// Practice feedback: coding (as in a test) plus the bundle's feedback → one result per coding rule
// (correct, partial, wrong, open) with feedback text, hints and solution. DOM-free; view.ts renders it.

import type { Bundle, CodingRuleDef, Expr, ResponseSet } from '@answerfield/bundle';
import { evaluate, fromJson, type Value } from '@answerfield/expr';
import { codeResponses, wordingFunction } from '@answerfield/runtime-core';

/** Outcome of a coding rule; `open` means a human coder judges the response (`manual`). */
export type Verdict = 'correct' | 'partial' | 'wrong' | 'open';

/** Practice result of one coding rule. */
export interface PracticeResult {
    /** Name of the coding rule (its variable). */
    rule: string;
    /** Responses the rule reads (to mark their components). */
    answers: string[];
    /** Absent if none of the responses was answered. */
    verdict?: Verdict;
    code?: number;
    score?: number;
    /** Full score of the rule (highest score among its codes). */
    max: number;
    /** Feedback for the assigned code (or `otherwise`). */
    feedback?: Value;
    hints: Value[];
    solution?: Value;
}

/** Results per coding rule of an item; feedback is evaluated in the language level set by the accommodations. */
export function practiceResults(bundle: Bundle, responses: ResponseSet, accommodations: Iterable<string> = []): PracticeResult[] {
    const coding = bundle.codings.find(c => c.item === responses.item);
    if (!coding) return [];
    const feedback = bundle.feedback?.find(f => f.item === responses.item)?.rules ?? {};
    const result = codeResponses(bundle, responses);
    // Feedback may reference version parameters and responses ("Dein Dreieck ist 3 Kästchen groß")
    const item = bundle.items.find(i => i.name === responses.item);
    const params = new Map((item?.params ?? []).map(p => [p.name, fromJson(responses.params?.[p.name] ?? p.default, p.type)]));
    const answers = new Map((item?.variables ?? []).map(v => {
        const r = responses.variables[v.id];
        return [v.id, r ? fromJson(r.value, v.type) : null];
    }));
    const env = {
        lookup: (name: string): Value => params.get(name) ?? answers.get(name) ?? null,
        functions: { wording: wordingFunction(new Set(accommodations)) }
    };
    const text = (e: Expr | undefined): Value | undefined => {
        if (!e) return undefined;
        try { return evaluate(e, env); } catch { return undefined; }
    };
    return coding.rules.map((rule: CodingRuleDef) => {
        const r = result.variables[rule.variable] ?? {};
        const fb = feedback[rule.variable] ?? {};
        const max = Math.max(0, ...rule.cases.map(c => c.score ?? 0));
        let verdict: Verdict | undefined;
        if (r.pending && r.pending.length > 0) verdict = 'open';
        else if (r.missing === undefined && r.code !== undefined) {
            const score = r.score ?? 0;
            // without scores (diagnostic codes only): code 0 is wrong, any other is correct
            verdict = max > 0 ? (score >= max ? 'correct' : score > 0 ? 'partial' : 'wrong') : (r.code === 0 ? 'wrong' : 'correct');
        }
        const codeText = r.code !== undefined ? fb.codes?.[String(r.code)] ?? (r.code === 0 ? fb.otherwise : undefined) : undefined;
        const feedbackValue = verdict && verdict !== 'open' ? text(codeText) : undefined;
        const solution = text(fb.solution);
        return {
            rule: rule.variable, answers: rule.answers, max,
            ...(verdict ? { verdict } : {}),
            ...(r.code !== undefined ? { code: r.code } : {}),
            ...(r.score !== undefined ? { score: r.score } : {}),
            ...(feedbackValue !== undefined ? { feedback: feedbackValue } : {}),
            hints: (fb.hints ?? []).map(h => text(h)).filter((h): h is Value => h !== undefined),
            ...(solution !== undefined ? { solution } : {})
        };
    });
}
