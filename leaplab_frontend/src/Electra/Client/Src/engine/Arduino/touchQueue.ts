/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
/**
 * touchQueue.ts
 *
 * Buffers touch points for sketches that read the emulated FT6206 through
 * `touched()` / `getPoint()`. The sketch loop runs at its own pace (often with
 * a `delay()` debounce), so this decides what the sketch still gets to see.
 *
 * The real FT6206 is a *state* device — it reports the current touch position,
 * not a backlog of every point since the last poll. Mirroring that here keeps
 * the behaviour predictable:
 *
 *  - While a gesture is in progress only the latest position is kept, so a fast
 *    drag can never build up a backlog that the sketch replays seconds later
 *    (which made taps fire the wrong button or respond very late).
 *  - On release the last position is preserved ahead of the release event, so a
 *    quick tap that finished between two sketch loop iterations still registers.
 *  - A new press after a completed gesture appends (instead of replacing), so
 *    rapid consecutive taps are all delivered in order.
 *
 * Kept pure (no engine/store imports) so it can be unit-tested in Node.
 */

export interface TouchQueuePoint {
  touched: boolean;
  x: number;
  y: number;
}

const MAX_QUEUE = 200;

export function enqueueTouchPoint(
  queue: TouchQueuePoint[],
  touched: boolean,
  x: number,
  y: number,
): void {
  const last = queue.length > 0 ? queue[queue.length - 1] : null;

  if (!touched) {
    // Already released with nothing pending — nothing to report.
    if (last && !last.touched) return;
    // Keep the last touch position (if the sketch hasn't consumed it yet) so a
    // quick tap still registers, then append the release event.
    queue.push({ touched: false, x, y });
    return;
  }

  if (last && last.touched) {
    // Same (unreleased) gesture — the chip would report the newest position.
    // Replace the pending point instead of queueing a backlog.
    queue[queue.length - 1] = { touched: true, x, y };
    return;
  }

  // New gesture (previous one already released) — append so rapid taps are all
  // delivered, in order.
  if (queue.length < MAX_QUEUE) {
    queue.push({ touched: true, x, y });
  }
}
