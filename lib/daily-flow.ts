/**
 * Daily-flow derivation
 *
 * Given today's tasks + blocks, compute which of the 4 guided steps the user
 * should be on:
 *
 *   1. Plan    (board)   — backlog has tasks, none planned yet
 *   2. Commit  (blocks)  — planned tasks exist, none assigned to a block
 *   3. Execute (home)    — committed tasks exist, not all done yet
 *   4. Reflect (today)   — all committed tasks are done
 *
 * Used by:
 *   - components/layout/flow-strip.tsx (the persistent stepper)
 *   - components/layout/app-shell.tsx  (Continue Day badge)
 *   - per-page next-action banners
 */

export type DailyFlowStep = "board" | "blocks" | "home" | "today";

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
    backlog: number;
    planned: number;
    committed: number;
    inProgress: number;
    done: number;
    blocks: number;
    activeBlocks: number;
  };
};

const STEP_LABELS: Record<DailyFlowStep, { num: number; name: string; verb: string }> = {
  board: { num: 1, name: "Plan", verb: "Plan" },
  blocks: { num: 2, name: "Commit", verb: "Commit" },
  home: { num: 3, name: "Execute", verb: "Execute" },
  today: { num: 4, name: "Reflect", verb: "Reflect" },
};

const STEP_ORDER: DailyFlowStep[] = ["board", "blocks", "home", "today"];

export function deriveDailyFlow(
  tasks: DailyFlowTask[],
  blocks: DailyFlowBlock[],
): DailyFlow {
  const backlog = tasks.filter((t) => t.status === "backlog").length;
  const planned = tasks.filter((t) =>
    ["planned", "in_progress", "done"].includes(t.status),
  ).length;
  const committed = tasks.filter((t) => t.studyBlockId !== null).length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const activeBlocks = blocks.filter((b) => b.status === "active").length;

  let step: DailyFlowStep;
  if (planned === 0) step = "board";
  else if (committed === 0) step = "blocks";
  else if (done < committed) step = "home";
  else step = "today";

  return {
    step,
    hasStarted: planned > 0,
    counts: {
      backlog,
      planned,
      committed,
      inProgress,
      done,
      blocks: blocks.length,
      activeBlocks,
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
    case "board":
      return "/board";
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
  if (pathname.startsWith("/board")) return "board";
  if (pathname.startsWith("/blocks")) return "blocks";
  if (pathname.startsWith("/today")) return "today";
  return null;
}

/**
 * Contextual "Next:" sentence shown in the flow strip.
 * Tense matches the current step so the user always knows what to do next.
 */
export function getNextActionHint(flow: DailyFlow): {
  message: string;
  ctaLabel: string;
  ctaHref: string;
} {
  switch (flow.step) {
    case "board":
      return {
        message: "Pick the few tasks that matter today.",
        ctaLabel: "Open Board",
        ctaHref: "/board",
      };
    case "blocks": {
      const n = flow.counts.planned;
      return {
        message: `Assign your ${n} planned task${n === 1 ? "" : "s"} to a time block.`,
        ctaLabel: "Open Blocks",
        ctaHref: "/blocks",
      };
    }
    case "home":
      return {
        message: flow.counts.activeBlocks > 0
          ? "Open focus mode and start the timer."
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
