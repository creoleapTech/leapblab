import { describe, expect, it } from 'vitest';
import { enqueueTouchPoint, type TouchQueuePoint } from '../src/Electra/Client/src/engine/Arduino/touchQueue';

/**
 * Emulates the sketch side of the FT6206 protocol, running `loop()` repeatedly:
 * each iteration calls touched() (which consumes release events and reports
 * "not touched") and getPoint() (which consumes one touch point).
 */
function drain(queue: TouchQueuePoint[]): Array<{ touched: boolean; x: number; y: number }> {
  const consumed: Array<{ touched: boolean; x: number; y: number }> = [];
  let guard = 0;
  while (guard++ < 500 && queue.length > 0) {
    if (!queue[0].touched) {
      queue.shift();
      continue;
    }
    consumed.push(queue.shift()!);
  }
  return consumed;
}

describe('enqueueTouchPoint', () => {
  it('keeps a quick tap that completes between sketch loop iterations', () => {
    const queue: TouchQueuePoint[] = [];
    enqueueTouchPoint(queue, true, 120, 260);  // press
    enqueueTouchPoint(queue, false, 0, 0);     // release before the sketch ran

    const consumed = drain(queue);
    expect(consumed).toEqual([{ touched: true, x: 120, y: 260 }]);
    expect(queue.length).toBe(0);
  });

  it('never builds a drag backlog — only the latest position survives', () => {
    const queue: TouchQueuePoint[] = [];
    enqueueTouchPoint(queue, true, 10, 10);
    for (let x = 30; x <= 230; x += 20) {
      enqueueTouchPoint(queue, true, x, 10);
    }
    expect(queue.length).toBe(1);

    enqueueTouchPoint(queue, false, 0, 0);
    expect(queue.length).toBe(2);
    expect(queue[0]).toEqual({ touched: true, x: 230, y: 10 });
    expect(queue[1].touched).toBe(false);
  });

  it('delivers rapid consecutive taps in order', () => {
    const queue: TouchQueuePoint[] = [];
    enqueueTouchPoint(queue, true, 120, 140);  // tap 1
    enqueueTouchPoint(queue, false, 0, 0);
    enqueueTouchPoint(queue, true, 120, 200);  // tap 2 before the sketch ran
    enqueueTouchPoint(queue, false, 0, 0);

    const consumed = drain(queue);
    expect(consumed).toEqual([
      { touched: true, x: 120, y: 140 },
      { touched: true, x: 120, y: 200 },
    ]);
    expect(queue.length).toBe(0);
  });

  it('replaces a stale position when a gesture is interrupted without release', () => {
    const queue: TouchQueuePoint[] = [];
    enqueueTouchPoint(queue, true, 50, 50);
    enqueueTouchPoint(queue, true, 90, 50);   // same unreleased gesture
    enqueueTouchPoint(queue, true, 200, 300); // new gesture, no release in between

    expect(queue).toEqual([{ touched: true, x: 200, y: 300 }]);
  });

  it('ignores a duplicate release event', () => {
    const queue: TouchQueuePoint[] = [];
    enqueueTouchPoint(queue, true, 100, 100);
    enqueueTouchPoint(queue, false, 0, 0);
    enqueueTouchPoint(queue, false, 0, 0);

    expect(queue).toEqual([
      { touched: true, x: 100, y: 100 },
      { touched: false, x: 0, y: 0 },
    ]);
  });

  it('handles a release after the sketch already consumed the press', () => {
    const queue: TouchQueuePoint[] = [];
    enqueueTouchPoint(queue, true, 100, 100);
    drain(queue); // sketch loop ran while the finger was down
    enqueueTouchPoint(queue, false, 0, 0);

    expect(queue).toEqual([{ touched: false, x: 0, y: 0 }]);
    expect(drain(queue)).toEqual([]);
    expect(queue.length).toBe(0);
  });
});
