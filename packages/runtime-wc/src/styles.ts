import { MATH_CSS } from './math-css.js';

/**
 * Default theme: atoms use only design tokens (--af-*), never fixed values.
 * A theme is a set of tokens; needs profiles override tokens on the root.
 */
export const THEME_CSS = /* css */ `
af-root {
  --af-font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --af-font-size-base: 1.125rem;
  --af-scale: 1;
  --af-line-height: 1.5;
  --af-color-text: #1d2433;
  --af-color-muted: #5b6475;
  --af-color-bg: #ffffff;
  --af-color-surface: #f4f6fa;
  --af-color-border: #8a93a6;
  --af-color-accent: #1f5fbf;
  --af-color-accent-text: #ffffff;
  --af-color-fill: #f2a33a;
  --af-color-focus: #0b57d0;
  --af-color-hint: #5b6475;
  --af-color-warning: #9a4d00;
  --af-color-error: #b3261e;
  --af-target-size: 2.75rem;
  --af-radius: 0.375em;
  --af-border-width: 2px;
  --af-focus-width: 3px;
  --af-space-1: 0.25em;
  --af-space-2: 0.5em;
  --af-space-3: 1em;
  --af-space-4: 1.5em;

  display: block;
  box-sizing: border-box;
  font-family: var(--af-font-family);
  font-size: calc(var(--af-font-size-base) * var(--af-scale));
  line-height: var(--af-line-height);
  color: var(--af-color-text);
  background: var(--af-color-bg);
  padding: var(--af-space-4);
  container-type: inline-size;
}
af-root *, af-root *::before, af-root *::after { box-sizing: border-box; }
af-root [hidden] { display: none !important; }

af-root[data-contrast="high"] {
  --af-color-text: #000000;
  --af-color-muted: #000000;
  --af-color-bg: #ffffff;
  --af-color-surface: #ffffff;
  --af-color-border: #000000;
  --af-color-accent: #000000;
  --af-color-fill: #000000;
  --af-color-focus: #000000;
  --af-border-width: 3px;
  --af-focus-width: 4px;
}
af-root[data-large-targets] { --af-target-size: 3.5rem; }
@media (forced-colors: active) {
  af-root { --af-color-fill: Highlight; --af-color-focus: Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  af-root * { transition: none !important; animation: none !important; }
}
af-root[data-reduced-motion] * { transition: none !important; animation: none !important; }
/* Focus emphasis: a strong ring; the innermost block being worked on stands out */
af-root[data-focus] { --af-focus-width: 5px; }
af-root[data-focus] :focus-visible { outline-offset: 3px; }
af-root[data-focus] :is(af-p, af-group, af-input, af-plane, af-table, af-lines):focus-within:not(:has(:is(af-p, af-group, af-input, af-plane, af-table, af-lines):focus-within)) {
  background: var(--af-color-surface); box-shadow: 0 0 0 0.5em var(--af-color-surface), -0.5em 0 0 0.5em var(--af-color-focus); border-radius: 1px;
}
/* Read aloud: a speaker button at the start of each block; the block being read is marked */
af-root[data-read-aloud] :is(af-p, af-group:not([data-dropdown], [data-slot]), af-input[data-multiline]) { display: flow-root; }
af-root .af-speak {
  float: inline-start; display: inline-flex; align-items: center; justify-content: center;
  inline-size: var(--af-target-size); block-size: var(--af-target-size); margin: 0 var(--af-space-2) var(--af-space-1) 0; padding: 0.45em;
  border: var(--af-border-width) solid var(--af-color-border); border-radius: 50%; background: var(--af-color-bg); color: var(--af-color-accent); cursor: pointer;
}
af-root .af-speak svg { inline-size: 100%; block-size: 100%; }
af-root .af-speak[aria-pressed="true"] { background: var(--af-color-accent); border-color: var(--af-color-accent); color: var(--af-color-accent-text); }
af-root [data-speaking] { background: var(--af-color-surface); box-shadow: 0 0 0 0.35em var(--af-color-surface); }

/* Layout */
af-for, af-iteration, af-show, af-component { display: contents; }
af-page { display: block; }
af-page + af-page { margin-top: var(--af-space-4); }
af-section { display: block; margin-block: var(--af-space-3); }
af-section > h2 { font-size: 1.25em; margin: 0 0 var(--af-space-2); }
af-row { display: flex; flex-direction: row; flex-wrap: wrap; gap: var(--af-space-3); align-items: flex-start; }
af-root[data-reflow] af-row:not([data-keep]) { flex-direction: column; }
@container (max-width: 30em) { af-row:not([data-keep]) { flex-direction: column; } }
af-p { display: block; margin-block: var(--af-space-2); }
af-p[data-tone="hint"] { color: var(--af-color-hint); }
af-p[data-tone="warning"] { color: var(--af-color-warning); }
af-p[data-tone="accent"] { color: var(--af-color-accent); }
/* Box (speech bubble, sign, frame): as wide as its content, aligned to its side */
af-box {
  display: block; width: fit-content; max-width: 100%; box-sizing: border-box;
  margin-block: var(--af-space-2); padding: var(--af-space-2) var(--af-space-3);
  border: var(--af-border-width) solid var(--af-color-border); border-radius: var(--af-radius);
  background: var(--af-color-bg);
}
af-box > .af-box-heading { font-weight: 700; margin-bottom: var(--af-space-2); }
af-box > af-p:first-child, af-box > .af-box-heading + af-p { margin-top: 0; }
af-box > af-p:last-child { margin-bottom: 0; }
af-box[data-tone="accent"] { border-color: var(--af-color-accent); background: var(--af-color-surface); }
af-box[data-tone="hint"] { border-style: dashed; }
af-box[data-tone="warning"] { border-color: var(--af-color-warning); }
af-box[data-side="end"] { margin-inline-start: auto; }
/* Speech bubbles etc. in a list: at most 85 % wide so the side stays recognizable; full width minus a margin under reflow */
af-list af-box { max-width: 85%; }
af-root[data-reflow] af-list af-box, af-root[data-scale] af-list af-box { max-width: calc(100% - var(--af-space-4)); }
/* List */
af-list { display: block; margin-block: var(--af-space-2); }
af-list:not([data-ordered]):not(:has(af-box)) > [role="listitem"],
af-list:not([data-ordered]):not(:has(af-box)) af-component > [role="listitem"],
af-list:not([data-ordered]):not(:has(af-box)) af-iteration > [role="listitem"] { display: list-item; list-style: disc; margin-inline-start: 1.25em; }
af-list[data-ordered]:not(:has(af-box)) [role="listitem"] { display: list-item; list-style: decimal; margin-inline-start: 1.5em; }
/* List of boxes (chat log): no bullets, separator lines such as „Samstag“ centered */
af-list:has(af-box) af-p[data-tone="hint"]:not(af-box af-p) { text-align: center; }

/* Table: rows may sit inside components/loops (display: contents in between) */
af-table { display: table; border-collapse: collapse; margin-block: var(--af-space-3); width: 100%; }
af-table > .af-caption { display: table-caption; text-align: left; font-weight: 600; margin-bottom: var(--af-space-2); }
af-row[data-table-row] { display: table-row; }
af-cell {
  display: table-cell; vertical-align: top; padding: var(--af-space-1) var(--af-space-2);
  border: 1px solid var(--af-color-border);
}
af-row[data-head] > af-cell, af-row[data-head] af-cell { font-weight: 600; background: var(--af-color-surface); }
af-cell > af-p:first-child { margin-top: 0; }
af-cell > af-p:last-child { margin-bottom: 0; }

/* Stimulus beside the questions: side by side when wide (stimulus left, scrolls independently), stacked otherwise */
af-stimulus { display: block; margin-block: var(--af-space-3); }
@media (min-width: 60em) {
  af-root:not([data-reflow]):not([data-scale]):has(> af-stimulus),
  af-root:not([data-reflow]):not([data-scale]) af-page:has(> af-stimulus) {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: var(--af-space-4); align-items: start;
  }
  af-root:not([data-reflow]):not([data-scale]) > af-stimulus,
  af-root:not([data-reflow]):not([data-scale]) af-page > af-stimulus {
    grid-column: 1; grid-row: 1 / span 100; position: sticky; top: 0; margin: 0;
    max-height: calc(100vh - 2 * var(--af-space-4)); overflow: auto;
    padding-right: var(--af-space-3); border-right: 1px solid var(--af-color-border);
  }
  af-root:not([data-reflow]):not([data-scale]):has(> af-stimulus) > :not(af-stimulus),
  af-root:not([data-reflow]):not([data-scale]) af-page:has(> af-stimulus) > :not(af-stimulus) { grid-column: 2; }
}

/* Fixed lines numbered in the margin; long lines wrap with a hanging indent */
af-lines { display: block; margin-block: var(--af-space-3); padding-left: 3em; }
af-lines > * { display: block; position: relative; }
af-lines > [data-line]::before {
  content: attr(data-line); position: absolute; left: -3em; width: 2.2em; text-align: right;
  color: var(--af-color-muted); font-size: 0.85em; line-height: inherit;
}

/* Formulas (MathML): size follows the text, color follows the theme (including high contrast) */
/* Fractions at full size as in the printed booklet (more legible, also under magnification) */
af-text .af-math math { font-size: 1.1em; color: inherit; math-style: normal; }

/* Image as content (e.g. a choice option) */
af-text img.af-image { max-width: 100%; height: auto; vertical-align: middle; }
/* Image in an option or a cell: small enough for a choice */
af-toggle af-text img.af-image, af-cell af-text img.af-image { max-width: min(12em, 100%); }

/* Semantic markup → appearance */
af-text mark { font-weight: 700; background: var(--af-color-surface); color: inherit; padding: 0 0.15em; box-shadow: 0 0 0 1px var(--af-color-border); border-radius: 0.15em; }
af-text em { font-style: italic; }
af-text cite { font-style: italic; }
af-text del { text-decoration: line-through; }
af-root[data-contrast="high"] af-text mark { background: none; text-decoration: underline; text-decoration-thickness: 0.15em; }

/* Media: status, volume, video; no seek or pause controls. Timer: label and remaining time or a bar */
af-media, af-timer {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--af-space-2) var(--af-space-3);
  margin-block: var(--af-space-3); padding: var(--af-space-2) var(--af-space-3);
  border: var(--af-border-width) solid var(--af-color-border); border-radius: var(--af-radius); background: var(--af-color-surface);
}
af-media[data-kind="audio"]::before { content: "🔊"; font-size: 1.2em; }
af-media .af-media-video { display: block; flex-basis: 100%; max-width: 100%; border-radius: var(--af-radius); background: #000; }
af-media .af-media-status { font-weight: 600; }
af-media[data-kind="audio"][data-playing="true"]::before { color: var(--af-color-accent); }
af-media .af-media-volume { margin-left: auto; display: inline-flex; align-items: center; gap: var(--af-space-1); color: var(--af-color-muted); font-size: 0.9em; }
af-media .af-media-start { font: inherit; min-height: var(--af-target-size); padding: 0 var(--af-space-3); border-radius: var(--af-radius);
  border: var(--af-border-width) solid var(--af-color-accent); background: var(--af-color-accent); color: var(--af-color-accent-text); cursor: pointer; }
af-timer[hidden], af-flow { display: none; }
af-timer .af-timer-label { font-weight: 600; }
af-timer .af-timer-value { font-variant-numeric: tabular-nums; color: var(--af-color-muted); }
af-timer .af-timer-bar { flex: 1; min-width: 8em; accent-color: var(--af-color-accent); }
af-timer .af-timer-reveal { font: inherit; min-height: var(--af-target-size); padding: 0 var(--af-space-3); border-radius: var(--af-radius);
  border: var(--af-border-width) solid var(--af-color-border); background: var(--af-color-bg); color: var(--af-color-text); cursor: pointer; }
af-root[data-reduced-motion] af-timer .af-timer-bar { transition: none; }
.af-media-announce { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
af-root[data-locked] af-input input, af-root[data-locked] af-input textarea { background: var(--af-color-surface); }
af-root[data-locked] af-toggle { cursor: default; }

af-group { display: block; margin-block: var(--af-space-3); }
af-group[data-dropdown] { display: inline-block; margin: 0; }
af-group[data-dropdown] > select {
  font: inherit; color: var(--af-color-text); background: var(--af-color-bg);
  border: var(--af-border-width) solid var(--af-color-border); border-radius: var(--af-radius);
  min-height: var(--af-target-size); padding: var(--af-space-1) var(--af-space-2); max-width: 100%;
}
/* Character toolbar below an input field (keys) */
af-input > .af-keys { display: flex; flex-wrap: wrap; gap: var(--af-space-1); margin-top: var(--af-space-1); }
af-input > .af-keys > button {
  font: inherit; min-width: var(--af-target-size); min-height: var(--af-target-size); cursor: pointer;
  border: var(--af-border-width) solid var(--af-color-border); border-radius: var(--af-radius); background: var(--af-color-surface); color: var(--af-color-text);
}
/* Group with cards: dropdowns as slots, options as draggable cards; the dropdowns remain operable */
af-group[data-slot] { display: inline-flex; align-items: center; gap: var(--af-space-1); }
af-group[data-slot] > select.af-slot { border-style: dashed; min-width: 8em; background: var(--af-color-surface); }
af-group[data-slot][data-drop-target] > select.af-slot { border-style: solid; border-color: var(--af-color-accent); }
af-group[data-slot] > .af-slot-face { display: inline-flex; align-items: center; }
af-group[data-slot] > .af-slot-face[hidden] { display: none; }
af-group[data-slot] > .af-slot-face img, af-group > .af-cards img { max-height: 5em; max-width: 8em; width: auto; }
af-group > .af-cards { display: flex; flex-wrap: wrap; gap: var(--af-space-2); margin-block: var(--af-space-2); }
af-group > .af-cards .af-card {
  display: inline-flex; align-items: center; min-height: var(--af-target-size); padding: var(--af-space-1) var(--af-space-2);
  border: var(--af-border-width) solid var(--af-color-border); border-radius: var(--af-radius);
  background: var(--af-color-bg); cursor: grab; touch-action: none; user-select: none;
}
af-group > .af-cards .af-card[hidden] { display: none; }
af-group > .af-cards .af-card.af-picked { outline: var(--af-focus-width) solid var(--af-color-focus); }
af-group > .af-cards .af-card-ghost { position: fixed; z-index: 1000; pointer-events: none; transform: translate(-50%, -50%); opacity: 0.85; }
/* Switch access and reflow: dropdowns only */
[data-scanning] af-group > .af-cards, af-root[data-reflow] af-group > .af-cards { display: none; }
/* One radio group per table row (matrix): group and body generate no box, so the cells belong to the row */
af-row[data-table-row] > af-group, af-row[data-table-row] > af-group > .af-group-body,
af-row[data-table-row] af-component > af-group, af-row[data-table-row] af-component > af-group > .af-group-body { display: contents; }
af-row[data-table-row] af-group > .af-legend { display: none; }
af-cell af-toggle:not([data-look]) { justify-content: center; }
af-group > .af-legend { display: block; margin-bottom: var(--af-space-2); }
af-group > .af-group-body { display: flex; flex-direction: column; gap: var(--af-space-1); }

/* Focus */
af-root :focus-visible { outline: var(--af-focus-width) solid var(--af-color-focus); outline-offset: 2px; }

/* toggle */
af-toggle {
  display: inline-flex; align-items: center; gap: var(--af-space-2);
  min-height: var(--af-target-size); padding: var(--af-space-1) var(--af-space-2);
  border-radius: var(--af-radius); cursor: pointer; user-select: none;
}
af-toggle:hover { background: var(--af-color-surface); }
af-toggle > .af-indicator {
  flex: none; width: 1.25em; height: 1.25em;
  border: var(--af-border-width) solid var(--af-color-border); border-radius: 0.2em;
  background: var(--af-color-bg); display: inline-grid; place-items: center;
}
af-toggle[role="radio"] > .af-indicator { border-radius: 50%; }
af-toggle[aria-checked="true"] > .af-indicator { border-color: var(--af-color-accent); background: var(--af-color-accent); }
af-toggle[role="checkbox"][aria-checked="true"] > .af-indicator::after {
  content: ""; width: 0.35em; height: 0.65em; margin-top: -0.15em;
  border: solid var(--af-color-accent-text); border-width: 0 0.15em 0.15em 0; transform: rotate(45deg);
}
af-toggle[role="radio"][aria-checked="true"] > .af-indicator { box-shadow: inset 0 0 0 0.22em var(--af-color-bg); }
af-toggle[role="switch"] > .af-indicator { width: 2.2em; border-radius: 1em; position: relative; }
af-toggle[role="switch"] > .af-indicator::after {
  content: ""; position: absolute; left: 0.15em; width: 0.75em; height: 0.75em; border-radius: 50%; background: var(--af-color-border);
}
af-toggle[role="switch"][aria-checked="true"] > .af-indicator::after { left: auto; right: 0.15em; background: var(--af-color-accent-text); }
af-toggle[role="button"] {
  border: var(--af-border-width) solid var(--af-color-accent); color: var(--af-color-accent);
  padding: var(--af-space-1) var(--af-space-3); font-weight: 600;
}
af-toggle[role="button"] > .af-indicator { display: none; }
af-toggle[role="button"][aria-pressed="true"] { background: var(--af-color-accent); color: var(--af-color-accent-text); }
af-toggle[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
/* Toggle in a plane (grid point, part of a figure): small dot, full hit area kept */
af-plane af-toggle:not([data-look]):not([role="button"]) > .af-indicator { width: 0.8em; height: 0.8em; }

/* Toggle in running text: the word itself is the target */
af-toggle[data-look] {
  display: inline; min-height: 0; padding: 0.05em 0.1em; gap: 0; border-radius: 0.2em;
  line-height: inherit; box-decoration-break: clone; -webkit-box-decoration-break: clone;
}
af-toggle[data-look] > .af-indicator { display: none; }
af-toggle[data-look]:hover { background: var(--af-color-surface); }
af-toggle[data-look="strike"][aria-checked="true"] { text-decoration: line-through; text-decoration-thickness: 0.12em; color: var(--af-color-muted); }
af-toggle[data-look="underline"][aria-checked="true"] { text-decoration: underline; text-decoration-thickness: 0.12em; text-underline-offset: 0.2em; }
af-toggle[data-look="highlight"][aria-checked="true"] { background: var(--af-color-fill); }
af-toggle[data-look="encircle"][aria-checked="true"] { box-shadow: 0 0 0 var(--af-border-width) var(--af-color-accent); border-radius: 1em; }
/* Slot for a character (comma, bracket): narrow target between words; the content appears when set */
af-toggle[data-look="slot"] {
  display: inline-block; min-width: 0.9em; min-height: 1.4em; vertical-align: text-bottom; text-align: center;
  border-bottom: 1px dashed var(--af-color-border); margin: 0 0.05em;
}
af-toggle[data-look="slot"]:not([aria-checked="true"]) > .af-toggle-content { display: none; }
af-toggle[data-look="slot"][aria-checked="true"] > .af-toggle-content { font-weight: 700; color: var(--af-color-accent); }

/* input */
af-input { display: inline-flex; vertical-align: baseline; }
af-input[data-multiline] { display: flex; flex-direction: column; gap: var(--af-space-1); margin-block: var(--af-space-2); }
af-input input, af-input textarea {
  font: inherit; color: var(--af-color-text); background: var(--af-color-bg);
  border: var(--af-border-width) solid var(--af-color-border); border-radius: var(--af-radius);
  min-height: var(--af-target-size); padding: var(--af-space-1) var(--af-space-2);
}
af-input textarea { min-height: 6em; resize: vertical; width: 100%; }
af-input input:focus-visible, af-input textarea:focus-visible { outline: var(--af-focus-width) solid var(--af-color-focus); outline-offset: 0; }
.af-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
af-input .af-counter { font-size: 0.85em; color: var(--af-color-muted); align-self: flex-end; }

/* Extended description */
.af-description { margin-top: var(--af-space-1); color: var(--af-color-muted); font-size: 0.95em; }

/* value */
af-value { display: block; position: relative; height: var(--af-target-size); cursor: pointer; touch-action: none; border-radius: var(--af-radius); }
af-value:not([data-in-plane]):not([data-point])::before {
  content: ""; position: absolute; left: 0; right: 0; top: 50%; border-top: var(--af-border-width) solid var(--af-color-border);
}
af-value > .af-thumb {
  position: absolute; top: 50%; width: 1.4em; height: 1.4em; margin-left: -0.7em; margin-top: -0.7em;
  border-radius: 50%; background: var(--af-color-accent); border: 2px solid var(--af-color-bg); box-shadow: 0 0 0 1px var(--af-color-accent);
}
af-value[data-in-plane]:not([data-point]) > .af-thumb {
  width: 0; height: 0; margin-left: -0.6em; margin-top: -1.9em; border-radius: 0; background: none; box-shadow: none;
  border-left: 0.6em solid transparent; border-right: 0.6em solid transparent; border-top: 1.1em solid var(--af-color-accent); border-bottom: 0;
}
af-value[data-in-plane]:not([data-point]) > .af-thumb::after {
  content: ""; position: absolute; left: -1px; top: -0.2em; width: 2px; height: 2.2em; background: var(--af-color-accent);
}
af-value[data-in-plane]:not([data-point]) > .af-thumb[data-label]::before {
  content: attr(data-label); position: absolute; bottom: 1.2em; left: 0; transform: translateX(-50%);
  white-space: nowrap; font-size: 0.9em; font-weight: 600; color: var(--af-color-accent);
}
af-plane:has(.af-thumb[data-label]) { margin-top: var(--af-space-4); }
af-value:focus-visible { outline: var(--af-focus-width) solid var(--af-color-focus); outline-offset: 0.3em; }

/* Plane: area with a fixed aspect ratio, shapes as SVG layers on top */
af-plane { display: block; max-width: 36em; margin: var(--af-space-3) 0 var(--af-space-4); }
af-plane > .af-plane-area { position: relative; width: 100%; touch-action: none; }
af-plane .af-plane-grid,
af-dot > svg, af-caption > svg, af-polygon > svg {
  position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none;
}
af-dot, af-caption, af-polygon { display: contents; }
af-plane af-value[data-in-plane] { position: absolute; inset: 0; height: auto; }
af-plane .af-grid { stroke: var(--af-color-border); stroke-width: 1px; opacity: 0.35; vector-effect: non-scaling-stroke; }
af-plane .af-axis-line { stroke: var(--af-color-text); stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
af-plane .af-axis-label { position: absolute; font-style: italic; line-height: 1; pointer-events: none; white-space: nowrap; }
af-plane .af-axis-label[data-axis="x"] { transform: translate(-100%, -130%); }
af-plane .af-axis-label[data-axis="y"] { transform: translate(40%, 0); }
af-plane .af-axis-number { fill: var(--af-color-muted); font-family: var(--af-font-family); }
af-plane .af-stroke { fill: none; stroke: var(--af-color-text); stroke-width: 2px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
af-plane .af-thin { stroke-width: 1.5px; }
af-plane .af-fill { fill: var(--af-color-fill); fill-opacity: 0.18; }
af-plane .af-fill[data-tone="neutral"] { fill: var(--af-color-bg); fill-opacity: 1; }
af-plane .af-fill[data-tone="accent"] { fill: var(--af-color-fill); fill-opacity: 1; }
af-plane .af-fill[data-tone="hint"] { fill: var(--af-color-hint); fill-opacity: 0.3; }
af-plane .af-fill[data-tone="warning"] { fill: var(--af-color-warning); fill-opacity: 0.3; }
af-plane .af-dot { fill: var(--af-color-text); }
/* Labels as text over the area: body text size, independent of the coordinate range */
af-plane .af-shape-label { position: absolute; white-space: nowrap; pointer-events: none; line-height: 1; font-size: 0.9em; }
af-plane .af-shape-label[data-place="center"] { transform: translate(-50%, -50%); }
af-plane .af-shape-label[data-place="below"] { transform: translate(-50%, 0.7em); }
af-plane .af-shape-label[data-place="above-right"] { transform: translate(0.35em, -1.2em); }
af-plane .af-dot-label { font-weight: 600; font-size: 1em; }
/* Placeable point: handle at its position; while unset, in the tray below the area */
af-plane af-value[data-point] {
  position: absolute; inset: auto; width: var(--af-target-size); height: var(--af-target-size);
  transform: translate(-50%, -50%); border-radius: 50%; display: grid; place-items: center; z-index: 2;
}
af-plane af-value[data-point]::before {
  content: ""; width: 0.75em; height: 0.75em; border-radius: 50%; background: var(--af-color-accent);
  box-shadow: 0 0 0 0.2em var(--af-color-bg);
}
/* Grabbable: ring on hover, focus and drag */
af-plane af-value[data-point]::after {
  content: ""; position: absolute; inset: 0.2em; border-radius: 50%; border: 2px solid var(--af-color-accent);
  opacity: 0; transition: opacity 0.15s, inset 0.15s; pointer-events: none;
}
af-plane af-value[data-point]:hover::after, af-plane af-value[data-point]:focus-visible::after,
af-plane af-value[data-point][data-dragging]::after { opacity: 0.6; inset: 0; }
af-plane af-value[data-point][data-dragging] { cursor: grabbing; }
af-plane af-value[data-point]:not([data-dragging]) { cursor: grab; }
/* Coordinate badge (host setting, e.g. in the learning app): on hover, focus and drag */
af-plane af-value[data-point] > .af-coord {
  display: none; position: absolute; left: 50%; top: calc(100% + 0.1em); transform: translateX(-50%);
  white-space: nowrap; font-size: 0.8em; padding: 0.05em 0.35em; border-radius: 0.3em; pointer-events: none;
  background: var(--af-color-text); color: var(--af-color-bg);
}
[data-coordinates] af-plane af-value[data-point]:not([data-unset]):is(:hover, :focus-visible, [data-dragging]) > .af-coord { display: block; }
/* Grid crosshair at the dragged or focused point */
af-plane .af-plane-cross { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
af-plane .af-plane-cross::before, af-plane .af-plane-cross::after { content: ""; position: absolute; opacity: 0.5; }
af-plane .af-plane-cross::before { left: var(--af-cross-x); top: 0; bottom: 0; border-left: 1px dashed var(--af-color-accent); }
af-plane .af-plane-cross::after { top: var(--af-cross-y); left: 0; right: 0; border-top: 1px dashed var(--af-color-accent); }
af-plane .af-plane-cross[hidden] { display: none; }
/* Preview: where a tap would place the next point */
af-plane .af-plane-ghost {
  position: absolute; width: 0.75em; height: 0.75em; border-radius: 50%; transform: translate(-50%, -50%);
  background: var(--af-color-accent); opacity: 0.35; pointer-events: none; z-index: 1;
}
af-plane .af-plane-ghost::after {
  content: attr(data-label); position: absolute; left: 1em; bottom: 0.6em; font-weight: 700; color: var(--af-color-accent);
}
af-plane .af-plane-ghost[hidden] { display: none; }
af-plane .af-plane-area:has(af-value[data-point][data-unset]) { cursor: crosshair; }
af-plane af-value[data-point] > .af-thumb {
  position: absolute; left: 75%; bottom: 70%; top: auto; width: auto; height: auto; margin: 0; padding: 0;
  background: none; border: 0; box-shadow: none; border-radius: 0;
  font-weight: 700; font-size: 1.15em; color: var(--af-color-accent); white-space: nowrap; pointer-events: none;
}
/* Unset points wait in a tray below the area */
af-plane:has(af-value[data-point]) > .af-plane-area {
  /* Make the drawing area visible, even without a grid */
  outline: 1px solid var(--af-color-border); background: var(--af-color-surface);
}
af-plane { --af-tray-pad: var(--af-space-3); --af-tray-gap: var(--af-space-2); }
af-plane > .af-plane-tray {
  margin-top: var(--af-tray-gap); padding: var(--af-tray-pad); border: 1px solid var(--af-color-border); border-radius: 0.5em;
  min-height: var(--af-target-size); display: flex; align-items: center; color: var(--af-color-muted);
  padding-left: calc(var(--af-tray-pad) + var(--af-tray-count, 1) * (var(--af-target-size) + var(--af-space-4)) + var(--af-space-2));
}
af-plane > .af-plane-tray[hidden] { display: none; }
/* In the tray: drawn like a placed point, vertically centered in the tray */
af-plane af-value[data-point][data-unset]:not([data-carried]) {
  top: calc(100% + var(--af-tray-gap) + var(--af-tray-pad) + 1px + var(--af-target-size) / 2);
}
af-plane af-value[data-point][data-carried] { z-index: 3; }
af-plane af-value[data-point]:hover::before { transform: scale(1.2); }
/* Background image fills the area (coordinates match the image) */
af-plane .af-plane-background { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
/* Atoms at a point (at:): a toggle (e.g. picking a vertex) as a round target, an input (labeling) as a small field */
af-plane af-toggle[data-at] {
  position: absolute; transform: translate(-50%, -50%); width: var(--af-target-size); height: var(--af-target-size);
  padding: 0; border-radius: 50%; justify-content: center; z-index: 2;
}
af-plane af-toggle[data-at] > .af-indicator { width: 1em; height: 1em; border-radius: 50%; }
/* A toggle with shapes: the shapes are image and target, filled when set; the toggle itself is the (hidden) control */
af-plane af-toggle[data-shape] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
af-plane .af-toggle-shape { display: contents; }
af-plane .af-toggle-shape path { pointer-events: visiblePainted; cursor: pointer; }
af-plane af-toggle[data-shape] + .af-toggle-shape .af-fill { fill: var(--af-color-bg); fill-opacity: 1; }
af-plane af-toggle[data-shape][aria-checked="true"] + .af-toggle-shape .af-fill { fill: var(--af-color-fill); fill-opacity: 1; }
af-plane af-toggle[data-shape][aria-disabled="true"] + .af-toggle-shape path { cursor: default; }
af-plane af-toggle[data-shape]:focus-visible + .af-toggle-shape .af-stroke { stroke: var(--af-color-focus); stroke-width: calc(var(--af-focus-width) + 2px); }
af-plane .af-toggle-shape path:hover { stroke-width: 3px; }
af-plane af-group, af-plane af-group > .af-group-body { display: contents; }
af-plane af-group > .af-legend { display: none; }
af-plane af-input[data-at] { position: absolute; transform: translate(-50%, -50%); z-index: 2; }
af-plane af-input[data-at] input { min-height: 0; width: 3em; padding: 0.1em 0.2em; text-align: center; }
/* Error placeholder */
af-error {
  display: inline-block; color: var(--af-color-error); border: 1px dashed var(--af-color-error);
  border-radius: var(--af-radius); padding: 0 var(--af-space-1); font-size: 0.9em;
}

/*
 * Windows contrast themes (forced colors): the system replaces backgrounds and removes shadows. States that rely on
 * them (checked, pressed, highlighted, placed point) use system colors here, Highlight meaning "on".
 */
@media (forced-colors: active) {
  af-toggle > .af-indicator { forced-color-adjust: none; border-color: CanvasText; background: Canvas; }
  af-toggle[aria-checked="true"] > .af-indicator { border-color: Highlight; background: Highlight; }
  af-toggle[role="checkbox"][aria-checked="true"] > .af-indicator::after { border-color: HighlightText; }
  af-toggle[role="radio"][aria-checked="true"] > .af-indicator { box-shadow: inset 0 0 0 0.22em Canvas; }
  af-toggle[role="switch"] > .af-indicator::after { background: CanvasText; }
  af-toggle[role="switch"][aria-checked="true"] > .af-indicator::after { background: HighlightText; }
  af-toggle[role="button"][aria-pressed="true"], af-toggle[data-look="highlight"][aria-checked="true"] {
    forced-color-adjust: none; background: Highlight; color: HighlightText; border-color: Highlight;
  }
  af-toggle[data-look="encircle"][aria-checked="true"] { box-shadow: none; outline: var(--af-border-width) solid Highlight; }
  af-toggle[data-look="slot"][aria-checked="true"] > .af-toggle-content { color: Highlight; }
  af-text mark { box-shadow: none; text-decoration: underline; text-decoration-thickness: 0.15em; }
  af-value > .af-thumb, af-plane af-value[data-point]::before { forced-color-adjust: none; background: Highlight; border-color: Canvas; }
  af-plane af-value[data-point][data-unset]::before { background: Canvas; border: 2px solid Highlight; }
  af-plane .af-fill[data-tone="accent"] { forced-color-adjust: none; fill: Highlight; }
  af-group > .af-cards .af-card.af-picked { outline-color: Highlight; }
}
`;

const STYLE_ID = 'af-theme';

/** Inserts the default theme (plus MathML styles) into the document once. */
export function installStyles(doc: Document = document): void {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = THEME_CSS + MATH_CSS;
    doc.head.appendChild(style);
}
