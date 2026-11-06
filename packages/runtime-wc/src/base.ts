import { Dimension, Point, display, type Value } from '@answerfield/expr';
import { frameOf, percentAt } from './plane-math.js';
import type { ElementProps, RElement } from '@answerfield/runtime-core';

/**
 * Base class of atoms and layout elements. Uses no shadow DOM so that ARIA references work across
 * element boundaries and the theme applies.
 */
export abstract class AfElement extends HTMLElement {
    protected node?: RElement;
    protected props?: ElementProps;
    private initialized = false;

    /** Container that receives child elements; defaults to the element itself. */
    get childTarget(): HTMLElement {
        return this;
    }

    /** Called by the renderer after creation (not in the constructor, per the custom elements rules). */
    attach(node: RElement): void {
        this.node = node;
    }

    /** Called by the renderer whenever the properties change. */
    update(props: ElementProps): void {
        this.props = props;
        if (!this.initialized) {
            this.initialized = true;
            this.init();
        }
        this.render(props);
        this.describe(props);
    }

    private description?: HTMLElement;

    /** Extended description (`variant(extended_descriptions)`), available on every element, e.g. an image or a plane. */
    private describe(props: ElementProps): void {
        const extended = props.variants.extended_descriptions;
        if (extended === undefined && !this.description) return;
        this.description ??= Object.assign(document.createElement('p'), { className: 'af-description', id: uid('af-desc') });
        if (this.description.parentElement !== this) this.append(this.description);
        this.description.textContent = extended !== undefined ? display(extended) : '';
        this.description.hidden = extended === undefined;
        setAttr(this, 'aria-describedby', extended !== undefined ? this.description.id : undefined);
    }

    protected init(): void { }

    protected abstract render(props: ElementProps): void;

    protected emit(event: string, payload?: Value): void {
        this.node?.emit(event, payload);
    }

    protected arg(name: string): Value {
        return this.props?.args[name] ?? null;
    }

    protected text(name: string): string | undefined {
        const v = this.arg(name);
        return v === null ? undefined : display(v);
    }
}

const resolvers = new WeakMap<Element, (path: string) => string>();

/** Set by the renderer: resolves an item's media paths (see `RenderOptions.asset`). */
export function setAssetResolver(root: Element, resolve: (path: string) => string): void {
    resolvers.set(root, resolve);
}

/** URL for a media path; URLs with a scheme are returned unchanged. */
export function assetUrl(el: Element, path: string): string {
    if (path === '' || /^[a-z][\w+.-]*:/i.test(path)) return path;
    const root = el.closest('af-root');
    return root && resolvers.has(root) ? resolvers.get(root)!(path) : path;
}

/** Positions an atom at a point of the enclosing plane (`at:`); otherwise leaves it in the flow. */
export function positionAt(el: HTMLElement, at: Value): void {
    const frame = frameOf(el);
    if (!frame || !(at instanceof Point)) {
        el.removeAttribute('data-at');
        el.style.left = el.style.top = '';
        return;
    }
    el.setAttribute('data-at', '');
    const { left, top } = percentAt(frame, at.x.toNumber(), at.y.toNumber());
    el.style.left = `${left}%`;
    el.style.top = `${top}%`;
}

let idCounter = 0;
/** Document-unique id with the given prefix. */
export function uid(prefix: string): string {
    return `${prefix}-${++idCounter}`;
}

/** Sets an attribute, or removes it for `undefined`, `null` or `false`. */
export function setAttr(el: Element, name: string, value: string | undefined | null | false): void {
    if (value === undefined || value === null || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value);
}

/** CSS length of a dimension value, otherwise `undefined`. */
export function size(v: Value): string | undefined {
    return v instanceof Dimension ? v.text : undefined;
}
