import { beforeEach, describe, expect, test } from 'vitest';
import { createItemInstance } from '@answerfield/runtime-core';
import { renderItem } from '@answerfield/runtime-wc';
import { attachPractice } from '../src/index.js';
import { workspace } from './workspace.js';

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('Üben: Prüfen und Rückmeldung', () => {
    const source = `item pr2 "Üben" {
  a = Choice("Welche Zahl ist gerade?", ["3", "4", "5"])
  p { "Oben im Bruch steht der " b = Gap("Wort") "." }
  c = FreeText("Begründe.")
}
coding pr2 {
  a: codes(code(1, "richtig", score: 1, when: a == {2}, feedback: "Genau, 4 ist gerade."),
           code(2, "ungerade", when: a == {1} or a == {3},
                feedback: wording("3 und 5 lassen beim Teilen durch 2 einen Rest.", easy: "3 und 5 sind ungerade.")),
           hints: ["Gerade Zahlen kann man durch 2 teilen."], solution: "4")
  b: correct(normalize(b, case: false) == "zähler", wrong: "Unten steht der Nenner, oben …", hints: ["Z…"], solution: "Zähler")
  c: correct(manual("nennt einen Grund"))
}
`;
    async function setup(accommodations: string[] = []) {
        const { compile } = await workspace({ pr2: source });
        const instance = createItemInstance(compile('pr2').bundle, 'pr2', { accommodations });
        const { root } = renderItem(instance, document.body);
        const practice = attachPractice(root, instance);
        return { instance, root, check: () => practice.check(), dispose: () => practice.dispose() };
    }
    const feedbackOf = (root: HTMLElement, binding: string) => {
        const target = root.querySelector(`af-component[data-binding="${binding}"]`)!.firstElementChild as HTMLElement;
        return { result: target.dataset.result, text: target.parentElement!.querySelector('af-feedback')?.textContent };
    };

    test('Ergebnis an der Antwort, Rückmeldung je Code, Hinweis je Versuch, dann die Lösung; offen bei manual', async () => {
        const { root, check } = await setup();
        root.querySelectorAll<HTMLElement>('af-toggle')[2].click();   // 5: odd
        const input = root.querySelector('af-input input') as HTMLInputElement;
        input.value = 'Nenner';
        input.dispatchEvent(new Event('input'));
        const textarea = root.querySelector('af-input textarea') as HTMLTextAreaElement;
        textarea.value = 'weil';
        textarea.dispatchEvent(new Event('input'));

        let summary = check();
        expect(summary).toEqual({ correct: 0, partial: 0, wrong: 2, open: 1, total: 3 });
        expect(feedbackOf(root, 'a')).toEqual({ result: 'wrong', text: '3 und 5 lassen beim Teilen durch 2 einen Rest.Tipp: Gerade Zahlen kann man durch 2 teilen.' });
        expect(feedbackOf(root, 'b').text).toBe('Unten steht der Nenner, oben …Tipp: Z…');
        expect(feedbackOf(root, 'c')).toEqual({ result: 'open', text: 'Das sieht sich deine Lehrkraft an.' });
        expect(root.querySelector('.af-practice-status')!.textContent).toBe('0 von 3 richtig, 1 sieht sich deine Lehrkraft an.');
        // screen reader: feedback linked to the input
        expect(input.getAttribute('aria-describedby')).toMatch(/^af-feedback-\d+$/);

        // second attempt without changes: hints used up → solution
        check();
        expect(feedbackOf(root, 'b').text).toBe('Unten steht der Nenner, oben …Lösung: Zähler');

        // changing a response removes its feedback; others remain
        input.value = 'Zähler';
        input.dispatchEvent(new Event('input'));
        expect(feedbackOf(root, 'b')).toEqual({ result: undefined, text: undefined });
        expect(feedbackOf(root, 'a').result).toBe('wrong');
        expect(input.hasAttribute('aria-describedby')).toBe(false);

        root.querySelectorAll<HTMLElement>('af-toggle')[1].click();   // 4
        summary = check();
        expect(summary).toMatchObject({ correct: 2, wrong: 0, open: 1 });
        expect(feedbackOf(root, 'a')).toEqual({ result: 'correct', text: 'Genau, 4 ist gerade.' });
        expect(feedbackOf(root, 'b')).toEqual({ result: 'correct', text: 'Richtig!' });
    });

    test('Rückmeldung in Leichter Sprache', async () => {
        const { root, check } = await setup(['easy_language']);
        root.querySelectorAll<HTMLElement>('af-toggle')[0].click();
        check();
        expect(feedbackOf(root, 'a').text).toContain('3 und 5 sind ungerade.');
    });

    test('dispose entfernt Rückmeldung, Markierung und Statuszeile', async () => {
        const { root, check, dispose } = await setup();
        root.querySelectorAll<HTMLElement>('af-toggle')[0].click();
        check();
        expect(feedbackOf(root, 'a').result).toBe('wrong');
        dispose();
        expect(feedbackOf(root, 'a')).toEqual({ result: undefined, text: undefined });
        expect(root.querySelector('.af-practice-status')).toBeNull();
    });
});
