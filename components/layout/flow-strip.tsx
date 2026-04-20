"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DailyFlow,
  DailyFlowStep,
  getNextActionHint,
  getStepIndex,
  getStepLabel,
  getStepOrder,
  getStepRoute,
  pageToStep,
} from "@/lib/daily-flow";

const FLOW_PAGES = new Set<DailyFlowStep>(["board", "blocks", "home", "today"]);

type FlowStripProps = {
  /**
   * Force-show even when the flow hasn't started.
   * Useful for /board (Step 1) where the strip should appear before any planning.
   */
  alwaysShow?: boolean;
};

/**
 * Sticky stepper + next-action hint that sits below the main nav.
 *
 * Visibility rules:
 *   - On /board, /blocks, /today              → always visible (you're inside the flow)
 *   - On /                                    → visible only when the user has started
 *                                              (i.e. has at least one planned task)
 *   - On any other route (e.g. /tasks/login)  → hidden
 */
export function FlowStrip({ alwaysShow = false }: FlowStripProps) {
  const pathname = usePathname();
  const currentStepFromPath = pageToStep(pathname);
  const [flow, setFlow] = useState<DailyFlow | null>(null);

  useEffect(() => {
    if (!currentStepFromPath) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/daily-flow");
        if (!response.ok) return;
        const data = (await response.json()) as DailyFlow;
        if (!cancelled) setFlow(data);
      } catch {
        // silent — strip just won't render dynamic state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStepFromPath, pathname]);

  if (!currentStepFromPath || !FLOW_PAGES.has(currentStepFromPath)) {
    return null;
  }

  // On Home, only show once the user has actually started a day.
  const hasStarted = flow?.hasStarted ?? false;
  if (currentStepFromPath === "home" && !alwaysShow && !hasStarted) {
    return null;
  }

  // Use the path-derived step for highlight (where the user IS),
  // and the data-derived step for the next-action hint (where they SHOULD go).
  const highlightStep = currentStepFromPath;
  const recommendedStep = flow?.step ?? currentStepFromPath;
  const hint = flow ? getNextActionHint(flow) : null;
  const order = getStepOrder();
  const highlightIndex = getStepIndex(highlightStep);
  const recommendedIndex = getStepIndex(recommendedStep);

  return (
    <div
      className="sticky top-14 z-40 border-b backdrop-blur-xl"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
      }}
    >
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-6 py-2.5">
        {/* Stepper */}
        <ol className="flex flex-wrap items-center gap-1">
          {order.map((step, index) => {
            const meta = getStepLabel(step);
            const isActive = index === highlightIndex;
            const isComplete = index < recommendedIndex;
            const isUpcoming = index > highlightIndex && !isComplete;
            const route = getStepRoute(step);

            return (
              <li key={step} className="flex items-center">
                <Link
                  href={route}
                  className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[0.78rem] font-medium transition-colors"
                  style={{
                    color: isActive
                      ? "var(--accent)"
                      : isComplete
                        ? "var(--done)"
                        : "var(--text-2)",
                    background: isActive ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <span
                    className="grid h-[18px] w-[18px] place-items-center rounded-full text-[0.66rem] font-bold"
                    style={{
                      background: isActive
                        ? "var(--accent)"
                        : isComplete
                          ? "var(--done)"
                          : "var(--line-strong)",
                      color: isActive || isComplete ? "#fff" : "var(--text-2)",
                    }}
                  >
                    {isComplete ? "✓" : meta.num}
                  </span>
                  <span className={isUpcoming ? "opacity-80" : ""}>{meta.name}</span>
                </Link>
                {index < order.length - 1 ? (
                  <span
                    aria-hidden
                    className="mx-1 inline-block h-px w-4"
                    style={{
                      background:
                        index < recommendedIndex ? "var(--done)" : "var(--line-strong)",
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* Next-action hint */}
        {hint ? (
          <div className="flex items-center gap-2.5 text-[0.8rem]" style={{ color: "var(--text-2)" }}>
            <span className="font-semibold" style={{ color: "var(--text)" }}>
              Next:
            </span>
            <span>{hint.message}</span>
            {hint.ctaHref !== pathname ? (
              <Link
                href={hint.ctaHref}
                className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1 text-[0.78rem] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
                style={{ background: "var(--accent)" }}
              >
                {hint.ctaLabel}
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
