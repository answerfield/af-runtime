import type { Bundle, CodingResult, Judgments, ResponseSet, StateSnapshot } from '@answerfield/bundle';
import type { PracticeSummary } from '@answerfield/practice';
import {
    codeResponses, computed, createItemInstance, effect, requestedAccommodations, untracked, type LogEntry, type ParamValues
} from '@answerfield/runtime-core';
import { renderItem } from '@answerfield/runtime-wc';
import { Emitter } from './events.js';
import { loadPractice, type Practice } from './practice.js';
import { renderOptions, type PlayerOptions } from './options.js';

/** Options of {@link mountItem}. */
export interface ItemOptions extends PlayerOptions {
    /** State to resume from (`snapshot()` of an earlier run). */
    restore?: StateSnapshot;
    /** Item version as parameter values (e.g. from `randomVersion`); if absent, taken from `restore`, else defaults. */
    params?: ParamValues;
    /** Practice: `check()` evaluates the responses and shows results and feedback (loaded on demand). */
    practice?: boolean;
}

/** State of a mounted item for the host's own controls. */
export interface ItemState {
    item: string;
    /** Zero-based page and page count. */
    page: number;
    pageCount: number;
    /** Version (parameter values; empty without parameters). */
    params: Readonly<ParamValues>;
    /** Responses are locked (e.g. after a listening text). */
    locked: boolean;
    /** Navigation is free; false while e.g. a listening text runs. */
    navigation: boolean;
    /** The item has timers or media (`skip()` ends the running phase in a preview). */
    timed: boolean;
}

/** Events of an {@link ItemPlayer}; listeners get the new value. */
export interface ItemEvents extends Record<string, unknown> {
    change: ItemState;
    responses: ResponseSet;
    /** Resumable state after every response change. */
    snapshot: StateSnapshot;
}

/** A mounted item. Values are plain data; listeners are called after changes, not for the initial state. */
export interface ItemPlayer {
    readonly state: ItemState;
    /** Resolves once lazily loaded parts (switch access) are ready. */
    readonly ready: Promise<void>;
    on<K extends keyof ItemEvents>(event: K, listener: (value: ItemEvents[K]) => void): () => void;
    /** Shows a page (zero-based; clamped to the item's pages). */
    page(index: number): void;
    /** Preview only: ends the running play or lets running timers elapse. */
    skip(): void;
    /** With `practice` only: checks the responses and resolves to the summary (correct, partial, wrong, open). */
    check(): Promise<PracticeSummary | undefined>;
    responses(): ResponseSet;
    /** Coding with the built-in coder; `judgments` answer the questions for human coders. */
    coding(judgments?: Judgments): CodingResult;
    snapshot(): StateSnapshot;
    log(): LogEntry[];
    dispose(): void;
}

/** Shows an item of `bundle` in `element`. Throws if the bundle is unsupported or the item is missing. */
export function mountItem(element: HTMLElement, bundle: Bundle, item: string, options: ItemOptions = {}): ItemPlayer {
    const instance = createItemInstance(bundle, item, {
        ...(options.restore ? { restore: options.restore } : {}),
        accommodations: requestedAccommodations(options.profile ?? {}),
        ...(options.params ? { params: options.params } : {})
    });
    const rendered = renderItem(instance, element, renderOptions(options));
    let practice: Promise<Practice> | undefined = options.practice
        ? loadPractice().then(({ attachPractice }) => attachPractice(rendered.root, instance))
        : undefined;
    // a missing package is reported by check(); here it must not surface as an unhandled rejection
    practice?.catch(() => undefined);
    const events = new Emitter<ItemEvents>();
    const state = computed<ItemState>(() => ({
        item, page: instance.page.get(), pageCount: instance.pageCount, params: instance.params,
        locked: instance.flow.locked.get(), navigation: instance.flow.navigation.get(), timed: instance.clock !== undefined
    }));
    let current = state.peek();
    let first = true;
    const stops = [
        effect(() => {
            const s = state.get();
            untracked(() => {
                current = s;
                if (!first) events.emit('change', s);
            });
        }),
        effect(() => {
            const responses = instance.responses();
            untracked(() => {
                if (first) return;
                events.emit('responses', responses);
                events.emit('snapshot', instance.snapshot());
            });
        })
    ];
    first = false;
    let disposed = false;

    return {
        get state() { return current; },
        ready: rendered.ready,
        on: (event, listener) => events.on(event, listener),
        page: index => instance.page.set(Math.min(instance.pageCount - 1, Math.max(0, Math.trunc(index)))),
        skip: () => instance.clock?.skip(),
        check: () => practice?.then(p => p.check()) ?? Promise.resolve(undefined),
        responses: () => instance.responses(),
        coding: judgments => codeResponses(bundle, instance.responses(), judgments),
        snapshot: () => instance.snapshot(),
        log: () => [...instance.log],
        dispose: () => {
            if (disposed) return;
            disposed = true;
            stops.forEach(s => s());
            events.clear();
            void practice?.then(p => p.dispose(), () => undefined);
            practice = undefined;
            rendered.dispose();
            instance.dispose();
        }
    };
}
