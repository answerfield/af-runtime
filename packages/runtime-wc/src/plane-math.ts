import { Interval, Rational, type Value } from '@answerfield/expr';

// Coordinate math and drawing for planes; free of element classes so both elements.ts and geometry.ts can import it.

const SVG = 'http://www.w3.org/2000/svg';

/** Coordinate range of the enclosing 2D plane. */
export interface Frame { x0: number; x1: number; y0: number; y1: number }

/** Position of a plane point as a percentage of the area (left, top), for CSS positioning of points and labels. */
export function percentAt(frame: Frame, x: number, y: number): { left: number; top: number } {
    return { left: ((x - frame.x0) / (frame.x1 - frame.x0)) * 100, top: ((frame.y1 - y) / (frame.y1 - frame.y0)) * 100 };
}

/** Plane coordinates under a screen position (`rect`: the plane's area), not snapped to the grid. */
export function coordsAt(frame: Frame, rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
    return {
        x: frame.x0 + ((clientX - rect.left) / rect.width) * (frame.x1 - frame.x0),
        y: frame.y1 - ((clientY - rect.top) / rect.height) * (frame.y1 - frame.y0)
    };
}

/** Frame of the closest enclosing `af-plane`, if any. */
export function frameOf(el: Element): Frame | undefined {
    const plane = el.closest('af-plane') as (HTMLElement & { frame?: Frame }) | null;
    return plane?.frame;
}

/** Draws the grid and axes of a 2D plane as its background. */
export function drawGrid(svg: SVGSVGElement, frame: Frame, grid: Rational | undefined, axes: { x: boolean; y: boolean }, lines = true): void {
    svg.replaceChildren();
    const w = frame.x1 - frame.x0, h = frame.y1 - frame.y0;
    svg.setAttribute('viewBox', `${frame.x0} 0 ${w} ${h}`);
    const line = (x1: number, y1: number, x2: number, y2: number, cls: string) => {
        const l = document.createElementNS(SVG, 'line');
        Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => l.setAttribute(k, String(v)));
        l.setAttribute('class', cls);
        svg.append(l);
    };
    const text = (x: number, y: number, value: string, anchor: string) => {
        const t = document.createElementNS(SVG, 'text');
        t.setAttribute('x', String(x));
        t.setAttribute('y', String(y));
        t.setAttribute('font-size', String(Math.max(w, h) / 60 * 2));
        t.setAttribute('text-anchor', anchor);
        t.setAttribute('class', 'af-axis-number');
        t.textContent = value;
        svg.append(t);
    };
    const step = grid?.toNumber() ?? 0;
    const ticks = (from: number, to: number) => {
        if (step <= 0) return [];
        const result: number[] = [];
        for (let v = Math.ceil(from / step - 1e-9) * step; v <= to + 1e-9; v += step) result.push(Math.round(v * 1e6) / 1e6);
        return result;
    };
    if (lines) {
        for (const x of ticks(frame.x0, frame.x1)) line(x, 0, x, h, 'af-grid');
        for (const y of ticks(frame.y0, frame.y1)) line(frame.x0, frame.y1 - y, frame.x1, frame.y1 - y, 'af-grid');
    }
    const originX = Math.min(Math.max(0, frame.x0), frame.x1), originY = frame.y1 - Math.min(Math.max(0, frame.y0), frame.y1);
    const u = Math.max(w, h) / 60;
    if (axes.x) {
        line(frame.x0, originY, frame.x1, originY, 'af-axis-line');
        for (const x of ticks(frame.x0, frame.x1)) if (x !== 0) text(x, originY + u * 3.4, format(x), 'middle');
    }
    if (axes.y) {
        line(originX, 0, originX, h, 'af-axis-line');
        for (const y of ticks(frame.y0, frame.y1)) if (y !== 0) text(originX - u * 1.2, frame.y1 - y + u * 1, format(y), 'end');
    }
    if (axes.x && axes.y) text(originX - u * 1.2, originY + u * 3.4, '0', 'end');
}

/** Axis number with a German decimal comma. */
function format(v: number): string {
    return String(v).replace('.', ',');
}

/** Frame from two interval values (x and y range); `undefined` if either is not an interval. */
export function frameFrom(x: Value, y: Value): Frame | undefined {
    if (!(x instanceof Interval) || !(y instanceof Interval)) return undefined;
    return { x0: x.from.toNumber(), x1: x.to.toNumber(), y0: y.from.toNumber(), y1: y.to.toNumber() };
}

