// Versions of an item with parameters for a needs profile, e.g. for "new numbers" in practice.

import type { ItemDef } from '@answerfield/bundle';
import { itemVersions, type ParamValues } from '@answerfield/expr';
import { effectiveAccommodations } from './accommodations.js';

export { defaultParams, isVersion, itemVersions, type ParamValues } from '@answerfield/expr';

/**
 * Versions for the requested accommodations: those satisfying the condition with the effective accommodations;
 * if none does, the versions without accommodations. `[{}]` for items without parameters.
 */
export function versionsFor(item: ItemDef, requested: Iterable<string> = []): ParamValues[] {
    if (!item.params) return [{}];
    const list = itemVersions(item, effectiveAccommodations(requested, item.accommodations));
    return list.length > 0 ? list : itemVersions(item);
}

/** Random version for the profile, preferably different from `current`; undefined without parameters. */
export function randomVersion(item: ItemDef, requested: Iterable<string> = [], current?: ParamValues,
    random: () => number = Math.random): ParamValues | undefined {
    if (!item.params) return undefined;
    const all = versionsFor(item, requested);
    const same = (v: ParamValues) => current !== undefined && Object.keys(v).every(k => JSON.stringify(v[k]) === JSON.stringify(current[k]));
    const others = all.filter(v => !same(v));
    const pool = others.length > 0 ? others : all;
    return pool[Math.floor(random() * pool.length)];
}
