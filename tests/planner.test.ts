import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PLANNER_SETTINGS,
  compareTasks,
  generateDaySlots,
  hhmmToMinutes,
  minutesToHhmm,
  planDay,
  scoreTask,
  splitIntoSessions,
  sortTasks,
  type PlannerTask,
} from "../planner";

const TODAY = "2026-04-20";

function baseTask(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id: "t",
    title: "Task",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: 60,
    status: "backlog",
    createdAt: "2026-04-19T08:00:00.000Z",
    scheduledDate: null,
    scheduledBlockId: null,
    ...overrides,
  };
}

// ---------- dates / time utilities ----------

test("hhmmToMinutes and minutesToHhmm round trip", () => {
  assert.equal(hhmmToMinutes("00:00"), 0);
  assert.equal(hhmmToMinutes("10:30"), 630);
  assert.equal(hhmmToMinutes("23:59"), 1439);
  assert.equal(minutesToHhmm(0), "00:00");
  assert.equal(minutesToHhmm(630), "10:30");
  assert.equal(minutesToHhmm(1439), "23:59");
});

test("minutesToHhmm clamps out-of-range input", () => {
  assert.equal(minutesToHhmm(-1), "00:00");
  assert.equal(minutesToHhmm(2000), "23:59");
});

// ---------- splitting ----------

test("splitIntoSessions covers the product-spec examples", () => {
  assert.deepEqual(splitIntoSessions(45, 60), [45]);
  assert.deepEqual(splitIntoSessions(60, 60), [60]);
  assert.deepEqual(splitIntoSessions(90, 60), [60, 30]);
  assert.deepEqual(splitIntoSessions(150, 60), [60, 60, 30]);
});

test("splitIntoSessions returns no sessions for zero/negative minutes", () => {
  assert.deepEqual(splitIntoSessions(0, 60), []);
  assert.deepEqual(splitIntoSessions(-5, 60), []);
});

// ---------- slot generation ----------

test("generateDaySlots honours block/break/max settings", () => {
  const slots = generateDaySlots(DEFAULT_PLANNER_SETTINGS);
  // 10:00-11:00, 11:10-12:10, 12:20-13:20, 13:30-14:30 (max=4)
  assert.equal(slots.length, 4);
  assert.deepEqual(
    slots.map((s) => [s.startTime, s.endTime]),
    [
      ["10:00", "11:00"],
      ["11:10", "12:10"],
      ["12:20", "13:20"],
      ["13:30", "14:30"],
    ],
  );
});

test("generateDaySlots stops at maxFocusBlocksPerDay even with room left", () => {
  const slots = generateDaySlots({
    ...DEFAULT_PLANNER_SETTINGS,
    maxFocusBlocksPerDay: 2,
  });
  assert.equal(slots.length, 2);
});

test("generateDaySlots stops at dayEndHour", () => {
  // Only 10:00-11:00 fits: the next slot would end at 12:10, past noon.
  const slots = generateDaySlots({
    ...DEFAULT_PLANNER_SETTINGS,
    dayStartHour: 10,
    dayEndHour: 12,
    maxFocusBlocksPerDay: 10,
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].endTime, "11:00");

  // If we give it until 12:10, the second slot fits.
  const longer = generateDaySlots({
    ...DEFAULT_PLANNER_SETTINGS,
    dayStartHour: 10,
    dayEndHour: 13,
    maxFocusBlocksPerDay: 10,
  });
  assert.equal(longer.length, 2);
});

test("generateDaySlots rejects impossible settings", () => {
  assert.throws(() =>
    generateDaySlots({
      ...DEFAULT_PLANNER_SETTINGS,
      dayStartHour: 18,
      dayEndHour: 10,
    }),
  );
});

// ---------- scoring ----------

test("scoreTask flags overdue tasks", () => {
  const s = scoreTask(
    baseTask({ dueDate: "2026-04-18", priority: "low" }),
    TODAY,
  );
  assert.equal(s.overdue, true);
  // low(1) + overdue bonus(2) = 3
  assert.equal(s.effectivePriority, 3);
});

test("sortTasks: overdue beats high priority with no due date", () => {
  const overdueLow = baseTask({
    id: "o",
    priority: "low",
    dueDate: "2026-04-10",
  });
  const highNoDue = baseTask({ id: "h", priority: "high", dueDate: null });
  const sorted = sortTasks([highNoDue, overdueLow], TODAY);
  assert.deepEqual(sorted.map((t) => t.id), ["o", "h"]);
});

test("sortTasks: within same priority, earlier due date wins", () => {
  const a = baseTask({ id: "a", priority: "medium", dueDate: "2026-04-25" });
  const b = baseTask({ id: "b", priority: "medium", dueDate: "2026-04-22" });
  assert.deepEqual(
    sortTasks([a, b], TODAY).map((t) => t.id),
    ["b", "a"],
  );
});

test("sortTasks: no-due-date tasks sink below dated tasks of the same priority", () => {
  const dated = baseTask({ id: "dated", priority: "high", dueDate: "2026-04-22" });
  const noDate = baseTask({ id: "no", priority: "high", dueDate: null });
  assert.deepEqual(
    sortTasks([noDate, dated], TODAY).map((t) => t.id),
    ["dated", "no"],
  );
});

test("sortTasks: ultimate tie-breaker is createdAt, then id", () => {
  const older = baseTask({
    id: "b",
    priority: "medium",
    dueDate: null,
    createdAt: "2026-04-10T00:00:00.000Z",
  });
  const newer = baseTask({
    id: "a",
    priority: "medium",
    dueDate: null,
    createdAt: "2026-04-18T00:00:00.000Z",
  });
  assert.deepEqual(
    sortTasks([newer, older], TODAY).map((t) => t.id),
    ["b", "a"],
  );
});

test("compareTasks is transitive across a realistic mix", () => {
  const tasks: PlannerTask[] = [
    baseTask({ id: "1", priority: "low", dueDate: null }),
    baseTask({ id: "2", priority: "high", dueDate: "2026-04-22" }),
    baseTask({ id: "3", priority: "high", dueDate: "2026-04-21" }),
    baseTask({ id: "4", priority: "medium", dueDate: "2026-04-19" }), // overdue
  ];
  // sort twice and make sure order is stable
  const s1 = sortTasks(tasks, TODAY).map((t) => t.id);
  const s2 = sortTasks(tasks, TODAY).map((t) => t.id);
  assert.deepEqual(s1, s2);
  // Overdue first, then high priority by due date, then low
  assert.deepEqual(s1, ["4", "3", "2", "1"]);
  // Sanity: compareTasks agrees with the sorted order
  for (let i = 0; i < tasks.length - 1; i++) {
    const a = tasks.find((t) => t.id === s1[i])!;
    const b = tasks.find((t) => t.id === s1[i + 1])!;
    assert.ok(compareTasks(a, b, TODAY) <= 0);
  }
});

// ---------- scheduler: basic placement ----------

test("planDay: schedules a single small task in today's first slot", () => {
  const result = planDay({
    today: TODAY,
    tasks: [baseTask({ id: "only", estimatedMinutes: 45 })],
  });
  assert.equal(result.blocks.length, 1);
  const [b] = result.blocks;
  assert.equal(b.date, TODAY);
  assert.equal(b.startTime, "10:00");
  assert.equal(b.endTime, "10:45");
  assert.equal(b.durationMinutes, 45);
  assert.equal(b.sessionIndex, 0);
  assert.equal(b.sessionTotal, 1);
  assert.equal(b.status, "planned");
  assert.equal(result.plannerSummary.suggestedNextTaskId, "only");
});

test("planDay: splits a 150-minute task into 60/60/30 across today's slots", () => {
  const result = planDay({
    today: TODAY,
    tasks: [baseTask({ id: "big", estimatedMinutes: 150 })],
  });
  assert.equal(result.blocks.length, 3);
  assert.deepEqual(
    result.blocks.map((b) => b.durationMinutes),
    [60, 60, 30],
  );
  assert.deepEqual(
    result.blocks.map((b) => b.startTime),
    ["10:00", "11:10", "12:20"],
  );
  const [b1, b2, b3] = result.blocks;
  assert.equal(b1.sessionIndex, 0);
  assert.equal(b2.sessionIndex, 1);
  assert.equal(b3.sessionIndex, 2);
  assert.equal(b3.sessionTotal, 3);
});

test("planDay: spills remaining sessions to the next day when today is full", () => {
  const result = planDay({
    today: TODAY,
    tasks: [
      baseTask({ id: "t1", estimatedMinutes: 60, createdAt: "2026-04-19T08:00:00Z" }),
      baseTask({ id: "t2", estimatedMinutes: 60, createdAt: "2026-04-19T09:00:00Z" }),
      baseTask({ id: "t3", estimatedMinutes: 60, createdAt: "2026-04-19T10:00:00Z" }),
    ],
    settings: { maxFocusBlocksPerDay: 2 },
  });
  // 2 blocks today + 1 tomorrow
  assert.equal(result.blocks.length, 3);
  const todays = result.blocks.filter((b) => b.date === TODAY);
  const tomorrows = result.blocks.filter((b) => b.date === "2026-04-21");
  assert.equal(todays.length, 2);
  assert.equal(tomorrows.length, 1);
  assert.equal(tomorrows[0].taskId, "t3");
});

test("planDay: respects maxFocusBlocksPerDay across the whole horizon", () => {
  const tasks: PlannerTask[] = [];
  for (let i = 0; i < 20; i++) {
    tasks.push(
      baseTask({
        id: `x${i}`,
        estimatedMinutes: 60,
        createdAt: `2026-04-19T${String(i).padStart(2, "0")}:00:00Z`,
      }),
    );
  }
  const result = planDay({
    today: TODAY,
    tasks,
    settings: { maxFocusBlocksPerDay: 2, planningHorizonDays: 3 },
  });
  // 2 blocks/day × 3 days = 6 capacity
  assert.equal(result.blocks.length, 6);
  assert.equal(result.unscheduledTasks.length, 14);
});

test("planDay: overdue task beats higher priority task with no due date", () => {
  const result = planDay({
    today: TODAY,
    tasks: [
      baseTask({ id: "high", priority: "high", estimatedMinutes: 60, dueDate: null }),
      baseTask({
        id: "overdue-low",
        priority: "low",
        estimatedMinutes: 60,
        dueDate: "2026-04-15",
      }),
    ],
    settings: { maxFocusBlocksPerDay: 2 },
  });
  assert.equal(result.blocks[0].taskId, "overdue-low");
  assert.equal(result.blocks[1].taskId, "high");
});

test("planDay: uses default estimate when estimatedMinutes is null and flags it", () => {
  const result = planDay({
    today: TODAY,
    tasks: [baseTask({ id: "x", estimatedMinutes: null })],
    settings: { defaultTaskEstimateMinutes: 45 },
  });
  const [b] = result.blocks;
  assert.equal(b.durationMinutes, 45);
  const summary = result.taskSummaries.find((s) => s.taskId === "x");
  assert.ok(summary);
  assert.equal(summary!.usedDefaultEstimate, true);
  assert.match(summary!.reason, /default duration/i);
});

test("planDay: skips done tasks entirely", () => {
  const result = planDay({
    today: TODAY,
    tasks: [
      baseTask({ id: "done", status: "done", estimatedMinutes: 60 }),
      baseTask({ id: "open", status: "planned", estimatedMinutes: 60 }),
    ],
  });
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].taskId, "open");
  const doneSummary = result.taskSummaries.find((s) => s.taskId === "done");
  assert.ok(doneSummary);
  assert.equal(doneSummary!.scheduledSessions, 0);
  assert.match(doneSummary!.reason, /already done/i);
});

test("planDay: clamps tiny estimates to MIN_TASK_MINUTES (15)", () => {
  const result = planDay({
    today: TODAY,
    tasks: [baseTask({ id: "tiny", estimatedMinutes: 5 })],
  });
  assert.equal(result.blocks[0].durationMinutes, 15);
});

// ---------- scheduler: planner summary + warnings ----------

test("planDay: populates workloadWarning when tasks spill beyond the horizon", () => {
  const result = planDay({
    today: TODAY,
    tasks: [
      baseTask({ id: "a", estimatedMinutes: 60, createdAt: "2026-04-19T08:00:00Z" }),
      baseTask({ id: "b", estimatedMinutes: 60, createdAt: "2026-04-19T09:00:00Z" }),
      baseTask({ id: "c", estimatedMinutes: 60, createdAt: "2026-04-19T10:00:00Z" }),
    ],
    settings: { maxFocusBlocksPerDay: 1, planningHorizonDays: 2 },
  });
  assert.equal(result.blocks.length, 2);
  assert.equal(result.unscheduledTasks.length, 1);
  assert.match(result.plannerSummary.workloadWarning ?? "", /did not fit/i);
});

test("planDay: no warning when everything fits", () => {
  const result = planDay({
    today: TODAY,
    tasks: [baseTask({ id: "a", estimatedMinutes: 60 })],
  });
  assert.equal(result.plannerSummary.workloadWarning, null);
});

test("planDay: suggestedNextTaskId points at the very first block", () => {
  const result = planDay({
    today: TODAY,
    tasks: [
      baseTask({ id: "later", priority: "low", estimatedMinutes: 60 }),
      baseTask({ id: "first", priority: "high", dueDate: "2026-04-21", estimatedMinutes: 60 }),
    ],
  });
  assert.equal(result.plannerSummary.suggestedNextTaskId, "first");
});

test("planDay: totals reported in plannerSummary match the block list", () => {
  const result = planDay({
    today: TODAY,
    tasks: [
      baseTask({ id: "a", estimatedMinutes: 60 }),
      baseTask({ id: "b", estimatedMinutes: 90 }),
    ],
  });
  const totalFromBlocks = result.blocks.reduce((a, b) => a + b.durationMinutes, 0);
  assert.equal(result.plannerSummary.totalMinutesScheduled, totalFromBlocks);
  assert.equal(result.plannerSummary.totalBlocksGenerated, result.blocks.length);
});

// ---------- scheduler: determinism + re-run safety ----------

test("planDay is deterministic for the same input", () => {
  const input = {
    today: TODAY,
    tasks: [
      baseTask({ id: "a", priority: "high", estimatedMinutes: 90, dueDate: "2026-04-22" }),
      baseTask({ id: "b", priority: "medium", estimatedMinutes: 60, dueDate: "2026-04-23" }),
      baseTask({ id: "c", priority: "low", estimatedMinutes: null, dueDate: null }),
    ],
  };
  const r1 = planDay(input);
  const r2 = planDay(input);
  assert.deepEqual(r1, r2);
});

test("planDay: existingPlan locked blocks are preserved and their slots reserved", () => {
  const tasks = [baseTask({ id: "t", estimatedMinutes: 60 })];
  // Lock a block in the first slot of today, active.
  const firstRun = planDay({ today: TODAY, tasks });
  const lockedBlock = { ...firstRun.blocks[0], status: "active" as const };

  const secondRun = planDay({
    today: TODAY,
    tasks: [
      ...tasks,
      baseTask({ id: "new", estimatedMinutes: 60, createdAt: "2026-04-20T06:00:00Z" }),
    ],
    existingPlan: [lockedBlock],
  });

  // The locked block still exists
  assert.ok(secondRun.blocks.some((b) => b.id === lockedBlock.id && b.status === "active"));
  // The new task took the NEXT slot, not the locked one
  const newBlock = secondRun.blocks.find((b) => b.taskId === "new");
  assert.ok(newBlock);
  assert.notEqual(newBlock!.startTime, lockedBlock.startTime);
});

test("planDay: existingPlan credits already-scheduled minutes so the task isn't double-booked", () => {
  const task = baseTask({ id: "t", estimatedMinutes: 60 });
  const firstRun = planDay({ today: TODAY, tasks: [task] });
  const lockedBlock = { ...firstRun.blocks[0], status: "active" as const };

  const secondRun = planDay({
    today: TODAY,
    tasks: [task],
    existingPlan: [lockedBlock],
  });

  // Only the locked block should be present (the task's 60 min are already scheduled).
  assert.equal(secondRun.blocks.length, 1);
  assert.equal(secondRun.blocks[0].id, lockedBlock.id);
});
