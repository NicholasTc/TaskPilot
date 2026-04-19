"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Task } from "@/types/task";

const initialTasks: Task[] = [
  { id: "t1", name: "Finish TypeScript assignment", meta: "Due today", completed: false },
  { id: "t2", name: "Submit lab report", meta: "Due tomorrow, 11:59 PM", completed: false },
  { id: "t3", name: "Review math notes for quiz", meta: "Friday", completed: false },
  { id: "t4", name: "Organize desktop files", completed: false },
  { id: "t5", name: "Read 20 pages of biology textbook", meta: "Chapter 7", completed: false },
  { id: "t6", name: "Prepare project status report", meta: "Completed 2h ago", completed: true },
];

const reminders = [
  { name: "Group meeting", time: "Today, 6 PM" },
  { name: "Office hours", time: "Thu, 2 PM" },
  { name: "Dentist", time: "Sat, 10 AM" },
];

export default function TodayPage() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeTasks = useMemo(() => tasks.filter((task) => !task.completed), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.completed), [tasks]);
  const completedCount = completedTasks.length;
  const totalCount = tasks.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  useEffect(() => {
    const loadTasks = async () => {
      try {
        setErrorMessage(null);
        const response = await fetch("/api/tasks");

        if (!response.ok) {
          throw new Error("Unable to fetch tasks");
        }

        const fetchedTasks = (await response.json()) as Task[];
        setTasks(fetchedTasks);
      } catch (error) {
        console.error("Loading tasks failed", error);
        setErrorMessage("Could not load tasks from server. Showing local demo data.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadTasks();
  }, []);

  const handleAddTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || isSubmitting) return;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        throw new Error("Unable to create task");
      }

      const createdTask = (await response.json()) as Task;
      setTasks((prev) => [createdTask, ...prev]);
      setDraft("");
    } catch (error) {
      console.error("Adding task failed", error);
      setErrorMessage("Could not add task. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleTask = async (id: string) => {
    try {
      setErrorMessage(null);
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
      });

      if (!response.ok) {
        throw new Error("Unable to update task");
      }

      const updatedTask = (await response.json()) as Task;
      setTasks((prev) => prev.map((task) => (task.id === id ? updatedTask : task)));
    } catch (error) {
      console.error("Toggling task failed", error);
      setErrorMessage("Could not update task status.");
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (deletingIds.has(id)) return;

    try {
      setDeletingIds((prev) => new Set(prev).add(id));
      setErrorMessage(null);
      const response = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
      });

      // Treat 404 as already-deleted to keep delete action idempotent.
      if (!response.ok && response.status !== 404) {
        throw new Error("Unable to delete task");
      }

      setTasks((prev) => prev.filter((task) => task.id !== id));
    } catch (error) {
      console.error("Deleting task failed", error);
      setErrorMessage("Could not delete task.");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div>
      <section className="mb-10">
        <h1 className="text-[2.25rem] font-bold leading-[1.1] tracking-[-0.035em]">
          Good afternoon, Nicholas
        </h1>
        <p className="mt-2.5 text-base" style={{ color: "var(--text-2)" }}>
          You&apos;re off to a good start — keep the momentum going.
        </p>

        <div
          className="mt-6 rounded-[14px] border px-6 py-4 shadow-[var(--shadow-sm)]"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
        >
          <div className="mb-2.5 flex items-baseline justify-between">
            <span
              className="text-[0.82rem] font-semibold uppercase tracking-[0.04em]"
              style={{ color: "var(--text-2)" }}
            >
              Today&apos;s progress
            </span>
            <span className="text-[0.92rem] font-semibold">
              <span style={{ color: "var(--done)" }}>{completedCount}</span> of {totalCount} done
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(90deg, var(--done), #4cd964)",
              }}
            />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-[1fr_300px] gap-10 max-[880px]:grid-cols-1">
        <section>
          <h2 className="mb-4 text-[1.4rem] font-bold tracking-[-0.02em]">Today</h2>

          <form className="mb-6 flex gap-3" onSubmit={handleAddTask}>
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a task..."
              className="min-h-12 flex-1 rounded-[14px] border px-4 text-[0.95rem] outline-none transition focus:ring-4"
              style={{
                borderColor: "var(--line)",
                background: "var(--surface-solid)",
                color: "var(--text)",
                boxShadow: "var(--shadow-sm)",
              }}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-12 rounded-[14px] px-6 text-[0.92rem] font-semibold text-white transition active:scale-[0.97]"
              style={{
                background: "var(--accent)",
                boxShadow: "0 1px 2px rgba(0, 122, 255, 0.25)",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Adding..." : "Add"}
            </button>
          </form>

          {errorMessage ? (
            <p className="mb-4 text-[0.84rem]" style={{ color: "var(--danger)" }}>
              {errorMessage}
            </p>
          ) : null}

          <div>
            {isLoading ? (
              <p className="py-3 text-[0.88rem]" style={{ color: "var(--text-3)" }}>
                Loading tasks...
              </p>
            ) : null}
            {!isLoading
              ? activeTasks.map((task, idx) => (
                  <article
                    key={task.id}
                    className="mx-[-12px] flex items-center gap-3 rounded-[10px] border-b px-3 py-[14px] transition hover:bg-[var(--surface-hover)]"
                    style={{
                      borderBottomColor: idx === activeTasks.length - 1 ? "transparent" : "var(--line)",
                    }}
                  >
                    <button
                      type="button"
                      aria-label={`Toggle ${task.name}`}
                      onClick={() => handleToggleTask(task.id)}
                      className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full border-2 transition"
                      style={{ borderColor: "var(--text-3)" }}
                    >
                      <svg viewBox="0 0 16 16" className="h-[11px] w-[11px] fill-white opacity-0">
                        <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                      </svg>
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.96rem] font-medium">{task.name}</p>
                      {task.meta ? (
                        <p className="mt-0.5 text-[0.8rem]" style={{ color: "var(--text-3)" }}>
                          {task.meta}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${task.name}`}
                      onClick={() => handleDeleteTask(task.id)}
                      disabled={deletingIds.has(task.id)}
                      className="grid h-8 w-8 place-items-center rounded-[10px] transition hover:scale-[0.96]"
                      style={{ background: "transparent", opacity: deletingIds.has(task.id) ? 0.45 : 1 }}
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" style={{ fill: "var(--text-2)" }}>
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                        <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H5.5l1-1h3l1 1h2.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
                      </svg>
                    </button>
                  </article>
                ))
              : null}
            {!isLoading && activeTasks.length === 0 ? (
              <p className="py-3 text-[0.88rem]" style={{ color: "var(--text-3)" }}>
                No active tasks. Add one to get started.
              </p>
            ) : null}
          </div>

          <section className="mt-10">
            <h3
              className="mb-3 text-[0.78rem] font-semibold uppercase tracking-[0.04em]"
              style={{ color: "var(--text-3)" }}
            >
              Completed
            </h3>
            {!isLoading
              ? completedTasks.map((task) => (
              <article
                key={task.id}
                className="mx-[-12px] flex items-center gap-3 rounded-[10px] px-3 py-[14px] opacity-60 transition hover:bg-[var(--surface-hover)] hover:opacity-85"
              >
                <button
                  type="button"
                  aria-label={`Completed ${task.name}`}
                  onClick={() => handleToggleTask(task.id)}
                  className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full border-2"
                  style={{ borderColor: "var(--done)", background: "var(--done)" }}
                >
                  <svg viewBox="0 0 16 16" className="h-[11px] w-[11px] fill-white">
                    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.96rem] font-medium line-through">{task.name}</p>
                  {task.meta ? (
                    <p className="mt-0.5 text-[0.8rem]" style={{ color: "var(--text-3)" }}>
                      {task.meta}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${task.name}`}
                  onClick={() => handleDeleteTask(task.id)}
                  disabled={deletingIds.has(task.id)}
                  className="grid h-8 w-8 place-items-center rounded-[10px] transition hover:scale-[0.96]"
                  style={{ background: "transparent", opacity: deletingIds.has(task.id) ? 0.45 : 1 }}
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" style={{ fill: "var(--text-2)" }}>
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                    <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H5.5l1-1h3l1 1h2.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
                  </svg>
                </button>
              </article>
            ))
              : null}
            {!isLoading && completedTasks.length === 0 ? (
              <p className="py-3 text-[0.88rem]" style={{ color: "var(--text-3)" }}>
                Nothing completed yet.
              </p>
            ) : null}
          </section>
        </section>

        <aside className="flex flex-col gap-6">
          <section
            className="rounded-[18px] border px-6 py-6 shadow-[var(--shadow-md)]"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
          >
            <h3
              className="mb-4 text-[0.78rem] font-semibold uppercase tracking-[0.04em]"
              style={{ color: "var(--text-3)" }}
            >
              Focus timer
            </h3>
            <div className="text-center">
              <p className="text-[2.6rem] font-bold leading-none tracking-[-0.04em]">25:00</p>
              <p className="mt-1.5 text-[0.82rem]" style={{ color: "var(--text-3)" }}>
                Pomodoro
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  type="button"
                  className="min-h-9 rounded-[10px] px-4 text-[0.85rem] font-medium text-white transition active:scale-[0.96]"
                  style={{ background: "var(--accent)" }}
                >
                  Start
                </button>
                <button
                  type="button"
                  className="min-h-9 rounded-[10px] border px-4 text-[0.85rem] font-medium transition active:scale-[0.96]"
                  style={{ borderColor: "var(--line)", color: "var(--text)" }}
                >
                  Pause
                </button>
                <button
                  type="button"
                  className="min-h-9 rounded-[10px] border px-4 text-[0.85rem] font-medium transition active:scale-[0.96]"
                  style={{ borderColor: "var(--line)", color: "var(--text)" }}
                >
                  Reset
                </button>
              </div>
            </div>
          </section>

          <section
            className="rounded-[18px] border px-6 py-6 shadow-[var(--shadow-md)]"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
          >
            <h3
              className="mb-4 text-[0.78rem] font-semibold uppercase tracking-[0.04em]"
              style={{ color: "var(--text-3)" }}
            >
              Reminders
            </h3>
            {reminders.map((reminder, idx) => (
              <article
                key={reminder.name}
                className="flex items-center justify-between gap-3 border-b py-2.5"
                style={{ borderBottomColor: idx === reminders.length - 1 ? "transparent" : "var(--line)" }}
              >
                <p className="text-[0.88rem] font-medium">{reminder.name}</p>
                <span className="whitespace-nowrap text-[0.78rem]" style={{ color: "var(--text-3)" }}>
                  {reminder.time}
                </span>
              </article>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
