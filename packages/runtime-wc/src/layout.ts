// Layout elements: page, section, row, table, stimulus, numbered lines, paragraph, box, list.
import { Rational } from '@answerfield/expr';
import { AfElement, setAttr, uid, size } from './base.js';

/** A page of an item. */
export class AfPage extends AfElement {
    protected render(): void { }
}

/** Section; with a `heading` it becomes a named region. */
export class AfSection extends AfElement {
    private heading?: HTMLHeadingElement;

    protected render(): void {
        const text = this.text('heading');
        if (text && !this.heading) {
            this.heading = document.createElement('h2');
            this.prepend(this.heading);
        }
        if (this.heading) {
            this.heading.textContent = text ?? '';
            this.heading.hidden = !text;
            setAttr(this, 'role', 'region');
            setAttr(this, 'aria-labelledby', this.heading.id ||= uid('af-h'));
        }
    }
}

/** Horizontal row, or a table row when placed directly in a table. */
export class AfRow extends AfElement {
    protected render(): void {
        // Directly inside a table (not inside one of its cells), a row is a table row
        if (inTable(this)) {
            this.setAttribute('role', 'row');
            this.setAttribute('data-table-row', '');
            // Header row: its cells label the columns
            setAttr(this, 'data-head', this.arg('head') === true ? '' : undefined);
            return;
        }
        this.style.gap = size(this.arg('gap')) ?? '';
        setAttr(this, 'data-keep', this.arg('keep') === true ? '' : undefined);
    }
}

/** Whether the element sits directly in a table rather than inside one of its cells. */
function inTable(el: HTMLElement): boolean {
    return el.parentElement?.closest('af-table, af-cell')?.localName === 'af-table';
}

// ---------------------------------------------------------------------------
// Tables and numbered lines
// ---------------------------------------------------------------------------

/** ARIA table; an optional `caption` names it. */
export class AfTable extends AfElement {
    private caption?: HTMLElement;

    protected override init(): void {
        this.setAttribute('role', 'table');
    }

    protected render(): void {
        const text = this.text('caption');
        if (text && !this.caption) {
            this.caption = document.createElement('div');
            this.caption.className = 'af-caption';
            this.caption.id = uid('af-caption');
            this.prepend(this.caption);
        }
        if (this.caption) {
            this.caption.textContent = text ?? '';
            this.caption.hidden = !text;
        }
        setAttr(this, 'aria-labelledby', text ? this.caption?.id : undefined);
    }
}

/** Table cell; a column header inside a header row, `span` spans several columns. */
export class AfCell extends AfElement {
    protected render(): void {
        this.setAttribute('role', this.closest('af-row[data-table-row]')?.hasAttribute('data-head') ? 'columnheader' : 'cell');
        const span = this.arg('span');
        const n = span instanceof Rational ? Number(span.n) : 1;
        setAttr(this, 'aria-colspan', n > 1 ? String(n) : undefined);
        this.style.gridColumn = n > 1 ? `span ${n}` : '';
        setAttr(this, 'data-span', n > 1 ? String(n) : undefined);
    }
}

/** Stimulus material beside the questions: a named region that can be scrolled with the keyboard. */
export class AfStimulus extends AfElement {
    protected override init(): void {
        this.setAttribute('role', 'region');
        this.tabIndex = 0;
    }

    protected render(): void {
        this.setAttribute('aria-label', this.text('label') ?? 'Material zur Aufgabe');
    }
}

/** Fixed numbered lines: each child is one line; the first and every `every`-th line show their number. */
export class AfLines extends AfElement {
    private observer?: MutationObserver;

    protected override init(): void {
        this.observer = new MutationObserver(() => this.number());
        this.observer.observe(this, { childList: true });
    }

    protected render(): void {
        queueMicrotask(() => this.number());
    }

    private number(): void {
        const every = Math.max(1, Number(this.text('every') ?? 5));
        const start = Number(this.text('start') ?? 1);
        [...this.children].forEach((line, i) => {
            const n = start + i;
            setAttr(line, 'data-line', n % every === 0 || i === 0 ? String(n) : undefined);
        });
    }
}

/** Paragraph with an optional `tone`. */
export class AfParagraph extends AfElement {
    protected override init(): void {
        this.setAttribute('role', 'paragraph');
    }

    protected render(): void {
        setAttr(this, 'data-tone', this.text('tone'));
    }
}

/** Bordered block; with `heading` (visible) or `label` it becomes a named group. */
export class AfBox extends AfElement {
    private heading?: HTMLElement;

    protected render(): void {
        setAttr(this, 'data-tone', this.text('tone'));
        setAttr(this, 'data-side', this.text('side'));
        const heading = this.text('heading'), label = this.text('label');
        if (heading && !this.heading) {
            this.heading = document.createElement('div');
            this.heading.className = 'af-box-heading';
            this.heading.id = uid('af-box-h');
            this.prepend(this.heading);
        }
        if (this.heading) {
            this.heading.textContent = heading ?? '';
            this.heading.hidden = !heading;
        }
        setAttr(this, 'role', heading || label ? 'group' : undefined);
        setAttr(this, 'aria-labelledby', heading ? this.heading?.id : undefined);
        setAttr(this, 'aria-label', heading ? undefined : label);
    }
}

/** Wrappers without a box of their own (for, show, components); list entries may sit inside them. */
const WRAPPERS = new Set(['af-for', 'af-iteration', 'af-show', 'af-component']);

/** List: every rendered child is an entry, including children nested in loops and components. */
export class AfList extends AfElement {
    private observer?: MutationObserver;

    protected override init(): void {
        this.setAttribute('role', 'list');
        this.observer = new MutationObserver(() => this.mark());
        this.observer.observe(this, { childList: true, subtree: true });
    }

    protected render(): void {
        setAttr(this, 'data-ordered', this.arg('ordered') === true ? '' : undefined);
        setAttr(this, 'aria-label', this.text('label'));
        queueMicrotask(() => this.mark());
    }

    private mark(): void {
        const visit = (parent: Element) => [...parent.children].forEach(child => {
            if (WRAPPERS.has(child.localName)) visit(child);
            else if (child.getAttribute('role') !== 'listitem') child.setAttribute('role', 'listitem');
        });
        visit(this);
    }
}
