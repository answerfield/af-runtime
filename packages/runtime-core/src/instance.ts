import type {
    AssetInfo, Bundle, ComponentDef, ComponentNode, ElementNode, Expr, ForNode, ItemDef, JsonValue, Node, ResponseSet, ShowNode, Src,
    StateSnapshot
} from '@answerfield/bundle';
import { bundleProblem } from '@answerfield/bundle';
import {
    EvalError, Rational, ValueSet, defaultParams, destructure, isVersion, evaluate, fromJson, iterate, toJson, truthy, valueEquals,
    type Builtin, type Env, type ParamValues, type Value
} from '@answerfield/expr';
import { batch, computed, effect, signal, untracked, type ReadonlySignal, type WritableSignal } from './signals.js';
import { effectiveAccommodations, languageLevel, wordingFunction } from './accommodations.js';
import { versionsFor } from './versions.js';
import { ItemClock, type Clock, type Flow, type MediaControl, type TimerControl } from './clock.js';

// ---------------------------------------------------------------------------
// Runtime tree for renderers
// ---------------------------------------------------------------------------

/** Node of the runtime tree a renderer displays; reactive parts are signals. */
export type RNode = RElement | RContent | RFor | RShow | RComponent | RError;

/** Source reference (dev bundle) and node ID, for the visual editor and error messages. */
export interface RBase {
    src?: Src;
    id?: string;
}

/** Evaluated properties of an element. */
export interface ElementProps {
    /** Evaluated arguments; failed ones are null. */
    args: Readonly<Record<string, Value>>;
    /** Value of the bound state (`bind:`). */
    bind?: Value;
    /** Variants selected by the accommodations, e.g. `extended_descriptions`. */
    variants: Readonly<Record<string, Value>>;
    /** Evaluation errors of individual arguments (`name: message`). */
    errors: readonly string[];
}

/** Built-in element instance. */
export interface RElement extends RBase {
    kind: 'element';
    element: string;
    props: ReadonlySignal<ElementProps>;
    /** Fires an event: a handler (`on check`) or `bind` with the new value. Ignored once a `flow` locks the item or while `disabled` (except timer and media events). */
    emit(event: string, payload?: Value): void;
    /** Events that have handlers. */
    events: readonly string[];
    hasBind: boolean;
    children: RNode[];
    /** Only for `timer`: its countdown. */
    timer?: TimerControl;
    /** Only for `media`: when to play, and the renderer's reports. */
    media?: MediaControl;
}

/** Displayed value. */
export interface RContent extends RBase {
    kind: 'content';
    /** Throws on evaluation errors. */
    value: ReadonlySignal<Value>;
}

/** Loop instance. */
export interface RFor extends RBase {
    kind: 'for';
    /** Children per iteration; instances are kept per index across changes. */
    iterations: ReadonlySignal<RNode[][]>;
}

/** Conditional block; children exist even while hidden. */
export interface RShow extends RBase {
    kind: 'show';
    visible: ReadonlySignal<boolean>;
    children: RNode[];
}

/** Component instance. */
export interface RComponent extends RBase {
    kind: 'component';
    component: string;
    binding?: string;
    children: RNode[];
}

/** Placeholder for faulty source (dev bundle) or a component missing from the bundle. */
export interface RError extends RBase {
    kind: 'error';
    message: string;
}

/** Log entry of user and system events. */
export interface LogEntry {
    /** Milliseconds since the epoch of the item or booklet. */
    t: number;
    /** Instance path of the source; empty for item- or booklet-level events. */
    path: string;
    event: string;
    value?: JsonValue;
}

/** Options for {@link createItemInstance}. */
export interface ItemInstanceOptions {
    /** Snapshot to resume from. */
    restore?: StateSnapshot;
    /** Requested accommodations (from needs profile and study rules); the item's rules still apply. */
    accommodations?: Iterable<string>;
    /** Version parameters (see `itemVersions`). Absent: from the snapshot, else the defaults if valid, else the first valid version. */
    params?: ParamValues;
    /** Clock in milliseconds; default `Date.now`. */
    now?: () => number;
    /** Is the item currently visible (booklet)? Determines `displayed`. Default: always. */
    active?: () => boolean;
    /** Reference time of the log (e.g. booklet start); default: creation of the instance. */
    epoch?: number;
    /** Factor for timers (`timer` with `extended`); default 1.5 with `extended_time`, otherwise 1. */
    timeFactor?: number;
}

/** Running item. */
export interface ItemInstance {
    /** Bundle of the item (e.g. for coding and practice feedback). */
    readonly bundle: Bundle;
    readonly item: ItemDef;
    readonly nodes: RNode[];
    /** Number of top-level `page` elements; at least 1. */
    readonly pageCount: number;
    /** Current page, 0-based. */
    readonly page: WritableSignal<number>;
    /** Effective accommodations for this item. */
    readonly accommodations: ReadonlySet<string>;
    /** Version parameters (empty without parameters). */
    readonly params: Readonly<ParamValues>;
    /** Media of the bundle (path → hash, size, type). */
    readonly assets: Readonly<Record<string, AssetInfo>>;
    /** Timers and media (`timer`, `media`); only if the item has any. */
    readonly clock?: Clock;
    /** Navigation, lock and automatic advance from the item's `flow` elements. */
    readonly flow: Flow;
    readonly log: readonly LogEntry[];
    /** Current responses (reactive). */
    responses(): ResponseSet;
    /** State for resume; a copy that later changes do not affect. */
    snapshot(): StateSnapshot;
    dispose(): void;
}

/** Error in running a bundle (as opposed to evaluating an expression). */
export class RuntimeError extends Error { }

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/**
 * Built-in functions an item instance implements itself, since they read its state (playback, page, accommodations).
 * With `BUILTINS` from `@answerfield/expr` and `META_FUNCTIONS` they are the functions marked `runtime` in the
 * catalog of `@answerfield/bundle`.
 */
export const ITEM_FUNCTIONS = ['heard', 'current_page', 'wording', 'accommodations'] as const;

class Scope implements Env {
    private readonly values = new Map<string, () => Value>();
    private readonly states = new Map<string, WritableSignal<Value>>();
    private ownFunctions?: Env['functions'];

    constructor(private readonly parent?: Scope) { }

    /** Item functions (e.g. `heard()`), set at the top level and inherited. */
    get functions(): Env['functions'] {
        return this.ownFunctions ?? this.parent?.functions;
    }

    set functions(fns: Env['functions']) {
        this.ownFunctions = fns;
    }

    define(name: string, getter: () => Value): void {
        this.values.set(name, getter);
    }

    defineState(name: string, state: WritableSignal<Value>): void {
        this.states.set(name, state);
        this.values.set(name, () => state.get());
    }

    lookup(name: string): Value {
        for (let s: Scope | undefined = this; s; s = s.parent) {
            const getter = s.values.get(name);
            if (getter) return getter();
        }
        throw new EvalError(`'${name}' ist nicht definiert`);
    }

    state(name: string): WritableSignal<Value> {
        for (let s: Scope | undefined = this; s; s = s.parent) {
            const state = s.states.get(name);
            if (state) return state;
        }
        throw new RuntimeError(`Zustand '${name}' ist nicht definiert`);
    }
}

interface Context {
    scope: Scope;
    /** Instance path, for stable state keys. */
    path: string;
    /** Visibility, for tracking `displayed` (reactive). */
    visible: () => boolean;
    /** Response slots of the enclosing item or component. */
    slots: Map<string, WritableSignal<ReadonlySignal<Value> | undefined>>;
    occurrences: Map<string, number>;
    /** In a component with `children`: the call's content and the caller's context. */
    content?: { nodes: Node[]; ctx: Context };
}

interface Variable {
    response: ReadonlySignal<Value>;
    displayed: WritableSignal<boolean>;
    initial?: Value;
    type: string;
    /** Instance path of the component; its own states tell whether the response was worked on. */
    path: string;
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

/** Creates a running item; throws {@link RuntimeError} for incompatible bundles or unknown items. */
export function createItemInstance(bundle: Bundle, itemName: string, options: ItemInstanceOptions = {}): ItemInstance {
    const problem = bundleProblem(bundle);
    if (problem) throw new RuntimeError(problem);
    const item = bundle.items.find(i => i.name === itemName);
    if (!item) throw new RuntimeError(`Aufgabe '${itemName}' ist nicht im Bundle`);
    return new Interpreter(bundle, item, options).instance;
}

class Interpreter {
    readonly instance: ItemInstance;
    private readonly states = new Map<string, { signal: WritableSignal<Value>; type: string; initial: Value }>();
    private readonly variables = new Map<string, Variable>();
    private readonly disposers: Array<() => void> = [];
    private readonly log: LogEntry[] = [];
    private readonly restore: StateSnapshot;
    private readonly accommodations: ReadonlySet<string>;
    private readonly params: ParamValues;
    private readonly now: () => number;
    private readonly start: number;
    private readonly clock: ItemClock;

    constructor(private readonly bundle: Bundle, item: ItemDef, options: ItemInstanceOptions) {
        this.restore = options.restore ?? {};
        this.accommodations = effectiveAccommodations(options.accommodations ?? [], item.accommodations);
        const restoredParams = this.restore.$params;
        const restored = restoredParams && typeof restoredParams === 'object' && !Array.isArray(restoredParams) ? restoredParams : undefined;
        // Nothing chosen: the defaults if valid for the accommodations, otherwise the first valid version
        const chosen = options.params ?? restored
            ?? (isVersion(item, defaultParams(item), this.accommodations) ? undefined : versionsFor(item, this.accommodations)[0]);
        this.params = { ...defaultParams(item), ...chosen };
        this.now = options.now ?? (() => Date.now());
        this.start = options.epoch ?? this.now();
        // Continue the log
        const restoredLog = this.restore.$log;
        if (Array.isArray(restoredLog)) this.log.push(...(restoredLog as unknown as LogEntry[]));
        const active = options.active ?? (() => true);
        this.clock = new ItemClock({
            now: this.now, active,
            factor: options.timeFactor ?? (this.accommodations.has('extended_time') ? 1.5 : 1),
            record: (path, event) => this.record(path, event)
        }, { timers: this.restore.$timers, heard: this.restore.$heard });

        const pages = item.body.filter(n => n.kind === 'element' && n.element === 'page');
        const pageCount = Math.max(1, pages.length);
        const restoredPage = this.restore.$page;
        const page = signal(Number.isInteger(restoredPage) && (restoredPage as number) >= 0 && (restoredPage as number) < pageCount ? restoredPage as number : 0);

        const root: Context = {
            scope: new Scope(),
            path: '',
            visible: active,
            slots: this.createSlots(item.body),
            occurrences: new Map()
        };
        root.scope.functions = {
            heard: () => new Rational(BigInt(this.clock.heard.get())),
            current_page: () => new Rational(BigInt(page.get() + 1)),
            wording: wordingFunction(this.accommodations),
            accommodations: () => new ValueSet([...this.accommodations])
        } satisfies Record<(typeof ITEM_FUNCTIONS)[number], Builtin>;
        for (const p of item.params ?? []) {
            const value = fromJson(this.params[p.name] ?? p.default, p.type);
            root.scope.define(p.name, () => value);
        }
        for (const [name, slot] of root.slots) root.scope.define(name, () => slot.get()?.get() ?? null);

        // Top level: each page gets its own visibility
        const blockScope = this.declare(item.body, root);
        const ctx = { ...root, scope: blockScope };
        const nodes: RNode[] = [];
        let pageIndex = 0;
        for (const node of item.body) {
            if (node.kind === 'element' && node.element === 'page') {
                const index = pageIndex++;
                nodes.push(...this.node(node, { ...ctx, visible: () => active() && page.get() === index }));
            } else {
                nodes.push(...this.node(node, ctx));
            }
        }
        this.initVariables();

        const interpreter = this;
        this.instance = {
            bundle, item, nodes, pageCount, page,
            accommodations: this.accommodations,
            params: this.params,
            assets: bundle.assets ?? {},
            ...(this.clock.used ? { clock: this.clock } : {}),
            flow: this.clock.flow,
            log: this.log,
            responses: () => interpreter.responses(item),
            snapshot: () => {
                // Copy the log so a saved snapshot does not change afterwards
                return { ...interpreter.snapshot(), ...(item.params ? { $params: interpreter.params } : {}), $page: page.peek(), $log: [...interpreter.log] as unknown as JsonValue, ...interpreter.clock.snapshot() };
            },
            dispose: () => interpreter.disposers.splice(0).forEach(d => d())
        };
    }

    // --- Blocks and nodes -----------------------------------------------------------------

    /** State under `key`: restored from the snapshot or set to its initial value; included in snapshots. */
    private createState(key: string, type: string, initial: () => Value): WritableSignal<Value> {
        const restored = this.restore[key];
        const start = untracked(initial);
        const state = signal<Value>(restored !== undefined ? fromJson(restored, type) : start, valueEquals);
        this.states.set(key, { signal: state, type, initial: start });
        return state;
    }

    /** Declares a block's `state` and `let` in a new scope. */
    private declare(nodes: Node[], ctx: Context): Scope {
        const scope = new Scope(ctx.scope);
        for (const node of nodes) {
            if (node.kind === 'state') {
                scope.defineState(node.name, this.createState(`${ctx.path}.${node.name}`, node.type, () => evaluate(node.init, scope)));
            } else if (node.kind === 'let') {
                const value = computed(() => evaluate(node.value, scope));
                scope.define(node.name, () => value.get());
            }
        }
        return scope;
    }

    private block(nodes: Node[], ctx: Context): RNode[] {
        const scope = this.declare(nodes, ctx);
        return nodes.flatMap(n => this.node(n, { ...ctx, scope }));
    }

    private node(node: Node, ctx: Context): RNode[] {
        switch (node.kind) {
            case 'state': case 'let': case 'response':
                return [];
            case 'children':
                // Content lives in the caller's scope but is visible where the component places it
                return ctx.content ? this.block(ctx.content.nodes, { ...ctx.content.ctx, visible: ctx.visible }) : [];
            case 'content': {
                const value = computed(() => evaluate(node.value, ctx.scope));
                return [{ kind: 'content', value, ...src(node.src, node.id) }];
            }
            case 'element':
                return [this.element(node, ctx)];
            case 'component':
                return [this.component(node, ctx)];
            case 'show':
                return [this.show(node, ctx)];
            case 'for':
                return [this.forLoop(node, ctx)];
            case 'error':
                return [{ kind: 'error', message: node.message, ...src(node.src, node.id) }];
        }
    }

    private element(node: ElementNode, ctx: Context): RElement {
        const { scope } = ctx;
        const variants = Object.entries(node.variants ?? {})
            .filter(([kind]) => this.accommodations.has(kind));

        const props = computed<ElementProps>(() => {
            const errors: string[] = [];
            const safe = (name: string, expr: Expr): Value => {
                try {
                    return evaluate(expr, scope);
                } catch (e) {
                    errors.push(`${name}: ${message(e)}`);
                    return null;
                }
            };
            const args = Object.fromEntries(Object.entries(node.args).map(([k, e]) => [k, safe(k, e)]));
            const ref: Expr = { op: 'ref', name: node.bind ?? '' };
            const bind = node.bind ? safe('bind', node.bindIndex ? { op: 'index', target: ref, index: node.bindIndex } : ref) : undefined;
            const evaluated = Object.fromEntries(variants.map(([k, e]) => [k, safe(k, e)]));
            return { args, ...(node.bind ? { bind } : {}), variants: evaluated, errors };
        });

        // Language levels replace the content (text or block): easy language, falling back to simple. A text level in
        // an element with responses replaces the text before the first response; the responses keep their place.
        const stage = (kind: string): RNode[] | undefined => {
            const block = node.replacements?.[kind], text = node.variants?.[kind];
            if (block) return this.block(block, ctx);
            if (!text) return undefined;
            const original = this.block(node.children, ctx);
            const first = original.findIndex(n => n.kind === 'component' && n.binding !== undefined);
            return [{ kind: 'content', value: computed(() => evaluate(text, scope)) } satisfies RContent, ...(first < 0 ? [] : original.slice(first))];
        };
        const level = languageLevel(this.accommodations);
        const children = (level === 'easy' ? stage('easy_language') ?? stage('simple_language') : level === 'simple' ? stage('simple_language') : undefined)
            ?? this.block(node.children, ctx);

        const path = ctx.path;
        // Time and media report system events (elapsed, ready, ended): never locked or disabled
        const system = node.element === 'timer' || node.element === 'media';
        const emit = (event: string, payload?: Value): void => {
            // A `flow` locks the responses (e.g. after a listening text)
            if (!system && this.clock.flow.locked.peek()) {
                this.record(path, `${node.element}.${event}.locked`);
                return;
            }
            // Disabled controls accept nothing, even if a host sends the event
            if (!system && untracked(() => props.get().args.disabled) === true) return;
            batch(() => {
                if (event === 'bind' && node.bind) {
                    this.bound(scope, node.bind, node.bindIndex).set(payload ?? null);
                    this.record(path, `${node.element}.bind`, payload);
                    // A bound change triggers `on change`
                    event = 'change';
                }
                const actions = node.on?.[event];
                if (!actions) return;
                // Timer and media events are logged by the clock
                if (!system) this.record(path, `${node.element}.${event}`);
                // Evaluate all values first, then assign
                const values = actions.map(a => untracked(() => evaluate(a.value, scope)));
                actions.forEach((a, i) => scope.state(a.state).set(values[i]));
            });
        };

        // Time, media and flow register with the item's clock (document order); keys stay stable for resume
        const args = () => props.get().args;
        const key = () => {
            const n = ctx.occurrences.get(node.element) ?? 0;
            ctx.occurrences.set(node.element, n + 1);
            return `${ctx.path}/${node.element}#${n}`;
        };
        let timer: TimerControl | undefined, media: MediaControl | undefined;
        if (node.element === 'timer') {
            const registered = this.clock.timer(key(), args, () => emit('elapsed'));
            this.disposers.push(registered.dispose);
            timer = registered.control;
        } else if (node.element === 'media') {
            media = this.clock.mediaElement(key(), args, event => emit(event));
        } else if (node.element === 'flow') {
            this.clock.flowElement(args);
        }

        return {
            kind: 'element', element: node.element, props, emit,
            events: Object.keys(node.on ?? {}), hasBind: node.bind !== undefined,
            children, ...(timer ? { timer } : {}), ...(media ? { media } : {}), ...src(node.src, node.id)
        };
    }

    private component(node: ComponentNode, ctx: Context): RNode {
        const def: ComponentDef | undefined = this.bundle.components[node.component];
        if (!def) return { kind: 'error', message: `Komponente '${node.component}' fehlt im Bundle`, ...src(node.src, node.id) };

        let path: string;
        if (node.binding) {
            path = `${ctx.path}/${node.binding}`;
        } else {
            const n = ctx.occurrences.get(node.component) ?? 0;
            ctx.occurrences.set(node.component, n + 1);
            path = `${ctx.path}/${node.component}#${n}`;
        }

        // Own names only, but the item functions (heard(), wording() …) apply inside components too
        const scope = new Scope();
        scope.functions = ctx.scope.functions;
        for (const param of def.params.filter(p => !p.state)) {
            const arg = node.args[param.name];
            const value = arg
                ? computed(() => evaluate(arg, ctx.scope))
                : param.default ? computed(() => evaluate(param.default!, scope)) : undefined;
            scope.define(param.name, value ? () => value.get() : () => null);
        }
        // State parameters: bound to a caller's state, or an own state
        for (const param of def.params.filter(p => p.state)) {
            const bind = node.binds?.[param.name];
            if (bind) {
                scope.defineState(param.name, this.bound(ctx.scope, bind.state, bind.index));
                continue;
            }
            const init = param.default;
            scope.defineState(param.name, this.createState(`${path}.${param.name}`, param.type, () => init ? evaluate(init, scope) : null));
        }
        // Response bindings exist only in items; responses in the content (children) reach the caller via ctx.content
        const inner: Context = {
            scope, path, visible: ctx.visible, slots: new Map(), occurrences: new Map(),
            ...(node.children ? { content: { nodes: node.children, ctx } } : {})
        };
        const bodyScope = this.declare(def.body, inner);
        const children = def.body.flatMap(n => this.node(n, { ...inner, scope: bodyScope }));

        const responseNode = def.body.find(n => n.kind === 'response');
        if (node.binding && def.response && responseNode?.kind === 'response') {
            const response = computed(() => evaluate(responseNode.value, bodyScope));
            ctx.slots.get(node.binding)?.set(response);
            this.registerVariable(node.binding, response, def.response, ctx.visible, path);
        }
        return { kind: 'component', component: def.name, ...(node.binding ? { binding: node.binding } : {}), children, ...src(node.src, node.id) };
    }

    /**
     * State `name` of the scope, or its element `index` (1-based), readable and writable. An index outside the list
     * reads `none` and ignores writes.
     */
    private bound(scope: Scope, name: string, index?: Expr): WritableSignal<Value> {
        const state = scope.state(name);
        if (!index) return state;
        const position = (): number | undefined => {
            const i = evaluate(index, scope);
            return i instanceof Rational && i.d === 1n ? Number(i.n) - 1 : undefined;
        };
        const read = computed<Value>(() => {
            const list = state.get(), k = position();
            return Array.isArray(list) && k !== undefined && k >= 0 && k < list.length ? list[k] : null;
        });
        return {
            get: () => read.get(),
            peek: () => untracked(() => read.get()),
            set: (value: Value) => {
                const list = state.peek(), k = untracked(position);
                if (!Array.isArray(list) || k === undefined || k < 0 || k >= list.length) return;
                state.set(list.map((v, j) => j === k ? value : v));
            }
        };
    }

    private show(node: ShowNode, ctx: Context): RShow {
        const visible = computed(() => truthy(evaluate(node.when, ctx.scope)));
        const parentVisible = ctx.visible;
        const children = this.block(node.body, {
            ...ctx,
            visible: () => parentVisible() && safe(visible, false)
        });
        return { kind: 'show', visible, children, ...src(node.src, node.id) };
    }

    private forLoop(node: ForNode, ctx: Context): RFor {
        const list = computed(() => iterate(evaluate(node.iterable, ctx.scope)));
        const cache: RNode[][] = [];
        const iterations = computed(() => {
            const length = list.get().length;
            while (cache.length < length) {
                const index = cache.length;
                const scope = new Scope(ctx.scope);
                node.vars.forEach((name, j) => scope.define(name, () => {
                    const values = list.get();
                    return index < values.length ? destructure(values[index], index, node.vars.length)[j] : null;
                }));
                cache.push(untracked(() => this.block(node.body, { ...ctx, scope, path: `${ctx.path}[${index}]`, occurrences: new Map() })));
            }
            return cache.slice(0, length);
        });
        return { kind: 'for', iterations, ...src(node.src, node.id) };
    }

    // --- Responses ------------------------------------------------------------------------

    /** Response slots for all bindings in a body (outside component bodies and loops). */
    private createSlots(body: Node[]): Map<string, WritableSignal<ReadonlySignal<Value> | undefined>> {
        const slots = new Map<string, WritableSignal<ReadonlySignal<Value> | undefined>>();
        const visit = (nodes: Node[]) => nodes.forEach(n => {
            if (n.kind === 'component' && n.binding) slots.set(n.binding, signal<ReadonlySignal<Value> | undefined>(undefined));
            if (n.kind === 'component' && n.children) visit(n.children);
            if (n.kind === 'element' || n.kind === 'show') visit(n.kind === 'element' ? n.children : n.body);
        });
        visit(body);
        return slots;
    }

    private registerVariable(name: string, response: ReadonlySignal<Value>, type: string, visible: () => boolean, path: string): void {
        const restored = this.restore[`$displayed.${name}`];
        const displayed = signal(restored === true);
        this.variables.set(name, { response, displayed, type, path });
        this.disposers.push(effect(() => {
            if (visible()) displayed.set(true);
        }));
    }

    private initVariables(): void {
        for (const [name, variable] of this.variables) {
            const restored = this.restore[`$initial.${name}`];
            variable.initial = restored !== undefined
                ? fromJson(restored, variable.type)
                : untracked(() => safe(variable.response, null));
        }
    }

    private responses(item: ItemDef): ResponseSet {
        const variables: ResponseSet['variables'] = {};
        for (const info of item.variables) {
            const variable = this.variables.get(info.id);
            if (!variable) continue;
            const value = safe(variable.response, null);
            variables[info.id] = {
                value: toJson(value),
                changed: !valueEquals(value, variable.initial ?? null) || this.touched(variable.path),
                displayed: variable.displayed.get()
            };
        }
        return {
            item: item.name, variables, accommodations: [...this.accommodations].sort(),
            ...(item.params ? { params: this.params } : {})
        };
    }

    /**
     * Whether the component's own state differs from its start: the response may still equal its initial value, e.g.
     * a number gap with „abc“ (no number, but worked on, so coded as wrong, not as omitted).
     */
    private touched(path: string): boolean {
        for (const [key, s] of this.states) {
            if ((key.startsWith(`${path}.`) || key.startsWith(`${path}/`)) && !valueEquals(s.signal.get(), s.initial)) return true;
        }
        return false;
    }

    private snapshot(): StateSnapshot {
        const result: StateSnapshot = {};
        for (const [key, { signal: s }] of this.states) result[key] = toJson(s.peek());
        for (const [name, v] of this.variables) {
            result[`$initial.${name}`] = toJson(v.initial ?? null);
            if (v.displayed.peek()) result[`$displayed.${name}`] = true;
        }
        return result;
    }

    private record(path: string, event: string, value?: Value): void {
        this.log.push({ t: this.now() - this.start, path, event, ...(value !== undefined ? { value: toJson(value) } : {}) });
    }
}

function src(s: Src | undefined, id?: string): RBase {
    return { ...(s ? { src: s } : {}), ...(id ? { id } : {}) };
}

/** Value of a signal, or `fallback` on evaluation errors. */
function safe<T>(s: ReadonlySignal<T>, fallback: T): T {
    try {
        return s.get();
    } catch {
        return fallback;
    }
}

/** Message of an error or thrown value. */
export function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
