import type { Bundle, CodingResult, Judgments, ManualQuestion, ResponseSet, VariableCode } from '@answerfield/bundle';
import { EvalError, Rational, evaluate, evaluateCondition, fromJson, type Env, type Value } from '@answerfield/expr';
import { message } from './instance.js';

/** Coding functions over response variables (`meta` expressions), by name. */
const META: Readonly<Record<string, (vars: string[], responses: ResponseSet, result: CodingResult) => Value>> = {
    changed: ([name], responses) => responses.variables[name]?.changed ?? false,
    displayed: ([name], responses) => responses.variables[name]?.displayed ?? false,
    sum_score: (vars, _, result) => vars.reduce((sum, v) => sum.add(Rational.of(result.variables[v]?.score ?? 0)), Rational.of(0))
};

/** Names of the coding functions over response variables, as they appear in `meta` expressions of a bundle. */
export const META_FUNCTIONS: readonly string[] = Object.keys(META);

/**
 * Built-in coder: applies a bundle's coding to an item's responses.
 * Codes apply only to changed responses (first matching case, otherwise code 0); unchanged ones get a missing code,
 * `omitted` if displayed, otherwise `not_reached`. If the result depends on `manual(…)` questions without a
 * judgment, the rule stays open (`pending`). Evaluation errors are reported per rule (`error`).
 */
export function codeResponses(bundle: Bundle, responses: ResponseSet, judgments: Judgments = {}): CodingResult {
    const item = bundle.items.find(i => i.name === responses.item);
    const coding = bundle.codings.find(c => c.item === responses.item);
    const result: CodingResult = { item: responses.item, variables: {}, scores: {} };
    if (!item || !coding) return result;

    const types = new Map(item.variables.map(v => [v.id, v.type]));
    // Version parameters: coding computes with the same numbers the item showed
    const params = new Map((item.params ?? []).map(p => [p.name, fromJson(responses.params?.[p.name] ?? p.default, p.type)]));
    const value = (name: string): Value => {
        if (params.has(name)) return params.get(name)!;
        const response = responses.variables[name];
        const type = types.get(name);
        if (!type) throw new EvalError(`'${name}' ist keine Antwort`);
        return response ? fromJson(response.value, type) : null;
    };
    const derived = new Map<string, Value>();
    const env: Env = {
        lookup: name => derived.has(name) ? derived.get(name)! : value(name),
        meta: (fn, vars) => {
            if (!Object.hasOwn(META, fn)) throw new EvalError(`Unbekannte Kodierfunktion '${fn}'`);
            return META[fn](vars, responses, result);
        },
        judge: q => judgments[q.id]
    };

    for (const rule of coding.rules) {
        const sources = (rule.answers ?? [rule.variable]).map(v => responses.variables[v]);
        const changed = sources.some(r => r?.changed);
        const displayed = sources.some(r => r?.displayed);
        let code: VariableCode = changed ? { code: 0, label: 'falsch', score: 0 } : { missing: displayed ? 'omitted' : 'not_reached' };
        if (changed) {
            try {
                // Open cases (manual questions without judgment) take precedence: a later match counts only once they are judged.
                const pending = new Map<string, ManualQuestion>();
                for (const c of rule.cases) {
                    const truth = evaluateCondition(c.when, env, q => pending.set(q.id, q));
                    if (truth === false || truth === 'open') continue;
                    code = { code: c.code, ...(c.label !== undefined ? { label: c.label } : {}), score: c.score ?? 0 };
                    break;
                }
                if (pending.size > 0) code = { pending: [...pending.values()] };
            } catch (e) {
                code = { error: message(e) };
            }
        }
        result.variables[rule.variable] = code;
    }
    for (const score of coding.scores) {
        try {
            const v = evaluate(score.value, env);
            derived.set(score.name, v);
            result.scores[score.name] = v instanceof Rational ? v.toNumber() : 0;
        } catch {
            result.scores[score.name] = 0;
        }
    }
    return result;
}
