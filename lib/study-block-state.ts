/**
 * Canonical study-block session state rules.
 *
 * A block has two related fields: `status` ("planned" | "active" | "done")
 * and `timerState` ("paused" | "running"). In addition `runningSince` and
 * `activeTaskId` must agree with these. To avoid surprising transitions in
 * the focus UI we normalize every write through these rules:
 *
 *   planned => timerState must be "paused", runningSince=null
 *             (block is scheduled but not started)
 *   active  => timerState may be "running" or "paused"
 *             when "paused", runningSince must be null
 *             when "running", runningSince must be a Date
 *   done    => timerState must be "paused", runningSince=null,
 *             activeTaskId=null
 *
 * Never set `status = "active"` while `timerState = "running"` without
 * setting `runningSince`; use `markBlockActive` to start a run.
 */

import { StudyBlockStatus, StudyBlockTimerState } from "@/models/StudyBlock";

export type MutableBlock = {
  status: StudyBlockStatus | string;
  timerState?: StudyBlockTimerState | string | null;
  runningSince?: Date | null;
  activeTaskId?: unknown;
  remainingSeconds?: number;
};

/**
 * Enforces the invariant above on an in-memory block. Mutates in place.
 *
 * Safe to call after any status/timer change and before `block.save()`.
 */
export function normalizeBlockSessionState(block: MutableBlock) {
  switch (block.status) {
    case "planned":
      block.timerState = "paused";
      block.runningSince = null;
      break;
    case "done":
      block.timerState = "paused";
      block.runningSince = null;
      block.activeTaskId = null;
      break;
    case "active":
      if (block.timerState === "running") {
        if (!block.runningSince) block.runningSince = new Date();
      } else {
        block.timerState = "paused";
        block.runningSince = null;
      }
      break;
    default:
      block.timerState = "paused";
      block.runningSince = null;
      break;
  }
}
