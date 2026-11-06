// Practice mode for the learning app: attaches from outside to a rendered item. The runtime knows nothing about it;
// it only provides the pieces (instance, coding, `inline`) and the DOM contract (`af-component[data-binding]`,
// `data-result`).

import type { ItemInstance } from '@answerfield/runtime-core';
import type { PracticeSummary } from './summary.js';
import { PracticeView } from './view.js';

export { practiceResults, type PracticeResult, type Verdict } from './results.js';
export type { PracticeSummary } from './summary.js';

/** Handle returned by {@link attachPractice}. */
export interface Practice {
    /** Checks the responses, shows results and feedback, and announces a summary. */
    check(): PracticeSummary;
    /** Removes all feedback and the live region. */
    dispose(): void;
}

/** Attaches practice mode to an item: `root` is `Rendered.root` from `renderItem`, `instance` its item instance. */
export function attachPractice(root: HTMLElement, instance: ItemInstance): Practice {
    return new PracticeView(root, instance);
}
