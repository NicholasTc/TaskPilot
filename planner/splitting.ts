/**
 * Splitting tasks into sessions.
 *
 * A "session" is one block's worth of work on a task. If a task's
 * estimated time exceeds the block size, we slice it into consecutive
 * sessions until all the minutes are accounted for. Example with
 * blockSize=60:
 *
 *   45  → [45]
 *   60  → [60]
 *   90  → [60, 30]
 *   150 → [60, 60, 30]
 *
 * The final session may be short; that's fine — a 30-minute tail still
 * occupies one block (we won't double up tasks in a single block).
 */

import { MIN_TASK_MINUTES } from "./constants";

export function splitIntoSessions(
  totalMinutes: number,
  blockSizeMinutes: number,
): number[] {
  if (totalMinutes <= 0) return [];
  if (blockSizeMinutes <= 0) {
    throw new Error(`blockSizeMinutes must be positive, got ${blockSizeMinutes}`);
  }

  const sessions: number[] = [];
  let remaining = Math.max(MIN_TASK_MINUTES, Math.floor(totalMinutes));
  while (remaining > 0) {
    const chunk = Math.min(blockSizeMinutes, remaining);
    sessions.push(chunk);
    remaining -= chunk;
  }
  return sessions;
}
