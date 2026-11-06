// Runs the conformance cases of @answerfield/conformance against the reference runtime: starts the bundles of the
// package (no compiling, no language) and checks the observations step by step (semantik.md, section 15).
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { THEMES, type Case as ConformanceCase, type CaseFile } from '@answerfield/conformance';
import type { Bundle, JsonValue, Judgments } from '@answerfield/bundle';
import { Rational, display, fromJson, toJson, type Value } from '@answerfield/expr';
import {
    codeResponses, createBookletInstance, createItemInstance, type BookletInstance, type ItemInstance, type NeedsProfile,
    type ParamValues, type RNode
} from '../src/index.js';
import { elements } from './tree.js';

const require = createRequire(import.meta.url);

type Step = Record<string, JsonValue>;

/** A case of the package with its theme and loosely typed steps (the runner reports unknown steps itself). */
interface Case {
    name: string;
    bundle: string;
    item?: string;
    booklet?: string;
    accommodations?: string[];
    profile?: NeedsProfile;
    params?: ParamValues;
    steps: Step[];
}

interface Suite {
    bundles: Record<string, Bundle>;
    cases: Case[];
}

/** Bundles and cases of all themes, from the package; cases are named `<theme>/<case>`. */
function loadSuite(): Suite {
    const bundles: Record<string, Bundle> = {};
    const cases: Case[] = [];
    for (const theme of THEMES) {
        bundles[theme] = require(`@answerfield/conformance/cases/${theme}.bundle.json`) as Bundle;
        const file = require(`@answerfield/conformance/cases/${theme}.cases.json`) as CaseFile;
        for (const c of file.cases as ConformanceCase[]) {
            cases.push({ ...(c as unknown as Case), name: `${theme}/${c.name}`, bundle: theme });
        }
    }
    return { bundles, cases };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Partial match: objects compare only the expected keys, arrays element by element with equal length; `"*"` matches
 * any present value, `null` also matches an absent one.
 */
function mismatches(actual: unknown, expected: unknown, path: string): string[] {
    if (expected === '*') return actual === undefined ? [`${path}: fehlt`] : [];
    if (expected === null) return actual === null || actual === undefined ? [] : [`${path}: ${JSON.stringify(actual)} statt null`];
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || actual.length !== expected.length) {
            return [`${path}: ${JSON.stringify(actual)} statt ${JSON.stringify(expected)}`];
        }
        return expected.flatMap((e, i) => mismatches(actual[i], e, `${path}[${i}]`));
    }
    if (typeof expected === 'object') {
        if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
            return [`${path}: ${JSON.stringify(actual)} statt Objekt`];
        }
        return Object.entries(expected).flatMap(([k, e]) => mismatches((actual as Record<string, unknown>)[k], e, `${path}.${k}`));
    }
    return actual === expected ? [] : [`${path}: ${JSON.stringify(actual)} statt ${JSON.stringify(expected)}`];
}

/** Expected log entries (event name or partial entry) must occur in this order, others may lie between. */
function logMismatches(log: readonly unknown[], expected: JsonValue[]): string[] {
    let at = 0;
    for (const entry of expected) {
        const want = typeof entry === 'string' ? { event: entry } : entry;
        while (at < log.length && mismatches(log[at], want, '').length > 0) at++;
        if (at === log.length) return [`log: ${JSON.stringify(entry)} fehlt (in Reihenfolge)`];
        at++;
    }
    return [];
}

/** Display text of all visible content nodes of an item (current page, open `show` blocks). */
function visibleTexts(instance: ItemInstance): string[] {
    const texts: string[] = [];
    const visit = (nodes: RNode[], visible: boolean): void => nodes.forEach(n => {
        switch (n.kind) {
            case 'content':
                if (visible) try { texts.push(display(n.value.get())); } catch { /* evaluation error: nothing shown */ }
                return;
            case 'element': case 'component': return visit(n.children, visible);
            case 'show': {
                let open = false;
                try { open = n.visible.get(); } catch { /* hidden on error */ }
                return visit(n.children, visible && open);
            }
            case 'for': return n.iterations.get().forEach(it => visit(it, visible));
        }
    });
    let page = 0;
    for (const node of instance.nodes) {
        const isPage = node.kind === 'element' && node.element === 'page';
        visit([node], !isPage || page++ === instance.page.get());
    }
    return texts;
}

/** Value of a step's `value`, decoded with `type` or by its JSON shape (text, number, point). */
function payload(step: Step): Value {
    const value = step.value ?? null;
    if (typeof step.type === 'string') return fromJson(value, step.type);
    if (typeof value === 'number') return Rational.of(value);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return fromJson(value, 'Point');
    return value as Value;
}

function jsonArgs(args: Readonly<Record<string, Value>>): Record<string, JsonValue> {
    return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, toJson(v)]));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Runs one case against the reference runtime; returns all mismatches. */
function run(suite: Suite, c: Case): string[] {
    const bundle = suite.bundles[c.bundle];
    let now = 0;
    const clock = () => now;
    let judgments: Judgments = {};
    let item: ItemInstance | undefined;
    let booklet: BookletInstance | undefined;
    if (c.booklet) booklet = createBookletInstance(bundle, c.booklet, { profile: c.profile, now: clock });
    else item = createItemInstance(bundle, c.item!, { accommodations: c.accommodations, params: c.params, now: clock });
    const current = (): ItemInstance => booklet ? booklet.current.get() : item!;
    const atom = (target: JsonValue) => {
        const { element, index } = target as { element: string; index: number };
        const found = elements(current().nodes).filter(e => e.element === element)[index];
        if (!found) throw new Error(`${element} #${index} nicht gefunden`);
        return found;
    };

    const failures: string[] = [];
    c.steps.forEach((step, s) => {
        const at = `Schritt ${s + 1}`;
        if ('emit' in step) atom(step.emit).emit(String(step.event), step.event === 'bind' ? payload(step) : undefined);
        else if ('page' in step) current().page.set(Number(step.page));
        else if ('advance' in step) {
            now += Number(step.advance);
            if (booklet) booklet.tick(); else item!.clock?.tick();
        } else if ('media' in step) {
            // What the renderer reports for the n-th media element: loaded, play started, play ended
            const control = elements(current().nodes).filter(e => e.element === 'media')[Number(step.media)]?.media;
            if (!control) throw new Error(`${at}: media #${String(step.media)} nicht gefunden`);
            const signal = String(step.signal);
            if (signal === 'ready') control.ready(); else if (signal === 'ended') control.ended(); else control.started();
        } else if ('judge' in step) judgments = step.judge as Judgments;
        else if ('next' in step) booklet!.next();
        else if ('previous' in step) booklet!.previous();
        else if ('goTo' in step) booklet!.goTo(Number(step.goTo));
        else if ('finish' in step) booklet!.finish();
        else if ('control' in step) booklet!.control(step.control as never);
        else if ('restore' in step) {
            if (booklet) {
                const snapshot = JSON.parse(JSON.stringify(booklet.snapshot()));
                booklet.dispose();
                booklet = createBookletInstance(bundle, c.booklet!, { profile: c.profile, now: clock, restore: snapshot });
            } else {
                const snapshot = JSON.parse(JSON.stringify(item!.snapshot()));
                item!.dispose();
                item = createItemInstance(bundle, c.item!, { accommodations: c.accommodations, now: clock, restore: snapshot });
            }
        } else if ('expect' in step) {
            failures.push(...check(step.expect as Record<string, JsonValue>).map(f => `${at}: ${f}`));
        } else {
            throw new Error(`${at}: unbekannter Schritt ${JSON.stringify(step)}`);
        }
    });
    return failures;

    function check(expected: Record<string, JsonValue>): string[] {
        const instance = current();
        return Object.entries(expected).flatMap(([key, want]): string[] => {
            switch (key) {
                case 'responses':
                    return booklet
                        ? Object.entries(want as Record<string, JsonValue>).flatMap(([name, w]) => mismatches(booklet!.items.get(name)!.responses(), w, `responses.${name}`))
                        : mismatches(instance.responses(), want, 'responses');
                case 'coding':
                    return booklet
                        ? Object.entries(want as Record<string, JsonValue>).flatMap(([name, w]) =>
                            mismatches(codeResponses(bundle, booklet!.items.get(name)!.responses(), judgments), w, `coding.${name}`))
                        : mismatches(codeResponses(bundle, instance.responses(), judgments), want, 'coding');
                case 'state':
                    return mismatches(instance.snapshot(), want, 'state');
                case 'accommodations':
                    return mismatches([...(booklet ? booklet.accommodations : instance.accommodations)].sort(), want, key);
                case 'params': return mismatches(instance.params, want, key);
                case 'page': return mismatches(instance.page.get(), want, key);
                case 'pageCount': return mismatches(instance.pageCount, want, key);
                case 'elements':
                    return (want as JsonValue[]).flatMap((w, i) => {
                        const el = atom(w);
                        const props = el.props.get();
                        const observed = {
                            element: el.element, index: (w as { index: number }).index,
                            args: jsonArgs(props.args), variants: jsonArgs(props.variants),
                            ...(props.bind !== undefined ? { bind: toJson(props.bind) } : {})
                        };
                        return mismatches(observed, w, `elements[${i}]`);
                    });
                case 'shows': {
                    const texts = visibleTexts(instance);
                    return (want as string[]).filter(t => !texts.includes(t)).map(t => `shows: "${t}" nicht sichtbar (${JSON.stringify(texts)})`);
                }
                case 'hides': {
                    const texts = visibleTexts(instance);
                    return (want as string[]).filter(t => texts.includes(t)).map(t => `hides: "${t}" ist sichtbar`);
                }
                case 'timers':
                    return mismatches(elements(instance.nodes).filter(e => e.element === 'timer').map(t => JSON.parse(JSON.stringify(t.timer!.state.get()))), want, key);
                case 'playing':
                    return mismatches(elements(instance.nodes).filter(e => e.element === 'media').map(m => m.media!.playing.get()), want, key);
                case 'heard': return mismatches(instance.clock?.heard.get() ?? 0, want, key);
                case 'locked': return mismatches(instance.flow.locked.get(), want, key);
                case 'navigation': return mismatches(instance.flow.navigation.get(), want, key);
                case 'log': return logMismatches(booklet ? booklet.log : instance.log, want as JsonValue[]);
            }
            if (!booklet) return [`${key}: nur bei Testheften`];
            const observed: Record<string, unknown> = {
                position: booklet.position.get(), current: instance.item.name, part: booklet.part.get().name,
                remaining: booklet.remaining.get() ?? null, finished: booklet.finished.get(), waiting: booklet.waiting.get(),
                paused: booklet.paused.get(), canNext: booklet.canNext.get(), canPrevious: booklet.canPrevious.get(),
                atPartEnd: booklet.atPartEnd.get()
            };
            if (!(key in observed)) return [`unbekannte Erwartung '${key}'`];
            return mismatches(observed[key], want, key);
        });
    }
}

// ---------------------------------------------------------------------------

const suite = loadSuite();

describe('Konformitätsfälle', () => {
    test.each(suite.cases.map(c => c.name))('%s', name => {
        expect(run(suite, suite.cases.find(c => c.name === name)!)).toEqual([]);
    });
});
