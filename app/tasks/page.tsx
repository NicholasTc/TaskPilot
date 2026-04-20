"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Task } from "@/types/task";

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

function getTaskStatus(task: Task): Exclude<FilterId, "all"> {
  if (task.status) return task.status;
  return task.completed ? "done" : "backlog";
}

export default function TasksLibraryPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const [meta, setMeta] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

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
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, meta: meta.trim(), status: "backlog" }),
      });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error("Create failed.");
      const created = (await response.json()) as Task;
      setTasks((prev) => [created, ...prev]);
      setDraft("");
      setMeta("");
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not create the task.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (
    id: string,
    nextStatus: Exclude<FilterId, "all">,
  ) => {
    setUpdatingIds((prev) => new Set(prev).add(id));
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          completed: nextStatus === "done",
        }),
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
  };

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

  return (
    <div className="mx-auto w-full max-w-[960px]">
      <header className="anim mb-6">
        <h1 className="text-[1.85rem] font-bold leading-[1.1] tracking-[-0.03em]">
          Tasks
        </h1>
        <p className="mt-1.5 text-[0.95rem]" style={{ color: "var(--text-2)" }}>
          Your full library — separate from the daily flow. Create, browse, and
          tag anything you might want to plan later.
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
        <form className="grid grid-cols-[1fr_auto] gap-3 max-[640px]:grid-cols-1" onSubmit={handleCreate}>
          <div className="grid grid-cols-[1.6fr_1fr] gap-2.5 max-[480px]:grid-cols-1">
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
            <input
              type="text"
              value={meta}
              onChange={(event) => setMeta(event.target.value)}
              placeholder="Tag / context (optional)"
              className="h-11 rounded-[12px] border px-3.5 text-[0.9rem] outline-none transition focus:ring-4"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface-hover)",
                color: "var(--text)",
              }}
            />
          </div>
          <button
            type="submit"
            disabled={!draft.trim() || isSubmitting}
            className="h-11 rounded-[12px] px-5 text-[0.92rem] font-semibold text-white transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55"
            style={{ background: "var(--accent)", boxShadow: "0 1px 2px rgba(0,122,255,0.25)" }}
          >
            {isSubmitting ? "Adding..." : "Add task"}
          </button>
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
              const isUpdating = updatingIds.has(task.id);
              const isDeleting = deletingIds.has(task.id);

              return (
                <li
                  key={task.id}
                  className="grid grid-cols-[24px_1fr_auto_auto] items-center gap-3 border-b px-4 py-3 last:border-b-0 max-[640px]:grid-cols-[24px_1fr_auto]"
                  style={{ borderBottomColor: "var(--line)" }}
                >
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
                    className="h-8 rounded-[8px] border px-2 text-[0.78rem] font-medium outline-none transition max-[640px]:hidden"
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
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
