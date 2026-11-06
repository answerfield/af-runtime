import { Dimension, Rational, truthy, type Value } from '@answerfield/expr';
import type { JsonValue } from '@answerfield/bundle';
import { batch, computed, effect, signal, untracked, type ReadonlySignal, type WritableSignal } from './signals.js';

/**
 * Time and media of an item: `timer` elements count down, `media` elements play, `flow` elements decide navigation,
 * lock and automatic advance. The runtime owns the time (extended time, resume, booklet pause, log); renderers only
 * display, play and report loading and the end of a play.
 */

/** Observable state of a `timer`. */
export interface TimerState {
    /** Counting: `running` and the item is active. */
    running: boolean;
    /** Remaining time in milliseconds while `running` is true; undefined otherwise. */
    remaining?: number;
    /** Effective duration in milliseconds (with the extended-time factor). */
    duration: number;
}

/** Handle of a `timer` for the renderer. */
export interface TimerControl {
    readonly state: ReadonlySignal<TimerState>;
    /** Advances the item's timers (called regularly by the renderer). */
    tick(): void;
}

/** Handle of a `media` element for the renderer. */
export interface MediaControl {
    /** Should play now: the `playing` argument and the item is active; a rise starts from the beginning. */
    readonly playing: ReadonlySignal<boolean>;
    /** Excerpt in seconds. */
    readonly from: ReadonlySignal<number | undefined>;
    readonly to: ReadonlySignal<number | undefined>;
    /** Fully loaded (fires the `ready` event; again after every reload). */
    ready(): void;
    /** Playback started (log only). */
    started(): void;
    /** Playback finished (counts for `heard()`, fires `ended`). */
    ended(): void;
}

/** Combined `flow` of an item: navigation free only if all allow it, locked if one locks, advance if one asks and navigation is free. */
export interface Flow {
    readonly navigation: ReadonlySignal<boolean>;
    readonly locked: ReadonlySignal<boolean>;
    readonly advance: ReadonlySignal<boolean>;
}

/** Timers and media of an item. */
export interface Clock {
    /** Completed plays of all media (for `heard()`). */
    readonly heard: ReadonlySignal<number>;
    /** Advances the timers (called regularly by renderer and booklet). */
    tick(): void;
    /** Preview only: ends running plays, else lets running timers elapse now. */
    skip(): void;
}

/** Saved state of a timer (`$timers` in the item snapshot). */
interface TimerSnapshot { elapsed: number; fired: boolean }

/** Callbacks of the interpreter for events and the log. */
export interface ClockHost {
    now(): number;
    /** The item is active (shown and not paused); timers count and media play only then. */
    active(): boolean;
    /** Extended-time factor for timers with `extended`. */
    factor: number;
    record(path: string, event: string): void;
}

interface TimerEntry {
    key: string;
    args: () => Readonly<Record<string, Value>>;
    fire: () => void;
    state: WritableSignal<TimerState>;
    /** Time counted before the running stretch, and its start (undefined while not counting). */
    accumulated: number;
    since?: number;
    fired: boolean;
}

/** Implementation of {@link Clock}; created by the item interpreter, elements register in document order. */
export class ItemClock implements Clock {
    private readonly timers: TimerEntry[] = [];
    private readonly media: Array<{ playing: ReadonlySignal<boolean>; ended: () => void }> = [];
    private readonly flows: Array<() => Readonly<Record<string, Value>>> = [];
    private readonly heardCount: WritableSignal<number>;
    private readonly restored: Record<string, TimerSnapshot>;
    private readonly flowVersion = signal(0);
    readonly flow: Flow;

    constructor(private readonly host: ClockHost, restore?: { timers?: JsonValue; heard?: JsonValue }) {
        this.restored = isTimers(restore?.timers) ? restore.timers : {};
        this.heardCount = signal(typeof restore?.heard === 'number' ? restore.heard : 0);
        const all = (name: string, fallback: boolean) => computed(() => {
            this.flowVersion.get();
            return this.flows.map(f => f()[name]).map(v => v === null || v === undefined ? fallback : truthy(v));
        });
        const navigation = all('navigation', true), locked = all('locked', false), advance = all('advance', false);
        this.flow = {
            navigation: computed(() => navigation.get().every(Boolean)),
            locked: computed(() => locked.get().some(Boolean)),
            advance: computed(() => advance.get().some(Boolean) && navigation.get().every(Boolean))
        };
    }

    get heard(): ReadonlySignal<number> { return this.heardCount; }

    /** Whether the item has timers or media (otherwise there is nothing to tick). */
    get used(): boolean { return this.timers.length > 0 || this.media.length > 0; }

    /** Registers a `timer` under a stable key; `fire` runs its `elapsed` handlers. */
    timer(key: string, args: () => Readonly<Record<string, Value>>, fire: () => void): { control: TimerControl; dispose: () => void } {
        const saved = this.restored[key];
        const entry: TimerEntry = {
            key, args, fire, accumulated: 0, fired: false,
            state: signal<TimerState>({ running: false, duration: 0 }, sameTimer)
        };
        this.timers.push(entry);
        const running = computed(() => truthy(args().running ?? true));
        let previous: boolean | undefined;
        // Every rise of `running` starts from the full duration; the very first one resumes a saved state
        const stopRunning = effect(() => {
            const on = running.get();
            untracked(() => {
                if (on && !previous) {
                    const resume = previous === undefined ? saved : undefined;
                    Object.assign(entry, { accumulated: resume?.elapsed ?? 0, since: undefined, fired: resume?.fired ?? false });
                    if (!resume) this.host.record(key, 'timer.start');
                }
                previous = on;
                this.update(entry, on);
            });
        });
        const stopActive = effect(() => {
            const active = this.host.active();
            untracked(() => this.update(entry, running.peek(), active));
        });
        return { control: { state: entry.state, tick: () => this.tick() }, dispose: () => { stopRunning(); stopActive(); } };
    }

    /** Registers a `media` element; `emit` fires its events (`ready`, `ended`). */
    mediaElement(key: string, args: () => Readonly<Record<string, Value>>, emit: (event: string) => void): MediaControl {
        const playing = computed(() => truthy(args().playing ?? false) && this.host.active());
        const seconds = (name: string) => computed(() => { const v = args()[name]; return v instanceof Dimension ? millis(v) / 1000 : undefined; });
        const ended = () => {
            if (!playing.peek()) return;
            batch(() => {
                this.heardCount.set(this.heardCount.peek() + 1);
                this.host.record(key, 'media.ended');
                emit('ended');
            });
        };
        this.media.push({ playing, ended });
        return {
            playing, from: seconds('from'), to: seconds('to'), ended,
            ready: () => { this.host.record(key, 'media.ready'); emit('ready'); },
            started: () => this.host.record(key, 'media.play')
        };
    }

    /** Registers a `flow` element. */
    flowElement(args: () => Readonly<Record<string, Value>>): void {
        this.flows.push(args);
        this.flowVersion.set(this.flowVersion.peek() + 1);
    }

    tick(): void {
        for (const entry of this.timers) {
            const running = untracked(() => truthy(entry.args().running ?? true));
            this.update(entry, running);
            if (!running || entry.fired || entry.since === undefined) continue;
            if (this.elapsed(entry) >= this.duration(entry)) {
                entry.fired = true;
                this.host.record(entry.key, 'timer.elapsed');
                entry.fire();
            }
        }
    }

    skip(): void {
        const playing = this.media.filter(m => m.playing.peek());
        if (playing.length > 0) {
            playing.forEach(m => m.ended());
            return;
        }
        for (const entry of this.timers) {
            if (entry.since !== undefined && !entry.fired) entry.accumulated = this.duration(entry) + 1;
        }
        this.tick();
    }

    /** Snapshot entries; undefined without timers and plays. */
    snapshot(): { $timers?: JsonValue; $heard?: JsonValue } {
        const timers = Object.fromEntries(this.timers
            .filter(t => t.state.peek().running || t.fired || t.accumulated > 0)
            .map(t => [t.key, { elapsed: Math.round(this.elapsed(t)), fired: t.fired }]));
        return {
            ...(Object.keys(timers).length > 0 ? { $timers: timers as unknown as JsonValue } : {}),
            ...(this.heardCount.peek() > 0 ? { $heard: this.heardCount.peek() } : {})
        };
    }

    /** Books the running stretch and publishes the state; `running` is the argument, counting needs the item active. */
    private update(entry: TimerEntry, running: boolean, active = untracked(() => this.host.active())): void {
        const counting = running && active;
        const t = this.host.now();
        if (entry.since !== undefined && !counting) {
            entry.accumulated += t - entry.since;
            entry.since = undefined;
        } else if (entry.since === undefined && counting) {
            entry.since = t;
        }
        const duration = this.duration(entry);
        entry.state.set({
            running, duration,
            ...(running ? { remaining: Math.max(0, duration - this.elapsed(entry)) } : {})
        });
    }

    private elapsed(entry: TimerEntry): number {
        return entry.accumulated + (entry.since !== undefined ? this.host.now() - entry.since : 0);
    }

    private duration(entry: TimerEntry): number {
        const args = untracked(() => entry.args());
        return millis(args.duration) * (args.extended === false ? 1 : this.host.factor);
    }
}

function sameTimer(a: TimerState, b: TimerState): boolean {
    return a.running === b.running && a.remaining === b.remaining && a.duration === b.duration;
}

function isTimers(v: JsonValue | undefined): v is Record<string, TimerSnapshot> & JsonValue {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Duration like `30s`, `2min`, `500ms` in milliseconds; 0 if not a duration. */
export function millis(v: Value): number {
    if (!(v instanceof Dimension)) return 0;
    const m = /^([0-9]+(?:\.[0-9]+)?)(ms|s|min)$/.exec(v.text);
    if (!m) return 0;
    const n = Number(m[1]);
    return m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : n * 60000;
}

/** `heard()` as a number value. */
export function heardValue(clock: Clock): Value {
    return new Rational(BigInt(clock.heard.get()));
}
