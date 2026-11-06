// Choice elements: group (also rendered as a dropdown or with draggable cards) and toggle.
import type { RElement } from '@answerfield/runtime-core';
import { AfElement, setAttr, positionAt, uid } from './base.js';

/** Group of toggles: checkbox group or radio group, optionally shown as a dropdown or with cards. */
export class AfGroup extends AfElement {
    private legend!: HTMLElement;
    private body!: HTMLElement;
    /** Dropdown view of a radio group; the toggles remain the source of truth. */
    private select?: HTMLSelectElement;
    private face?: HTMLElement;

    override get childTarget(): HTMLElement {
        return this.body;
    }

    override attach(node: RElement): void {
        super.attach(node);
        this.legend = document.createElement('div');
        this.legend.className = 'af-legend';
        this.legend.id = uid('af-legend');
        this.body = document.createElement('div');
        this.body.className = 'af-group-body';
        this.append(this.legend, this.body);
        this.addEventListener('keydown', e => this.onKeyDown(e));
        this.addEventListener('focusin', e => { if (e.target instanceof AfToggle) this.lastFocused = e.target; });
    }

    private lastFocused?: AfToggle;

    /** Cards for the slots in this group (`cards: start|end`). */
    tray?: CardTray;

    protected render(): void {
        const label = this.text('label');
        this.legend.textContent = label ?? '';
        const cards = this.text('cards');
        setAttr(this, 'data-cards', cards);
        if (cards && !this.tray) this.tray = new CardTray(this);
        this.tray?.place(cards === 'start' ? 'start' : 'end');
        if (this.arg('dropdown') === true && this.text('role') === 'radiogroup') {
            this.renderDropdown(label);
        } else {
            this.setAttribute('role', this.text('role') === 'radiogroup' ? 'radiogroup' : 'group');
            this.legend.hidden = !label;
            setAttr(this, 'aria-labelledby', label ? this.legend.id : undefined);
        }
        queueMicrotask(() => this.syncRovingFocus());
    }

    private renderDropdown(label: string | undefined): void {
        this.setAttribute('role', 'none');
        this.removeAttribute('aria-labelledby');
        this.setAttribute('data-dropdown', '');
        this.legend.hidden = true;
        this.body.hidden = true;
        if (!this.select) {
            this.select = document.createElement('select');
            this.select.addEventListener('change', () => {
                const radios = this.radios();
                const index = this.select!.selectedIndex;
                if (index <= 0) radios.find(r => r.checked)?.clear();
                else radios[index - 1]?.select();
            });
            this.insertBefore(this.select, this.body);
        }
        setAttr(this.select, 'aria-label', label);
    }

    /** Selects an option (1-based), e.g. a dropped card. */
    place(option: number): void {
        this.radios()[option - 1]?.select();
    }

    /** Options as cards for the tray: content, checked, and whether it is unavailable here. */
    cards(): { content: Node[]; checked: boolean; disabled: boolean }[] {
        return this.radios().map(r => ({
            content: [...(r.querySelector('.af-toggle-content')?.childNodes ?? [])].map(n => n.cloneNode(true)),
            checked: r.checked,
            disabled: r.getAttribute('aria-disabled') === 'true' && !r.checked
        }));
    }

    /** Syncs the dropdown options (text, disabled, selected) from the toggles. */
    private syncSelect(): void {
        const select = this.select;
        if (!select) return;
        const radios = this.radios();
        const texts = ['–', ...radios.map(r => r.textContent?.trim() || r.querySelector('img')?.alt || r.getAttribute('aria-label') || '')];
        while (select.options.length > texts.length) select.remove(select.options.length - 1);
        texts.forEach((text, i) => {
            const option = select.options[i] ?? select.appendChild(document.createElement('option'));
            option.textContent = text;
            option.disabled = i > 0 && radios[i - 1].getAttribute('aria-disabled') === 'true' && !radios[i - 1].checked;
        });
        select.selectedIndex = radios.findIndex(r => r.checked) + 1;
        // Slot in a group with cards: drawn as a drop target showing the placed card (images included)
        const deck = this.parentElement?.closest('af-group[data-cards]') as AfGroup | null;
        this.toggleAttribute('data-slot', deck !== null);
        select.classList.toggle('af-slot', deck !== null);
        if (deck) {
            this.face ??= Object.assign(document.createElement('span'), { className: 'af-slot-face' });
            this.face.setAttribute('aria-hidden', 'true');
            if (this.face.parentElement !== this) this.insertBefore(this.face, select);
            const chosen = radios.find(r => r.checked)?.querySelector('.af-toggle-content');
            this.face.replaceChildren(...[...chosen?.childNodes ?? []].map(n => n.cloneNode(true)));
            this.face.hidden = !chosen;
        }
        // Redraw the cards (some may now sit in a slot)
        deck?.tray?.sync();
    }

    private radios(): AfToggle[] {
        return [...this.body.querySelectorAll<AfToggle>('af-toggle[role="radio"]')].filter(t => t.closest('af-group') === this);
    }

    /** Toggles inside running text (highlighting, inserting punctuation), often dozens per text. */
    private textToggles(): AfToggle[] {
        return [...this.body.querySelectorAll<AfToggle>('af-toggle[data-look]')].filter(t => t.closest('af-group') === this);
    }

    /** Toggles of a group that forms a single tab stop (radio group, toggles in text); empty otherwise. */
    roving(): AfToggle[] {
        if (this.select) return [];
        if (this.getAttribute('role') === 'radiogroup') return this.radios();
        const toggles = this.textToggles();
        return toggles.length > 1 ? toggles : [];
    }

    /**
     * Roving tabindex: only one option is reachable with Tab; in a radio group the checked one (or the first),
     * for toggles in text the last focused one (or the first).
     */
    syncRovingFocus(): void {
        if (this.select) {
            this.syncSelect();
            return;
        }
        const toggles = this.roving();
        if (toggles.length === 0) return;
        const active = this.getAttribute('role') === 'radiogroup'
            ? toggles.find(r => r.checked) ?? toggles[0]
            : toggles.find(t => t === this.lastFocused) ?? toggles[0];
        toggles.forEach(t => t.tabIndex = t === active ? 0 : -1);
    }

    /** Arrow keys move within the group; a radio group selects as it moves, toggles in text switch only on Space. */
    private onKeyDown(e: KeyboardEvent): void {
        const toggles = this.roving();
        const index = toggles.findIndex(t => t === document.activeElement);
        if (index < 0) return;
        const radio = this.getAttribute('role') === 'radiogroup';
        const last = toggles.length - 1;
        const target = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (index === last ? (radio ? 0 : last) : index + 1)
            : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (index === 0 ? (radio ? last : 0) : index - 1)
            : !radio && e.key === 'Home' ? 0 : !radio && e.key === 'End' ? last : -1;
        if (target < 0) return;
        e.preventDefault();
        const next = toggles[target];
        next.focus();
        if (radio) next.select();
        else {
            this.lastFocused = next;
            this.syncRovingFocus();
        }
    }
}

// ---------------------------------------------------------------------------
// Interactive atoms
// ---------------------------------------------------------------------------

/**
 * Cards of a group with `cards`: the options of its dropdowns (slots), to drag or tap. A pointer convenience only:
 * the slots remain dropdowns and the response is their selection. The cards are therefore hidden from assistive
 * technology; keyboard and screen reader users operate the dropdowns.
 */
export class CardTray {
    readonly el: HTMLElement;
    private picked?: number;
    private drag?: { option: number; ghost: HTMLElement; startX: number; startY: number; moved: boolean };
    private readonly onSlot = (e: Event) => this.onSlotPointer(e);

    constructor(private readonly group: AfGroup) {
        this.el = document.createElement('div');
        this.el.className = 'af-cards';
        this.el.setAttribute('aria-hidden', 'true');
        // Tap a card, then a slot: the slot takes the card instead of opening its dropdown
        group.addEventListener('pointerdown', this.onSlot, true);
        queueMicrotask(() => this.sync());
    }

    /** Places the cards at the start or end of the group. */
    place(side: 'start' | 'end'): void {
        const body = this.group.childTarget;
        if (side === 'start' ? body.previousElementSibling !== this.el : body.nextElementSibling !== this.el) {
            if (side === 'start') body.before(this.el); else body.after(this.el);
        }
        this.sync();
    }

    private slots(): AfGroup[] {
        return [...this.group.querySelectorAll<AfGroup>('af-group[data-dropdown]')]
            .filter(g => g.parentElement?.closest('af-group[data-cards]') === this.group);
    }

    /** Redraws the cards from the current slot states. */
    sync(): void {
        const slots = this.slots();
        const cards = slots[0]?.cards() ?? [];
        const states = slots.map(s => s.cards());
        this.el.replaceChildren(...cards.map((card, i) => {
            const option = i + 1;
            const el = document.createElement('div');
            el.className = 'af-card';
            el.append(...card.content);
            // Placed and unavailable elsewhere (each card used once) → remove from the tray
            const at = states.findIndex(s => s[i]?.checked);
            el.hidden = at >= 0 && states.every((s, k) => k === at || s[i]?.disabled);
            el.classList.toggle('af-picked', this.picked === option);
            el.addEventListener('pointerdown', e => this.start(e, option, el));
            return el;
        }));
    }

    private start(e: PointerEvent, option: number, card: HTMLElement): void {
        if (e.button !== 0) return;
        e.preventDefault();
        // Synthetic events (tests, some assistive tools) have no real pointer to capture
        try { card.setPointerCapture(e.pointerId); } catch { /* continue without capture */ }
        const ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add('af-card-ghost');
        ghost.hidden = true;
        this.el.append(ghost);
        this.drag = { option, ghost, startX: e.clientX, startY: e.clientY, moved: false };
        const move = (ev: PointerEvent) => {
            const d = this.drag;
            if (!d) return;
            if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 6) return;
            d.moved = true;
            d.ghost.hidden = false;
            d.ghost.style.left = `${ev.clientX}px`;
            d.ghost.style.top = `${ev.clientY}px`;
            this.highlight(this.slotAt(ev.clientX, ev.clientY));
        };
        const end = (ev: PointerEvent) => {
            card.removeEventListener('pointermove', move);
            card.removeEventListener('pointerup', end);
            card.removeEventListener('pointercancel', end);
            const d = this.drag;
            this.drag = undefined;
            d?.ghost.remove();
            this.highlight(undefined);
            if (!d) return;
            if (!d.moved) {
                // Tap: pick the card up, or put it back
                this.picked = this.picked === option ? undefined : option;
                this.sync();
                return;
            }
            if (ev.type === 'pointerup') this.slotAt(ev.clientX, ev.clientY)?.place(option);
            this.picked = undefined;
        };
        card.addEventListener('pointermove', move);
        card.addEventListener('pointerup', end);
        card.addEventListener('pointercancel', end);
    }

    private onSlotPointer(e: Event): void {
        if (this.picked === undefined) return;
        const slot = (e.target as Element | null)?.closest?.('af-group[data-dropdown]') as AfGroup | null;
        if (!slot || !this.slots().includes(slot)) return;
        e.preventDefault();
        e.stopPropagation();
        const option = this.picked;
        this.picked = undefined;
        slot.place(option);
        this.sync();
    }

    /** Slot under the pointer (the dragged card does not block hit testing). */
    private slotAt(x: number, y: number): AfGroup | undefined {
        const slots = this.slots();
        return document.elementsFromPoint(x, y).map(el => el.closest('af-group[data-dropdown]') as AfGroup | null)
            .find((g): g is AfGroup => g !== null && slots.includes(g));
    }

    private highlight(slot: AfGroup | undefined): void {
        for (const s of this.slots()) s.toggleAttribute('data-drop-target', s === slot);
    }
}

/** Selectable option: checkbox, radio, toggle button or a toggle in text (`look`). */
export class AfToggle extends AfElement {
    private content!: HTMLElement;
    /** In a plane: the toggle's shapes, drawn in the plane right after it and clickable there. */
    private shapes?: HTMLElement;

    get checked(): boolean {
        return this.arg('checked') === true;
    }

    override get childTarget(): HTMLElement {
        // In a plane the content is the toggle's shape (e.g. a sector to color): it is image and target at once, while
        // the toggle itself stays the control for keyboard, switches and screen readers
        if (!this.shapes && this.closest('af-plane')) {
            this.shapes = document.createElement('span');
            this.shapes.className = 'af-toggle-shape';
            this.shapes.addEventListener('click', e => {
                e.preventDefault();
                this.activate();
            });
            this.after(this.shapes);
            this.setAttribute('data-shape', '');
        }
        return this.shapes ?? this.content;
    }

    override attach(node: RElement): void {
        super.attach(node);
        const indicator = document.createElement('span');
        indicator.className = 'af-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        this.content = document.createElement('span');
        this.content.className = 'af-toggle-content';
        this.append(indicator, this.content);
        this.tabIndex = 0;
        this.addEventListener('click', e => {
            e.preventDefault();
            this.activate();
        });
        this.addEventListener('keydown', e => {
            if (e.key === ' ' || (e.key === 'Enter' && this.getAttribute('role') !== 'radio')) {
                e.preventDefault();
                this.activate();
            }
        });
    }

    /** For radio groups: select without toggling off. */
    select(): void {
        if (!this.checked && !this.disabled) this.emit('check');
    }

    /** Clears the selection (e.g. the empty choice in a dropdown). */
    clear(): void {
        if (this.checked && !this.disabled) this.emit('uncheck');
    }

    private get disabled(): boolean {
        return this.arg('disabled') === true;
    }

    private activate(): void {
        if (this.disabled || this.getAttribute('aria-disabled') === 'true') return;
        if (this.getAttribute('role') === 'radio') this.select();
        else this.emit(this.checked ? 'uncheck' : 'check');
    }

    protected render(): void {
        const role = this.text('role') ?? 'checkbox';
        this.setAttribute('role', role);
        const look = this.text('look');
        setAttr(this, 'data-look', look && look !== 'box' ? look : undefined);
        positionAt(this, this.arg('at'));
        // Toggle button: aria-pressed instead of aria-checked
        this.setAttribute(role === 'button' ? 'aria-pressed' : 'aria-checked', String(this.checked));
        this.removeAttribute(role === 'button' ? 'aria-checked' : 'aria-pressed');
        setAttr(this, 'aria-disabled', this.disabled ? 'true' : undefined);
        setAttr(this, 'aria-label', this.text('label'));
        (this.closest('af-group') as AfGroup | null)?.syncRovingFocus?.();
    }
}
