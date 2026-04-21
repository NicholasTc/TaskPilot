import test from "node:test";
import assert from "node:assert/strict";

import {
  generatedBlockToStudyBlockPayload,
  generatedBlocksToStudyBlockPayloads,
  studyBlockDocToGeneratedBlock,
  taskDocToPlannerTask,
  taskDocsToPlannerTasks,
  type StudyBlockLike,
  type TaskLike,
} from "../planner/adapters";
import type { GeneratedBlock } from "../planner/types";

// ---------- Task → PlannerTask ----------

test("taskDocToPlannerTask maps core DB fields", () => {
  const doc: TaskLike = {
    _id: { toString: () => "abc123" },
    name: "Ship planner",
    status: "planned",
    completed: false,
    dayKey: "2026-04-20",
    studyBlockId: "block-9",
    createdAt: new Date("2026-04-19T08:00:00Z"),
    priority: "high",
    dueDate: new Date("2026-04-22T00:00:00Z"),
    estimatedMinutes: 90,
  };
  const planner = taskDocToPlannerTask(doc);
  assert.equal(planner.id, "abc123");
  assert.equal(planner.title, "Ship planner");
  assert.equal(planner.status, "planned");
  assert.equal(planner.priority, "high");
  assert.equal(planner.dueDate, "2026-04-22");
  assert.equal(planner.estimatedMinutes, 90);
  assert.equal(planner.scheduledDate, "2026-04-20");
  assert.equal(planner.scheduledBlockId, "block-9");
  assert.equal(planner.createdAt, "2026-04-19T08:00:00.000Z");
});

test("taskDocToPlannerTask fills safe defaults for Stage-3 fields missing on today's schema", () => {
  const doc: TaskLike = {
    _id: "t1",
    name: "Legacy task",
    status: "backlog",
    completed: false,
    createdAt: "2026-04-15T10:00:00Z",
  };
  const planner = taskDocToPlannerTask(doc);
  assert.equal(planner.priority, "medium");
  assert.equal(planner.dueDate, null);
  assert.equal(planner.estimatedMinutes, null);
  assert.equal(planner.scheduledDate, null);
  assert.equal(planner.scheduledBlockId, null);
});

test("taskDocToPlannerTask uses normalizeTaskState when status is missing", () => {
  const legacyCompleted: TaskLike = {
    _id: "t2",
    name: "Old completed",
    completed: true,
    createdAt: "2026-04-10T10:00:00Z",
  };
  assert.equal(taskDocToPlannerTask(legacyCompleted).status, "done");

  const legacyOpen: TaskLike = {
    _id: "t3",
    name: "Old open",
    completed: false,
    createdAt: "2026-04-10T10:00:00Z",
  };
  assert.equal(taskDocToPlannerTask(legacyOpen).status, "backlog");
});

test("taskDocToPlannerTask clamps non-finite / zero / negative estimates to null", () => {
  const cases = [0, -10, Number.NaN, Number.POSITIVE_INFINITY];
  for (const value of cases) {
    const p = taskDocToPlannerTask({
      _id: "x",
      name: "x",
      estimatedMinutes: value,
      createdAt: new Date(),
    });
    assert.equal(p.estimatedMinutes, null, `value ${value} should map to null`);
  }
});

test("taskDocsToPlannerTasks preserves order", () => {
  const docs: TaskLike[] = [
    { _id: "1", name: "a", createdAt: "2026-04-01T00:00:00Z" },
    { _id: "2", name: "b", createdAt: "2026-04-02T00:00:00Z" },
    { _id: "3", name: "c", createdAt: "2026-04-03T00:00:00Z" },
  ];
  assert.deepEqual(
    taskDocsToPlannerTasks(docs).map((t) => t.id),
    ["1", "2", "3"],
  );
});

// ---------- GeneratedBlock → StudyBlockPayload ----------

function block(overrides: Partial<GeneratedBlock> = {}): GeneratedBlock {
  return {
    id: "gb-1",
    date: "2026-04-20",
    startTime: "10:00",
    endTime: "11:00",
    durationMinutes: 60,
    taskId: "task-1",
    taskTitle: "Ship planner",
    sessionIndex: 0,
    sessionTotal: 1,
    blockType: "focus",
    status: "planned",
    reason: "because",
    ...overrides,
  };
}

test("generatedBlockToStudyBlockPayload translates HH:mm to minute offsets", () => {
  const payload = generatedBlockToStudyBlockPayload(
    block({ startTime: "10:30", durationMinutes: 45 }),
    "user-abc",
  );
  assert.equal(payload.userId, "user-abc");
  assert.equal(payload.dayKey, "2026-04-20");
  assert.equal(payload.startMinutes, 630);
  assert.equal(payload.durationMin, 45);
  assert.equal(payload.status, "planned");
  assert.equal(payload.activeTaskId, "task-1");
  assert.equal(payload.title, "Ship planner");
});

test("generatedBlocksToStudyBlockPayloads maps every block", () => {
  const blocks = [
    block({ id: "a", startTime: "10:00" }),
    block({ id: "b", startTime: "11:10", durationMinutes: 30, endTime: "11:40" }),
  ];
  const payloads = generatedBlocksToStudyBlockPayloads(blocks, "u1");
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].startMinutes, 600);
  assert.equal(payloads[1].startMinutes, 670);
});

// ---------- StudyBlock (DB) → GeneratedBlock round trip ----------

test("studyBlockDocToGeneratedBlock inverts generatedBlockToStudyBlockPayload for start time", () => {
  const doc: StudyBlockLike = {
    _id: "sb-7",
    dayKey: "2026-04-21",
    title: "Ship planner",
    startMinutes: 670, // 11:10
    durationMin: 60,
    status: "active",
    activeTaskId: "task-1",
  };
  const gen = studyBlockDocToGeneratedBlock(doc, "Ship planner");
  assert.equal(gen.id, "sb-7");
  assert.equal(gen.date, "2026-04-21");
  assert.equal(gen.startTime, "11:10");
  assert.equal(gen.endTime, "12:10");
  assert.equal(gen.taskId, "task-1");
  assert.equal(gen.status, "active");
});

test("studyBlockDocToGeneratedBlock: generated → DB → generated round-trips time fields", () => {
  const original = block({
    id: "ignored",
    date: "2026-04-22",
    startTime: "12:20",
    endTime: "13:20",
    durationMinutes: 60,
    status: "active",
  });
  const dbPayload = generatedBlockToStudyBlockPayload(original, "u1");
  const restored = studyBlockDocToGeneratedBlock(
    {
      _id: "round-trip",
      dayKey: dbPayload.dayKey,
      title: dbPayload.title,
      startMinutes: dbPayload.startMinutes,
      durationMin: dbPayload.durationMin,
      status: dbPayload.status,
      activeTaskId: dbPayload.activeTaskId,
    },
    original.taskTitle,
  );
  assert.equal(restored.date, original.date);
  assert.equal(restored.startTime, original.startTime);
  assert.equal(restored.endTime, original.endTime);
  assert.equal(restored.durationMinutes, original.durationMinutes);
  assert.equal(restored.status, original.status);
  assert.equal(restored.taskId, original.taskId);
});
