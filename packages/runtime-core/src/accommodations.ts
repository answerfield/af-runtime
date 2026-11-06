import type { ItemDef } from '@answerfield/bundle';
import type { Value } from '@answerfield/expr';

/**
 * Needs profile following QTI 3 / Access for All (PNP). Holds settings only, never diagnoses.
 */
export interface NeedsProfile {
    display?: {
        /** Magnification factor; above 1 requests `magnification`. */
        scale?: number;
        contrast?: 'normal' | 'high';
        reflow?: boolean;
        reduced_motion?: boolean;
        /** Strong focus ring, the current block highlighted, the clock shown on request only (attention, anxiety). */
        focus_emphasis?: boolean;
    };
    content?: {
        read_aloud?: 'off' | 'on_demand';
        extended_descriptions?: boolean;
        /** Simple language (Einfache Sprache). */
        simple_language?: boolean;
        /** Easy language (Leichte Sprache; more simplified, falls back to simple language where missing). */
        easy_language?: boolean;
    };
    interaction?: {
        large_targets?: boolean;
        /**
         * Operation with one or two switches (scanning): `auto` moves the highlight at a fixed pace (`interval` in
         * seconds) and one switch selects; `step`: one switch advances, the other selects. `keys`: keys the switch
         * interface sends (default: Space advances, Enter selects).
         */
        switch_access?: { mode?: 'auto' | 'step'; interval?: number; keys?: { next?: string; select?: string } };
    };
    timing?: {
        /** Time factor; above 1 requests `extended_time`. */
        extension?: number;
    };
    assistive_technology?: {
        screen_reader?: boolean;
    };
}

/** Accommodations a profile requests (names as in `accommodations { … }`). */
export function requestedAccommodations(profile: NeedsProfile): string[] {
    const result: string[] = [];
    if ((profile.display?.scale ?? 1) > 1) result.push('magnification');
    if (profile.display?.contrast === 'high') result.push('contrast');
    if (profile.display?.reflow) result.push('reflow');
    if (profile.display?.reduced_motion) result.push('reduced_motion');
    if (profile.display?.focus_emphasis) result.push('focus_emphasis');
    if (profile.content?.read_aloud === 'on_demand' && !profile.assistive_technology?.screen_reader) result.push('read_aloud');
    if (profile.content?.extended_descriptions) result.push('extended_descriptions');
    if (profile.content?.simple_language) result.push('simple_language');
    if (profile.content?.easy_language) result.push('easy_language');
    if (profile.interaction?.large_targets) result.push('large_targets');
    if (profile.interaction?.switch_access) result.push('switch_access');
    if ((profile.timing?.extension ?? 1) > 1) result.push('extended_time');
    return result;
}

/**
 * Needs profile ∩ study rules ∩ item = effective accommodations.
 * Study rules filter the request beforehand; here the item applies: `deny` excludes, a non-empty `allow` list
 * restricts.
 */
export function effectiveAccommodations(requested: Iterable<string>, item: ItemDef['accommodations']): ReadonlySet<string> {
    const result = new Set<string>();
    for (const a of requested) {
        if (item?.deny.includes(a)) continue;
        if (item && item.allow.length > 0 && !item.allow.includes(a)) continue;
        result.add(a);
    }
    return result;
}

/** Language level of the effective accommodations: easy takes precedence over simple. */
export function languageLevel(accommodations: ReadonlySet<string>): 'easy' | 'simple' | undefined {
    return accommodations.has('easy_language') ? 'easy' : accommodations.has('simple_language') ? 'simple' : undefined;
}

/** `wording(text, simple, easy)` for the accommodations' language level (item text and practice feedback). */
export function wordingFunction(accommodations: ReadonlySet<string>): (args: Value[]) => Value {
    const level = languageLevel(accommodations);
    // Easy falls back to simple, simple to the plain text
    return ([text, simple, easy]) => (level === 'easy' ? easy ?? simple : level === 'simple' ? simple : null) ?? text ?? null;
}

/** Accommodation names for people (overviews, reports). */
export const ACCOMMODATION_NAMES: Readonly<Record<string, string>> = {
    magnification: 'Vergrößerung', contrast: 'Kontrast', reflow: 'Umbruch', focus_emphasis: 'Fokus',
    extended_time: 'Zeitverlängerung', read_aloud: 'Vorlesen', simple_language: 'Einfache Sprache',
    extended_descriptions: 'Bildbeschreibungen', large_targets: 'große Bedienflächen', reduced_motion: 'reduzierte Bewegung',
    switch_access: 'Taster', easy_language: 'Leichte Sprache'
};

