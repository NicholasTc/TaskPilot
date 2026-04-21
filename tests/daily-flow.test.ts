import test from "node:test";
import assert from "node:assert/strict";
import {
  DailyFlowBlock,
  DailyFlowStep,
  DailyFlowTask,
  deriveDailyFlow,
  getNextActionHint,
  getStepIndex,
  getStepLabel,
  getStepOrder,
  getStepRoute,
  pageToStep,
} from "../lib/daily-flow";

function task(
  status: DailyFlowTask["status"],
  opts: { studyBlockId?: string | null; id?: string } = {},
): DailyFlowTask {
  return {
    id: opts.id ?? Math.random().toString(36).slice(2),
    status,
    studyBlockId: opts.studyBlockId ?? null,
  };
}

function block(status: DailyFlowBlock["status"], id?: string): DailyFlowBlock {
  return { id: id ?? Math.random().toString(36).slice(2), status };
}

// ---------- deriveDailyFlow (new auto-planner rules) ----------

test("derives step=tasks when there are open tasks but no blocks yet", () => {
  const flow = deriveDailyFlow([task("backlog"), task("backlog")], []);
  assert.equal(flow.step, "tasks");
  assert.equal(flow.hasStarted, false);
  assert.equal(flow.counts.openTasks, 2);
  assert.equal(flow.counts.blocks, 0);
});

test("derives step=tasks when the slate is totally empty", () => {
  const flow = deriveDailyFlow([], []);
  assert.equal(flow.step, "tasks");
  assert.equal(flow.hasStarted, false);
  assert.equal(flow.counts.openTasks, 0);
});

test("derives step=blocks once blocks have been scheduled but none started", () => {
  const flow = deriveDailyFlow(
    [task("planned", { studyBlockId: "b1" }), task("backlog")],
    [block("planned", "b1"), block("planned", "b2")],
  );
  assert.equal(flow.step, "blocks");
  assert.equal(flow.hasStarted, true);
  assert.equal(flow.counts.plannedBlocks, 2);
  assert.equal(flow.counts.activeBlocks, 0);
});

test("derives step=home when an active block is running", () => {
  const flow = deriveDailyFlow(
    [task("in_progress", { studyBlockId: "b1" })],
    [block("active", "b1"), block("planned", "b2")],
  );
  assert.equal(flow.step, "home");
  assert.equal(flow.counts.activeBlocks, 1);
  assert.equal(flow.counts.inProgressTasks, 1);
});

test("derives step=today when every block is done", () => {
  const flow = deriveDailyFlow(
    [task("done", { studyBlockId: "b1" }), task("done", { studyBlockId: "b2" })],
    [block("done", "b1"), block("done", "b2")],
  );
  assert.equal(flow.step, "today");
  assert.equal(flow.counts.doneBlocks, 2);
  assert.equal(flow.counts.doneTasks, 2);
});

test("active block beats 'all done' when both could apply", () => {
  // One block active, another done — step should still be home because
  // the user has something to focus on.
  const flow = deriveDailyFlow(
    [],
    [block("active", "b1"), block("done", "b2")],
  );
  assert.equal(flow.step, "home");
});

// ---------- counts are accurate ----------

test("counts reflect task + block aggregates", () => {
  const flow = deriveDailyFlow(
    [
      task("backlog"),
      task("planned"),
      task("in_progress"),
      task("done"),
    ],
    [block("planned"), block("active"), block("done")],
  );
  assert.equal(flow.counts.openTasks, 3); // backlog + planned + in_progress
  assert.equal(flow.counts.inProgressTasks, 1);
  assert.equal(flow.counts.doneTasks, 1);
  assert.equal(flow.counts.blocks, 3);
  assert.equal(flow.counts.plannedBlocks, 1);
  assert.equal(flow.counts.activeBlocks, 1);
  assert.equal(flow.counts.doneBlocks, 1);
});

// ---------- step metadata ----------

test("step order matches the new auto-planner sequence", () => {
  assert.deepEqual(getStepOrder(), ["tasks", "blocks", "home", "today"]);
});

test("step labels use the guided-flow vocabulary", () => {
  const labels = getStepOrder().map((s) => getStepLabel(s).name);
  assert.deepEqual(labels, ["Plan", "Schedule", "Focus", "Reflect"]);
});

test("getStepIndex returns the ordinal position for every step", () => {
  assert.equal(getStepIndex("tasks"), 0);
  assert.equal(getStepIndex("blocks"), 1);
  assert.equal(getStepIndex("home"), 2);
  assert.equal(getStepIndex("today"), 3);
});

test("getStepRoute maps each step to a real app route", () => {
  const steps: DailyFlowStep[] = ["tasks", "blocks", "home", "today"];
  const routes = steps.map(getStepRoute);
  assert.deepEqual(routes, ["/tasks", "/blocks", "/", "/today"]);
});

test("pageToStep recognises the four flow routes and ignores everything else", () => {
  assert.equal(pageToStep("/"), "home");
  assert.equal(pageToStep("/tasks"), "tasks");
  assert.equal(pageToStep("/tasks/new"), "tasks");
  assert.equal(pageToStep("/blocks"), "blocks");
  assert.equal(pageToStep("/today"), "today");
  assert.equal(pageToStep("/board"), null); // board is no longer a primary flow step
  assert.equal(pageToStep("/settings"), null);
});

// ---------- getNextActionHint ----------

test("getNextActionHint always points to a real flow route", () => {
  const cases: Array<{ tasks: DailyFlowTask[]; blocks: DailyFlowBlock[] }> = [
    { tasks: [task("backlog")], blocks: [] },
    { tasks: [], blocks: [block("planned")] },
    { tasks: [], blocks: [block("active")] },
    { tasks: [], blocks: [block("done")] },
  ];
  for (const { tasks, blocks } of cases) {
    const hint = getNextActionHint(deriveDailyFlow(tasks, blocks));
    assert.ok(
      ["/tasks", "/blocks", "/", "/today"].includes(hint.ctaHref),
      `hint.ctaHref should point to a flow route, got: ${hint.ctaHref}`,
    );
    assert.ok(hint.message.length > 0);
  }
});

test("tasks-step hint surfaces the number of open tasks", () => {
  const flow = deriveDailyFlow(
    [task("backlog"), task("planned"), task("in_progress")],
    [],
  );
  const hint = getNextActionHint(flow);
  assert.match(hint.message, /3 tasks/);
});

test("empty tasks-step hint nudges the user to add something", () => {
  const flow = deriveDailyFlow([], []);
  const hint = getNextActionHint(flow);
  assert.match(hint.message, /add a task/i);
});
