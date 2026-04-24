/**
 * Daily-flow derivation (Stage-5 auto-planner flow)
 *
 * Given today's tasks + today's blocks, compute which of the 4 guided steps
 * the user should be on. This maps to the "dump-and-go" UX — the user
 * dumps tasks, clicks Plan my day, then executes.
 *
 *   1. Plan     (tasks)   — there are tasks to do, but no blocks exist
 *                           for today yet → click "Plan my day".
 *   2. Schedule (blocks)  — blocks exist, but none have been started yet →
 *                           review the generated schedule and start it.
 *   3. Focus    (home)    — an active block is running (or the first
 *                           planned block is ready to start).
 *   4. Reflect  (today)   — all blocks are done, time to recap.
 *
 * Used by:
 *   - components/layout/flow-strip.tsx (the persistent stepper)
 *   - components/layout/app-shell.tsx  ("Start Day" / "Continue Day" CTA)
 *   - per-page NextActionBanners
 */

export type DailyFlowStep = "tasks" | "blocks" | "home" | "today";

export type DailyFlowTask = {
  id: string;
  status: "backlog" | "planned" | "in_progress" | "done";
  studyBlockId: string | null;
};

export type DailyFlowBlock = {
  id: string;
  status: "planned" | "active" | "done";
};

export type DailyFlow = {
  step: DailyFlowStep;
  hasStarted: boolean;
  counts: {
    /** Tasks not yet done (i.e. candidates for the planner). */
    openTasks: number;
    /** Total blocks scheduled for today. */
    blocks: number;
    /** Blocks not yet started. */
    plannedBlocks: number;
    /** Blocks currently active. */
    activeBlocks: number;
    /** Blocks finished. */
    doneBlocks: number;
    /** Tasks marked in_progress (convenience signal for UI warnings). */
    inProgressTasks: number;
    /** Tasks marked done (for the Reflect page). */
    doneTasks: number;
  };
};

const STEP_LABELS: Record<DailyFlowStep, { num: number; name: string; verb: string }> = {
  tasks: { num: 1, name: "Plan", verb: "Plan" },
  blocks: { num: 2, name: "Schedule", verb: "Schedule" },
  home: { num: 3, name: "Focus", verb: "Focus" },
  today: { num: 4, name: "Reflect", verb: "Reflect" },
};

const STEP_ORDER: DailyFlowStep[] = ["tasks", "blocks", "home", "today"];

/**
 * Derive the current step from today's tasks and blocks.
 *
 * Rules (checked in this order):
 *   - Active block exists                         → home
 *   - Blocks exist and all are done               → today
 *   - Blocks exist (but not all done, none active)→ blocks
 *   - No blocks, open tasks exist                 → tasks
 *   - Nothing at all                              → tasks (empty-slate entry)
 */
export function deriveDailyFlow(
  tasks: DailyFlowTask[],
  blocks: DailyFlowBlock[],
): DailyFlow {
  const openTasks = tasks.filter((t) => t.status !== "done").length;
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress").length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;

  const totalBlocks = blocks.length;
  const plannedBlocks = blocks.filter((b) => b.status === "planned").length;
  const activeBlocks = blocks.filter((b) => b.status === "active").length;
  const doneBlocks = blocks.filter((b) => b.status === "done").length;

  let step: DailyFlowStep;
  if (activeBlocks > 0) {
    step = "home";
  } else if (totalBlocks > 0 && doneBlocks === totalBlocks) {
    step = "today";
  } else if (totalBlocks > 0) {
    step = "blocks";
  } else {
    step = "tasks";
  }

  return {
    step,
    // "Started" = the user has moved past the dump-and-plan stage.
    hasStarted: totalBlocks > 0,
    counts: {
      openTasks,
      blocks: totalBlocks,
      plannedBlocks,
      activeBlocks,
      doneBlocks,
      inProgressTasks,
      doneTasks,
    },
  };
}

export function getStepLabel(step: DailyFlowStep) {
  return STEP_LABELS[step];
}

export function getStepOrder() {
  return STEP_ORDER;
}

export function getStepIndex(step: DailyFlowStep) {
  return STEP_ORDER.indexOf(step);
}

export function getStepRoute(step: DailyFlowStep): string {
  switch (step) {
    case "tasks":
      return "/tasks";
    case "blocks":
      return "/blocks";
    case "home":
      return "/";
    case "today":
      return "/today";
  }
}

export function pageToStep(pathname: string): DailyFlowStep | null {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/blocks")) return "blocks";
  if (pathname.startsWith("/today")) return "today";
  return null;
}

/**
 * Contextual "Next:" sentence shown in the flow strip.
 * The strip is orientation-only — the primary CTA lives in each page's
 * NextActionBanner so we never have two competing "do this" buttons.
 */
export function getNextActionHint(flow: DailyFlow): {
  message: string;
  ctaLabel: string;
  ctaHref: string;
} {
  switch (flow.step) {
    case "tasks": {
      const n = flow.counts.openTasks;
      return {
        message:
          n === 0
            ? "Add a task, then plan your day."
            : `Click Plan my day to schedule your ${n} task${n === 1 ? "" : "s"}.`,
        ctaLabel: "Open Tasks",
        ctaHref: "/tasks",
      };
    }
    case "blocks": {
      const n = flow.counts.plannedBlocks;
      return {
        message: `Start your first of ${n} planned block${n === 1 ? "" : "s"}.`,
        ctaLabel: "Open Blocks",
        ctaHref: "/blocks",
      };
    }
    case "home":
      return {
        message:
          flow.counts.activeBlocks > 0
            ? "A block is running — open focus mode."
            : "Start your focus block.",
        ctaLabel: "Go to Home",
        ctaHref: "/",
      };
    case "today":
      return {
        message: "Reflect, then plan tomorrow.",
        ctaLabel: "Open Reflection",
        ctaHref: "/today",
      };
  }
}
