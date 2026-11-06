import type { AssetResolver, RenderOptions, Speech, Theme } from '@answerfield/runtime-wc';
import type { NeedsProfile } from '@answerfield/runtime-core';

/** What items and booklets have in common: who is tested, how it looks, where media come from. */
export interface PlayerOptions {
    /** Needs profile of the person; which accommodations apply is decided inside (study rules, item rules). */
    profile?: NeedsProfile;
    /** Theme layered over the default (supplied by the host). */
    theme?: Theme;
    /** Base URL for relative media paths (e.g. the folder of the bundle). */
    baseUrl?: string;
    /** Media resolver (e.g. a CDN, see `assetResolver`); takes precedence over `baseUrl`. */
    asset?: AssetResolver;
    /**
     * Region scanned in switch access mode (`switch_access`): pass the frame including the host's navigation so that
     * "Weiter" is reachable too. Defaults to the item.
     */
    scanScope?: HTMLElement;
    /** Show the coordinates of dragged points (for practice; in tests without axes it could give answers away). */
    coordinates?: boolean;
    /** Voice for reading aloud (`read_aloud`), e.g. prerecorded or a server voice; default: the browser's. */
    speech?: Speech;
}

/** Render options for runtime-wc from the player options. */
export function renderOptions(o: PlayerOptions): RenderOptions {
    return {
        profile: o.profile ?? {},
        ...(o.baseUrl !== undefined ? { baseUrl: o.baseUrl } : {}),
        ...(o.asset ? { asset: o.asset } : {}),
        ...(o.theme ? { theme: o.theme } : {}),
        ...(o.scanScope ? { scanScope: o.scanScope } : {}),
        ...(o.coordinates ? { coordinates: true } : {}),
        ...(o.speech ? { speech: o.speech } : {})
    };
}
