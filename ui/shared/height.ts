// Work Status frame height. The guest asks the host for its content height after each paint; a host
// can drop such a request (observed natively: a frame left at a height the guest never asked for,
// with no later paint to ask again). So after asking, check the frame once it had time to resize and
// ask again a bounded number of times, backing off. Animation frames only: no timers, no loops. At
// most one check chain is pending; a newer paint, hiding and dispose cancel it. While hidden nothing
// is sent or queued, and on return only the latest height is sent and checked.

/** Frames to wait before each check (~100, 200, 400 ms at 60 Hz). One re-send per failed check. */
export const HEIGHT_RETRY_FRAMES = [6, 12, 24] as const;

export interface HeightHost {
  send: (height: number) => Promise<unknown>;
  /** The frame's actual height as the guest sees it (innerHeight). */
  actual: () => number;
  /** Whether the frame is shown; nothing is sent or scheduled while it is hidden. */
  visible: () => boolean;
  /** Schedules `fn` after `frames` animation frames; returns its cancel. */
  afterFrames: (frames: number, fn: () => void) => () => void;
}

/** Runs `fn` after `n` animation frames (chained requestAnimationFrame; bounded by `n`); cancellable. */
export function afterAnimationFrames(n: number, fn: () => void) {
  let left = n;
  let id = 0;
  const step = () => { if (--left <= 0) fn(); else id = requestAnimationFrame(step); };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}

/**
 * At most one pending check chain at any time: a newer paint, hiding and dispose cancel it. While
 * hidden, paints only record the latest height; on return that height alone is sent and checked.
 */
export class HeightSync {
  private readonly host: HeightHost;
  private generation = 0;
  /** The last request the host acted on, and the frame height it left. */
  private settled: { want: number; frame: number } | null = null;
  /** The latest requested height, and whether it still has to be sent (or re-checked) when shown. */
  private latest: number | null = null;
  private owed = false;
  private cancel: (() => void) | null = null;
  private disposed = false;
  constructor(host: HeightHost) { this.host = host; }

  request(want: number) {
    if (this.disposed) return;
    this.latest = want;
    this.stop();
    if (!this.host.visible()) { this.owed = true; return; }
    this.run(want);
  }

  /** The frame was hidden: a pending check cannot run, so it is cancelled and owed on return. */
  hidden() {
    if (this.disposed || !this.cancel) return;
    this.stop();
    this.owed = true;
  }

  /** The frame is shown again: only the latest height, and only if something is owed. */
  visible() {
    if (this.disposed || !this.owed || this.latest === null || !this.host.visible()) return;
    this.run(this.latest);
  }

  dispose() { this.disposed = true; this.stop(); this.latest = null; this.owed = false; }

  private stop() { this.generation++; this.cancel?.(); this.cancel = null; }

  private run(want: number) {
    this.owed = false;
    const generation = ++this.generation;
    const before = this.host.actual();
    void this.host.send(want).catch(() => {});
    // Already acted on: the same height left the frame exactly as it is now, or the frame sits at a
    // host clamp that any height at or above it would hit again.
    const s = this.settled;
    if (s && s.frame === before && (s.want === want || (s.frame < s.want && want >= s.frame))) return;
    this.check(generation, want, before, 0);
  }

  private check(generation: number, want: number, before: number, attempt: number) {
    if (attempt >= HEIGHT_RETRY_FRAMES.length) return;
    this.cancel = this.host.afterFrames(HEIGHT_RETRY_FRAMES[attempt], () => {
      this.cancel = null;
      // A newer paint owns the height now.
      if (generation !== this.generation || this.disposed) return;
      const frame = this.host.actual();
      // Applied, or the host changed the frame in response (a clamp also counts): done.
      if (Math.abs(frame - want) <= 1 || frame !== before) { this.settled = { want, frame }; return; }
      void this.host.send(want).catch(() => {});
      this.check(generation, want, before, attempt + 1);
    });
  }
}
