/** Typed event listeners: `on` returns the function that removes the listener. */
export class Emitter<Events extends Record<string, unknown>> {
    private readonly listeners = new Map<keyof Events, Set<(value: never) => void>>();

    on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void {
        let set = this.listeners.get(event);
        if (!set) this.listeners.set(event, set = new Set());
        set.add(listener as (value: never) => void);
        return () => { set.delete(listener as (value: never) => void); };
    }

    emit<K extends keyof Events>(event: K, value: Events[K]): void {
        // a failing listener must not stop the others or the player
        for (const listener of [...this.listeners.get(event) ?? []]) {
            try {
                (listener as (value: Events[K]) => void)(value);
            } catch (e) {
                console.error(`AF-Player: Fehler im Listener für '${String(event)}'`, e);
            }
        }
    }

    clear(): void {
        this.listeners.clear();
    }
}
