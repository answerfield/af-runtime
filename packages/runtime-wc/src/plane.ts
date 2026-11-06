// Value and plane: slider and placeable point; coordinate system with grid, axes and tray.
import { Interval, Point, Rational, display, valueEquals } from '@answerfield/expr';
import { percentAt, drawGrid, frameFrom, frameOf, type Frame } from './plane-math.js';
import type { ElementProps, RElement } from '@answerfield/runtime-core';
import { AfElement, assetUrl, setAttr, size } from './base.js';

/**
 * One axis of a value: range and step (domain), the visible window (the plane's or the element's own range) and
 * its direction on screen.
 */
interface ValueAxis {
    min: Rational;
    max: Rational;
    step: Rational;
    from: number;
    to: number;
    dir: 'x' | 'y';
}

/** A value on one axis (slider, axis marker) or on two axes (point in the plane). */
type ValueMode = 'slider' | 'point';

/**
 * Numeric response on a scale: a slider (in a plane a marker on the x axis) or a point placed in the plane by
 * keyboard, tap or drag.
 */
export class AfValue extends AfElement {
    private thumb!: HTMLElement;
    /** Point: coordinate badge, e.g. „C (4 | 4)“ (only when the host enables it). */
    private coord!: HTMLElement;
    /** The point is being dragged. */
    private dragging = false;

    override attach(node: RElement): void {
        super.attach(node);
        this.thumb = document.createElement('span');
        this.thumb.className = 'af-thumb';
        this.thumb.setAttribute('aria-hidden', 'true');
        this.coord = document.createElement('span');
        this.coord.className = 'af-coord';
        this.coord.setAttribute('aria-hidden', 'true');
        this.append(this.thumb, this.coord);
        this.tabIndex = 0;
        this.addEventListener('keydown', e => this.onKeyDown(e));
        this.addEventListener('pointerdown', e => this.onPointer(e));
        this.addEventListener('pointermove', e => { if (e.buttons === 1) this.onPointer(e); });
        this.addEventListener('pointerup', () => this.endDrag());
        this.addEventListener('pointercancel', () => this.endDrag());
        this.addEventListener('focus', () => this.showCross());
        this.addEventListener('blur', () => this.showCross());
    }

    private get plane(): AfPlane | null {
        return this.closest('af-plane') as AfPlane | null;
    }

    private get mode(): ValueMode {
        return this.arg('min') instanceof Point ? 'point' : 'slider';
    }

    /** Axes of the value; `undefined` if the arguments are incomplete. */
    private axes(): ValueAxis[] | undefined {
        const min = this.arg('min'), max = this.arg('max'), step = this.arg('step');
        if (!(step instanceof Rational) || step.compare(Rational.of(0)) <= 0) return undefined;
        const frame = frameOf(this);
        if (min instanceof Point && max instanceof Point) {
            if (!frame) return undefined;
            return [
                { min: min.x, max: max.x, step, from: frame.x0, to: frame.x1, dir: 'x' },
                { min: min.y, max: max.y, step, from: frame.y0, to: frame.y1, dir: 'y' }
            ];
        }
        if (!(min instanceof Rational) || !(max instanceof Rational)) return undefined;
        return [{ min, max, step, from: frame?.x0 ?? min.toNumber(), to: frame?.x1 ?? max.toNumber(), dir: 'x' }];
    }

    /** Current value as one coordinate per axis; `undefined` while unset. */
    private coords(): Rational[] | undefined {
        const v = this.props?.bind;
        return v instanceof Point ? [v.x, v.y] : v instanceof Rational ? [v] : undefined;
    }

    /** Whether a value has been set. */
    get hasValue(): boolean {
        return this.coords() !== undefined;
    }

    /** Rounds to the axis step and clamps to its range, using exact arithmetic. */
    private snap(v: number, a: ValueAxis): Rational {
        const r = a.min.add(a.step.mul(Rational.of(Math.round((v - a.min.toNumber()) / a.step.toNumber()))));
        return r.compare(a.min) < 0 ? a.min : r.compare(a.max) > 0 ? a.max : r;
    }

    private set(values: number[]): void {
        const axes = this.axes();
        if (!axes) return;
        const c = axes.map((a, i) => this.snap(values[i], a));
        const next = c.length === 2 ? new Point(c[0], c[1]) : c[0];
        const current = this.props?.bind ?? null;
        if (current === null || !valueEquals(current, next)) this.emit('bind', next);
    }

    /** Values under the pointer (in the plane's area or the element itself), not yet snapped. */
    private pointed(e: PointerEvent): number[] | undefined {
        const axes = this.axes();
        const box = (this.plane?.querySelector('.af-plane-area') ?? this).getBoundingClientRect();
        if (!axes || box.width <= 0 || (axes.some(a => a.dir === 'y') && box.height <= 0)) return undefined;
        return axes.map(a => a.dir === 'x'
            ? a.from + Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * (a.to - a.from)
            : a.to - Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) * (a.to - a.from));
    }

    /** Sets the value from the pointer position in the plane's area (or the element itself). */
    placeAt(e: PointerEvent): void {
        const values = this.pointed(e);
        if (!values) return;
        this.focus();
        this.set(values);
    }

    /** Where a tap would place the point, as a percentage of the area (for the plane's preview). */
    previewAt(e: PointerEvent): { left: number; top: number } | undefined {
        const axes = this.axes(), values = this.pointed(e);
        if (!axes || !values || axes.length !== 2) return undefined;
        const [x, y] = axes.map((a, i) => this.snap(values[i], a).toNumber());
        return { left: ((x - axes[0].from) / (axes[0].to - axes[0].from)) * 100, top: 100 - ((y - axes[1].from) / (axes[1].to - axes[1].from)) * 100 };
    }

    /** Whether the pointer is over the plane's area. */
    private overArea(e: PointerEvent): boolean {
        const box = this.plane?.querySelector('.af-plane-area')?.getBoundingClientRect();
        return !!box && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
    }

    private onPointer(e: PointerEvent): void {
        if (e.type === 'pointerdown') {
            try { this.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
            this.dragging = true;
            this.setAttribute('data-dragging', '');
        }
        e.stopPropagation(); // otherwise the plane's click handler would place the next unset point
        // Dragging out of the tray: the point follows the pointer and is set only once over the area
        if (this.mode === 'point' && !this.hasValue && !this.overArea(e)) {
            const box = this.plane?.querySelector('.af-plane-area')?.getBoundingClientRect();
            if (e.type === 'pointermove' && box) {
                this.style.left = `${e.clientX - box.left}px`;
                this.style.top = `${e.clientY - box.top}px`;
                this.setAttribute('data-carried', '');
            }
            return;
        }
        this.removeAttribute('data-carried');
        this.placeAt(e);
    }

    private endDrag(): void {
        this.dragging = false;
        this.removeAttribute('data-dragging');
        this.removeAttribute('data-carried');
        // Released outside the area: back to the tray
        if (this.props) this.render(this.props);
        this.showCross();
    }

    /** Shows the grid crosshair while the point is dragged or focused. */
    private showCross(): void {
        const axes = this.axes(), coords = this.coords();
        const on = this.mode === 'point' && !!axes && !!coords && (this.dragging || this === document.activeElement);
        this.plane?.cross(on ? {
            left: ((coords![0].toNumber() - axes![0].from) / (axes![0].to - axes![0].from)) * 100,
            top: 100 - ((coords![1].toNumber() - axes![1].from) / (axes![1].to - axes![1].from)) * 100
        } : undefined);
    }

    /**
     * Arrow keys move by one step, Page Up/Down by five; for a point, horizontal keys change x and vertical keys y.
     * While unset, the first key press sets the initial value: the center for a point, the minimum on an axis.
     */
    private onKeyDown(e: KeyboardEvent): void {
        const axes = this.axes();
        if (!axes) return;
        const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        const current = this.coords()?.map(c => c.toNumber());
        if (!current) {
            this.set(axes.map(a => axes.length === 2 ? (a.min.toNumber() + a.max.toNumber()) / 2 : a.min.toNumber()));
            return;
        }
        const point = axes.length === 2;
        const axis = point && !['ArrowRight', 'ArrowLeft'].includes(e.key) ? 1 : 0;
        const a = axes[axis];
        const step = a.step.toNumber() * (e.key.startsWith('Page') ? 5 : 1);
        const next = [...current];
        if (e.key === 'Home') next[axis] = a.min.toNumber();
        else if (e.key === 'End') next[axis] = a.max.toNumber();
        else next[axis] += ['ArrowRight', 'ArrowUp', 'PageUp'].includes(e.key) ? step : -step;
        this.set(next);
    }

    protected render(props: ElementProps): void {
        const mode = this.mode, axes = this.axes(), coords = this.coords();
        const label = this.text('label') ?? (mode === 'point' ? 'Punkt' : undefined);
        setAttr(this, 'data-point', mode === 'point' ? '' : undefined);
        setAttr(this, 'data-in-plane', mode === 'slider' && this.closest('af-plane') ? '' : undefined);
        setAttr(this, 'data-unset', mode === 'point' && !coords ? '' : undefined);
        this.setAttribute('role', mode === 'slider' && this.text('role') === 'spinbutton' ? 'spinbutton' : 'slider');
        setAttr(this, 'aria-label', label);
        setAttr(this, 'aria-roledescription', mode === 'point' ? 'Punkt' : undefined);
        setAttr(this, 'aria-orientation', mode === 'point' ? undefined : 'horizontal');
        const one = mode !== 'point' && axes;
        setAttr(this, 'aria-valuemin', one ? String(axes[0].min.toNumber()) : undefined);
        setAttr(this, 'aria-valuemax', one ? String(axes[0].max.toNumber()) : undefined);
        setAttr(this, 'aria-valuenow', one && coords ? String(coords[0].toNumber()) : undefined);
        this.setAttribute('aria-valuetext', mode === 'point'
            ? (coords ? `${label} bei ${display(props.bind ?? null)}` : `${label}: noch nicht gesetzt; Pfeiltaste, Antippen der Fläche oder Hineinziehen setzt ihn`)
            : coords ? display(coords[0]) : 'kein Wert');

        // Position: the coordinate as a percentage of the visible window
        const at = (v: number, a: ValueAxis) => ((v - a.from) / (a.to - a.from)) * 100;
        this.thumb.textContent = mode === 'point' ? this.text('display') ?? '' : '';
        this.coord.textContent = mode === 'point' && coords ? `${this.text('display') ?? ''} ${display(props.bind ?? null)}`.trim() : '';
        // Marker on an axis: label above the marker (e.g. the number that belongs there)
        setAttr(this.thumb, 'data-label', mode === 'slider' ? this.text('display') : undefined);
        if (mode === 'slider') {
            this.thumb.hidden = !coords || !axes;
            if (coords && axes) this.thumb.style.left = `${at(coords[0].toNumber(), axes[0])}%`;
            // In a plane: on the x axis (y = 0)
            const frame = frameOf(this);
            this.thumb.style.top = frame ? `${((frame.y1 - Math.min(Math.max(0, frame.y0), frame.y1)) / (frame.y1 - frame.y0)) * 100}%` : '';
        } else if (mode === 'point') {
            this.thumb.hidden = false;
            if (coords && axes) {
                this.style.left = `${at(coords[0].toNumber(), axes[0])}%`;
                this.style.top = `${100 - at(coords[1].toNumber(), axes[1])}%`;
            }
            // Let the plane rearrange the tray (unset points move up when one is set)
            this.plane?.updateTray();
            this.showCross();
        }
    }
}

// ---------------------------------------------------------------------------
// Plane
// ---------------------------------------------------------------------------

/** 2D coordinate plane (or a number line without `y`) with grid, axes, background and a tray for unset points. */
export class AfPlane extends AfElement {
    private area!: HTMLElement;
    private axisLabels: HTMLElement[] = [];
    /** Tray for points not yet placed, with a hint. */
    private tray!: HTMLElement;
    /** Hover preview: where a tap would place the next point. */
    private ghost!: HTMLElement;
    /** Grid crosshair at the dragged or focused point. */
    private crossLines!: HTMLElement;
    private grid?: SVGSVGElement;
    private background?: HTMLImageElement;
    /** Coordinate range; without `y`, a flat strip around the x axis. */
    frame?: Frame;

    /** Grid spacing, if set. */
    get gridStep(): Rational | undefined {
        const grid = this.arg('grid');
        return grid instanceof Rational ? grid : undefined;
    }

    override get childTarget(): HTMLElement {
        return this.area;
    }

    override attach(node: RElement): void {
        super.attach(node);
        this.area = document.createElement('div');
        this.area.className = 'af-plane-area';
        this.ghost = document.createElement('span');
        this.ghost.className = 'af-plane-ghost';
        this.ghost.setAttribute('aria-hidden', 'true');
        this.ghost.hidden = true;
        this.crossLines = document.createElement('span');
        this.crossLines.className = 'af-plane-cross';
        this.crossLines.setAttribute('aria-hidden', 'true');
        this.crossLines.hidden = true;
        this.area.append(this.ghost, this.crossLines);
        this.tray = document.createElement('div');
        this.tray.className = 'af-plane-tray';
        this.tray.setAttribute('aria-hidden', 'true'); // each point's accessible text already explains how to place it
        this.tray.hidden = true;
        this.append(this.area, this.tray);
        this.area.addEventListener('pointermove', e => this.preview(e));
        this.area.addEventListener('pointerleave', () => { this.ghost.hidden = true; });
    }

    /** Unset points of the plane, in the order taps place them. */
    private unset(): AfValue[] {
        return [...this.area.querySelectorAll<AfValue>('af-value[data-point][data-unset]')];
    }

    /** Shows the tray while points are unset; the hint names them. */
    updateTray(): void {
        const open = this.unset();
        this.tray.hidden = open.length === 0;
        open.filter(v => !v.hasAttribute('data-carried')).forEach((v, i) => {
            v.style.left = `calc(var(--af-tray-pad) + ${i} * (var(--af-target-size) + var(--af-space-4)) + var(--af-target-size) / 2)`;
            v.style.top = '';
        });
        if (open.length === 0) {
            this.ghost.hidden = true;
            return;
        }
        const names = open.map(v => v.querySelector('.af-thumb')?.textContent || v.getAttribute('aria-label') || 'Punkt');
        this.tray.style.setProperty('--af-tray-count', String(open.length));
        this.tray.textContent = `${names.join(', ')}: ${open.length === 1 ? 'tippe in die Fläche oder zieh den Punkt hinein' : 'tippe nacheinander in die Fläche oder zieh die Punkte hinein'}.`;
    }

    /** Mouse or pen preview: a faint point at the nearest grid point. */
    private preview(e: PointerEvent): void {
        const next = this.unset()[0];
        const at = e.pointerType !== 'touch' && e.buttons === 0 && !(e.target as Element).closest('af-value') ? next?.previewAt(e) : undefined;
        this.ghost.hidden = !at;
        if (!at) return;
        this.ghost.style.left = `${at.left}%`;
        this.ghost.style.top = `${at.top}%`;
        this.ghost.dataset.label = next.querySelector('.af-thumb')?.textContent ?? '';
    }

    /** Shows the crosshair at a position (percentages), or hides it for `undefined`. */
    cross(at: { left: number; top: number } | undefined): void {
        this.crossLines.hidden = !at;
        if (!at) return;
        this.crossLines.style.setProperty('--af-cross-x', `${at.left}%`);
        this.crossLines.style.setProperty('--af-cross-y', `${at.top}%`);
    }

    protected render(): void {
        const x = this.arg('x');
        let y = this.arg('y');
        if (x instanceof Interval && !(y instanceof Interval)) {
            const half = x.to.sub(x.from).div(Rational.of(20));
            y = new Interval(half.neg(), half);
        }
        this.frame = frameFrom(x, y);
        this.style.width = size(this.arg('width')) ?? '';
        if (!this.frame) return;
        // Aspect ratio from the coordinate range; grid as background
        const f = this.frame;
        this.area.style.aspectRatio = `${f.x1 - f.x0} / ${f.y1 - f.y0}`;
        this.grid ??= this.area.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), this.area.firstChild);
        this.grid.setAttribute('class', 'af-plane-grid');
        this.grid.setAttribute('preserveAspectRatio', 'none');
        this.grid.setAttribute('aria-hidden', 'true');
        // Axes are drawn when x_axis/y_axis is set (even to ""), numbered along the grid; the name sits at the axis end
        const xAxis = this.arg('x_axis') !== null, yAxis = this.arg('y_axis') !== null;
        drawGrid(this.grid, f, this.gridStep, { x: xAxis, y: yAxis });
        this.axisLabels.forEach(l => l.remove());
        this.axisLabels = [];
        const originX = Math.min(Math.max(0, f.x0), f.x1), originY = Math.min(Math.max(0, f.y0), f.y1);
        for (const [axis, on] of [['x', xAxis], ['y', yAxis]] as const) {
            const name = on ? this.text(`${axis}_axis`) : undefined;
            if (!name) continue;
            const label = document.createElement('span');
            label.className = 'af-axis-label';
            label.dataset.axis = axis;
            label.setAttribute('aria-hidden', 'true');
            label.textContent = name;
            const origin = percentAt(f, originX, originY);
            label.style.left = axis === 'x' ? '100%' : `${origin.left}%`;
            label.style.top = axis === 'x' ? `${origin.top}%` : '0%';
            this.area.append(label);
            this.axisLabels.push(label);
        }
        const background = this.text('background');
        if (background) {
            this.background ??= this.area.insertBefore(document.createElement('img'), this.area.firstChild);
            this.background.className = 'af-plane-background';
            this.background.alt = '';
            this.background.src = assetUrl(this, background);
        }
        this.area.onpointerdown = e => this.place(e);
    }

    /** Click in the area: places the next unset point, otherwise moves the focused one. */
    private place(e: PointerEvent): void {
        if ((e.target as Element).closest('af-value')) return;
        const values = [...this.area.querySelectorAll<AfValue>('af-value[data-point]')];
        const target = values.find(v => !v.hasValue) ?? values.find(v => v.contains(document.activeElement));
        target?.placeAt(e);
        this.ghost.hidden = true;
    }
}
