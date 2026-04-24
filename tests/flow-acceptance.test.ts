import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..");

function read(rel: string) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/**
 * Lightweight static UX guards for the state-based daily-assistant model.
 *
 * Notes on what changed since the guided-flow era:
 *   - The sticky 4-step "Plan / Schedule / Focus / Reflect" stepper
 *     (FlowStrip) is gone; the app no longer narrates a forced sequence.
 *   - The "Continue Day · Step N" CTA pill in the global nav is gone;
 *     "Today" is now a plain primary nav link.
 *   - The Study Blocks page no longer renders a NextActionBanner; its
 *     own hero card answers "what's next?" without step-language.
 *   - Planner-behavior guards (Re-plan, Skip-this-block, no manual block
 *     creation, planner reasons surfaced, Plan-my-day flow) are kept.
 */

// ---------- Stepper / shell removal ----------

test("flow-strip stepper component has been removed", () => {
  assert.equal(
    existsSync(join(repoRoot, "components/layout/flow-strip.tsx")),
    false,
    "components/layout/flow-strip.tsx should no longer exist — the app dropped the staged flow indicator",
  );
});

test("app shell no longer mounts FlowStrip", () => {
  const source = read("components/layout/app-shell.tsx");
  assert.ok(
    !/FlowStrip/.test(source),
    "app-shell.tsx must not import or render FlowStrip",
  );
});

test("app shell no longer surfaces a 'Continue Day · Step N' pill", () => {
  const source = read("components/layout/app-shell.tsx");
  assert.ok(
    !/Continue Day/.test(source),
    "app-shell.tsx must not render a 'Continue Day' badge",
  );
  assert.ok(
    !/getStepRoute|getStepLabel/.test(source),
    "app-shell.tsx must not reuse the old step-routing helpers in chrome",
  );
});

test("app shell exposes a plain 'Today' primary nav link to /blocks", () => {
  const source = read("components/layout/app-shell.tsx");
  assert.ok(
    /label="Today"/.test(source),
    "app-shell.tsx should label the day-execution link 'Today'",
  );
  assert.ok(
    /href="\/blocks"/.test(source),
    "app-shell.tsx should route the 'Today' link to /blocks",
  );
});

// ---------- Today (Study Blocks) page is no longer step-themed ----------

test("today (blocks) page no longer uses NextActionBanner or step language", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    !/NextActionBanner/.test(source),
    "app/blocks/page.tsx must not render a NextActionBanner — the page header + hero card own the narrative",
  );
  assert.ok(
    !/Step\s*\d/.test(source),
    "app/blocks/page.tsx must not contain 'Step N' copy",
  );
  assert.ok(
    !/Schedule phase|Schedule · Running|Schedule · Complete/.test(source),
    "app/blocks/page.tsx must not contain wizard-era schedule-phase copy",
  );
});

test("today (blocks) page frames itself as 'Your day', not 'Study Blocks'", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    /"Your day"|"Your plan"/.test(source),
    "app/blocks/page.tsx should use the calmer 'Your day' / 'Your plan' framing in its h1",
  );
  assert.ok(
    !/>\s*Study Blocks\s*</.test(source),
    "app/blocks/page.tsx should no longer render the 'Study Blocks' heading on the page itself",
  );
});

test("today (blocks) page exposes one clear primary CTA per state", () => {
  const source = read("app/blocks/page.tsx");
  // Active state → exactly one "Open focus mode" CTA.
  const openFocusMatches = source.match(/>\s*Open focus mode\s*</g) ?? [];
  assert.equal(
    openFocusMatches.length,
    1,
    "the active block hero should expose exactly one 'Open focus mode' CTA",
  );
  // Planned state → exactly one "Start block" CTA.
  const startBlockMatches = source.match(/>\s*Start block\s*</g) ?? [];
  assert.equal(
    startBlockMatches.length,
    1,
    "the next-block hero should expose exactly one 'Start block' CTA",
  );
});

test("today (blocks) page demotes Re-plan and Skip rather than leading with them", () => {
  const source = read("app/blocks/page.tsx");
  // Re-plan still exists, but as quieter copy ("Adjust plan") in the footer.
  assert.ok(
    /Adjust plan/.test(source),
    "Re-plan should appear as an 'Adjust plan' affordance, not a top-of-page button",
  );
  assert.ok(
    /handleReplan/.test(source),
    "Re-plan handler must still exist for the demoted control",
  );
  // Per-block skip should still be wired up.
  assert.ok(
    /handleSkipBlock/.test(source),
    "Skip-this-block handler must still be wired up",
  );
  assert.ok(
    /Skip for now|>\s*Skip\s*</.test(source),
    "Skip control should be present (as 'Skip for now' on the hero or 'Skip' on rows)",
  );
});

test("today (blocks) page empty state surfaces 'Plan my day' as its primary CTA", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    /Nothing planned yet|No schedule for this day yet/.test(source),
    "today page empty state should clearly communicate no schedule exists yet",
  );
  assert.ok(
    /"Plan my day"|>\s*Plan my day\s*</.test(source),
    "today page empty state should offer 'Plan my day' as the primary CTA",
  );
});

test("today (blocks) page surfaces the planner's placement reason for the next block", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    /block\.reason/.test(source),
    "today page should render block.reason so users see why a block was scheduled",
  );
});

// ---------- Planner-behavior guards (preserved from prior stage) ----------

test("today (blocks) page does not regress to the legacy 'Add new block' / 'Create block' CTAs", () => {
  // The dump-and-go flow removed those specific labels. The current
  // calendar-driven Add Block UX uses different language ("Add a block",
  // "Add block") and a popover form, so the legacy strings must stay gone.
  const source = read("app/blocks/page.tsx");
  assert.ok(
    !/Add new block/.test(source),
    "today page must not render the old 'Add new block' CTA",
  );
  assert.ok(
    !/Create block/.test(source),
    "today page must not render the 'Create block' submit button",
  );
});

test("today (blocks) page no longer renders the manual task-to-block assignment panel", () => {
  const source = read("app/blocks/page.tsx");
  assert.ok(
    !/Save assignments/.test(source),
    "today page must not render the 'Save assignments' panel",
  );
  assert.ok(
    !/openAssignPanel|handleSaveAssignments/.test(source),
    "today page must not keep assignment handlers",
  );
});

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

test("home does not render a second 'Open focus mode' link/button next to the banner", () => {
  const source = read("app/page.tsx");
  const jsxChildMatches = source.match(/>\s*Open focus mode\s*</g) ?? [];
  assert.equal(
    jsxChildMatches.length,
    0,
    "home should let the NextActionBanner provide the 'Open focus mode' CTA, not a separate <Link>/<button>",
  );
});

test("reflect page does not render a duplicate Start Day button", () => {
  const source = read("app/today/page.tsx");
  assert.ok(
    !/Start Day →/.test(source),
    "today/page.tsx should not duplicate a Start Day CTA",
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
