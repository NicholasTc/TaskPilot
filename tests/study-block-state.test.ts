import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBlockSessionState } from "../lib/study-block-state";

test("planned block cannot be running", () => {
  const block = {
    status: "planned",
    timerState: "running",
    runningSince: new Date(),
  };
  normalizeBlockSessionState(block);
  assert.equal(block.timerState, "paused");
  assert.equal(block.runningSince, null);
});

test("done block clears activeTaskId and runningSince", () => {
  const block = {
    status: "done",
    timerState: "running",
    runningSince: new Date(),
    activeTaskId: "abc",
  };
  normalizeBlockSessionState(block);
  assert.equal(block.timerState, "paused");
  assert.equal(block.runningSince, null);
  assert.equal(block.activeTaskId, null);
});

test("active + running requires a runningSince", () => {
  const block: {
    status: string;
    timerState: string;
    runningSince: Date | null;
  } = {
    status: "active",
    timerState: "running",
    runningSince: null,
  };
  normalizeBlockSessionState(block);
  assert.ok(block.runningSince instanceof Date, "runningSince auto-filled");
  assert.equal(block.timerState, "running");
});

test("active + paused clears runningSince", () => {
  const block = {
    status: "active",
    timerState: "paused",
    runningSince: new Date(),
  };
  normalizeBlockSessionState(block);
  assert.equal(block.timerState, "paused");
  assert.equal(block.runningSince, null);
});
