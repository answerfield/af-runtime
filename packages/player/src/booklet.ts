import type { Bundle, CodingResult, PartDef, ResponseSet } from '@answerfield/bundle';
import {
    createBookletInstance, effect, untracked, type BookletInstance, type BookletSnapshot, type ControlCommand, type LogEntry,
    type Position
} from '@answerfield/runtime-core';
import { renderItem, type Rendered } from '@answerfield/runtime-wc';
import { Emitter } from './events.js';
import { renderOptions, type PlayerOptions } from './options.js';

/** Options of {@link mountBooklet}. */
export interface BookletOptions extends PlayerOptions {
    /** State to resume from (`snapshot()` of an earlier run). */
    restore?: BookletSnapshot;
    /** Clock tick in milliseconds (time limits, timers); 0: the host calls `tick()` itself. */
    tickInterval?: number;
    /** While running, a `snapshot` event at least this often in milliseconds (elapsed time); 0: only on changes. */
    saveInterval?: number;
}

/** Booklet state for the host's navigation and chrome. */
export interface BookletState {
    part: PartDef;
    position: Position;
    /** Name of the current item or instruction page. */
    item: string;
    instruction: boolean;
    /** One-based number of the current item within the part (instructions excluded), and the item count. */
    itemNumber: number;
    itemCount: number;
    /** Zero-based page of the current item, and its page count. */
    page: number;
    pageCount: number;
    /** Remaining time of the part in seconds; absent if untimed. */
    remaining?: number;
    canNext: boolean;
    canPrevious: boolean;
    atPartEnd: boolean;
    isLastPart: boolean;
    finished: boolean;
    /** Part is waiting to be released by the test administrator. */
    waiting: boolean;
    /** Paused by the test administrator. */
    paused: boolean;
}

/** Events of a {@link BookletPlayer}; listeners get the new value. */
export interface BookletEvents extends Record<string, unknown> {
    change: BookletState;
    responses: ResponseSet[];
    /** Resumable state on every relevant change and regularly while running (see `saveInterval`). */
    snapshot: BookletSnapshot;
    finished: void;
}

/** Log of a booklet (navigation, time, test administrator) and of its items. */
export interface BookletLog {
    booklet: LogEntry[];
    items: Record<string, LogEntry[]>;
}

/**
 * A mounted booklet. The host builds navigation from `state` and the methods; the current item is rendered into
 * the element, which gets the focus when the item changes.
 */
export interface BookletPlayer {
    readonly state: BookletState;
    on<K extends keyof BookletEvents>(event: K, listener: (value: BookletEvents[K]) => void): () => void;
    /** Next page or item, as the booklet rules allow. */
    next(): void;
    previous(): void;
    /** Jumps to an entry (zero-based) of the current part; only with `navigation: free`. */
    goTo(entry: number): void;
    finish(): void;
    /** Test administrator command: release, pause, resume, extend, end. */
    control(command: ControlCommand): void;
    /** Advances the clock (only needed with `tickInterval: 0`). */
    tick(): void;
    /** Preview only: ends the running play or lets running timers of the current item elapse. */
    skip(): void;
    responses(): ResponseSet[];
    /** Coding of all items with the built-in coder (questions for human coders stay open). */
    coding(): CodingResult[];
    snapshot(): BookletSnapshot;
    log(): BookletLog;
    /** Accommodations in effect at booklet level, and the time factor. */
    accommodations(): { accommodations: string[]; timeFactor: number };
    dispose(): void;
}

/** Shows a booklet of `bundle` in `element`. Throws if the bundle is unsupported or the booklet is missing. */
export function mountBooklet(element: HTMLElement, bundle: Bundle, name: string, options: BookletOptions = {}): BookletPlayer {
    const booklet = createBookletInstance(bundle, name, { profile: options.profile ?? {}, ...(options.restore ? { restore: options.restore } : {}) });
    if (!element.hasAttribute('tabindex')) element.tabIndex = -1;
    const events = new Emitter<BookletEvents>();
    const render = renderOptions(options);
    let rendered: Rendered | undefined;
    let current = stateOf(booklet);
    let first = true;
    const stops = [
        // the current item, or a calm notice while waiting for release or paused; focus to the start of a new item
        effect(() => {
            const item = booklet.current.get();
            const done = booklet.finished.get();
            const halted = booklet.waiting.get() || booklet.paused.get();
            untracked(() => {
                rendered?.dispose();
                element.querySelector(':scope > .af-booklet-halt')?.remove();
                rendered = done || halted ? undefined : renderItem(item, element, render);
                if (halted) {
                    const note = element.ownerDocument.createElement('p');
                    note.className = 'af-booklet-halt';
                    note.setAttribute('role', 'status');
                    note.textContent = booklet.waiting.get() ? 'Bitte warte, bis es weitergeht.' : 'Pause. Es geht gleich weiter.';
                    element.append(note);
                }
                if (!first) element.focus({ preventScroll: false });
            });
        }),
        effect(() => {
            const s = stateOf(booklet);
            untracked(() => {
                current = s;
                if (!first) events.emit('change', s);
            });
        }),
        effect(() => {
            const responses = booklet.responses();
            // position, page and test administrator actions belong in the saved state; the clock does not (it changes
            // every second): the elapsed time comes with the regular snapshot below
            booklet.position.get(); booklet.current.get().page.get(); booklet.finished.get();
            booklet.waiting.get(); booklet.paused.get();
            untracked(() => {
                if (first) return;
                events.emit('responses', responses);
                events.emit('snapshot', booklet.snapshot());
            });
        }),
        effect(() => {
            if (booklet.finished.get()) untracked(() => { if (!first) events.emit('finished', undefined); });
        })
    ];
    first = false;
    const tickEvery = options.tickInterval ?? 1000, saveEvery = options.saveInterval ?? 10_000;
    const ticker = tickEvery > 0 ? setInterval(() => booklet.tick(), tickEvery) : undefined;
    const saver = saveEvery > 0 ? setInterval(() => { if (!booklet.finished.peek()) events.emit('snapshot', booklet.snapshot()); }, saveEvery) : undefined;
    let disposed = false;

    return {
        get state() { return current; },
        on: (event, listener) => events.on(event, listener),
        next: () => booklet.next(),
        previous: () => booklet.previous(),
        goTo: entry => booklet.goTo(entry),
        finish: () => booklet.finish(),
        control: command => booklet.control(command),
        tick: () => booklet.tick(),
        skip: () => booklet.current.peek().clock?.skip(),
        responses: () => booklet.responses(),
        coding: () => booklet.coding(),
        snapshot: () => booklet.snapshot(),
        log: () => ({ booklet: [...booklet.log], items: Object.fromEntries([...booklet.items].map(([n, i]) => [n, [...i.log]])) }),
        accommodations: () => ({ accommodations: [...booklet.accommodations].sort(), timeFactor: booklet.timeFactor }),
        dispose: () => {
            if (disposed) return;
            disposed = true;
            clearInterval(ticker);
            clearInterval(saver);
            stops.forEach(s => s());
            events.clear();
            rendered?.dispose();
            booklet.dispose();
        }
    };
}

function stateOf(b: BookletInstance): BookletState {
    const part = b.part.get();
    const current = b.current.get();
    const items = part.entries.filter(e => !b.items.get(e)?.item.instruction);
    const remaining = b.remaining.get();
    return {
        part,
        position: b.position.get(),
        item: current.item.name,
        instruction: current.item.instruction === true,
        itemNumber: items.indexOf(current.item.name) + 1,
        itemCount: items.length,
        page: current.page.get(),
        pageCount: current.pageCount,
        ...(remaining !== undefined ? { remaining } : {}),
        canNext: b.canNext.get(),
        canPrevious: b.canPrevious.get(),
        atPartEnd: b.atPartEnd.get(),
        isLastPart: b.isLastPart.get(),
        finished: b.finished.get(),
        waiting: b.waiting.get(),
        paused: b.paused.get()
    };
}
