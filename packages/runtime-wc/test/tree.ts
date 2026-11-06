import type { RElement, RNode } from '../src/index.js';

/** All elements of a runtime tree (loops and components expanded). */
export function elements(nodes: RNode[]): RElement[] {
    return nodes.flatMap(n => {
        switch (n.kind) {
            case 'element': return [n, ...elements(n.children)];
            case 'component': case 'show': return elements(n.children);
            case 'for': return n.iterations.get().flatMap(elements);
            default: return [];
        }
    });
}

export function find(nodes: RNode[], element: string, label?: string): RElement {
    const found = elements(nodes).filter(e => e.element === element && (label === undefined || e.props.get().args.label === label));
    if (found.length === 0) throw new Error(`Kein ${element} ${label ?? ''}`);
    return found[0];
}

export function all(nodes: RNode[], element: string): RElement[] {
    return elements(nodes).filter(e => e.element === element);
}
