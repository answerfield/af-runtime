// Text input with a character toolbar and a length counter.
import { Rational, display, type Value } from '@answerfield/expr';
import type { ElementProps } from '@answerfield/runtime-core';
import { AfElement, setAttr, positionAt, uid, size } from './base.js';

/** Single- or multi-line text input bound to a response. */
export class AfInput extends AfElement {
    private field!: HTMLInputElement | HTMLTextAreaElement;
    private counter?: HTMLElement;
    /** Live region announcing the length limit when it gets close (not on every keystroke). */
    private limit?: HTMLElement;
    private announced = '';

    protected override init(): void {
        const multiline = this.arg('multiline') === true;
        if (multiline) {
            this.setAttribute('data-multiline', '');
            const label = document.createElement('label');
            label.className = 'af-label';
            this.field = document.createElement('textarea');
            this.field.id = uid('af-input');
            label.htmlFor = this.field.id;
            this.counter = document.createElement('span');
            this.counter.className = 'af-counter';
            this.counter.id = uid('af-counter');
            this.field.setAttribute('aria-describedby', this.counter.id);
            this.limit = document.createElement('span');
            this.limit.className = 'af-visually-hidden';
            this.limit.setAttribute('role', 'status');
            this.append(label, this.field, this.counter, this.limit);
        } else {
            this.field = document.createElement('input');
            this.field.type = 'text';
            this.append(this.field);
        }
        this.field.addEventListener('input', () => this.emit('bind', this.field.value));
    }

    private keybar?: HTMLElement;

    /** Character toolbar (`keys`): buttons insert at the caret; focus stays in the field. */
    private renderKeys(): void {
        const keys = Array.isArray(this.arg('keys')) ? (this.arg('keys') as Value[]).map(k => display(k)) : [];
        const current = this.keybar ? [...this.keybar.children].map(b => b.textContent) : [];
        if (keys.join('\u0000') === current.join('\u0000')) return;
        this.keybar?.remove();
        this.keybar = undefined;
        if (keys.length === 0) return;
        this.keybar = document.createElement('div');
        this.keybar.className = 'af-keys';
        this.keybar.setAttribute('role', 'toolbar');
        this.keybar.setAttribute('aria-label', 'Zeichen einfügen');
        for (const key of keys) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = key;
            setAttr(button, 'aria-label', KEY_NAMES[key] ? `${KEY_NAMES[key]} einfügen` : undefined);
            // Suppress mousedown so caret and focus stay in the field
            button.addEventListener('mousedown', e => e.preventDefault());
            button.addEventListener('click', () => this.insert(key));
            this.keybar.append(button);
        }
        this.field.after(this.keybar);
    }

    private insert(text: string): void {
        const f = this.field;
        const start = f.selectionStart ?? f.value.length, end = f.selectionEnd ?? start;
        const max = f.maxLength > 0 ? f.maxLength : Infinity;
        if (f.value.length - (end - start) + text.length > max) return;
        f.value = f.value.slice(0, start) + text + f.value.slice(end);
        f.setSelectionRange(start + text.length, start + text.length);
        f.focus();
        this.emit('bind', f.value);
    }

    protected render(props: ElementProps): void {
        positionAt(this, this.arg('at'));
        this.renderKeys();
        const label = this.text('label') ?? '';
        const labelElement = this.querySelector<HTMLLabelElement>('label.af-label');
        if (labelElement) labelElement.textContent = label;
        else setAttr(this.field, 'aria-label', label || undefined);

        const value = typeof props.bind === 'string' ? props.bind : '';
        if (this.field.value !== value) this.field.value = value;
        const max = this.arg('max');
        if (max instanceof Rational) this.field.maxLength = Number(max.n);
        else this.field.removeAttribute('maxlength');
        if (this.counter) this.counter.textContent = max instanceof Rational ? `${value.length} / ${max}` : '';
        if (this.limit && max instanceof Rational) {
            // Announce only at thresholds (10 % left, limit reached); otherwise the count is shown next to the field only
            const n = Number(max.n), left = n - value.length;
            const note = left <= 0 ? 'Höchstlänge erreicht.' : left <= Math.max(10, Math.round(n / 10)) ? `Noch ${left} Zeichen frei.` : '';
            const bucket = left <= 0 ? 'full' : note ? 'near' : '';
            if (bucket !== this.announced) {
                this.limit.textContent = note;
                this.announced = bucket;
            }
        }
        this.field.style.width = size(this.arg('width')) ?? '';
        // No browser assistance in responses (spell check, autocorrect, suggestions)
        this.field.spellcheck = false;
        setAttr(this.field, 'autocomplete', 'off');
        setAttr(this.field, 'autocorrect', 'off');
        setAttr(this.field, 'autocapitalize', 'off');
        setAttr(this.field, 'inputmode', this.text('kind') === 'number' ? 'decimal' : undefined);
    }
}

/** Spoken names of common toolbar characters, for screen readers. */
const KEY_NAMES: Readonly<Record<string, string>> = {
    '·': 'mal', '×': 'mal', ':': 'geteilt durch', '÷': 'geteilt durch', '²': 'hoch 2', '³': 'hoch 3', '√': 'Wurzel',
    'π': 'pi', '≈': 'ungefähr gleich', '≠': 'ungleich', '≤': 'kleiner gleich', '≥': 'größer gleich', '°': 'Grad',
    '±': 'plus minus', '∞': 'unendlich', '−': 'minus', '%': 'Prozent', '‰': 'Promille', '∠': 'Winkel', '△': 'Dreieck'
};
