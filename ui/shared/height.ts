// Work Status frame height. The guest asks the host for its content height after each paint; a host
// can drop such a request (observed natively: a frame left at a height the guest never asked for,
// with no later paint to ask again). So after asking, check the frame once it had time to resize and
// ask again a bounded number of times, backing off. Animation frames only: no timers, no loops, and
// nothing runs while hidden (the next check simply waits).

/** Frames to wait before each check (~100, 200, 400 ms at 60 Hz). One re-send per failed check. */
export const HEIGHT_RETRY_FRAMES = [6, 12, 24] as const;

export interface HeightHost {
  send: (height: number) => Promise<unknown>;
  /** The frame's actual height as the guest sees it (innerHeight). */
  actual: () => number;
  afterFrames: (frames: number, fn: () => void) => void;
}

/** Runs `fn` after `n` animation frames (chained requestAnimationFrame; bounded by `n`). */
export function afterAnimationFrames(n: number, fn: () => void) {
  let left = n;
  const step = () => { if (--left <= 0) fn(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

export class HeightSync {
  private readonly host: HeightHost;
  private generation = 0;
  /** The last request the host acted on, and the frame height it left. */
  private settled: { want: number; frame: number } | null = null;
  constructor(host: HeightHost) { this.host = host; }

  request(want: number) {
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
    this.host.afterFrames(HEIGHT_RETRY_FRAMES[attempt], () => {
      // A newer paint owns the height now.
      if (generation !== this.generation) return;
      const frame = this.host.actual();
      // Applied, or the host changed the frame in response (a clamp also counts): done.
      if (Math.abs(frame - want) <= 1 || frame !== before) { this.settled = { want, frame }; return; }
      void this.host.send(want).catch(() => {});
      this.check(generation, want, before, attempt + 1);
    });
  }
}
