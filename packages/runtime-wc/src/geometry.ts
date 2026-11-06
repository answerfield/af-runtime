import { Arc, Point, display, type Value } from '@answerfield/expr';
import { AfElement } from './elements.js';
import { frameOf, percentAt, type Frame } from './plane-math.js';

export { coordsAt, drawGrid, frameFrom, frameOf, percentAt, type Frame } from './plane-math.js';

const SVG = 'http://www.w3.org/2000/svg';

/** Point → SVG coordinates of the plane (y points down so text is not mirrored). */
function at(frame: Frame, p: Point): [number, number] {
    return [p.x.toNumber(), frame.y1 - p.y.toNumber()];
}

function points(v: Value): Point[] {
    return Array.isArray(v) ? v.filter((p): p is Point => p instanceof Point) : [];
}

/**
 * Base of a plane's drawing elements: each element is an SVG layer covering the whole area in the plane's
 * coordinate system. Presentational only; for screen readers the item or `value` describes the content.
 */
abstract class AfShape extends AfElement {
    protected svg!: SVGSVGElement;
    private labels: HTMLElement[] = [];

    protected override init(): void {
        this.setAttribute('aria-hidden', 'true');
        this.svg = document.createElementNS(SVG, 'svg');
        this.svg.setAttribute('preserveAspectRatio', 'none');
        this.append(this.svg);
    }

    protected render(): void {
        const frame = frameOf(this);
        this.svg.replaceChildren();
        this.labels.forEach(l => l.remove());
        this.labels = [];
        if (!frame) return;
        this.svg.setAttribute('viewBox', `${frame.x0} 0 ${frame.x1 - frame.x0} ${frame.y1 - frame.y0}`);
        this.draw(frame, (this.props?.args ?? {}) as Record<string, Value>);
    }

    protected abstract draw(frame: Frame, args: Record<string, Value>): void;

    protected add<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
        const el = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
        this.svg.append(el);
        return el;
    }

    /**
     * Label as HTML text at a position of the plane (SVG coordinates), so it keeps body text size regardless of the
     * plane's coordinate range. `place`: placement relative to the position.
     */
    protected label(frame: Frame, x: number, y: number, text: string, place: 'center' | 'above-right' | 'below', cls = 'af-shape-label'): void {
        const el = document.createElement('span');
        el.className = cls;
        el.dataset.place = place;
        el.textContent = text;
        // y is already an SVG coordinate (measured from the top)
        const { left, top } = percentAt(frame, x, frame.y1 - y);
        el.style.left = `${left}%`;
        el.style.top = `${top}%`;
        this.append(el);
        this.labels.push(el);
    }

    /** Unit for radii, relative to the plane's size. */
    protected unit(frame: Frame): number {
        return Math.max(frame.x1 - frame.x0, frame.y1 - frame.y0) / 60;
    }
}

/** A point marker (`shape: notch` draws a tick on the x axis instead). */
export class AfDot extends AfShape {
    protected draw(frame: Frame, args: Record<string, Value>): void {
        const p = args.at;
        if (!(p instanceof Point)) return;
        const [x, y] = at(frame, p), u = this.unit(frame);
        const label = display(args.label ?? null);
        if (args.shape === 'notch') {
            // Tick across the x axis, label below
            this.add('line', { x1: x, y1: y - u * 1.5, x2: x, y2: y + u * 1.5, class: 'af-stroke' });
            if (label) this.label(frame, x, y, label, 'below');
            return;
        }
        this.add('circle', { cx: x, cy: y, r: u * 0.9, class: 'af-dot' });
        if (label) this.label(frame, x, y, label, 'above-right', 'af-shape-label af-dot-label');
    }
}

/** A text label at a point of the plane. */
export class AfCaption extends AfShape {
    protected draw(frame: Frame, args: Record<string, Value>): void {
        const p = args.at, text = display(args.text ?? null);
        if (!(p instanceof Point) || !text) return;
        const [x, y] = at(frame, p);
        this.label(frame, x, y, text, 'center');
    }
}

/**
 * Path data for points and arcs: a line to each point; an arc lines to its start and bends to its end (a full circle
 * in two halves, since SVG cannot draw an arc to its own start point).
 */
export function pathData(frame: Frame, items: Point[]): string {
    const parts: string[] = [];
    const to = (p: Point) => {
        const [x, y] = at(frame, p);
        parts.push(`${parts.length === 0 ? 'M' : 'L'}${x},${y}`);
    };
    for (const item of items) {
        if (!(item instanceof Arc)) { to(item); continue; }
        const from = item.from.toNumber(), end = item.to.toNumber(), r = item.radius.toNumber();
        const [cx, cy] = at(frame, item.center);
        // Rounded: cos 90° is 6e-17, not 0
        const point = (deg: number) => {
            const a = deg * Math.PI / 180;
            return [+(cx + r * Math.cos(a)).toFixed(6), +(cy - r * Math.sin(a)).toFixed(6)];
        };
        const [sx, sy] = point(from);
        parts.push(`${parts.length === 0 ? 'M' : 'L'}${sx},${sy}`);
        // Counterclockwise in the plane is counterclockwise on screen too: SVG sweep 0 (its y points down)
        const sweep = end > from ? 0 : 1;
        const steps = Math.abs(end - from) >= 360 ? [from + (end - from) / 2, end] : [end];
        let last = from;
        for (const stop of steps) {
            const [x, y] = point(stop);
            parts.push(`A${r},${r} 0 ${Math.abs(stop - last) > 180 ? 1 : 0} ${sweep} ${x},${y}`);
            last = stop;
        }
    }
    return parts.join(' ');
}

/** A polygon or polyline through the given points and arcs. */
export class AfPolygon extends AfShape {
    protected draw(frame: Frame, args: Record<string, Value>): void {
        const all = Array.isArray(args.points) ? args.points : [];
        const present = points(args.points ?? null);
        const arcs = present.some(p => p instanceof Arc);
        if (present.length < 2 && !arcs) return;
        // All points present: closed shape; open (closed: false) or a point missing: line through the present ones
        const closed = args.closed !== false && present.length === all.length && (present.length >= 3 || arcs);
        const tone = typeof args.tone === 'string' ? args.tone : undefined;
        this.add('path', {
            d: pathData(frame, present) + (closed ? ' Z' : ''),
            class: closed ? 'af-stroke af-fill' : 'af-stroke',
            ...(closed && tone ? { 'data-tone': tone } : {})
        });
    }
}

/** Geometry element tag names mapped to their classes (registered by the renderer). */
export const GEOMETRY_ELEMENTS: Readonly<Record<string, CustomElementConstructor>> = {
    'af-dot': AfDot,
    'af-caption': AfCaption,
    'af-polygon': AfPolygon
};
