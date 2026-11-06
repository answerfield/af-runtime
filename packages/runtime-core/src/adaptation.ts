// Overview for those who adapt items: what the item rules out, which texts still lack a language level, which
// graphics lack a description. Computed by running the item with and without each accommodation.
import type { Bundle } from '@answerfield/bundle';
import { display, isContentValue, type Value } from '@answerfield/expr';
import { createItemInstance, type ItemInstance, type RNode } from './instance.js';

/** One language level: how many texts it changes, and the texts it leaves as they are. */
export interface LevelCoverage {
    level: 'simple' | 'easy';
    total: number;
    adapted: number;
    unchanged: string[];
}

/** Adaptation overview of one item. */
export interface AdaptationReport {
    item: string;
    title?: string;
    /** Accommodations the item rules out, with the reason given in `deny`. */
    denied: string[];
    reason?: string;
    /** Language levels the item does not rule out. */
    levels: LevelCoverage[];
    /** Graphics (`plane`, images) and how many have a description; absent if descriptions are ruled out. */
    graphics?: { total: number; described: number };
    /** The numbers depend on accommodations (`versions`): those versions are easier or harder. */
    varies: boolean;
}

const LEVELS = [['simple', 'simple_language'], ['easy', 'easy_language']] as const;

/** Overview for `item` of `bundle`. Texts are what is displayed with at least three words. */
export function adaptationReport(bundle: Bundle, item: string): AdaptationReport {
    const def = bundle.items.find(i => i.name === item);
    if (!def) throw new Error(`Aufgabe '${item}' ist nicht im Bundle.`);
    const denied = def.accommodations?.deny ?? [];
    const run = <T>(accommodations: string[], f: (instance: ItemInstance) => T): T => {
        const instance = createItemInstance(bundle, item, { accommodations });
        try { return f(instance); } finally { instance.dispose(); }
    };
    const original = run([], i => texts(i.nodes));
    const levels = LEVELS.filter(([, a]) => !denied.includes(a)).map(([level, accommodation]) => {
        const shown = new Set(run([accommodation], i => texts(i.nodes)));
        const unchanged = original.filter(t => shown.has(t));
        return { level, total: original.length, adapted: original.length - unchanged.length, unchanged };
    });
    return {
        item,
        ...(def.title !== undefined ? { title: def.title } : {}),
        denied,
        ...(def.accommodations?.reason ? { reason: def.accommodations.reason } : {}),
        levels,
        ...(denied.includes('extended_descriptions') ? {} : { graphics: run(['extended_descriptions'], i => graphics(i.nodes)) }),
        varies: def.params !== undefined && JSON.stringify(def.versions ?? null).includes('"accommodations"')
    };
}

/** Displayed texts with at least three words: an element's own content in one piece, plus labels and headings. */
function texts(nodes: RNode[]): string[] {
    const result = new Set<string>();
    const add = (text: string) => {
        const clean = text.replace(/\s+/g, ' ').trim();
        if ((clean.match(/\p{L}{2,}/gu) ?? []).length >= 3) result.add(clean);
    };
    const visit = (list: RNode[]) => {
        for (const node of list) {
            switch (node.kind) {
                case 'element': {
                    const args = node.props.get().args;
                    for (const key of ['label', 'heading', 'caption']) if (args[key] != null) add(plain(args[key]));
                    add(node.children.filter(c => c.kind === 'content').map(c => safe(() => plain(c.value.get()))).join(''));
                    visit(node.children);
                    break;
                }
                case 'content':
                    break;
                case 'component': case 'show':
                    // Content directly in a component or block counts on its own (e.g. a toggle's option text)
                    node.children.forEach(c => { if (c.kind === 'content') add(safe(() => plain(c.value.get()))); });
                    visit(node.children);
                    break;
                case 'for':
                    (safe(() => node.iterations.get()) || []).forEach(visit);
                    break;
            }
        }
    };
    visit(nodes);
    return [...result];
}

/** Graphics and how many of them carry a description. */
function graphics(nodes: RNode[]): { total: number; described: number } {
    let total = 0, described = 0;
    const visit = (list: RNode[]) => {
        for (const node of list) {
            if (node.kind === 'element') {
                const props = node.props.get();
                const image = node.children.some(c => c.kind === 'content' && hasImage(safe(() => c.value.get())));
                if (node.element === 'plane' || image) {
                    total++;
                    if (props.variants.extended_descriptions != null) described++;
                }
                if (node.element !== 'plane') visit(node.children);
            } else if (node.kind === 'component' || node.kind === 'show') {
                visit(node.children);
            } else if (node.kind === 'for') {
                (safe(() => node.iterations.get()) || []).forEach(visit);
            }
        }
    };
    visit(nodes);
    return { total, described };
}

function plain(value: Value): string {
    if (isContentValue(value)) {
        if (value.content === 'seq') return Array.isArray(value.args.items) ? value.args.items.map(plain).join('') : '';
        if (value.content === 'image') return '';
        if (value.content === 'math') return display(value.args.tex ?? null);
        return plain(value.args.text ?? null);
    }
    return value === null ? '' : display(value);
}

function hasImage(value: Value): boolean {
    if (!isContentValue(value)) return false;
    if (value.content === 'image') return true;
    return value.content === 'seq' && Array.isArray(value.args.items) && value.args.items.some(hasImage);
}

function safe<T>(f: () => T): T {
    try { return f(); } catch { return '' as T; }
}
