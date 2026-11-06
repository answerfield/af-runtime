/** Summary of one check. */
export interface PracticeSummary {
    correct: number;
    partial: number;
    wrong: number;
    open: number;
    /** Rules evaluated (unanswered rules excluded). */
    total: number;
}
