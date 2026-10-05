/** Listeners by event type, as the DOM's EventTarget has them, for any object. */
export class EventDispatcher<Events extends Record<string, unknown> = Record<string, unknown>> {
  #listeners = new Map<keyof Events, Set<(event: Events[keyof Events]) => void>>();

  addEventListener<K extends keyof Events>(type: K, listener: (event: Events[K]) => void): void {
    let set = this.#listeners.get(type);
    if (set === undefined) this.#listeners.set(type, (set = new Set()));
    set.add(listener as (event: Events[keyof Events]) => void);
  }

  removeEventListener<K extends keyof Events>(type: K, listener: (event: Events[K]) => void): void {
    this.#listeners.get(type)?.delete(listener as (event: Events[keyof Events]) => void);
  }

  dispatchEvent<K extends keyof Events>(type: K, event: Events[K]): void {
    for (const l of [...(this.#listeners.get(type) ?? [])]) l(event);
  }
}
