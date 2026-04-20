import test from "node:test";
import assert from "node:assert/strict";
import {
  DailyFlowBlock,
  DailyFlowTask,
  deriveDailyFlow,
  getNextActionHint,
  getStepRoute,
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

test("derives step=board when nothing is picked for today", () => {
  const flow = deriveDailyFlow([task("backlog"), task("backlog")], []);
  assert.equal(flow.step, "board");
  assert.equal(flow.hasStarted, false);
  assert.equal(flow.counts.pickedForToday, 0);
});

test("derives step=blocks when tasks planned but none committed", () => {
  const flow = deriveDailyFlow(
    [task("planned"), task("planned"), task("backlog")],
    [],
  );
  assert.equal(flow.step, "blocks");
  assert.equal(flow.hasStarted, true);
  assert.equal(flow.counts.pickedForToday, 2);
  assert.equal(flow.counts.committed, 0);
});

test("derives step=home when committed but not all done", () => {
  const flow = deriveDailyFlow(
    [
      task("planned", { studyBlockId: "b1" }),
      task("done", { studyBlockId: "b1" }),
    ],
    [block("active", "b1")],
  );
  assert.equal(flow.step, "home");
  assert.equal(flow.counts.done, 1);
  assert.equal(flow.counts.committed, 2);
  assert.equal(flow.counts.activeBlocks, 1);
});

test("derives step=today when all committed tasks are done", () => {
  const flow = deriveDailyFlow(
    [
      task("done", { studyBlockId: "b1" }),
      task("done", { studyBlockId: "b1" }),
    ],
    [block("done", "b1")],
  );
  assert.equal(flow.step, "today");
});

test("getStepRoute returns a valid path for every step", () => {
  const paths = ["board", "blocks", "home", "today"].map((s) =>
    getStepRoute(s as DailyFlowTask["status"] & "board"),
  );
  assert.deepEqual(paths, ["/board", "/blocks", "/", "/today"]);
});

test("getNextActionHint never routes the user off-flow", () => {
  const flow = deriveDailyFlow(
    [task("planned", { studyBlockId: "b1" })],
    [block("planned", "b1")],
  );
  const hint = getNextActionHint(flow);
  assert.ok(
    ["/board", "/blocks", "/", "/today"].includes(hint.ctaHref),
    `hint.ctaHref should point to a flow route, got: ${hint.ctaHref}`,
  );
  assert.ok(hint.message.length > 0);
});

test("picked-task count excludes backlog", () => {
  const flow = deriveDailyFlow(
    [
      task("backlog"),
      task("planned"),
      task("in_progress"),
      task("done"),
    ],
    [],
  );
  assert.equal(flow.counts.backlog, 1);
  assert.equal(flow.counts.pickedForToday, 3);
  assert.equal(flow.counts.inProgress, 1);
  assert.equal(flow.counts.done, 1);
});
