type Tick = (dtSeconds: number, nowSeconds: number) => void;

/**
 * Single requestAnimationFrame loop shared by all unit instances. Keeps animation evaluation
 * outside React rendering; subscribers decide when (and whether) to trigger a redraw.
 */
export class AnimationClock {
  private subscribers = new Set<Tick>();
  private rafId: number | null = null;
  private last = 0;
  private running = false;
  /** Global time multiplier. */
  timeScale = 1;
  /** Clamp a single step so backgrounded tabs don't jump. Seconds. */
  maxStep = 0.1;

  subscribe(tick: Tick): () => void {
    this.subscribers.add(tick);
    this.start();
    return () => {
      this.subscribers.delete(tick);
      if (this.subscribers.size === 0) this.stop();
    };
  }

  private start() {
    if (this.running) return;
    this.running = true;
    this.last = now();
    const loop = () => {
      if (!this.running) return;
      const t = now();
      let dt = (t - this.last) / 1000;
      this.last = t;
      if (dt > this.maxStep) dt = this.maxStep;
      dt *= this.timeScale;
      for (const s of this.subscribers) s(dt, t / 1000);
      this.rafId = requestFrame(loop);
    };
    this.rafId = requestFrame(loop);
  }

  private stop() {
    this.running = false;
    if (this.rafId !== null) cancelFrame(this.rafId);
    this.rafId = null;
  }
}

function now(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
}

function requestFrame(cb: () => void): number {
  const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number };
  if (g.requestAnimationFrame) return g.requestAnimationFrame(cb);
  return setTimeout(cb, 16) as unknown as number;
}

function cancelFrame(id: number): void {
  const g = globalThis as { cancelAnimationFrame?: (id: number) => void };
  if (g.cancelAnimationFrame) g.cancelAnimationFrame(id);
  else clearTimeout(id);
}

export const sharedClock = new AnimationClock();
