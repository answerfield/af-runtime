import { Dimension, display, isContentValue, type Value } from '@answerfield/expr';
import type { AssetInfo } from '@answerfield/bundle';
import { effect, message, type ItemInstance, type NeedsProfile, type RBase, type RNode } from '@answerfield/runtime-core';
import { AfElement, ELEMENTS, assetUrl, defineElements, setAssetResolver, setAttr } from './elements.js';
import { installStyles } from './styles.js';
import { GEOMETRY_ELEMENTS } from './geometry.js';
import { installTheme, type Theme } from './theme.js';
import type { Speech } from './speak.js';

/** Options for `renderItem`. */
export interface RenderOptions {
    /** Needs profile supplying values such as the magnification factor; whether it applies depends on the effective accommodations. */
    profile?: NeedsProfile;
    /** Show errors and source references (preview). */
    dev?: boolean;
    /** Base for relative media paths (e.g. the item's folder); used when `asset` is not set. */
    baseUrl?: string;
    /**
     * Maps a media path in the bundle (plus hash, size, type) to a URL. The host decides, e.g. a CDN with
     * content-addressed names, signed URLs or a service worker.
     */
    asset?: AssetResolver;
    /**
     * Scan scope for `switch_access` (default: the item). A booklet passes its frame here so that its
     * „Weiter“ and „Zurück“ buttons are reachable too.
     */
    scanScope?: HTMLElement;
    /**
     * Theme layered over the default theme, supplied by the host.
     * Accommodations such as high contrast or reduced motion take precedence.
     */
    theme?: Theme;
    /**
     * Show a point's coordinates as a badge while dragging, e.g. „C (4 | 4)“, for practice. In assessments without
     * axes this could give away the answer, so the host decides; off by default. Screen readers always announce them.
     */
    coordinates?: boolean;
    /** Voice for `read_aloud` (e.g. prerecorded or a server voice); default: the browser's speech output. */
    speech?: Speech;
}

/** Resolves a bundle media path (with its asset info, if known) to a URL. */
export type AssetResolver = (path: string, info: AssetInfo | undefined) => string;

/** Handle to a rendered item. */
export interface Rendered {
    root: HTMLElement;
    /** Resolves once lazily loaded parts (switch access) are ready. */
    ready: Promise<void>;
    dispose(): void;
}

/** Renders an item into `container`. */
export function renderItem(instance: ItemInstance, container: HTMLElement, options: RenderOptions = {}): Rendered {
    defineElements();
    for (const [name, ctor] of Object.entries(GEOMETRY_ELEMENTS)) if (!customElements.get(name)) customElements.define(name, ctor);
    installStyles(container.ownerDocument);
    if (options.theme) installTheme(container.ownerDocument, options.theme);

    const root = container.ownerDocument.createElement('af-root');
    applyAccommodations(root, instance.accommodations, options.profile);
    root.setAttribute('lang', 'de');
    root.dataset.item = instance.item.name;
    if (options.theme) root.dataset.theme = options.theme.name;
    if (options.baseUrl) root.dataset.base = options.baseUrl;
    if (options.coordinates) root.dataset.coordinates = '';
    const resolve = options.asset;
    setAssetResolver(root, resolve
        ? path => resolve(path, instance.assets[path])
        : path => (options.baseUrl ? new URL(path, options.baseUrl).toString() : path));
    if (instance.item.src) root.dataset.src = instance.item.src.join(':');
    if (instance.item.id) root.dataset.node = instance.item.id;
    container.appendChild(root);

    const disposers: Array<() => void> = [];
    // Once a `flow` locks the item (e.g. after a listening text), responses stay visible but become read-only
    {
        disposers.push(effect(() => {
            const locked = instance.flow.locked.get();
            setAttr(root, 'data-locked', locked ? '' : undefined);
            if (!locked) return;
            root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input:not([type="range"]), textarea, select')
                .forEach(f => { if (f instanceof HTMLSelectElement) f.disabled = true; else f.readOnly = true; });
            root.querySelectorAll('af-toggle').forEach(t => t.setAttribute('aria-disabled', 'true'));
        }));
    }
    // Lazily loaded parts: each becomes a separate chunk in the host's build
    const pending: Promise<void>[] = [];
    if (instance.accommodations.has('switch_access')) {
        let disposed = false;
        let scanner: { dispose(): void } | undefined;
        pending.push(import('./scan.js').then(({ Scanner }) => {
            if (!disposed) scanner = new Scanner(options.scanScope ?? root, root, options.profile?.interaction?.switch_access);
        }));
        disposers.push(() => { disposed = true; scanner?.dispose(); });
    }
    if (instance.accommodations.has('read_aloud')) {
        let disposed = false;
        let reader: { dispose(): void } | undefined;
        pending.push(import('./speak.js').then(({ ReadAloud, browserSpeech }) => {
            const speech = options.speech ?? (root.ownerDocument.defaultView ? browserSpeech(root.ownerDocument.defaultView) : undefined);
            if (!disposed && speech) reader = new ReadAloud(root, speech);
        }));
        disposers.push(() => { disposed = true; reader?.dispose(); });
    }
    const ready = Promise.all(pending).then(() => undefined);
    let pageIndex = 0;
    for (const node of instance.nodes) {
        const el = mount(node, root, disposers, options);
        if (node.kind === 'element' && node.element === 'page' && el) {
            const index = pageIndex++;
            disposers.push(effect(() => { el.hidden = instance.page.get() !== index; }));
        }
    }
    return {
        root,
        ready,
        dispose: () => {
            disposers.splice(0).reverse().forEach(d => d());
            root.remove();
        }
    };
}

/** Sets root attributes for the effective display accommodations. */
export function applyAccommodations(root: HTMLElement, accommodations: ReadonlySet<string>, profile?: NeedsProfile): void {
    const scale = accommodations.has('magnification') ? profile?.display?.scale ?? 2 : 1;
    root.style.setProperty('--af-scale', String(scale));
    setAttr(root, 'data-scale', scale !== 1 ? String(scale) : undefined);
    setAttr(root, 'data-contrast', accommodations.has('contrast') ? 'high' : undefined);
    setAttr(root, 'data-reflow', accommodations.has('reflow') ? '' : undefined);
    setAttr(root, 'data-large-targets', accommodations.has('large_targets') ? '' : undefined);
    setAttr(root, 'data-reduced-motion', accommodations.has('reduced_motion') ? '' : undefined);
    setAttr(root, 'data-descriptions', accommodations.has('extended_descriptions') ? '' : undefined);
    setAttr(root, 'data-focus', accommodations.has('focus_emphasis') ? '' : undefined);
    setAttr(root, 'data-read-aloud', accommodations.has('read_aloud') ? '' : undefined);
}

/** Semantic markup → HTML elements assistive technology understands; the look comes from the theme. */
const MARKUP: Readonly<Record<string, string>> = {
    mark: 'mark', emph: 'em', strong: 'strong', title: 'cite', del: 'del', sup: 'sup', sub: 'sub'
};

/** Content value as DOM: text, markup, image, math or a sequence of these. `host` resolves media paths. */
export function inline(host: HTMLElement, value: Value): Node {
    const doc = host.ownerDocument;
    if (isContentValue(value) && MARKUP[value.content]) {
        const el = doc.createElement(MARKUP[value.content]);
        el.append(inline(host, value.args.text ?? null));
        return el;
    }
    if (isContentValue(value) && value.content === 'image') {
        const img = doc.createElement('img');
        img.className = 'af-image';
        img.src = assetUrl(host, display(value.args.src ?? null));
        img.alt = display(value.args.alt ?? null);
        const width = value.args.width;
        if (width instanceof Dimension) img.style.width = width.text;
        return img;
    }
    if (isContentValue(value) && value.content === 'math') {
        // MathML produced by the compiler (Temml), taken from the bundle
        const span = doc.createElement('span');
        span.className = 'af-math';
        span.innerHTML = display(value.args.mathml ?? null);
        // TeX source, for reading aloud
        if (value.args.tex) span.dataset.tex = display(value.args.tex);
        return span;
    }
    if (isContentValue(value) && value.content === 'seq') {
        const fragment = doc.createDocumentFragment();
        const items = value.args.items;
        if (Array.isArray(items)) items.forEach(item => fragment.append(inline(host, item)));
        return fragment;
    }
    return doc.createTextNode(isContentValue(value) ? '' : display(value));
}

/** Custom elements of the renderer itself (displayed values, errors); no built-in elements of the language. */
const OWN_TAGS: ReadonlySet<string> = new Set(['af-text', 'af-error']);

/**
 * Built-in elements this runtime renders, by their name in the bundle (`ElementNode.element`); each one is the custom
 * element `af-<name>`. They are the elements marked `runtime` in the catalog of `@answerfield/bundle`.
 */
export const RUNTIME_ELEMENTS: ReadonlySet<string> = new Set([...Object.keys(ELEMENTS), ...Object.keys(GEOMETRY_ELEMENTS)]
    .filter(tag => !OWN_TAGS.has(tag)).map(tag => tag.slice('af-'.length)));

/** Mounts a runtime node under `parent`; registers its effects in `disposers`. */
function mount(node: RNode, parent: HTMLElement, disposers: Array<() => void>, options: RenderOptions): HTMLElement | undefined {
    const doc = parent.ownerDocument;
    switch (node.kind) {
        case 'element': {
            const tag = `af-${node.element}`;
            if (!RUNTIME_ELEMENTS.has(node.element) || !customElements.get(tag)) {
                return append(parent, errorElement(doc, `Element '${node.element}' wird von dieser Runtime nicht unterstützt`), node);
            }
            const el = doc.createElement(tag) as AfElement;
            el.attach(node);
            append(parent, el, node);
            let errors: HTMLElement | undefined;
            disposers.push(effect(() => {
                const props = node.props.get();
                el.update(props);
                if (options.dev && props.errors.length > 0) {
                    errors ??= el.appendChild(errorElement(doc, ''));
                    errors.textContent = props.errors.join('; ');
                } else if (errors) {
                    errors.remove();
                    errors = undefined;
                }
            }));
            node.children.forEach(c => mount(c, el.childTarget, disposers, options));
            return el;
        }
        case 'content': {
            const el = append(parent, doc.createElement('af-text'), node);
            disposers.push(effect(() => {
                try {
                    const value = node.value.get();
                    el.replaceChildren(inline(el, value));
                    el.removeAttribute('data-error');
                } catch (e) {
                    el.textContent = options.dev ? `⚠ ${message(e)}` : '';
                    el.setAttribute('data-error', '');
                }
            }));
            return el;
        }
        case 'component': {
            const el = append(parent, doc.createElement('af-component'), node);
            el.dataset.component = node.component;
            if (node.binding) el.dataset.binding = node.binding;
            node.children.forEach(c => mount(c, el, disposers, options));
            return el;
        }
        case 'show': {
            const el = append(parent, doc.createElement('af-show'), node);
            node.children.forEach(c => mount(c, el, disposers, options));
            disposers.push(effect(() => {
                let visible = false;
                try { visible = node.visible.get(); } catch { /* hide on error */ }
                el.hidden = !visible;
            }));
            return el;
        }
        case 'for': {
            const el = append(parent, doc.createElement('af-for'), node);
            const mounted: Array<{ el: HTMLElement; dispose: () => void }> = [];
            disposers.push(effect(() => {
                let iterations: RNode[][] = [];
                try { iterations = node.iterations.get(); } catch (e) {
                    if (options.dev) el.replaceChildren(errorElement(doc, message(e)));
                }
                while (mounted.length > iterations.length) {
                    const last = mounted.pop()!;
                    last.dispose();
                    last.el.remove();
                }
                for (let i = mounted.length; i < iterations.length; i++) {
                    const iteration = el.appendChild(doc.createElement('af-iteration'));
                    const own: Array<() => void> = [];
                    iterations[i].forEach(c => mount(c, iteration, own, options));
                    mounted.push({ el: iteration, dispose: () => own.splice(0).reverse().forEach(d => d()) });
                }
            }));
            disposers.push(() => mounted.splice(0).forEach(m => m.dispose()));
            return el;
        }
        case 'error':
            return append(parent, errorElement(doc, options.dev ? node.message : 'Fehler in der Aufgabe'), node);
    }
}

/** Appends `el` and records the node's source location and id as data attributes. */
function append<T extends HTMLElement>(parent: HTMLElement, el: T, node: RBase): T {
    if (node.src) el.dataset.src = node.src.join(':');
    if (node.id) el.dataset.node = node.id;
    parent.appendChild(el);
    return el;
}

function errorElement(doc: Document, text: string): HTMLElement {
    const el = doc.createElement('af-error');
    el.setAttribute('role', 'note');
    el.textContent = text;
    return el;
}
