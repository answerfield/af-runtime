import type { PracticeSummary } from '@answerfield/practice';
import type { ItemInstance } from '@answerfield/runtime-core';

/** Handle of practice mode (same shape as `Practice` of `@answerfield/practice`). */
export interface Practice {
    check(): PracticeSummary;
    dispose(): void;
}

/**
 * Loads `@answerfield/practice` on demand (a separate chunk in the host's build). The specifier stays literal so bundlers
 * include the package; the type check is suppressed because the package is optional (hosts without practice mode need not install it).
 * `@ts-ignore` rather than `@ts-expect-error`, which would fail wherever the package exists.
 */
export async function loadPractice(): Promise<{ attachPractice(root: HTMLElement, instance: ItemInstance): Practice }> {
    try {
        // @ts-ignore optional package
        return await import('@answerfield/practice');
    } catch (cause) {
        throw new Error('Üben braucht das Paket @answerfield/practice.', { cause });
    }
}
