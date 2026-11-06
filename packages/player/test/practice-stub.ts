// Stand-in for the optional package @answerfield/practice, which is absent in the public export.
// Tests that need practice mode mock `loadPractice`; this stub only lets the import resolve.
export function attachPractice(): never {
  throw new Error('Üben braucht das Paket @answerfield/practice.');
}
