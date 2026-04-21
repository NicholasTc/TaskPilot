/**
 * Thin, typed client wrapper around `POST /api/plan`.
 *
 * All UI that triggers the auto-planner (Tasks page "Plan my day" button,
 * Blocks page "Re-plan" header button, per-block "Skip this block" action)
 * routes through `runAutoPlan()` so retry/error semantics stay consistent.
 *
 * Intentionally framework-free: no React, no Next.js helpers — just fetch.
 */

import type { PlanResult, PlannerSettings } from "@/planner";
import type { Task } from "@/types/task";

export type RunAutoPlanOptions = {
  /** Partial settings overrides — leave empty for the DEFAULT_PLANNER_SETTINGS. */
  settings?: Partial<PlannerSettings>;
  /** "YYYY-MM-DD" override for testing. Omit to use the server's local today. */
  today?: string;
  /** AbortSignal for cancelable requests (e.g. on unmount). */
  signal?: AbortSignal;
};

export type RunAutoPlanResponse = {
  today: string;
  planningHorizonEnd: string;
  settings: PlannerSettings;
  plan: PlanResult;
  tasks: Task[];
  deletedBlockIds: string[];
  insertedBlockIds: string[];
  lockedBlockIds: string[];
};

export class AutoPlanError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AutoPlanError";
    this.status = status;
  }
}

/**
 * Runs the auto-planner end-to-end. Returns the full plan result with
 * real DB block ids plus the refreshed task list.
 *
 * Throws `AutoPlanError` on non-2xx responses; callers catch and surface
 * the message to the user.
 */
export async function runAutoPlan(
  options: RunAutoPlanOptions = {},
): Promise<RunAutoPlanResponse> {
  const { settings, today, signal } = options;
  const body: Record<string, unknown> = {};
  if (settings) body.settings = settings;
  if (today) body.today = today;

  const response = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let message = "Could not run the planner.";
    try {
      const data = (await response.json()) as { error?: string };
      if (data && typeof data.error === "string") message = data.error;
    } catch {
      // ignore — keep default message
    }
    throw new AutoPlanError(message, response.status);
  }

  return (await response.json()) as RunAutoPlanResponse;
}

/**
 * Choose the best post-plan destination for the "Plan my day" flow.
 *
 * Rules:
 *   - If today has any new or already-started blocks → go to /blocks
 *     so the user sees the schedule.
 *   - If absolutely nothing got scheduled (e.g. all tasks are already done
 *     or outside the horizon) → stay on the origin page so the user can
 *     add tasks or adjust settings.
 */
export function pickPostPlanRoute(
  response: RunAutoPlanResponse,
  fallback = "/tasks",
): string {
  const hasBlocksToday = response.plan.blocks.some(
    (b) => b.date === response.today,
  );
  if (hasBlocksToday) return "/blocks";
  if (response.plan.blocks.length > 0) return "/blocks";
  return fallback;
}
