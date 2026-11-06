// Element registry of the runtime; the classes live by topic in base, layout, choice, input and plane.
import { AfPage, AfSection, AfRow, AfTable, AfCell, AfStimulus, AfLines, AfParagraph, AfBox, AfList } from './layout.js';
import { AfGroup, AfToggle } from './choice.js';
import { AfInput } from './input.js';
import { AfValue, AfPlane } from './plane.js';
import { AfFlow, AfMedia, AfTimer } from './media.js';

export * from './base.js';
export * from './layout.js';
export * from './choice.js';
export * from './input.js';
export * from './plane.js';
export * from './media.js';

/** Displays the value of an expression as text. */
export class AfText extends HTMLElement { }

/** Placeholder for invalid source locations (dev bundle) and runtime errors. */
export class AfError extends HTMLElement { }

/** Custom element tag names mapped to their classes. */
export const ELEMENTS: Readonly<Record<string, CustomElementConstructor>> = {
    'af-page': AfPage,
    'af-section': AfSection,
    'af-row': AfRow,
    'af-table': AfTable,
    'af-cell': AfCell,
    'af-lines': AfLines,
    'af-stimulus': AfStimulus,
    'af-p': AfParagraph,
    'af-group': AfGroup,
    'af-toggle': AfToggle,
    'af-input': AfInput,
    'af-value': AfValue,
    'af-plane': AfPlane,
    'af-box': AfBox,
    'af-list': AfList,
    'af-media': AfMedia,
    'af-timer': AfTimer,
    'af-flow': AfFlow,
    'af-text': AfText,
    'af-error': AfError
};

/** Registers all elements; idempotent. */
export function defineElements(registry: CustomElementRegistry = customElements): void {
    for (const [name, ctor] of Object.entries(ELEMENTS)) {
        if (!registry.get(name)) registry.define(name, ctor);
    }
}
