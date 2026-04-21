"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Task, TaskPriority } from "@/types/task";
import { NextActionBanner } from "@/components/layout/next-action-banner";
import { AutoPlanError, pickPostPlanRoute, runAutoPlan } from "@/lib/plan-client";

type FilterId = "all" | "backlog" | "planned" | "in_progress" | "done";

const filters: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "backlog", label: "Backlog" },
  { id: "planned", label: "Planned" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done" },
];

const statusMeta: Record<
  Exclude<FilterId, "all">,
  { label: string; dot: string; tone: "neutral" | "accent" | "warn" | "done" }
> = {
  backlog: { label: "Backlog", dot: "var(--text-3)", tone: "neutral" },
  planned: { label: "Planned", dot: "var(--accent)", tone: "accent" },
  in_progress: { label: "In Progress", dot: "var(--warn)", tone: "warn" },
  done: { label: "Done", dot: "var(--done)", tone: "done" },
};

const priorityMeta: Record<
  TaskPriority,
  { label: string; bg: string; fg: string }
> = {
  high: { label: "High", bg: "rgba(255, 69, 58, 0.12)", fg: "#d63a31" },
  medium: { label: "Medium", bg: "rgba(0, 122, 255, 0.12)", fg: "var(--accent)" },
  // Must not match the picker track (`var(--surface-hover)`) or "Low" looks unselected.
  low: { label: "Low", bg: "rgba(120, 120, 132, 0.22)", fg: "var(--text)" },
};

function getTaskStatus(task: Task): Exclude<FilterId, "all"> {
  if (task.status) return task.status;
  return task.completed ? "done" : "backlog";
}

function formatDueDate(value: string | null | undefined): string | null {
  if (!value) return null;
  // `value` is "YYYY-MM-DD"; render in the user's locale without shifting days.
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatEstimate(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

export default function TasksLibraryPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);

  // Quick-add form state
  const [draft, setDraft] = useState("");
  const [draftMeta, setDraftMeta] = useState("");
  const [draftPriority, setDraftPriority] = useState<TaskPriority>("medium");
  const [draftDueDate, setDraftDueDate] = useState("");
  const [draftEstimate, setDraftEstimate] = useState("");

  // Filters + UI state
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const redirectToLogin = useCallback(() => router.replace("/login"), [router]);

  const loadTasks = useCallback(async () => {
    try {
      setErrorMessage(null);
      setIsLoading(true);
      const response = await fetch("/api/tasks");
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error("Failed to load tasks.");
      const data = (await response.json()) as Task[];
      setTasks(data);
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not load tasks. Please refresh and try again.");
    } finally {
      setIsLoading(false);
    }
  }, [redirectToLogin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTasks();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTasks]);

  const counts = useMemo(() => {
    const base = { all: tasks.length, backlog: 0, planned: 0, in_progress: 0, done: 0 };
    for (const task of tasks) {
      const status = getTaskStatus(task);
      base[status] += 1;
    }
    return base;
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (activeFilter !== "all" && getTaskStatus(task) !== activeFilter) return false;
      if (!term) return true;
      return (
        task.name.toLowerCase().includes(term) ||
        (task.meta ?? "").toLowerCase().includes(term)
      );
    });
  }, [tasks, activeFilter, search]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || isSubmitting) return;
    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const estimate = draftEstimate.trim();
      const estimateValue =
        estimate === "" ? null : Number.parseInt(estimate, 10);
      if (
        estimateValue !== null &&
        (!Number.isFinite(estimateValue) || estimateValue <= 0)
      ) {
        setErrorMessage("Estimate must be a positive number of minutes.");
        setIsSubmitting(false);
        return;
      }

      const payload: Record<string, unknown> = {
        name,
        meta: draftMeta.trim(),
        status: "backlog",
        priority: draftPriority,
        dueDate: draftDueDate.trim() || null,
        estimatedMinutes: estimateValue,
      };

      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error("Create failed.");
      const created = (await response.json()) as Task;
      setTasks((prev) => [created, ...prev]);
      setDraft("");
      setDraftMeta("");
      setDraftPriority("medium");
      setDraftDueDate("");
      setDraftEstimate("");
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not create the task.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const patchTask = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      setUpdatingIds((prev) => new Set(prev).add(id));
      try {
        const response = await fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("Update failed.");
        const updated = (await response.json()) as Task;
        setTasks((prev) => prev.map((task) => (task.id === id ? updated : task)));
      } catch (error) {
        console.error(error);
        setErrorMessage("Could not update the task.");
      } finally {
        setUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [],
  );

  const handleStatusChange = (
    id: string,
    nextStatus: Exclude<FilterId, "all">,
  ) =>
    patchTask(id, {
      status: nextStatus,
      completed: nextStatus === "done",
    });

  const handlePriorityChange = (id: string, priority: TaskPriority) =>
    patchTask(id, { priority });

  const openTaskCount = useMemo(
    () => tasks.filter((t) => getTaskStatus(t) !== "done").length,
    [tasks],
  );

  const handlePlanDay = useCallback(async () => {
    if (isPlanning || openTaskCount === 0) return;
    setIsPlanning(true);
    setPlanError(null);
    setErrorMessage(null);
    try {
      const result = await runAutoPlan();
      // Sync the local task list to whatever the server persisted so the
      // UI reflects bumps like backlog → planned immediately.
      setTasks(result.tasks);
      const destination = pickPostPlanRoute(result, "/tasks");
      router.push(destination);
    } catch (error) {
      console.error("Plan my day failed", error);
      if (error instanceof AutoPlanError && error.status === 401) {
        redirectToLogin();
        return;
      }
      const message =
        error instanceof AutoPlanError
          ? error.message
          : "Could not plan your day. Please try again.";
      setPlanError(message);
    } finally {
      setIsPlanning(false);
    }
  }, [isPlanning, openTaskCount, redirectToLogin, router]);

  const handleDelete = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed.");
      setTasks((prev) => prev.filter((task) => task.id !== id));
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not delete the task.");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const bannerTitle =
    openTaskCount === 0
      ? "Add a task, then let the planner do the rest."
      : openTaskCount === 1
        ? "You have 1 task ready — plan your day."
        : `You have ${openTaskCount} tasks ready — plan your day.`;
  const bannerDescription =
    openTaskCount === 0
      ? "Dump what's on your mind into the list below. When you're ready, click Plan my day to build your schedule."
      : "Click Plan my day to auto-schedule your open tasks into focus blocks based on priority, due date, and estimated time.";

  return (
    <div className="mx-auto w-full max-w-[960px]">
      <NextActionBanner
        step={1}
        eyebrow="Step 1 · Plan"
        title={bannerTitle}
        description={bannerDescription}
        tone={openTaskCount === 0 ? "neutral" : "accent"}
        ctaLabel={isPlanning ? "Planning..." : "Plan my day"}
        onCtaClick={handlePlanDay}
        ctaDisabled={isPlanning || openTaskCount === 0}
      />
      {planError ? (
        <p
          className="mb-4 rounded-[10px] border px-4 py-2.5 text-[0.84rem]"
          style={{ borderColor: "var(--line)", background: "var(--surface-solid)", color: "var(--danger)" }}
        >
          {planError}
        </p>
      ) : null}
      <header className="anim mb-6">
        <h1 className="text-[1.85rem] font-bold leading-[1.1] tracking-[-0.03em]">
          Tasks
        </h1>
        <p className="mt-1.5 text-[0.95rem]" style={{ color: "var(--text-2)" }}>
          Dump what you need to do. The planner uses priority, due date, and
          estimated minutes to build your schedule — fill in what you know.
        </p>
      </header>

      {/* Quick-add */}
      <section
        className="anim anim-d1 mb-5 rounded-[16px] border p-4"
        style={{
          background: "var(--surface-solid)",
          borderColor: "var(--line)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <form className="flex flex-col gap-3" onSubmit={handleCreate}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a task..."
            className="h-11 rounded-[12px] border px-3.5 text-[0.92rem] outline-none transition focus:ring-4"
            style={{
              borderColor: "var(--line)",
              background: "var(--surface-hover)",
              color: "var(--text)",
            }}
          />
          <div className="grid grid-cols-[auto_auto_auto_1fr_auto] items-center gap-2.5 max-[720px]:grid-cols-2">
            <PriorityPicker value={draftPriority} onChange={setDraftPriority} />
            <label className="flex items-center gap-1.5 text-[0.78rem]" style={{ color: "var(--text-2)" }}>
              Due
              <input
                type="date"
                value={draftDueDate}
                onChange={(event) => setDraftDueDate(event.target.value)}
                className="h-9 rounded-[10px] border px-2.5 text-[0.84rem] outline-none"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--surface-hover)",
                  color: "var(--text)",
                }}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[0.78rem]" style={{ color: "var(--text-2)" }}>
              Est.
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={draftEstimate}
                onChange={(event) => setDraftEstimate(event.target.value)}
                placeholder="min"
                className="h-9 w-[88px] rounded-[10px] border px-2.5 text-[0.84rem] outline-none"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--surface-hover)",
                  color: "var(--text)",
                }}
              />
            </label>
            <input
              type="text"
              value={draftMeta}
              onChange={(event) => setDraftMeta(event.target.value)}
              placeholder="Tag / context (optional)"
              className="h-9 rounded-[10px] border px-3 text-[0.84rem] outline-none"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface-hover)",
                color: "var(--text)",
              }}
            />
            <button
              type="submit"
              disabled={!draft.trim() || isSubmitting}
              className="h-9 rounded-[10px] px-4 text-[0.88rem] font-semibold text-white transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55"
              style={{ background: "var(--accent)", boxShadow: "0 1px 2px rgba(0,122,255,0.25)" }}
            >
              {isSubmitting ? "Adding..." : "Add task"}
            </button>
          </div>
        </form>
      </section>

      {/* Filters + search */}
      <section className="anim anim-d2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {filters.map((filter) => {
            const isActive = activeFilter === filter.id;
            const count = counts[filter.id];
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setActiveFilter(filter.id)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.82rem] font-medium transition-colors"
                style={{
                  borderColor: isActive ? "var(--accent)" : "var(--line)",
                  background: isActive ? "var(--accent-soft)" : "transparent",
                  color: isActive ? "var(--accent)" : "var(--text-2)",
                }}
              >
                {filter.label}
                <span
                  className="rounded-full px-1.5 text-[0.7rem] font-semibold"
                  style={{
                    background: isActive ? "var(--accent)" : "var(--line)",
                    color: isActive ? "#fff" : "var(--text-2)",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tasks..."
          className="h-9 w-[220px] rounded-[10px] border px-3 text-[0.86rem] outline-none transition focus:ring-2 max-[480px]:w-full"
          style={{
            borderColor: "var(--line)",
            background: "var(--surface-solid)",
            color: "var(--text)",
          }}
        />
      </section>

      {errorMessage ? (
        <p
          className="mb-4 rounded-[10px] border px-4 py-2.5 text-[0.84rem]"
          style={{ borderColor: "var(--line)", background: "var(--surface-solid)", color: "var(--danger)" }}
        >
          {errorMessage}
        </p>
      ) : null}

      {/* List */}
      <section
        className="anim anim-d3 overflow-hidden rounded-[16px] border"
        style={{
          background: "var(--surface-solid)",
          borderColor: "var(--line)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((skeleton) => (
              <div
                key={skeleton}
                className="h-[58px] animate-pulse rounded-[10px]"
                style={{ background: "var(--surface-hover)" }}
              />
            ))}
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-[0.95rem] font-medium">No tasks here yet.</p>
            <p className="mt-1 text-[0.84rem]" style={{ color: "var(--text-2)" }}>
              {activeFilter === "all"
                ? "Add your first task above to get started."
                : "Try a different filter or create a new task."}
            </p>
          </div>
        ) : (
          <ul>
            {visibleTasks.map((task) => {
              const status = getTaskStatus(task);
              const statusInfo = statusMeta[status];
              const priority: TaskPriority = task.priority ?? "medium";
              const priorityInfo = priorityMeta[priority];
              const dueLabel = formatDueDate(task.dueDate);
              const estimateLabel = formatEstimate(task.estimatedMinutes);
              const isUpdating = updatingIds.has(task.id);
              const isDeleting = deletingIds.has(task.id);
              const isEditing = editingId === task.id;

              return (
                <li
                  key={task.id}
                  className="border-b last:border-b-0"
                  style={{ borderBottomColor: "var(--line)" }}
                >
                  <div className="grid grid-cols-[24px_1fr_auto_auto_auto] items-center gap-3 px-4 py-3 max-[720px]:grid-cols-[24px_1fr_auto]">
                    <button
                      type="button"
                      aria-label={`Toggle ${task.name}`}
                      onClick={() =>
                        handleStatusChange(task.id, status === "done" ? "backlog" : "done")
                      }
                      disabled={isUpdating}
                      className="grid h-[22px] w-[22px] place-items-center rounded-full border-2 transition hover:border-[var(--accent)]"
                      style={{
                        borderColor: status === "done" ? "var(--done)" : "var(--text-3)",
                        background: status === "done" ? "var(--done)" : "transparent",
                        opacity: isUpdating ? 0.5 : 1,
                      }}
                    >
                      {status === "done" ? (
                        <svg viewBox="0 0 16 16" className="h-[11px] w-[11px] fill-white">
                          <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                        </svg>
                      ) : null}
                    </button>

                    <div className="min-w-0">
                      <p
                        className="truncate text-[0.94rem] font-medium"
                        style={{
                          color: "var(--text)",
                          textDecoration: status === "done" ? "line-through" : "none",
                          opacity: status === "done" ? 0.6 : 1,
                        }}
                      >
                        {task.name}
                      </p>
                      {task.meta ? (
                        <p className="mt-0.5 truncate text-[0.78rem]" style={{ color: "var(--text-3)" }}>
                          {task.meta}
                        </p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
                          style={{ background: priorityInfo.bg, color: priorityInfo.fg }}
                        >
                          {priorityInfo.label}
                        </span>
                        {dueLabel ? (
                          <span
                            className="rounded-full border px-2 py-0.5 text-[0.7rem]"
                            style={{ borderColor: "var(--line)", color: "var(--text-2)" }}
                          >
                            Due {dueLabel}
                          </span>
                        ) : null}
                        {estimateLabel ? (
                          <span
                            className="rounded-full border px-2 py-0.5 text-[0.7rem]"
                            style={{ borderColor: "var(--line)", color: "var(--text-2)" }}
                          >
                            {estimateLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <select
                      value={status}
                      onChange={(event) =>
                        handleStatusChange(
                          task.id,
                          event.target.value as Exclude<FilterId, "all">,
                        )
                      }
                      disabled={isUpdating}
                      className="h-8 rounded-[8px] border px-2 text-[0.78rem] font-medium outline-none transition max-[720px]:hidden"
                      style={{
                        borderColor: "var(--line)",
                        background: "var(--surface-hover)",
                        color: statusInfo.dot,
                      }}
                    >
                      <option value="backlog">Backlog</option>
                      <option value="planned">Planned</option>
                      <option value="in_progress">In Progress</option>
                      <option value="done">Done</option>
                    </select>

                    <button
                      type="button"
                      aria-label={`Edit ${task.name}`}
                      aria-expanded={isEditing}
                      onClick={() => setEditingId(isEditing ? null : task.id)}
                      className="grid h-8 w-8 place-items-center rounded-[8px] border transition hover:bg-[var(--surface-hover)]"
                      style={{
                        borderColor: isEditing ? "var(--accent)" : "var(--line)",
                        color: isEditing ? "var(--accent)" : "var(--text-2)",
                      }}
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                        <path d="M12.146 0.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106L5 12.293V11.5a.5.5 0 0 0-.5-.5H4v-.5a.5.5 0 0 0-.5-.5h-.468z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      aria-label={`Delete ${task.name}`}
                      onClick={() => handleDelete(task.id)}
                      disabled={isDeleting}
                      className="grid h-8 w-8 place-items-center rounded-[8px] transition hover:bg-[var(--surface-hover)]"
                      style={{ opacity: isDeleting ? 0.45 : 1 }}
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" style={{ fill: "var(--text-2)" }}>
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                        <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H5.5l1-1h3l1 1h2.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
                      </svg>
                    </button>
                  </div>

                  {isEditing ? (
                    <EditPanel
                      task={task}
                      onClose={() => setEditingId(null)}
                      onSave={(patch) => {
                        void patchTask(task.id, patch);
                      }}
                      onPriorityChange={(next) => handlePriorityChange(task.id, next)}
                      isSaving={isUpdating}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ----- small presentational subcomponents -----

function PriorityPicker({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (next: TaskPriority) => void;
}) {
  return (
    <div
      className="inline-flex h-9 items-center rounded-[10px] border p-0.5"
      style={{ borderColor: "var(--line)", background: "var(--surface-hover)" }}
      role="radiogroup"
      aria-label="Priority"
    >
      {(Object.keys(priorityMeta) as TaskPriority[]).map((option) => {
        const isActive = value === option;
        return (
          <button
            type="button"
            key={option}
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option)}
            className="rounded-[8px] px-2.5 py-1 text-[0.78rem] font-semibold transition"
            style={{
              background: isActive ? priorityMeta[option].bg : "transparent",
              color: isActive ? priorityMeta[option].fg : "var(--text-2)",
            }}
          >
            {priorityMeta[option].label}
          </button>
        );
      })}
    </div>
  );
}

function EditPanel({
  task,
  onClose,
  onSave,
  onPriorityChange,
  isSaving,
}: {
  task: Task;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onPriorityChange: (priority: TaskPriority) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(task.name);
  const [meta, setMeta] = useState(task.meta ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [estimate, setEstimate] = useState(
    task.estimatedMinutes ? String(task.estimatedMinutes) : "",
  );
  const priority: TaskPriority = task.priority ?? "medium";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const estimateValue =
      estimate.trim() === "" ? null : Number.parseInt(estimate, 10);

    onSave({
      name: trimmedName,
      meta: meta.trim(),
      dueDate: dueDate.trim() || null,
      estimatedMinutes:
        estimateValue !== null && Number.isFinite(estimateValue) && estimateValue > 0
          ? estimateValue
          : null,
    });
    onClose();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 border-t px-4 py-3"
      style={{ borderTopColor: "var(--line)", background: "var(--surface-hover)" }}
    >
      <div className="grid grid-cols-[1fr_1fr] gap-3 max-[640px]:grid-cols-1">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Task name"
          className="h-9 rounded-[10px] border px-3 text-[0.88rem] outline-none"
          style={{
            borderColor: "var(--line)",
            background: "var(--surface-solid)",
            color: "var(--text)",
          }}
        />
        <input
          type="text"
          value={meta}
          onChange={(event) => setMeta(event.target.value)}
          placeholder="Tag / context"
          className="h-9 rounded-[10px] border px-3 text-[0.84rem] outline-none"
          style={{
            borderColor: "var(--line)",
            background: "var(--surface-solid)",
            color: "var(--text)",
          }}
        />
      </div>
      <div className="grid grid-cols-[auto_auto_auto_1fr_auto_auto] items-center gap-2.5 max-[720px]:grid-cols-2">
        <PriorityPicker value={priority} onChange={onPriorityChange} />
        <label className="flex items-center gap-1.5 text-[0.78rem]" style={{ color: "var(--text-2)" }}>
          Due
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="h-9 rounded-[10px] border px-2.5 text-[0.84rem] outline-none"
            style={{
              borderColor: "var(--line)",
              background: "var(--surface-solid)",
              color: "var(--text)",
            }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-[0.78rem]" style={{ color: "var(--text-2)" }}>
          Est.
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={estimate}
            onChange={(event) => setEstimate(event.target.value)}
            placeholder="min"
            className="h-9 w-[88px] rounded-[10px] border px-2.5 text-[0.84rem] outline-none"
            style={{
              borderColor: "var(--line)",
              background: "var(--surface-solid)",
              color: "var(--text)",
            }}
          />
        </label>
        <span />
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-[10px] border px-3 text-[0.84rem] font-medium transition"
          style={{ borderColor: "var(--line)", color: "var(--text-2)" }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving || !name.trim()}
          className="h-9 rounded-[10px] px-4 text-[0.84rem] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-55"
          style={{ background: "var(--accent)" }}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
