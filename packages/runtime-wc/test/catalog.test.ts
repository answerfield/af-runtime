import { createRequire } from 'node:module';
import { beforeEach, describe, expect, test } from 'vitest';
import { BUNDLE_FORMAT, BUNDLE_VERSION, type Bundle, type Expr, type Catalog, type Node } from '@answerfield/bundle';
import { BUILTINS, isContentValue } from '@answerfield/expr';
import { ITEM_FUNCTIONS, META_FUNCTIONS, codeResponses, createItemInstance, type RContent } from '@answerfield/runtime-core';
import { AfMedia, RUNTIME_ELEMENTS, renderItem } from '../src/index.js';

// The runtime implements every catalog entry, and nothing else: the catalog lists exactly what reaches a bundle.
const catalog: Catalog = createRequire(import.meta.url)('@answerfield/bundle/catalog.json');

/** What the runtime implements: functions in expr and runtime-core, elements in runtime-wc. */
interface Implementation {
    functions: string[];
    elements: string[];
}

const runtime: Implementation = {
    functions: [...Object.keys(BUILTINS), ...ITEM_FUNCTIONS, ...META_FUNCTIONS],
    elements: [...RUNTIME_ELEMENTS]
};

/** Every difference between the runtime and the catalog, one message each; empty if they match. */
function differences(k: Catalog, implementation: Implementation): string[] {
    const found: string[] = [];
    for (const [section, label] of [['functions', 'Funktion'], ['elements', 'Element']] as const) {
        const entries = new Set(k[section].map(e => e.name));
        const implemented = new Set(implementation[section]);
        for (const name of entries) if (!implemented.has(name)) found.push(`${label} '${name}' steht im Katalog, fehlt aber in der Runtime.`);
        for (const name of implemented) if (!entries.has(name)) found.push(`Die Runtime setzt ${label} '${name}' um, der Katalog kennt diesen Namen nicht.`);
    }
    return [...found, ...formDifferences(k)];
}

/** Where the runtime code fixes the form of the arguments, the catalog's bundle form must match it. */
function formDifferences(k: Catalog): string[] {
    const found: string[] = [];
    for (const f of k.functions) {
        const params = f.parameters;
        // Coding functions get the names of response variables (`meta`), never values
        const meta = f.form === 'meta';
        if (META_FUNCTIONS.includes(f.name) && !meta) {
            found.push(`Funktion '${f.name}': die Runtime erhält sie als meta mit Namen von Antwortvariablen, im Katalog fehlt form meta.`);
        }
        if (meta && !META_FUNCTIONS.includes(f.name)) {
            found.push(`Funktion '${f.name}': laut Katalog als meta im Bundle, die Runtime kennt sie nicht als Kodierfunktion (META_FUNCTIONS).`);
        }
        // Content functions in expr map argument positions to names: probe them with numbered arguments
        if (f.result === 'Content' && Object.hasOwn(BUILTINS, f.name)) {
            const result = BUILTINS[f.name](params.map((_, i) => `a${i}`));
            if (!isContentValue(result)) continue;
            for (const [key, value] of Object.entries(result.args)) {
                const index = typeof value === 'string' && /^a\d+$/.test(value) ? Number(value.slice(1)) : undefined;
                if (index === undefined) {
                    found.push(`Funktion '${f.name}': die Runtime liest das Argument '${key}', im Bundle fehlt es.`);
                } else if (params[index].name !== key) {
                    found.push(`Funktion '${f.name}': die Runtime liest Argument ${index + 1} als '${key}', im Bundle steht dort '${params[index].name}'.`);
                }
            }
        }
    }
    for (const e of k.elements) {
        // runtime-core takes `bind` from ElementNode.bind, not from the arguments
        if (e.parameters.some(p => p.name === 'bind')) {
            found.push(`Element '${e.name}': die Runtime nimmt bind aus dem Element (ElementNode.bind), im Bundle steht es unter den Argumenten.`);
        }
    }
    return found;
}

/** Bundle with one item `t` and the given body; built by hand to reach names the compiler would not emit. */
function bundle(body: Node[]): Bundle {
    return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, items: [{ name: 't', body, variables: [] }], components: {}, codings: [] };
}

/** Names worth probing: every catalog entry, every implemented name and a few foreign ones. */
function candidates(section: 'functions' | 'elements'): string[] {
    return [...new Set([...catalog[section].map(e => e.name), ...runtime[section], 'unbekannt', 'toString', 'text', 'error'])];
}

describe('Katalog und Runtime', () => {
    test('die Runtime setzt genau die Einträge des Katalogs um', () => {
        expect(differences(catalog, runtime)).toEqual([]);
    });

    test('ein fehlender oder zusätzlicher Eintrag im Katalog fällt auf', () => {
        const missing: Catalog = { ...catalog, functions: catalog.functions.filter(f => f.name !== 'heard'), elements: catalog.elements.filter(e => e.name !== 'dot') };
        expect(differences(missing, runtime)).toEqual([
            "Die Runtime setzt Funktion 'heard' um, der Katalog kennt diesen Namen nicht.",
            "Die Runtime setzt Element 'dot' um, der Katalog kennt diesen Namen nicht."
        ]);
        const extra: Catalog = structuredClone(catalog);
        extra.functions.push({ name: 'extra', parameters: [], result: 'Int', description: 'Zusätzliche Funktion.' });
        // A name the compiler resolves never reaches a bundle, so the runtime has nothing for it
        extra.elements.push({ name: 'show', parameters: [{ name: 'when', type: 'Bool' }], children: true, description: 'Probe.' });
        expect(differences(extra, runtime)).toEqual([
            "Funktion 'extra' steht im Katalog, fehlt aber in der Runtime.",
            "Element 'show' steht im Katalog, fehlt aber in der Runtime."
        ]);
    });

    test('stünde die Autoren-Form von math, changed und input im Katalog, fiele die Abweichung auf', () => {
        const copy: Catalog = structuredClone(catalog);
        copy.functions.find(f => f.name === 'math')!.parameters = [{ name: 'tex', type: 'Text' }];
        delete copy.functions.find(f => f.name === 'changed')!.form;
        copy.elements.find(e => e.name === 'input')!.parameters.unshift({ name: 'bind', type: 'Text' });
        expect(differences(copy, runtime)).toEqual([
            "Funktion 'math': die Runtime liest Argument 1 als 'mathml', im Bundle steht dort 'tex'.",
            "Funktion 'math': die Runtime liest das Argument 'tex', im Bundle fehlt es.",
            "Funktion 'changed': die Runtime erhält sie als meta mit Namen von Antwortvariablen, im Katalog fehlt form meta.",
            "Element 'input': die Runtime nimmt bind aus dem Element (ElementNode.bind), im Bundle steht es unter den Argumenten."
        ]);
    });

    test('eine Funktion, die laut Katalog als meta ankommt, muss die Runtime als Kodierfunktion kennen', () => {
        const copy: Catalog = structuredClone(catalog);
        copy.functions.find(f => f.name === 'heard')!.form = 'meta';
        expect(differences(copy, runtime)).toEqual([
            "Funktion 'heard': laut Katalog als meta im Bundle, die Runtime kennt sie nicht als Kodierfunktion (META_FUNCTIONS)."
        ]);
    });

    test('Aufrufe erreichen genau die Funktionen aus expr und der Aufgabe, Kodierfunktionen genau META_FUNCTIONS', () => {
        const names = candidates('functions');
        const call = (fn: string): Expr => ({ op: 'call', fn, args: [] });
        const instance = createItemInstance(bundle(names.map(fn => ({ kind: 'content', value: call(fn) }))), 't');
        const unknown = (node: RContent) => {
            try {
                node.value.get();
                return false;
            } catch (e) {
                return e instanceof Error && e.message.startsWith('Unbekannte Funktion');
            }
        };
        const callable = names.filter((_, i) => !unknown(instance.nodes[i] as RContent));
        expect(callable.sort()).toEqual([...Object.keys(BUILTINS), ...ITEM_FUNCTIONS].sort());

        const coded = bundle([]);
        coded.items[0].variables = [{ id: 'a', type: 'Int', component: 'C' }];
        coded.codings = [{ item: 't', rules: names.map(fn => ({ variable: fn, answers: ['a'], cases: [{ code: 1, when: { op: 'meta', fn, vars: ['a'] } }] })), scores: [] }];
        const result = codeResponses(coded, { item: 't', variables: { a: { value: 1, changed: true, displayed: true } }, accommodations: [] });
        const meta = names.filter(fn => !('error' in result.variables[fn] && /Unbekannte Kodierfunktion/.test(String(result.variables[fn].error))));
        expect(meta.sort()).toEqual([...META_FUNCTIONS].sort());
    });

    describe('Elemente', () => {
        beforeEach(() => {
            document.body.innerHTML = '';
        });

        test('der Renderer stellt genau RUNTIME_ELEMENTS dar', () => {
            const names = candidates('elements');
            const instance = createItemInstance(bundle(names.map(element => ({ kind: 'element', element, args: {}, children: [] }))), 't');
            // No network: media without a source would otherwise be fetched
            const createPlayer = AfMedia.createPlayer;
            AfMedia.createPlayer = () => ({ volume: 1, load: () => new Promise<void>(() => {}), play: async () => {}, stop() {}, dispose() {} });
            let root: HTMLElement;
            try {
                root = renderItem(instance, document.body).root;
            } finally {
                AfMedia.createPlayer = createPlayer;
            }
            const rendered = names.filter(name => root.querySelector(`:scope > af-${CSS.escape(name)}`) !== null && name !== 'error');
            const rejected = [...root.querySelectorAll(':scope > af-error')].map(e => /Element '(.+)' wird von dieser Runtime nicht unterstützt/.exec(e.textContent ?? '')?.[1]);
            expect(rendered.sort()).toEqual([...RUNTIME_ELEMENTS].sort());
            expect(rejected.sort()).toEqual(names.filter(n => !RUNTIME_ELEMENTS.has(n)).sort());
        });
    });
});
