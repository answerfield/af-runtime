// Open theme mechanism: a theme is a second style layer on top of the default theme, supplied by the host
// (for example a theme package of the host). The runtime sets `data-theme` on the item and embeds the CSS so that accommodations
// win: high contrast and forced colors fall back to the default theme, and reduced motion (needs profile or system)
// lets the default theme switch animations off.

/** A host-supplied style layer applied on top of the default theme. */
export interface Theme {
    /** Set as `data-theme` on `af-root`; lowercase letters, digits and hyphens. */
    name: string;
    /**
     * Nested rules for the item (CSS nesting): selectors apply inside `af-root`, `&` is `af-root` itself.
     * Should only target tokens (`--af-…`) and attributes the runtime already sets.
     */
    css: string;
    /** `@keyframes` (cannot be nested); prefix their names with the theme name. */
    keyframes?: string;
}

const NAME = /^[a-z][a-z0-9-]*$/;

/** Stylesheet text for a theme, scoped to `af-root[data-theme]` and disabled under high or forced contrast. */
export function themeCss(theme: Theme): string {
    if (!NAME.test(theme.name)) throw new Error(`Ungültiger Theme-Name: ${theme.name}`);
    return `@media not (forced-colors: active) {\naf-root[data-theme="${theme.name}"]:not([data-contrast="high"]) {\n${theme.css}\n}\n}\n${theme.keyframes ?? ''}`;
}

/** Inserts a theme's stylesheet into the document (once per document). */
export function installTheme(doc: Document, theme: Theme): void {
    const id = `af-theme-${theme.name}`;
    if (doc.getElementById(id)) return;
    const style = doc.createElement('style');
    style.id = id;
    style.textContent = themeCss(theme);
    doc.head.appendChild(style);
}
