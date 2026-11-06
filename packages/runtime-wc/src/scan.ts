// Scanning for one- and two-switch access (accommodation `switch_access`): a highlight moves across all operable
// targets and a switch selects. Groups (options, words in a text) are entered; values, dropdowns and long texts are
// operated through a toolbar of large buttons. Text input is left to the person's on-screen keyboard (e.g. that of
// their assistive device); Escape or leaving the field resumes scanning.
//
// Self-contained: works only on the rendered DOM (tags, roles, ARIA attributes), imports nothing from the runtime and
// ships its own CSS. renderItem loads this module only when `switch_access` is in effect (separate build chunk).

/** Settings for switch access, taken from the needs profile. */
export interface ScanOptions {
    /** `auto`: the highlight advances on a timer and either switch selects; `step`: `next` advances, `select` selects. */
    mode?: 'auto' | 'step';
    /** Interval for `auto`, in seconds. */
    interval?: number;
    /** Keys (`KeyboardEvent.key`) as sent by a switch interface. */
    keys?: { next?: string; select?: string };
}

type Kind = 'press' | 'group' | 'text' | 'value' | 'point' | 'dropdown' | 'scroll';
interface Target { el: HTMLElement; kind: Kind }

/** One scan level: the whole item at the top, below it a group or a control toolbar. */
interface Level {
    targets: () => Target[];
    index: number;
    /** At the end of a group, return to the level above; at the top and in toolbars, wrap around. */
    leaveAtEnd: boolean;
    /** Entered target (group, value …), highlighted while scanning inside it. */
    owner?: HTMLElement;
    panel?: HTMLElement;
}

const STYLE_ID = 'af-scan-styles';
const CSS = `
/* Scanning (switch_access): heavy outline on the current target, shaded entered group, control toolbar at the bottom */
/* also used outside the item (booklet navigation), hence fallbacks for the theme variables */
[data-af-scan] { outline: calc(var(--af-focus-width, 3px) * 2) solid var(--af-color-focus, #0b57d0) !important; outline-offset: 3px; border-radius: var(--af-radius, 6px); }
[data-scan-inside] { background: var(--af-color-surface, #f4f6fa); box-shadow: 0 0 0 var(--af-focus-width, 3px) var(--af-color-focus, #0b57d0); border-radius: var(--af-radius, 6px); }
/* A group in a plane (e.g. a row of eggs) has no box of its own: its toggles carry the mark */
af-plane af-group[data-af-scan] af-toggle { outline: calc(var(--af-focus-width, 3px) * 2) solid var(--af-color-focus, #0b57d0); outline-offset: 2px; border-radius: 50%; }
af-plane af-group[data-scan-inside] af-toggle { outline: var(--af-focus-width, 3px) dashed var(--af-color-focus, #0b57d0); outline-offset: 2px; border-radius: 50%; }
/* A toggle with shapes is hidden; its shapes show the mark */
af-plane af-toggle[data-shape][data-af-scan] + .af-toggle-shape .af-stroke,
af-plane af-group[data-af-scan] .af-toggle-shape .af-stroke { stroke: var(--af-color-focus, #0b57d0); stroke-width: calc(var(--af-focus-width, 3px) * 2); stroke-dasharray: none; }
af-plane af-group[data-scan-inside] .af-toggle-shape .af-stroke { stroke: var(--af-color-focus, #0b57d0); stroke-dasharray: 4 3; }
af-root .af-scan-panel { position: sticky; bottom: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: var(--af-space-2); justify-content: center;
  padding: var(--af-space-2); background: var(--af-color-surface); border-top: var(--af-border-width) solid var(--af-color-border); }
af-root .af-scan-panel button { font: inherit; font-size: 1.25em; min-width: calc(var(--af-target-size) * 1.6); min-height: calc(var(--af-target-size) * 1.2);
  padding: 0 var(--af-space-3); border-radius: var(--af-radius); border: var(--af-border-width) solid var(--af-color-border); background: var(--af-color-bg); color: inherit; }
`;

function installScanStyles(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
}

const visible = (el: Element) => !el.closest('[hidden]');
const enabled = (el: Element) => el.getAttribute('aria-disabled') !== 'true' && !(el as HTMLButtonElement).disabled;

/** The group's own operable toggles (excluding those of nested groups). */
function ownToggles(group: Element): HTMLElement[] {
    return [...group.querySelectorAll<HTMLElement>('af-toggle')].filter(t => t.closest('af-group') === group && visible(t) && enabled(t));
}

/** Operable targets in document order; a group with several toggles counts as one target. */
function collect(scope: HTMLElement): Target[] {
    const out: Target[] = [];
    const groups = new Set<Element>();
    for (const el of scope.querySelectorAll<HTMLElement>('af-group, af-toggle, af-input, af-value, af-stimulus, button, select, a[href]')) {
        if (!visible(el) || !enabled(el) || el.closest('.af-scan-panel')) continue;
        const group = el.parentElement?.closest('af-group');
        if (group && groups.has(group)) continue;
        if (el.localName === 'af-group') {
            if (el.hasAttribute('data-dropdown')) {
                const select = el.querySelector('select');
                if (select && !select.disabled) out.push({ el: select, kind: 'dropdown' });
                groups.add(el);
            } else if (ownToggles(el).length > 1) {
                out.push({ el, kind: 'group' });
                groups.add(el);
            }
        } else if (el.localName === 'af-toggle' || el.localName === 'button' || el.localName === 'a') out.push({ el, kind: 'press' });
        else if (el.localName === 'af-input') {
            const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
            if (field && !field.readOnly) out.push({ el, kind: 'text' });
        } else if (el.localName === 'af-value') out.push({ el, kind: el.hasAttribute('data-point') ? 'point' : 'value' });
        else if (el.localName === 'af-stimulus') { if (el.scrollHeight > el.clientHeight + 1) out.push({ el, kind: 'scroll' }); }
        else if (el instanceof HTMLSelectElement && !el.closest('af-group[data-dropdown]')) out.push({ el, kind: 'dropdown' });
    }
    return out;
}

/** Drives switch-access scanning over a scope until disposed. */
export class Scanner {
    private readonly levels: Level[];
    private readonly options: Required<Pick<ScanOptions, 'mode' | 'interval'>> & { next: string; select: string };
    private current?: HTMLElement;
    private timer?: ReturnType<typeof setInterval>;
    /** Text entry in progress: keys belong to the field. */
    private editing?: HTMLElement;
    private readonly onKey = (e: KeyboardEvent) => this.key(e);
    /** Re-highlights when the host replaces highlighted targets (e.g. navigation buttons). */
    private readonly observer = new MutationObserver(() => this.refresh());

    /** `scope`: area to scan (the item, in a booklet also its navigation); `panelHost`: the item, which hosts the control toolbar. */
    constructor(private readonly scope: HTMLElement, private readonly panelHost: HTMLElement, options: ScanOptions = {}) {
        this.options = {
            mode: options.mode ?? 'step',
            interval: Math.max(0.5, options.interval ?? 1.5),
            next: options.keys?.next ?? ' ',
            select: options.keys?.select ?? 'Enter'
        };
        // The item first, then the rest of the scope (e.g. the booklet navigation)
        const top = scope === panelHost ? () => collect(scope)
            : () => [...collect(panelHost), ...collect(scope).filter(t => !panelHost.contains(t.el))];
        this.levels = [{ targets: top, index: -1, leaveAtEnd: false }];
        scope.ownerDocument.addEventListener('keydown', this.onKey, true);
        installScanStyles(scope.ownerDocument);
        scope.setAttribute('data-scanning', '');
        this.observer.observe(scope, { childList: true, subtree: true });
        this.restartTimer();
        queueMicrotask(() => this.step());
    }

    /** Stops scanning and removes all highlights and toolbars. */
    dispose(): void {
        this.scope.ownerDocument.removeEventListener('keydown', this.onKey, true);
        clearInterval(this.timer);
        this.observer.disconnect();
        while (this.levels.length > 1) this.leave();
        this.highlight(undefined);
        this.scope.removeAttribute('data-scanning');
    }

    private get level(): Level {
        return this.levels[this.levels.length - 1];
    }

    private key(e: KeyboardEvent): void {
        if (this.editing) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.endEditing();
            }
            return;
        }
        if (e.key !== this.options.next && e.key !== this.options.select) return;
        e.preventDefault();
        e.stopPropagation();
        // Never select something that is not visibly highlighted (e.g. while the host swaps buttons)
        if (!this.current?.isConnected) {
            this.refresh();
            if (e.key === this.options.select || this.options.mode === 'auto') return;
        }
        if (e.key === this.options.select || this.options.mode === 'auto') this.choose();
        else this.step();
        this.restartTimer();
    }

    private restartTimer(): void {
        clearInterval(this.timer);
        if (this.options.mode === 'auto') this.timer = setInterval(() => { if (!this.editing) this.step(); }, this.options.interval * 1000);
    }

    /** Advances the highlight; at the end of a group, returns to the group itself. */
    step(): void {
        const level = this.level, targets = level.targets();
        if (targets.length === 0) return this.highlight(undefined);
        level.index++;
        if (level.index >= targets.length) {
            if (level.leaveAtEnd) {
                this.leave();
                return this.highlight(this.level.targets()[this.level.index]?.el);
            }
            level.index = 0;
        }
        this.highlight(targets[level.index].el);
    }

    /** Activates the highlighted target. */
    choose(): void {
        const target = this.level.targets()[this.level.index];
        if (!target || target.el !== this.current) return;
        const { el, kind } = target;
        switch (kind) {
            case 'press': {
                el.click();
                // Radio option chosen: leave the group, which stays highlighted
                if (el.getAttribute('role') === 'radio' && this.level.owner?.localName === 'af-group') {
                    this.leave();
                    this.highlight(this.level.targets()[this.level.index]?.el);
                }
                return;
            }
            case 'group': return this.enter({ targets: () => ownToggles(el).map(t => ({ el: t, kind: 'press' })), index: -1, leaveAtEnd: true, owner: el });
            case 'text': return this.startEditing(el);
            case 'value': return this.panel(el, [['−', () => this.press(el, 'ArrowLeft')], ['+', () => this.press(el, 'ArrowRight')]]);
            case 'point': return this.panel(el, [['←', () => this.press(el, 'ArrowLeft')], ['→', () => this.press(el, 'ArrowRight')],
                ['↑', () => this.press(el, 'ArrowUp')], ['↓', () => this.press(el, 'ArrowDown')]]);
            case 'dropdown': {
                const select = el as HTMLSelectElement;
                const move = (d: number) => {
                    select.selectedIndex = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + d));
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                };
                return this.panel(el, [['vorige', () => move(-1)], ['nächste', () => move(1)]]);
            }
            case 'scroll': {
                const by = (d: number) => el.scrollBy?.({ top: d * el.clientHeight * 0.8 });
                return this.panel(el, [['hoch', () => by(-1)], ['runter', () => by(1)]]);
            }
        }
    }

    /** After DOM changes: restores a lost highlight at the same position in the cycle. */
    private refresh(): void {
        if (this.current?.isConnected || this.editing || this.level.index < 0) return;
        while (this.levels.length > 1 && !this.level.owner?.isConnected) this.leave();
        const targets = this.level.targets();
        this.level.index = Math.max(0, Math.min(this.level.index, targets.length - 1));
        this.highlight(targets[this.level.index]?.el);
    }

    private press(el: HTMLElement, key: string): void {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }

    private enter(level: Level): void {
        this.levels.push(level);
        level.owner?.setAttribute('data-scan-inside', '');
        this.step();
    }

    private leave(): void {
        const level = this.levels.pop()!;
        level.owner?.removeAttribute('data-scan-inside');
        level.panel?.remove();
    }

    /** Control toolbar for a target: its actions plus „fertig“; the target stays highlighted meanwhile. */
    private panel(owner: HTMLElement, actions: [string, () => void][]): void {
        const doc = this.scope.ownerDocument;
        const panel = doc.createElement('div');
        panel.className = 'af-scan-panel';
        panel.setAttribute('role', 'toolbar');
        panel.setAttribute('aria-label', 'Steuerung');
        const buttons = [...actions, ['fertig', () => {
            this.leave();
            this.highlight(owner);
        }] as [string, () => void]].map(([label, act]) => {
            const button = doc.createElement('button');
            button.type = 'button';
            button.tabIndex = -1;
            button.textContent = label;
            button.addEventListener('click', act);
            return button;
        });
        panel.append(...buttons);
        this.panelHost.append(panel);
        this.enter({ targets: () => buttons.map(b => ({ el: b, kind: 'press' })), index: -1, leaveAtEnd: false, owner, panel });
    }

    private startEditing(el: HTMLElement): void {
        const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
        if (!field) return;
        this.editing = el;
        el.setAttribute('data-scan-inside', '');
        field.addEventListener('blur', () => this.endEditing(), { once: true });
        field.focus();
    }

    private endEditing(): void {
        const el = this.editing;
        if (!el) return;
        this.editing = undefined;
        el.removeAttribute('data-scan-inside');
        el.querySelector<HTMLElement>('input, textarea')?.blur();
        this.highlight(el);
        this.restartTimer();
    }

    private highlight(el: HTMLElement | undefined): void {
        this.current?.removeAttribute('data-af-scan');
        this.current = el;
        if (!el) return;
        el.setAttribute('data-af-scan', '');
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
}
