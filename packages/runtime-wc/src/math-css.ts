/**
 * Styles for MathML produced by Temml (https://temml.org) in browsers with MathML Core.
 * Excerpt from temml 0.14.0, dist/Temml-Local.css (MIT License, © Ron Kok), without the bundled font: only the rules
 * for what our formulas produce (fractions, super-/subscripts, over- and underlines). If a formula needs more
 * (e.g. \cancel, \vec, tables), copy the matching rules from that Temml file.
 */
export const MATH_CSS = /* css */ `
math {
  font-family: "Cambria Math", 'STIXTwoMath-Regular', 'NotoSansMath-Regular', math;
  font-style: normal;
  font-weight: normal;
  line-height: normal;
  font-size-adjust: none;
  text-indent: 0;
  text-transform: none;
  letter-spacing: normal;
  word-wrap: normal;
  direction: ltr;
  /* Prevent Firefox from omitting the dot on i or j. */
  font-feature-settings: "dtls" off;
}

math * {
  border-color: currentColor;
}

/* display: block is necessary in Firefox and Safari. */
math.tml-display {
  display: block;
  width: 100%;
}

/* Cramped superscripts in WebKit */
mfrac > :nth-child(2),
msqrt,
mover > :first-child {
  math-shift: compact
}

/* Chromium ignores the <menclose> attributes (MathML 3): draw over- and underlines as borders */
@supports (not (-webkit-backdrop-filter: blur(1px))) and (not (-moz-appearance: none)) {
  menclose {
    position: relative;
    padding: 0.5ex 0ex;
  }
  .tml-overline {
    padding: 0.1em 0 0 0;
    border-top: 0.065em solid;
  }
  .tml-underline {
    padding: 0 0 0.1em 0;
    border-bottom: 0.065em solid;
  }
}

/* flex-wrap for line-breaking in Chromium */
math {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
}
math > mrow {
  padding: 0.5ex 0ex;
}

/* Firefox: avoid flex-wrap */
@-moz-document url-prefix() {
  math { display: inline; }
  math > mrow { padding: 0 }
}
`;
