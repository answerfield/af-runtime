import { bundleProblem, type BookletDef, type Bundle, type CodingResult, type JsonValue, type PartDef, type ResponseSet, type StateSnapshot } from '@answerfield/bundle';
import { batch, computed, signal, untracked, type ReadonlySignal } from './signals.js';
import { createItemInstance, RuntimeError, type ItemInstance, type LogEntry } from './instance.js';
import { codeResponses } from './coding.js';
import { effectiveAccommodations, requestedAccommodations, type NeedsProfile } from './accommodations.js';

/** Position in a booklet: part index and entry index within the part, both 0-based. */
export interface Position {
    part: number;
    entry: number;
}

/** Booklet state for resume. */
export interface BookletSnapshot {
    /** Start of the booklet in ms since epoch (reference for all log times). */
    startedAt: number;
    position: Position;
    /** Time used per part name, in milliseconds. */
    elapsed: Record<string, number>;
    finished: boolean;
    /** Item snapshots by item name. */
    items: Record<string, StateSnapshot>;
    log: LogEntry[];
    /** Test administrator state: released parts, pause, extension per part (seconds), last command number. */
    control?: { released: string[]; paused: boolean; extra: Record<string, number>; seq: number };
}

/**
 * Command from the test administrator. `part`: a part name, otherwise the current part. `seq`: sequence number of
 * the command; a command with the same or a lower number is ignored (duplicate delivery, e.g. after reconnecting).
 */
export type ControlCommand =
    | { kind: 'release'; part?: string; seq?: number }
    | { kind: 'pause'; seq?: number }
    | { kind: 'resume'; seq?: number }
    | { kind: 'extend'; seconds: number; part?: string; seq?: number }
    | { kind: 'end'; part?: string; seq?: number };

/** Options for {@link createBookletInstance}. */
export interface BookletOptions {
    restore?: BookletSnapshot;
    /** The test taker's needs profile; only what study rules and item allow takes effect. */
    profile?: NeedsProfile;
    now?: () => number;
}

/** Running booklet; all signals are reactive for the host. */
export interface BookletInstance {
    readonly booklet: BookletDef;
    readonly position: ReadonlySignal<Position>;
    readonly part: ReadonlySignal<PartDef>;
    /** Current item or instruction page. */
    readonly current: ReadonlySignal<ItemInstance>;
    /** All item instances by name. */
    readonly items: ReadonlyMap<string, ItemInstance>;
    readonly canPrevious: ReadonlySignal<boolean>;
    /** Next is possible within the current part (page or item). */
    readonly canNext: ReadonlySignal<boolean>;
    /** At the end of the part: next leaves it (no way back). */
    readonly atPartEnd: ReadonlySignal<boolean>;
    readonly isLastPart: ReadonlySignal<boolean>;
    /** Remaining time of the current part in seconds; undefined without a time limit. */
    readonly remaining: ReadonlySignal<number | undefined>;
    readonly finished: ReadonlySignal<boolean>;
    /** The current part waits for release by the test administrator (`start: released`). */
    readonly waiting: ReadonlySignal<boolean>;
    /** Paused by the test administrator: no input, the clock stops. */
    readonly paused: ReadonlySignal<boolean>;
    /** Effective accommodations at booklet level (profile ∩ study rules); items may restrict further. */
    readonly accommodations: ReadonlySet<string>;
    /** Factor for time limits (`extended_time`). */
    readonly timeFactor: number;
    readonly log: readonly LogEntry[];
    next(): void;
    previous(): void;
    /** Jumps to an entry of the current part (only with `navigation: free`). */
    goTo(entry: number): void;
    /** Ends the booklet. */
    finish(): void;
    /** Applies a test administrator command (release, pause, resume, extend, end); logged. */
    control(command: ControlCommand): void;
    /** Advances the clock; leaves the part when time is up. The host calls this regularly. */
    tick(): void;
    /** Responses of all items (without instruction pages); reactive. */
    responses(): ResponseSet[];
    /** Coding of all responses, without judgments (manual questions stay pending). */
    coding(): CodingResult[];
    snapshot(): BookletSnapshot;
    dispose(): void;
}

/**
 * Runs a booklet: sequence of parts and entries, time limits with extension, test administrator control and shared
 * state. Items never reached stay "not displayed" and are coded `not_reached`.
 */
export function createBookletInstance(bundle: Bundle, name: string, options: BookletOptions = {}): BookletInstance {
    const problem = bundleProblem(bundle);
    if (problem) throw new RuntimeError(problem);
    const booklet = bundle.booklets?.find(b => b.name === name);
    if (!booklet) throw new RuntimeError(`Testheft '${name}' ist nicht im Bundle`);
    if (booklet.parts.length === 0) throw new RuntimeError(`Testheft '${name}' hat keine Teile`);
    const now = options.now ?? (() => Date.now());
    const restore = options.restore;
    const log: LogEntry[] = [...(restore?.log ?? [])];
    const start = restore?.startedAt ?? now();
    const record = (event: string, value?: JsonValue) => log.push({ t: now() - start, path: '', event, ...(value !== undefined ? { value } : {}) });

    const requested = requestedAccommodations(options.profile ?? {});
    const accommodations = effectiveAccommodations(requested, booklet.accommodations);
    const timeFactor = accommodations.has('extended_time') ? Math.max(1, options.profile?.timing?.extension ?? 1) : 1;

    // Use the saved position only if it exists in the booklet (it may not after the booklet changed)
    const saved = restore?.position;
    const valid = saved && Number.isInteger(saved.part) && Number.isInteger(saved.entry) && saved.part >= 0 && saved.entry >= 0
        && saved.part < booklet.parts.length && saved.entry < booklet.parts[saved.part].entries.length;
    const position = signal<Position>(valid ? { part: saved.part, entry: saved.entry } : { part: 0, entry: 0 }, (a, b) => a.part === b.part && a.entry === b.entry);
    const finished = signal(restore?.finished ?? false);
    // Test administrator state
    const released = signal<ReadonlySet<string>>(new Set(restore?.control?.released ?? []));
    const paused = signal(restore?.control?.paused ?? false);
    const extra = new Map(Object.entries(restore?.control?.extra ?? {}));
    // Bumped on every extension so `remaining` updates without waiting for the next tick
    const extended = signal(0);
    let seq = restore?.control?.seq ?? 0;
    let pausePending = false;
    const clock = signal(now());
    // Time used by completed stretches per part, plus start of the running stretch
    const elapsed = new Map(Object.entries(restore?.elapsed ?? {}));
    let runningSince = now();

    const waitsFor = (p: PartDef) => p.start === 'released' && !released.get().has(p.name);
    // Displayed and operable only while the part runs: not before release, not while paused
    const halted = () => paused.get() || waitsFor(booklet.parts[position.get().part]);
    const items = new Map<string, ItemInstance>();
    booklet.parts.forEach((part, p) => part.entries.forEach((entry, e) => {
        const active = () => !finished.get() && !halted() && position.get().part === p && position.get().entry === e;
        items.set(entry, createItemInstance(bundle, entry, {
            restore: restore?.items?.[entry],
            accommodations: [...accommodations],
            now,
            active,
            epoch: start,
            timeFactor
        }));
    }));

    const part = computed(() => booklet.parts[position.get().part]);
    const waiting = computed(() => !finished.get() && waitsFor(part.get()));
    const stopped = computed(() => waiting.get() || paused.get());
    const current = computed(() => items.get(part.get().entries[position.get().entry])!);
    const lastEntry = computed(() => position.get().entry >= part.get().entries.length - 1);
    const lastPage = computed(() => current.get().page.get() >= current.get().pageCount - 1);
    // A `flow` can hold navigation (e.g. during a listening text) and advance automatically afterwards
    const listening = computed(() => !current.get().flow.navigation.get());
    const canNext = computed(() => !finished.get() && !stopped.get() && !listening.get() && (!lastPage.get() || !lastEntry.get()));
    const atPartEnd = computed(() => !finished.get() && !stopped.get() && !listening.get() && lastPage.get() && lastEntry.get());
    const isLastPart = computed(() => position.get().part >= booklet.parts.length - 1);
    const canPrevious = computed(() => {
        if (finished.get() || stopped.get() || listening.get() || part.get().navigation !== 'free') return false;
        return current.get().page.get() > 0 || position.get().entry > 0;
    });
    const running = () => !finished.peek() && !paused.peek() && !waitsFor(part.peek());
    const used = (p: PartDef, at: number) => (elapsed.get(p.name) ?? 0) + (p === part.peek() && running() ? Math.max(0, at - runningSince) : 0);
    const remaining = computed(() => {
        const p = part.get();
        if (p.time === undefined || finished.get()) return undefined;
        stopped.get();
        extended.get();
        return Math.max(0, Math.ceil(p.time * timeFactor + (extra.get(p.name) ?? 0) - used(p, clock.get()) / 1000));
    });

    /** Books the running time of the current part (only while it runs). */
    const settle = () => {
        const t = now();
        const p = part.peek();
        elapsed.set(p.name, (elapsed.get(p.name) ?? 0) + (running() ? t - runningSince : 0));
        runningSince = t;
    };

    const moveTo = (target: Position) => batch(() => {
        const leavingPart = target.part !== position.peek().part;
        if (leavingPart) {
            settle();
            record('part.leave', part.peek().name);
        }
        position.set(target);
        clock.set(now());
        items.get(booklet.parts[target.part].entries[target.entry])!.page.set(0);
        record('navigate', `${booklet.parts[target.part].name}/${booklet.parts[target.part].entries[target.entry]}`);
    });

    /** To the next item (skipping remaining pages of the current one); at the end of the part, to the next part. */
    const nextEntry = () => {
        const { part: p, entry } = position.peek();
        if (entry < booklet.parts[p].entries.length - 1) moveTo({ part: p, entry: entry + 1 });
        else leavePart();
    };
    // Items already left automatically after listening; don't advance from them again (e.g. when revisited locked)
    const advanced = new Set<ItemInstance>();

    const leavePart = () => {
        const p = position.peek().part;
        if (p < booklet.parts.length - 1) moveTo({ part: p + 1, entry: 0 });
        else finish();
    };

    const finish = () => {
        if (finished.peek()) return;
        settle();
        batch(() => finished.set(true));
        record('finish');
    };

    const partNamed = (name?: string) => name === undefined ? part.peek() : booklet.parts.find(p => p.name === name);
    const applyPause = () => batch(() => { settle(); paused.set(true); clock.set(now()); record('control.pause'); });
    const control = (command: ControlCommand) => {
        if (command.seq !== undefined) {
            if (command.seq <= seq) return;
            seq = command.seq;
        }
        if (finished.peek()) return;
        switch (command.kind) {
            case 'release': {
                const p = partNamed(command.part);
                if (!p || released.peek().has(p.name)) return;
                batch(() => {
                    settle();
                    released.set(new Set([...released.peek(), p.name]));
                    clock.set(now());
                    record('control.release', p.name);
                });
                return;
            }
            case 'pause':
                if (paused.peek()) return;
                // A fixed schedule (flow without navigation) cannot be paused: pause afterwards
                if (listening.peek()) { pausePending = true; record('control.pause.deferred'); return; }
                applyPause();
                return;
            case 'resume':
                pausePending = false;
                if (!paused.peek()) return;
                batch(() => { settle(); paused.set(false); clock.set(now()); record('control.resume'); });
                return;
            case 'extend': {
                const p = partNamed(command.part);
                if (!p || !(command.seconds > 0)) return;
                extra.set(p.name, (extra.get(p.name) ?? 0) + command.seconds);
                extended.set(extended.peek() + 1);
                clock.set(now());
                record('control.extend', { part: p.name, seconds: command.seconds });
                return;
            }
            case 'end': {
                if (command.part === undefined) { record('control.end'); finish(); return; }
                if (command.part !== part.peek().name) return;
                record('control.end', command.part);
                leavePart();
                return;
            }
        }
    };

    const instance: BookletInstance = {
        booklet, position, part, current, items, canPrevious, canNext, atPartEnd, isLastPart, remaining, finished,
        waiting, paused, accommodations, timeFactor, log, control,
        next: () => {
            if (finished.peek() || untracked(() => stopped.get()) || listening.peek()) return;
            const item = current.peek();
            if (item.page.peek() < item.pageCount - 1) {
                item.page.set(item.page.peek() + 1);
                return;
            }
            const { part: p, entry } = position.peek();
            if (entry < booklet.parts[p].entries.length - 1) moveTo({ part: p, entry: entry + 1 });
            else leavePart();
        },
        previous: () => {
            if (!untracked(() => canPrevious.get())) return;
            const item = current.peek();
            if (item.page.peek() > 0) {
                item.page.set(item.page.peek() - 1);
                return;
            }
            const { part: p, entry } = position.peek();
            moveTo({ part: p, entry: entry - 1 });
            const target = current.peek();
            target.page.set(target.pageCount - 1);
        },
        goTo: entry => {
            const p = position.peek().part;
            if (finished.peek() || untracked(() => stopped.get()) || listening.peek() || booklet.parts[p].navigation !== 'free') return;
            if (entry < 0 || entry >= booklet.parts[p].entries.length) return;
            moveTo({ part: p, entry });
        },
        finish,
        tick: () => {
            clock.set(now());
            // Timers of the current item; a `flow` with `advance` moves on once (e.g. after a listening text)
            const item = current.peek();
            if (!finished.peek()) {
                item.clock?.tick();
                if (!advanced.has(item) && item.flow.advance.peek()) {
                    advanced.add(item);
                    record('flow.advance', item.item.name);
                    nextEntry();
                    if (pausePending) { pausePending = false; applyPause(); }
                    return;
                }
            }
            if (pausePending && !listening.peek()) { pausePending = false; applyPause(); }
            if (untracked(() => remaining.get()) === 0) {
                record('timeout', part.peek().name);
                leavePart();
            }
        },
        responses: () => [...items.values()]
            .filter(i => !i.item.instruction)
            .map(i => i.responses()),
        coding: () => instance.responses().map(r => codeResponses(bundle, r)),
        snapshot: () => {
            const total = Object.fromEntries(booklet.parts.map(x => [x.name, used(x, now())]).filter(([, v]) => v !== 0));
            return {
                startedAt: start,
                position: position.peek(),
                elapsed: total,
                finished: finished.peek(),
                items: Object.fromEntries([...items].map(([n, i]) => [n, i.snapshot()])),
                log: [...log],
                control: { released: [...released.peek()], paused: paused.peek(), extra: Object.fromEntries(extra), seq }
            };
        },
        dispose: () => items.forEach(i => i.dispose())
    };
    record(restore ? 'resume' : 'start', `${part.peek().name}/${part.peek().entries[position.peek().entry]}`);
    return instance;
}
