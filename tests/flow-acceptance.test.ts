import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..");

function read(rel: string) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/**
 * Lightweight static UX guards:
 *  - FlowStrip must NOT render an inline CTA link to the recommended step —
 *    that role belongs to the page-level NextActionBanner.
 *  - Each flow page should render at most ONE NextActionBanner at a time.
 *  - The app shell's "Start/Continue Day" button must route via the
 *    computed daily-flow step (getStepRoute), not hard-coded to /board.
 */

test("flow strip is orientation-only (no CTA button)", () => {
  const source = read("components/layout/flow-strip.tsx");
  assert.ok(
    !/href=\{hint\.ctaHref\}/.test(source),
    "flow-strip.tsx should not render a Link to hint.ctaHref",
  );
  assert.ok(
    !/\{hint\.ctaLabel\}/.test(source),
    "flow-strip.tsx should not render hint.ctaLabel as a button",
  );
});

test("app shell routes Start/Continue CTA to the computed step", () => {
  const source = read("components/layout/app-shell.tsx");
  assert.ok(
    /getStepRoute\(flow\.step\)/.test(source),
    "app-shell.tsx must derive the CTA href from getStepRoute(flow.step)",
  );
});

test("each flow page imports exactly one NextActionBanner source", () => {
  const pages = [
    "app/tasks/page.tsx",
    "app/blocks/page.tsx",
    "app/page.tsx",
    "app/today/page.tsx",
    // Board is no longer in the primary nav but keeps the banner so URL visitors
    // still get guided back to Tasks.
    "app/board/page.tsx",
  ];
  for (const page of pages) {
    const source = read(page);
    const imports = source.match(/from "@\/components\/layout\/next-action-banner"/g) ?? [];
    assert.equal(
      imports.length,
      1,
      `${page} must import NextActionBanner exactly once`,
    );
  }
});

test("home does not render a second 'Open focus mode' link/button next to the banner", () => {
  const source = read("app/page.tsx");
  const jsxChildMatches = source.match(/>\s*Open focus mode\s*</g) ?? [];
  assert.equal(
    jsxChildMatches.length,
    0,
    "home should let the NextActionBanner provide the 'Open focus mode' CTA, not a separate <Link>/<button>",
  );
});

test("blocks active card has exactly one primary 'Open focus mode' action", () => {
  const source = read("app/blocks/page.tsx");
  const jsxChildMatches = source.match(/>\s*Open focus mode\s*</g) ?? [];
  assert.equal(
    jsxChildMatches.length,
    1,
    "the active block card should expose one primary 'Open focus mode' CTA, not multiple",
  );
});

test("reflect page does not render a duplicate Start Day button", () => {
  const source = read("app/today/page.tsx");
  assert.ok(
    !/Start Day →/.test(source),
    "today/page.tsx should not duplicate the Start Day CTA from the banner",
  );
});

// ---------- Stage 5: dump-and-go acceptance ----------

test("tasks page exposes a single 'Plan my day' primary CTA via the banner", () => {
  const source = read("app/tasks/page.tsx");
  // Button label comes from the banner's ctaLabel, wired to handlePlanDay.
  assert.ok(
    /ctaLabel=\{[^}]*"Plan my day"/.test(source),
    "tasks page should label its primary CTA 'Plan my day'",
  );
  assert.ok(
    /onCtaClick=\{handlePlanDay\}/.test(source),
    "tasks page should wire the banner CTA to handlePlanDay",
  );
  // And we should only mention "Plan my day" once as a label (planning spinner text stays distinct).
  const planMyDayMatches = source.match(/"Plan my day"/g) ?? [];
  assert.equal(
    planMyDayMatches.length,
    1,
    "tasks page should reference the literal 'Plan my day' label exactly once",
  );
});

test("tasks page wires the banner CTA through the shared plan-client helper", () => {
  const source = read("app/tasks/page.tsx");
  assert.ok(
    /from "@\/lib\/plan-client"/.test(source),
    "tasks page should import runAutoPlan from lib/plan-client (shared client wrapper)",
  );
  assert.ok(
    /\brunAutoPlan\s*\(/.test(source),
    "tasks page should invoke runAutoPlan()",
  );
});

test("blocks page no longer renders the manual 'Add new block' UI", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    !/Add new block/.test(source),
    "blocks page must not render the old 'Add new block' CTA in the dump-and-go flow",
  );
  assert.ok(
    !/Create block/.test(source),
    "blocks page must not render the 'Create block' submit button",
  );
  assert.ok(
    !/handleCreateBlock/.test(source),
    "blocks page must not keep the handleCreateBlock handler",
  );
});

test("blocks page no longer renders the manual task-to-block assignment panel", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    !/Save assignments/.test(source),
    "blocks page must not render the 'Save assignments' panel",
  );
  assert.ok(
    !/openAssignPanel|handleSaveAssignments/.test(source),
    "blocks page must not keep assignment handlers",
  );
});

test("blocks page exposes Re-plan and Skip-this-block actions", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    />\s*(Re-plan|Re-planning\.\.\.)\s*</.test(source) || /"Re-plan"|"Re-planning\.\.\."/.test(source),
    "blocks page should expose a visible Re-plan control",
  );
  assert.ok(
    /handleReplan/.test(source),
    "blocks page should route the Re-plan action through handleReplan",
  );
  assert.ok(
    /Skip this block/.test(source),
    "blocks page should expose a 'Skip this block' action per block",
  );
  assert.ok(
    /handleSkipBlock/.test(source),
    "blocks page should route Skip through handleSkipBlock",
  );
});

test("blocks page empty state surfaces 'Plan my day' as its primary CTA", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    /No schedule for this day yet/.test(source),
    "blocks page empty state should clearly communicate no schedule exists yet",
  );
  assert.ok(
    /"Plan my day"|>\s*Plan my day\s*</.test(source),
    "blocks page empty state should offer 'Plan my day' as the primary CTA",
  );
});

test("blocks page surfaces the planner's placement reason for each block", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    /block\.reason/.test(source),
    "blocks page should render block.reason so users see why a block was scheduled",
  );
});

test("board page is demoted to an optional view (no 'New Task' header button)", () => {
  const source = read("app/board/page.tsx");
  assert.ok(
    !/>\s*New Task\s*</.test(source),
    "board page should no longer surface the 'New Task' primary button in its header",
  );
  assert.ok(
    /Optional view|Optional · Manual/i.test(source),
    "board page should signal that it's no longer part of the guided flow",
  );
  assert.ok(
    /ctaHref="\/tasks"/.test(source),
    "board page should nudge visitors back to /tasks where planning lives",
  );
});

test("plan-client exposes runAutoPlan with retry-safe semantics", () => {
  const source = read("lib/plan-client.ts");
  assert.ok(
    /export async function runAutoPlan/.test(source),
    "plan-client.ts must export runAutoPlan()",
  );
  assert.ok(
    /class AutoPlanError/.test(source),
    "plan-client.ts must export an AutoPlanError type so callers can branch on status",
  );
  assert.ok(
    /POST.*\/api\/plan|url: "\/api\/plan"|"\/api\/plan"/.test(source),
    "plan-client.ts must point runAutoPlan at POST /api/plan",
  );
});
