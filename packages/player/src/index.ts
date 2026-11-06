/**
 * @answerfield/player is the interface for hosts: embed items and booklets, framework-neutral. Data in and out are the bundle
 * format (`@answerfield/bundle`); runtime and renderer (`@answerfield/runtime-core`, `@answerfield/runtime-wc`) stay internal and may change.
 * Framework integrations (for example Angular components) are meant as a thin layer over this package.
 */
import { assetFileName, type Bundle } from '@answerfield/bundle';
import { randomVersion as pickVersion, requestedAccommodations, type NeedsProfile, type ParamValues } from '@answerfield/runtime-core';
import type { AssetResolver } from '@answerfield/runtime-wc';

export { mountItem, type ItemEvents, type ItemOptions, type ItemPlayer, type ItemState } from './item.js';
export { mountBooklet, type BookletEvents, type BookletLog, type BookletOptions, type BookletPlayer, type BookletState } from './booklet.js';
export type { PlayerOptions } from './options.js';

// Coding without display (e.g. on a server), and the types hosts pass in and get back
export { codeResponses } from '@answerfield/runtime-core';
export type { BookletSnapshot, ControlCommand, LogEntry, NeedsProfile, ParamValues, Position } from '@answerfield/runtime-core';
export type { AssetResolver, Speech, Theme } from '@answerfield/runtime-wc';
export type { PracticeSummary } from '@answerfield/practice';

/**
 * Resolves media from `base` (CDN, output of `af compile --assets`) by content-hashed file name; media without a hash
 * (dev bundle) are loaded from `bundles/` next to the bundles.
 */
export function assetResolver(base: string): AssetResolver {
    return (path, info) => {
        const name = info && assetFileName(path, info);
        return name ? base + name : `bundles/${path}`;
    };
}

/**
 * Another version of an item that suits the profile (e.g. smaller numbers in easy language), different from
 * `current` if there is one; undefined for items without versions.
 */
export function randomVersion(bundle: Bundle, item: string, profile: NeedsProfile = {}, current?: ParamValues): ParamValues | undefined {
    const def = bundle.items.find(i => i.name === item);
    return def ? pickVersion(def, requestedAccommodations(profile), current) : undefined;
}
