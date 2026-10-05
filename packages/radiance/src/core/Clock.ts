/** Time between frames, for an animation loop: `getDelta()` is the seconds since the last call. */
export class Clock {
  #last: number | undefined;
  /** Seconds since `start()`, or since the first `getDelta()`. */
  elapsed = 0;

  start(): void {
    this.#last = performance.now();
    this.elapsed = 0;
  }

  getDelta(): number {
    const now = performance.now();
    const dt = this.#last === undefined ? 0 : (now - this.#last) / 1000;
    this.#last = now;
    this.elapsed += dt;
    return dt;
  }
}
