import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TASK_PRIORITY,
  dueDateToDayKey,
  isTaskPriority,
  normalizeTaskFields,
  parseDueDate,
  parseEstimatedMinutes,
  parseTaskPriority,
} from "../lib/task-fields";

// ---------- priority ----------

test("isTaskPriority accepts the three valid values and rejects the rest", () => {
  assert.equal(isTaskPriority("low"), true);
  assert.equal(isTaskPriority("medium"), true);
  assert.equal(isTaskPriority("high"), true);
  assert.equal(isTaskPriority("urgent"), false);
  assert.equal(isTaskPriority(""), false);
  assert.equal(isTaskPriority(null), false);
  assert.equal(isTaskPriority(2), false);
});

test("parseTaskPriority returns undefined for unknown values so routes can ignore", () => {
  assert.equal(parseTaskPriority("high"), "high");
  assert.equal(parseTaskPriority("nope"), undefined);
  assert.equal(parseTaskPriority(undefined), undefined);
  assert.equal(parseTaskPriority(null), undefined);
});

// ---------- due date ----------

test("parseDueDate: null and empty string clear the due date", () => {
  assert.equal(parseDueDate(null), null);
  assert.equal(parseDueDate(""), null);
  assert.equal(parseDueDate("   "), null);
});

test("parseDueDate: YYYY-MM-DD becomes a UTC midnight Date", () => {
  const result = parseDueDate("2026-04-25");
  assert.ok(result instanceof Date);
  assert.equal((result as Date).toISOString(), "2026-04-25T00:00:00.000Z");
});

test("parseDueDate: full ISO strings round-trip", () => {
  const result = parseDueDate("2026-04-25T18:30:00.000Z");
  assert.ok(result instanceof Date);
  assert.equal((result as Date).toISOString(), "2026-04-25T18:30:00.000Z");
});

test("parseDueDate: non-strings and garbage return undefined", () => {
  assert.equal(parseDueDate("not a date"), undefined);
  assert.equal(parseDueDate(42), undefined);
  assert.equal(parseDueDate({}), undefined);
});

// ---------- estimate ----------

test("parseEstimatedMinutes: positive integers and floats round to minutes", () => {
  assert.equal(parseEstimatedMinutes(60), 60);
  assert.equal(parseEstimatedMinutes(45.4), 45);
  assert.equal(parseEstimatedMinutes(45.6), 46);
});

test("parseEstimatedMinutes: null clears, 0/negative/NaN/string return undefined", () => {
  assert.equal(parseEstimatedMinutes(null), null);
  assert.equal(parseEstimatedMinutes(0), undefined);
  assert.equal(parseEstimatedMinutes(-10), undefined);
  assert.equal(parseEstimatedMinutes(Number.NaN), undefined);
  assert.equal(parseEstimatedMinutes("30"), undefined);
});

// ---------- dueDateToDayKey ----------

test("dueDateToDayKey handles Date, YYYY-MM-DD, full ISO, null", () => {
  assert.equal(
    dueDateToDayKey(new Date("2026-04-25T00:00:00.000Z")),
    "2026-04-25",
  );
  assert.equal(dueDateToDayKey("2026-04-25"), "2026-04-25");
  assert.equal(
    dueDateToDayKey("2026-04-25T18:30:00.000Z"),
    "2026-04-25",
  );
  assert.equal(dueDateToDayKey(null), null);
  assert.equal(dueDateToDayKey(undefined), null);
  assert.equal(dueDateToDayKey("garbage"), null);
});

// ---------- normalizeTaskFields ----------

test("normalizeTaskFields fills safe defaults when fields are missing", () => {
  assert.deepEqual(normalizeTaskFields({}), {
    priority: DEFAULT_TASK_PRIORITY,
    dueDate: null,
    estimatedMinutes: null,
  });
});

test("normalizeTaskFields preserves valid values", () => {
  assert.deepEqual(
    normalizeTaskFields({
      priority: "high",
      dueDate: new Date("2026-04-25T00:00:00.000Z"),
      estimatedMinutes: 90,
    }),
    {
      priority: "high",
      dueDate: "2026-04-25",
      estimatedMinutes: 90,
    },
  );
});

test("normalizeTaskFields coerces invalid priority to default", () => {
  assert.equal(normalizeTaskFields({ priority: "urgent" }).priority, "medium");
});

test("normalizeTaskFields rejects zero / negative / NaN estimates", () => {
  assert.equal(normalizeTaskFields({ estimatedMinutes: 0 }).estimatedMinutes, null);
  assert.equal(normalizeTaskFields({ estimatedMinutes: -5 }).estimatedMinutes, null);
  assert.equal(
    normalizeTaskFields({ estimatedMinutes: Number.NaN }).estimatedMinutes,
    null,
  );
});
