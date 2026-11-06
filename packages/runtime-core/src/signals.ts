/**
 * Reactive primitives: signal (state), computed (derived), effect.
 * Thin adapter over alien-signals with Angular-like semantics, so hosts can bridge them easily.
 */
import * as alien from 'alien-signals';

/** Readable signal; `get()` inside a computed or effect creates a dependency. */
export interface ReadonlySignal<T> {
    get(): T;
    /** Reads the value without creating a dependency. */
    peek(): T;
}

/** Signal that can be set. */
export interface WritableSignal<T> extends ReadonlySignal<T> {
    set(value: T): void;
}

/** Creates a writable signal; setting a value `equals` to the current one notifies nobody. */
export function signal<T>(value: T, equals: (a: T, b: T) => boolean = Object.is): WritableSignal<T> {
    const s = alien.signal(value);
    return {
        get: () => s(),
        peek: () => untracked(() => s()),
        set: v => { if (!equals(v, untracked(() => s()))) s(v); }
    };
}

/** Outcome of a computation; errors are stored like values and rethrown on read. */
type Outcome<T> = { value: T } | { error: unknown };

/** Computations currently running; used to detect values that depend on themselves. */
const computing = new Set<object>();

/** Derived signal, recomputed lazily; errors are cached and rethrown on read, cycles throw. */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
    const key = {};
    const c = alien.computed<Outcome<T>>(previous => {
        computing.add(key);
        let next: Outcome<T>;
        try {
            next = { value: fn() };
        } catch (e) {
            next = { error: e ?? new Error('Unbekannter Fehler') };
        } finally {
            computing.delete(key);
        }
        // Keep an equal outcome so dependents don't rerun
        if (previous && 'value' in previous && 'value' in next && Object.is(previous.value, next.value)) return previous;
        if (previous && 'error' in previous && 'error' in next && message(previous.error) === message(next.error)) return previous;
        return next;
    });
    const read = (): T => {
        if (computing.has(key)) throw new Error('Zyklus: Wert hängt von sich selbst ab');
        const o = c();
        if ('error' in o) throw o.error;
        return o.value;
    };
    return { get: read, peek: () => untracked(read) };
}

/**
 * Runs `fn` now and again after every change of its dependencies; returns the disposer.
 * Effects are always top-level: otherwise alien-signals would treat an effect created inside another effect as
 * its child and dispose it on the outer effect's next run.
 */
export function effect(fn: () => (() => void) | void): () => void {
    return untracked(() => alien.effect(fn));
}

/** Groups changes; effects run once at the end. */
export function batch<T>(fn: () => T): T {
    alien.startBatch();
    try {
        return fn();
    } finally {
        alien.endBatch();
    }
}

/** Runs `fn` without tracking the signals it reads. */
export function untracked<T>(fn: () => T): T {
    const previous = alien.setActiveSub(undefined);
    try {
        return fn();
    } finally {
        alien.setActiveSub(previous);
    }
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
