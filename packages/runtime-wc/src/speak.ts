// Read aloud (read_aloud): a speaker button at each text block, question and labelled field. It reads what is shown,
// in the shown language level, with the device's speech output or a voice the host supplies. Works on the rendered
// DOM only and is loaded only when read_aloud applies.

/** Speech output; the host may supply its own (prerecorded, a server voice) instead of the browser's. */
export interface Speech {
    /** Speaks `text`; resolves when finished or cancelled. */
    speak(text: string, lang: string): Promise<void>;
    cancel(): void;
}

/** The browser's speech output (Web Speech API), or undefined where there is none. */
export function browserSpeech(win: Window & typeof globalThis = window, rate = 0.9): Speech | undefined {
    const synth = win.speechSynthesis;
    if (!synth || typeof win.SpeechSynthesisUtterance !== 'function') return undefined;
    return {
        speak: (text, lang) => new Promise(resolve => {
            const utterance = new win.SpeechSynthesisUtterance(text);
            utterance.lang = lang;
            utterance.rate = rate;
            utterance.onend = () => resolve();
            utterance.onerror = () => resolve();
            synth.cancel();
            synth.speak(utterance);
        }),
        cancel: () => synth.cancel()
    };
}

/** Units that get a speaker button: text blocks, questions with their options, headings, captions, labelled fields. */
const UNITS = 'af-p, af-group, af-lines, af-section > h2, af-table > .af-caption, af-box > .af-box-heading, af-input[data-multiline]';

/** Adds and maintains the speaker buttons in `root`; one text is read at a time. */
export class ReadAloud {
    private readonly observer: MutationObserver;
    private current?: { unit: Element; button: HTMLButtonElement };
    private scheduled = false;

    constructor(private readonly root: HTMLElement, private readonly speech: Speech) {
        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(root, { childList: true, subtree: true });
        this.update();
    }

    private schedule(): void {
        if (this.scheduled) return;
        this.scheduled = true;
        queueMicrotask(() => { this.scheduled = false; this.update(); });
    }

    /** Gives every outermost unit a button (content added later, e.g. by `show`, included). */
    private update(): void {
        for (const unit of this.root.querySelectorAll(UNITS)) {
            if (unit.parentElement?.closest(UNITS.replace(/, af-section > h2.*$/, ''))) continue; // part of a larger unit
            if (unit.closest('af-plane')) continue;                                                  // part of a drawing
            if (buttonOf(unit)) continue;
            const button = unit.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = 'af-speak';
            button.innerHTML = SPEAKER;
            button.setAttribute('aria-label', 'Vorlesen');
            button.setAttribute('aria-pressed', 'false');
            button.addEventListener('click', () => this.toggle(unit, button));
            // Inside the unit where its own rendering leaves the first child alone; before it where children are lines
            if (unit.localName === 'af-lines' || unit.localName === 'h2' || unit.classList.contains('af-caption') || unit.classList.contains('af-box-heading')) {
                unit.before(button);
            } else {
                unit.prepend(button);
            }
            (button as SpeakButton).afUnit = unit;
        }
    }

    private toggle(unit: Element, button: HTMLButtonElement): void {
        const again = this.current?.unit === unit;
        this.stop();
        if (again) return;
        const text = spokenText(unit);
        if (!text) return;
        this.current = { unit, button };
        unit.setAttribute('data-speaking', '');
        button.setAttribute('aria-pressed', 'true');
        void this.speech.speak(text, unit.closest('[lang]')?.getAttribute('lang') ?? 'de').then(() => {
            if (this.current?.unit === unit) this.stop();
        });
    }

    private stop(): void {
        if (!this.current) return;
        this.current.unit.removeAttribute('data-speaking');
        this.current.button.setAttribute('aria-pressed', 'false');
        this.current = undefined;
        this.speech.cancel();
    }

    dispose(): void {
        this.stop();
        this.observer.disconnect();
        this.root.querySelectorAll('button.af-speak').forEach(b => b.remove());
    }
}

/** Speaker icon (decorative; the button is named „Vorlesen“). */
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>'
    + '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

interface SpeakButton extends HTMLButtonElement { afUnit?: Element }

function buttonOf(unit: Element): HTMLButtonElement | undefined {
    const candidates = [unit.firstElementChild, unit.previousElementSibling];
    return candidates.find((b): b is SpeakButton => b instanceof unit.ownerDocument.defaultView!.HTMLButtonElement
        && b.classList.contains('af-speak') && (b as SpeakButton).afUnit === unit);
}

/** What a unit says: visible text, formulas spoken, fields and options as sentences. */
export function spokenText(unit: Element): string {
    const parts: string[] = [];
    const walk = (node: Node) => {
        if (node.nodeType === 3) { parts.push(node.textContent ?? ''); return; }
        if (!(node instanceof node.ownerDocument!.defaultView!.Element)) return;
        const el = node as Element;
        if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' || el.classList.contains('af-speak')
            || el.localName === 'select' || el.classList.contains('af-counter') || el.classList.contains('af-keys')) return;
        if (el.classList.contains('af-math')) { parts.push(` ${texSpeech(el.getAttribute('data-tex') ?? el.textContent ?? '')} `); return; }
        if (el.localName === 'img') { parts.push(` ${el.getAttribute('alt') ?? ''} `); return; }
        if (el.localName === 'input' || el.localName === 'textarea') {
            const label = el.getAttribute('aria-label');
            parts.push(label ? ` (Feld: ${label}) ` : ' (Feld) ');
            return;
        }
        // An option or a heading ends a sentence
        const pause = el.localName === 'af-toggle' || el.classList.contains('af-legend') || el.localName === 'label';
        el.childNodes.forEach(walk);
        if (pause) parts.push('. ');
    };
    walk(unit);
    return normalize(parts.join(''));
}

/** Operators and symbols as words; whitespace and punctuation tidied. */
export function normalize(text: string): string {
    return text
        .replace(/(\d)\s*[·×]\s*(\d)/g, '$1 mal $2')
        .replace(/(\d)\s+:\s+(\d)|(\d)\s*÷\s*(\d)/g, (_, a, b, c, d) => `${a ?? c} geteilt durch ${b ?? d}`)
        .replace(/(\d)\s*−\s*(\d)/g, '$1 minus $2')
        .replace(/(\d)\s*\+\s*(\d)/g, '$1 plus $2')
        .replace(/\s*=\s*/g, ' gleich ')
        .replace(/[·×]/g, ' mal ')
        .replace(/\s+([.,;:!?])/g, '$1')
        .replace(/([.!?:])\s*\.(\s|$)/g, '$1$2')
        .replace(/\s+/g, ' ')
        .trim();
}

const DENOMINATORS = ['', '', 'Halbe', 'Drittel', 'Viertel', 'Fünftel', 'Sechstel', 'Siebtel', 'Achtel', 'Neuntel',
    'Zehntel', 'Elftel', 'Zwölftel'];

/** A formula in TeX notation as German speech, for the formulas items use (fractions, operators, powers, roots). */
export function texSpeech(tex: string): string {
    let s = tex;
    for (let i = 0; i < 5; i++) {
        s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => {
            const n = Number(b.trim());
            const unit = /^\d+$/.test(a.trim()) && Number.isInteger(n) && n >= 2 && n < DENOMINATORS.length
                ? (n === 2 && a.trim() === '1' ? 'ein Halb' : DENOMINATORS[n]) : undefined;
            return unit ? (unit === 'ein Halb' ? unit : `${a.trim()} ${unit}`) : ` ${a} durch ${b} `;
        });
        s = s.replace(/\\sqrt\{([^{}]*)\}/g, ' Wurzel aus $1 ');
    }
    return normalize(s
        .replace(/\^\{?2\}?/g, ' hoch 2 ').replace(/\^\{?3\}?/g, ' hoch 3 ').replace(/\^\{([^{}]*)\}/g, ' hoch $1 ').replace(/\^(\w)/g, ' hoch $1 ')
        .replace(/_\{([^{}]*)\}/g, ' $1 ').replace(/_(\w)/g, ' $1 ')
        .replace(/\\cdot|\\times/g, ' mal ').replace(/\\div/g, ' geteilt durch ')
        .replace(/\\leq?/g, ' kleiner gleich ').replace(/\\geq?/g, ' größer gleich ').replace(/\\neq/g, ' ungleich ')
        .replace(/\\approx/g, ' ungefähr ').replace(/\\pi/g, ' pi ').replace(/\\alpha/g, ' alpha ').replace(/\\beta/g, ' beta ')
        .replace(/\\overline\{([^{}]*)\}/g, ' Strecke $1 ').replace(/\\angle/g, ' Winkel ').replace(/\\%/g, ' Prozent ')
        .replace(/</g, ' kleiner als ').replace(/>/g, ' größer als ')
        .replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}]/g, ' ')
        .replace(/(\S)\s*-\s*(\S)/g, '$1 minus $2').replace(/\+/g, ' plus '));
}
