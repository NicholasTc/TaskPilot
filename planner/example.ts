/**
 * Runnable demo of the planner engine.
 *
 *   npx tsx planner/example.ts
 *
 * Exercises the main features: priority ordering, overdue promotion,
 * splitting tasks across multiple blocks, spillover to later days, the
 * default-estimate fallback, and the workload warning.
 *
 * Dev-only — nothing in the app imports this file.
 */

import { DEFAULT_PLANNER_SETTINGS, planDay, type PlannerTask } from "./index";

const today = "2026-04-20";

const tasks: PlannerTask[] = [
  {
    id: "task-A",
    title: "Ship planner engine",
    priority: "high",
    dueDate: "2026-04-21",
    estimatedMinutes: 150, // 3 sessions of 60/60/30
    status: "planned",
    createdAt: "2026-04-19T08:00:00.000Z",
    scheduledDate: null,
    scheduledBlockId: null,
  },
  {
    id: "task-B",
    title: "Fix overdue billing bug",
    priority: "medium",
    dueDate: "2026-04-18", // already overdue
    estimatedMinutes: 60,
    status: "backlog",
    createdAt: "2026-04-18T09:30:00.000Z",
    scheduledDate: null,
    scheduledBlockId: null,
  },
  {
    id: "task-C",
    title: "Write portfolio blog post",
    priority: "low",
    dueDate: null,
    estimatedMinutes: null, // uses default
    status: "backlog",
    createdAt: "2026-04-15T14:00:00.000Z",
    scheduledDate: null,
    scheduledBlockId: null,
  },
  {
    id: "task-D",
    title: "Team design review prep",
    priority: "high",
    dueDate: "2026-04-20",
    estimatedMinutes: 45,
    status: "backlog",
    createdAt: "2026-04-19T12:00:00.000Z",
    scheduledDate: null,
    scheduledBlockId: null,
  },
  {
    id: "task-E",
    title: "Deep-dive on Mongo indexes",
    priority: "medium",
    dueDate: "2026-04-25",
    estimatedMinutes: 120,
    status: "backlog",
    createdAt: "2026-04-17T10:00:00.000Z",
    scheduledDate: null,
    scheduledBlockId: null,
  },
  {
    id: "task-F",
    title: "Already finished onboarding doc",
    priority: "low",
    dueDate: null,
    estimatedMinutes: 30,
    status: "done",
    createdAt: "2026-04-10T10:00:00.000Z",
    scheduledDate: null,
    scheduledBlockId: null,
  },
];

const result = planDay({
  today,
  tasks,
  settings: {
    ...DEFAULT_PLANNER_SETTINGS,
    maxFocusBlocksPerDay: 3, // force some spillover for the demo
  },
});

console.log("=== Inputs ===");
console.log(`today: ${today}`);
console.log(`tasks: ${tasks.length}`);
console.log();

console.log("=== Blocks (chronological) ===");
for (const b of result.blocks) {
  const label = `${b.date} ${b.startTime}–${b.endTime}`;
  const part =
    b.sessionTotal > 1 ? `  [${b.sessionIndex + 1}/${b.sessionTotal}]` : "";
  console.log(
    `  ${label}  ${b.taskTitle}${part}  (${b.durationMinutes}m) — ${b.reason}`,
  );
}

console.log();
console.log("=== Task summaries ===");
for (const s of result.taskSummaries) {
  console.log(
    `  ${s.title}: ${s.scheduledMinutes}/${s.totalMinutes}m scheduled, ${s.unscheduledMinutes}m unscheduled — ${s.reason}`,
  );
}

console.log();
console.log("=== Unscheduled ===");
if (result.unscheduledTasks.length === 0) {
  console.log("  (none)");
} else {
  for (const u of result.unscheduledTasks) {
    console.log(`  ${u.title}: ${u.remainingMinutes}m — ${u.reason}`);
  }
}

console.log();
console.log("=== Planner summary ===");
console.log(result.plannerSummary);
