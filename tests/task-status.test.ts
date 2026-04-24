import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaskState, resolveTaskState } from "../lib/task-status";

test("resolveTaskState preserves state when patch is empty", () => {
  const result = resolveTaskState(
    { status: "planned", completed: false },
    {},
  );
  assert.deepEqual(result, { status: "planned", completed: false });
});

test("resolveTaskState does not toggle completion on unrelated patches", () => {
  const result = resolveTaskState(
    { status: "in_progress", completed: false },
    {},
  );
  assert.equal(result.completed, false);
  assert.equal(result.status, "in_progress");
});

test("resolveTaskState: status is authoritative", () => {
  const result = resolveTaskState(
    { status: "planned", completed: false },
    { status: "done" },
  );
  assert.deepEqual(result, { status: "done", completed: true });
});

test("resolveTaskState: completed=true derives status=done", () => {
  const result = resolveTaskState(
    { status: "planned", completed: false },
    { completed: true },
  );
  assert.deepEqual(result, { status: "done", completed: true });
});

test("resolveTaskState: completed=false on a done task falls back to planned", () => {
  const result = resolveTaskState(
    { status: "done", completed: true },
    { completed: false },
  );
  assert.deepEqual(result, { status: "planned", completed: false });
});

test("resolveTaskState: completed=false on a non-done task preserves status", () => {
  const result = resolveTaskState(
    { status: "in_progress", completed: false },
    { completed: false },
  );
  assert.deepEqual(result, { status: "in_progress", completed: false });
});

test("resolveTaskState: when both status and completed are given, status wins", () => {
  const result = resolveTaskState(
    { status: "planned", completed: false },
    { status: "in_progress", completed: true },
  );
  assert.equal(result.status, "in_progress");
  assert.equal(result.completed, false);
});

test("normalizeTaskState keeps status/completed in sync", () => {
  assert.deepEqual(normalizeTaskState({ status: "done", completed: false }), {
    status: "done",
    completed: true,
  });
  assert.deepEqual(
    normalizeTaskState({ status: "planned", completed: true }),
    { status: "planned", completed: false },
  );
});

test("normalizeTaskState falls back when status is missing", () => {
  assert.deepEqual(normalizeTaskState({ completed: true }), {
    status: "done",
    completed: true,
  });
  assert.deepEqual(normalizeTaskState({ completed: false }), {
    status: "backlog",
    completed: false,
  });
});
