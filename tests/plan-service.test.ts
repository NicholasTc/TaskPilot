import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBlockIdMap,
  buildTaskPatches,
  categorizeExistingBlocks,
  computeDeletions,
  computeInsertions,
  existingBlocksToGenerated,
  rewritePlanBlockIds,
  toStudyBlockPayloads,
  type ExistingBlockLike,
} from "../lib/plan-service";
import { planDay } from "../planner/scheduler";
import type { GeneratedBlock, PlanResult, PlannerTask } from "../planner/types";

// ---------- test fixtures ----------

function existing(overrides: Partial<ExistingBlockLike> = {}): ExistingBlockLike {
  return {
    id: "block-1",
    dayKey: "2026-04-20",
    startMinutes: 600, // 10:00
    durationMin: 60,
    status: "planned",
    activeTaskId: "task-1",
    taskTitle: "Ship planner",
    ...overrides,
  };
}

function task(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id: "task-1",
    title: "Ship planner",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: 60,
    status: "backlog",
    createdAt: "2026-04-10T10:00:00Z",
    scheduledDate: null,
    scheduledBlockId: null,
    ...overrides,
  };
}

// ---------- categorizeExistingBlocks ----------

test("categorizeExistingBlocks splits planned vs locked", () => {
  const blocks = [
    existing({ id: "a", status: "planned" }),
    existing({ id: "b", status: "active" }),
    existing({ id: "c", status: "done" }),
    existing({ id: "d", status: "planned" }),
  ];
  const { locked, stalePlanned } = categorizeExistingBlocks(blocks);
  assert.deepEqual(
    locked.map((b) => b.id),
    ["b", "c"],
  );
  assert.deepEqual(
    stalePlanned.map((b) => b.id),
    ["a", "d"],
  );
});

// ---------- existingBlocksToGenerated ----------

test("existingBlocksToGenerated stamps the DB id as the planner id", () => {
  const [gen] = existingBlocksToGenerated([
    existing({ id: "db-xyz", status: "active", startMinutes: 630, durationMin: 45 }),
  ]);
  assert.equal(gen.id, "db-xyz");
  assert.equal(gen.startTime, "10:30");
  assert.equal(gen.endTime, "11:15");
  assert.equal(gen.status, "active");
  assert.equal(gen.taskId, "task-1");
});

test("existingBlocksToGenerated coerces null activeTaskId to empty string", () => {
  const [gen] = existingBlocksToGenerated([
    existing({ activeTaskId: null, taskTitle: "Untitled" }),
  ]);
  assert.equal(gen.taskId, "");
});

// ---------- computeDeletions / computeInsertions ----------

test("computeDeletions marks stale blocks missing from the new plan", () => {
  const stale = [existing({ id: "keep" }), existing({ id: "drop-1" }), existing({ id: "drop-2" })];
  const planBlocks: GeneratedBlock[] = [
    {
      id: "keep",
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
      reason: "",
    },
  ];
  assert.deepEqual(computeDeletions(stale, planBlocks), ["drop-1", "drop-2"]);
});

test("computeInsertions returns only blocks not already persisted", () => {
  const result: PlanResult = {
    blocks: [
      {
        id: "locked-1",
        date: "2026-04-20",
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        taskId: "t1",
        taskTitle: "T1",
        sessionIndex: 0,
        sessionTotal: 1,
        blockType: "focus",
        status: "active",
        reason: "",
      },
      {
        id: "new-1",
        date: "2026-04-20",
        startTime: "11:10",
        endTime: "12:10",
        durationMinutes: 60,
        taskId: "t2",
        taskTitle: "T2",
        sessionIndex: 0,
        sessionTotal: 1,
        blockType: "focus",
        status: "planned",
        reason: "",
      },
    ],
    unscheduledTasks: [],
    taskSummaries: [],
    plannerSummary: {
      totalTasksConsidered: 2,
      totalTasksScheduled: 2,
      totalTasksUnscheduled: 0,
      totalBlocksGenerated: 2,
      totalMinutesScheduled: 120,
      workloadWarning: null,
      suggestedNextTaskId: "t1",
    },
  };
  const inserts = computeInsertions(result, ["locked-1"]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].id, "new-1");
});

// ---------- toStudyBlockPayloads ----------

test("toStudyBlockPayloads stamps userId and preserves order", () => {
  const result: PlanResult = {
    blocks: [
      {
        id: "a",
        date: "2026-04-20",
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        taskId: "t1",
        taskTitle: "T1",
        sessionIndex: 0,
        sessionTotal: 1,
        blockType: "focus",
        status: "planned",
        reason: "",
      },
      {
        id: "b",
        date: "2026-04-20",
        startTime: "11:10",
        endTime: "12:10",
        durationMinutes: 60,
        taskId: "t2",
        taskTitle: "T2",
        sessionIndex: 0,
        sessionTotal: 1,
        blockType: "focus",
        status: "planned",
        reason: "",
      },
    ],
    unscheduledTasks: [],
    taskSummaries: [],
    plannerSummary: {
      totalTasksConsidered: 2,
      totalTasksScheduled: 2,
      totalTasksUnscheduled: 0,
      totalBlocksGenerated: 2,
      totalMinutesScheduled: 120,
      workloadWarning: null,
      suggestedNextTaskId: "t1",
    },
  };
  const payloads = toStudyBlockPayloads(result.blocks, "user-1");
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].userId, "user-1");
  assert.equal(payloads[0].startMinutes, 600);
  assert.equal(payloads[1].startMinutes, 670);
});

// ---------- buildBlockIdMap ----------

test("buildBlockIdMap: locked ids map to themselves, inserted ids map to persisted ids", () => {
  const map = buildBlockIdMap({
    insertedPairs: [
      { plannerBlockId: "p-1", persistedId: "db-1" },
      { plannerBlockId: "p-2", persistedId: "db-2" },
    ],
    lockedBlockIds: ["locked-a"],
  });
  assert.equal(map.get("locked-a"), "locked-a");
  assert.equal(map.get("p-1"), "db-1");
  assert.equal(map.get("p-2"), "db-2");
});

// ---------- buildTaskPatches ----------

test("buildTaskPatches assigns scheduled tasks to their first block and promotes backlog→planned", () => {
  const tasks = [
    task({ id: "t1", status: "backlog" }),
    task({ id: "t2", status: "in_progress" }),
  ];
  const result: PlanResult = {
    blocks: [
      {
        id: "p-1",
        date: "2026-04-20",
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        taskId: "t1",
        taskTitle: "T1",
        sessionIndex: 0,
        sessionTotal: 1,
        blockType: "focus",
        status: "planned",
        reason: "",
      },
      {
        id: "p-2",
        date: "2026-04-21",
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        taskId: "t1",
        taskTitle: "T1",
        sessionIndex: 1,
        sessionTotal: 2,
        blockType: "focus",
        status: "planned",
        reason: "",
      },
      {
        id: "locked",
        date: "2026-04-20",
        startTime: "13:00",
        endTime: "14:00",
        durationMinutes: 60,
        taskId: "t2",
        taskTitle: "T2",
        sessionIndex: 0,
        sessionTotal: 1,
        blockType: "focus",
        status: "active",
        reason: "",
      },
    ],
    unscheduledTasks: [],
    taskSummaries: [],
    plannerSummary: {
      totalTasksConsidered: 2,
      totalTasksScheduled: 2,
      totalTasksUnscheduled: 0,
      totalBlocksGenerated: 3,
      totalMinutesScheduled: 180,
      workloadWarning: null,
      suggestedNextTaskId: "t1",
    },
  };

  const blockIdMap = buildBlockIdMap({
    insertedPairs: [
      { plannerBlockId: "p-1", persistedId: "db-p-1" },
      { plannerBlockId: "p-2", persistedId: "db-p-2" },
    ],
    lockedBlockIds: ["locked"],
  });

  const patches = buildTaskPatches({ result, blockIdMap, tasks });
  assert.equal(patches.length, 2);

  const t1Patch = patches.find((p) => p.taskId === "t1")!;
  assert.equal(t1Patch.studyBlockId, "db-p-1"); // first session
  assert.equal(t1Patch.dayKey, "2026-04-20");
  assert.equal(t1Patch.status, "planned"); // backlog → planned

  const t2Patch = patches.find((p) => p.taskId === "t2")!;
  assert.equal(t2Patch.studyBlockId, "locked");
  assert.equal(t2Patch.dayKey, "2026-04-20");
  assert.equal(t2Patch.status, "in_progress"); // unchanged
});

test("buildTaskPatches clears studyBlockId/dayKey for unscheduled non-done tasks", () => {
  const tasks = [task({ id: "t1", status: "backlog" })];
  const result: PlanResult = {
    blocks: [],
    unscheduledTasks: [
      { taskId: "t1", title: "Ship planner", remainingMinutes: 60, reason: "no capacity" },
    ],
    taskSummaries: [],
    plannerSummary: {
      totalTasksConsidered: 1,
      totalTasksScheduled: 0,
      totalTasksUnscheduled: 1,
      totalBlocksGenerated: 0,
      totalMinutesScheduled: 0,
      workloadWarning: null,
      suggestedNextTaskId: null,
    },
  };
  const patches = buildTaskPatches({
    result,
    blockIdMap: new Map(),
    tasks,
  });
  assert.deepEqual(patches, [
    { taskId: "t1", status: "backlog", dayKey: null, studyBlockId: null },
  ]);
});

test("buildTaskPatches skips done tasks entirely", () => {
  const tasks = [task({ id: "done-1", status: "done" })];
  const result: PlanResult = {
    blocks: [],
    unscheduledTasks: [],
    taskSummaries: [],
    plannerSummary: {
      totalTasksConsidered: 0,
      totalTasksScheduled: 0,
      totalTasksUnscheduled: 0,
      totalBlocksGenerated: 0,
      totalMinutesScheduled: 0,
      workloadWarning: null,
      suggestedNextTaskId: null,
    },
  };
  assert.deepEqual(
    buildTaskPatches({ result, blockIdMap: new Map(), tasks }),
    [],
  );
});

// ---------- rewritePlanBlockIds ----------

test("rewritePlanBlockIds swaps in persisted ids everywhere in result.blocks", () => {
  const result: PlanResult = {
    blocks: [
      {
        id: "p-1",
        date: "2026-04-20",
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        taskId: "t1",
        taskTitle: "T1",
        sessionIndex: 0,
        sessionTotal: 1,
        blockType: "focus",
        status: "planned",
        reason: "",
      },
    ],
    unscheduledTasks: [],
    taskSummaries: [],
    plannerSummary: {
      totalTasksConsidered: 1,
      totalTasksScheduled: 1,
      totalTasksUnscheduled: 0,
      totalBlocksGenerated: 1,
      totalMinutesScheduled: 60,
      workloadWarning: null,
      suggestedNextTaskId: "t1",
    },
  };
  const rewritten = rewritePlanBlockIds(result, new Map([["p-1", "db-42"]]));
  assert.equal(rewritten.blocks[0].id, "db-42");
  assert.equal(result.blocks[0].id, "p-1"); // original untouched (immutability)
});

// ---------- end-to-end: real planDay + service plumbing ----------

test("end-to-end: locked active block survives re-plan, new block gets inserted, task points at first scheduled block", () => {
  const today = "2026-04-20";
  const dbBlocks: ExistingBlockLike[] = [
    // active block for task-a at 10:00-11:00
    existing({
      id: "db-active",
      status: "active",
      activeTaskId: "task-a",
      taskTitle: "Active Task",
      startMinutes: 600,
      durationMin: 60,
    }),
    // stale planned block for task-b at 11:10-12:10 — should be discarded and re-created
    existing({
      id: "db-stale",
      status: "planned",
      activeTaskId: "task-b",
      taskTitle: "Stale Plan",
      startMinutes: 670,
      durationMin: 60,
    }),
  ];
  const { locked, stalePlanned } = categorizeExistingBlocks(dbBlocks);
  const existingPlan = existingBlocksToGenerated(locked);

  const tasks: PlannerTask[] = [
    task({ id: "task-a", title: "Active Task", status: "in_progress", estimatedMinutes: 60 }),
    task({ id: "task-b", title: "Freshly Planned", status: "backlog", estimatedMinutes: 60 }),
  ];

  const result = planDay({ today, tasks, existingPlan });

  const deletions = computeDeletions(stalePlanned, result.blocks);
  assert.deepEqual(deletions, ["db-stale"]);

  const insertions = computeInsertions(result, locked.map((b) => b.id));
  assert.ok(insertions.length >= 1);
  // None of the insertions should collide with a locked id.
  for (const ins of insertions) {
    assert.notEqual(ins.id, "db-active");
  }

  // Simulate persistence giving us DB ids.
  const insertedPairs = insertions.map((b, i) => ({
    plannerBlockId: b.id,
    persistedId: `inserted-${i}`,
  }));
  const blockIdMap = buildBlockIdMap({
    insertedPairs,
    lockedBlockIds: locked.map((b) => b.id),
  });

  const patches = buildTaskPatches({ result, blockIdMap, tasks });
  const taskAPatch = patches.find((p) => p.taskId === "task-a")!;
  const taskBPatch = patches.find((p) => p.taskId === "task-b")!;

  assert.equal(taskAPatch.studyBlockId, "db-active");
  assert.equal(taskAPatch.status, "in_progress"); // unchanged
  assert.equal(taskBPatch.studyBlockId, "inserted-0");
  assert.equal(taskBPatch.status, "planned");

  const rewritten = rewritePlanBlockIds(result, blockIdMap);
  // All block ids should now either be locked DB ids or inserted-N.
  for (const b of rewritten.blocks) {
    assert.ok(
      b.id === "db-active" || b.id.startsWith("inserted-"),
      `unexpected block id in rewritten plan: ${b.id}`,
    );
  }
});
