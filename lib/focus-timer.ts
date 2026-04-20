export type TimerState = "paused" | "running";

type MutableTimerBlock = {
  remainingSeconds: number;
  timerState: TimerState;
  runningSince?: Date | null;
};

export function getDefaultRemainingSeconds(durationMin: number) {
  return Math.max(0, Math.floor(durationMin * 60));
}

export function getRemainingSeconds(block: {
  remainingSeconds: number;
  timerState: TimerState;
  runningSince?: Date | null;
}) {
  if (block.timerState !== "running" || !block.runningSince) {
    return Math.max(0, Math.floor(block.remainingSeconds));
  }

  const elapsedSeconds = Math.floor((Date.now() - block.runningSince.getTime()) / 1000);
  return Math.max(0, Math.floor(block.remainingSeconds) - elapsedSeconds);
}

export function applyElapsedAndPauseIfNeeded(block: MutableTimerBlock) {
  const remaining = getRemainingSeconds(block);
  if (block.timerState === "running") {
    block.remainingSeconds = remaining;
    if (remaining <= 0) {
      block.timerState = "paused";
      block.runningSince = null;
    }
  }
}

