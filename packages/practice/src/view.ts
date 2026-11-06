// Practice view attached to an item rendered by runtime-wc: marks each response with its result (`data-result`),
// shows feedback below it, one hint per attempt and then the solution, and announces a summary.
// Changing a response removes its feedback.

import type { PracticeSummary } from './summary.js';
import type { Value } from '@answerfield/expr';
import { effect, type ItemInstance } from '@answerfield/runtime-core';
import { inline } from '@answerfield/runtime-wc';
import { practiceResults, type PracticeResult, type Verdict } from './results.js';

const STYLE_ID = 'af-practice';
const CSS = /* css */ `
af-root [data-result]:not(af-feedback) { position: relative; border-radius: var(--af-radius); outline: 3px solid transparent; outline-offset: 4px; }
af-root [data-result="correct"]:not(af-feedback) { outline-color: #1b7f3a; }
af-root [data-result="partial"]:not(af-feedback) { outline-color: #9a4d00; }
af-root [data-result="wrong"]:not(af-feedback) { outline-color: #b3261e; }
af-root [data-result="open"]:not(af-feedback) { outline: 2px dashed var(--af-color-border); }
af-root [data-result]:not(af-feedback)::after {
  position: absolute; top: -0.8em; right: -0.5em; width: 1.5em; height: 1.5em; border-radius: 50%; color: #fff;
  display: grid; place-items: center; font-weight: 700; font-size: 0.9em; line-height: 1;
}
af-root [data-result="correct"]:not(af-feedback)::after { content: "✓"; background: #1b7f3a; }
af-root [data-result="partial"]:not(af-feedback)::after { content: "½"; background: #9a4d00; }
af-root [data-result="wrong"]:not(af-feedback)::after { content: "✗"; background: #b3261e; }
af-root [data-result="open"]:not(af-feedback)::after { content: "?"; background: var(--af-color-muted); }
af-feedback { display: block; margin: var(--af-space-2) 0 var(--af-space-3); padding: var(--af-space-2) var(--af-space-3);
  border-left: 4px solid var(--af-color-border); background: var(--af-color-surface); border-radius: 0 var(--af-radius) var(--af-radius) 0; }
af-feedback[data-result="correct"] { border-left-color: #1b7f3a; }
af-feedback[data-result="partial"] { border-left-color: #9a4d00; }
af-feedback[data-result="wrong"] { border-left-color: #b3261e; }
af-feedback > p { margin: 0; }
af-feedback > p + p { margin-top: var(--af-space-1); }
af-feedback .af-feedback-label { font-weight: 700; }
af-root .af-practice-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;

const VERDICT_TEXT: Record<Verdict, string> = {
    correct: 'Richtig!', partial: 'Teilweise richtig.', wrong: 'Noch nicht richtig.', open: 'Das sieht sich deine Lehrkraft an.'
};

let ids = 0;

/** DOM side of practice mode; see {@link attachPractice}. */
export class PracticeView {
    /** Attempts per coding rule (for staged hints). */
    private readonly attempts = new Map<string, number>();
    /** Shown feedback per coding rule: marked elements and feedback box. */
    private readonly shown = new Map<string, { targets: HTMLElement[]; box: HTMLElement; answers: string[] }>();
    /** Response values (JSON) at check time, to detect changes. */
    private checked = new Map<string, string>();
    private readonly status: HTMLElement;
    private readonly stop: () => void;

    constructor(private readonly root: HTMLElement, private readonly instance: ItemInstance) {
        const doc = root.ownerDocument;
        if (!doc.getElementById(STYLE_ID)) {
            const style = doc.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            doc.head.appendChild(style);
        }
        this.status = Object.assign(doc.createElement('div'), { className: 'af-practice-status' });
        this.status.setAttribute('role', 'status');
        root.append(this.status);
        // a changed response removes its feedback
        this.stop = effect(() => {
            const variables = this.instance.responses().variables;
            for (const [rule, view] of [...this.shown]) {
                if (view.answers.some(a => JSON.stringify(variables[a]?.value ?? null) !== this.checked.get(a))) this.hide(rule);
            }
        });
    }

    /** Checks all responses and shows feedback; see {@link Practice.check}. */
    check(): PracticeSummary {
        const responses = this.instance.responses();
        this.checked = new Map(Object.entries(responses.variables).map(([k, v]) => [k, JSON.stringify(v.value ?? null)]));
        for (const rule of [...this.shown.keys()]) this.hide(rule);
        const results = practiceResults(this.instance.bundle, responses, this.instance.accommodations);
        const summary: PracticeSummary = { correct: 0, partial: 0, wrong: 0, open: 0, total: 0 };
        for (const r of results) {
            if (!r.verdict) continue;
            summary[r.verdict]++;
            summary.total++;
            const attempt = r.verdict === 'correct' ? this.attempts.get(r.rule) ?? 1 : (this.attempts.get(r.rule) ?? 0) + 1;
            this.attempts.set(r.rule, attempt);
            this.show(r, attempt);
        }
        this.status.textContent = summary.total === 0 ? 'Noch keine Antwort zum Prüfen.'
            : `${summary.correct} von ${summary.total} richtig` + (summary.partial ? `, ${summary.partial} teilweise` : '')
              + (summary.open ? `, ${summary.open} sieht sich deine Lehrkraft an` : '') + '.';
        return summary;
    }

    /** Removes feedback, markers and the live region. */
    dispose(): void {
        this.stop();
        for (const rule of [...this.shown.keys()]) this.hide(rule);
        this.status.remove();
    }

    /** Elements to mark for responses: the first child of each bound component (the component itself has no box). */
    private targets(answers: string[]): HTMLElement[] {
        return answers.flatMap(a => [...this.root.querySelectorAll<HTMLElement>(`af-component[data-binding="${CSS_escape(a)}"]`)])
            .map(c => (c.firstElementChild as HTMLElement | null) ?? c)
            .filter(t => !t.closest('[hidden]'));
    }

    private show(r: PracticeResult, attempt: number): void {
        const targets = this.targets(r.answers);
        if (targets.length === 0) return;
        const verdict = r.verdict!;
        const doc = this.root.ownerDocument;
        const box = doc.createElement('af-feedback');
        box.id = `af-feedback-${++ids}`;
        box.dataset.result = verdict;
        const line = (label: string | undefined, value: Value | string) => {
            const p = doc.createElement('p');
            if (label) p.append(Object.assign(doc.createElement('span'), { className: 'af-feedback-label', textContent: `${label} ` }));
            p.append(typeof value === 'string' ? doc.createTextNode(value) : inline(box, value));
            box.append(p);
        };
        line(undefined, r.feedback ?? VERDICT_TEXT[verdict]);
        if (verdict === 'wrong' || verdict === 'partial') {
            // one hint per attempt in order, then the solution
            if (attempt <= r.hints.length) line('Tipp:', r.hints[attempt - 1]);
            else if (r.solution !== undefined) line('Lösung:', r.solution);
        }
        for (const t of targets) {
            t.dataset.result = verdict;
            const d = described(t);
            d.setAttribute('aria-describedby', [d.getAttribute('aria-describedby'), box.id].filter(Boolean).join(' '));
        }
        targets[targets.length - 1].after(box);
        this.shown.set(r.rule, { targets, box, answers: r.answers });
    }

    private hide(rule: string): void {
        const view = this.shown.get(rule);
        if (!view) return;
        for (const t of view.targets) {
            delete t.dataset.result;
            const d = described(t);
            const rest = (d.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id && id !== view.box.id);
            if (rest.length > 0) d.setAttribute('aria-describedby', rest.join(' ')); else d.removeAttribute('aria-describedby');
        }
        view.box.remove();
        this.shown.delete(rule);
    }
}

/** Element linked to the feedback via `aria-describedby`: the input control itself, otherwise the response element. */
function described(target: HTMLElement): HTMLElement {
    return target.querySelector<HTMLElement>('input, textarea, select') ?? target;
}

/** Escapes a name for an attribute selector (AF names are identifiers, but stay safe anyway). */
function CSS_escape(name: string): string {
    return name.replace(/["\\]/g, '\\$&');
}
