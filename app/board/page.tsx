"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Task } from "@/types/task";

const BOARD_STATUSES = ["backlog", "planned", "in_progress", "done"] as const;
type BoardStatus = (typeof BOARD_STATUSES)[number];

type BoardTask = Task & {
  status: BoardStatus;
  dayKey: string | null;
  order: number;
  studyBlockId: string | null;
};

type TasksByStatus = Record<BoardStatus, BoardTask[]>;

const initialBoardTasks: TasksByStatus = {
  backlog: [],
  planned: [],
  in_progress: [],
  done: [],
};

const statusMeta: Record<
  BoardStatus,
  { title: string; dot: string; empty: string; softBackground: string }
> = {
  backlog: {
    title: "Backlog",
    dot: "var(--text-3)",
    empty: "Drop unscheduled tasks here",
    softBackground: "var(--surface-hover)",
  },
  planned: {
    title: "Planned",
    dot: "var(--accent)",
    empty: "Drop tasks planned for this day",
    softBackground: "var(--surface-hover)",
  },
  in_progress: {
    title: "In Progress",
    dot: "#ff9500",
    empty: "Drag one task here to focus",
    softBackground: "rgba(255, 149, 0, 0.08)",
  },
  done: {
    title: "Done",
    dot: "var(--done)",
    empty: "Completed tasks appear here",
    softBackground: "var(--surface-hover)",
  },
};

function toLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function normalizeTask(task: Task): BoardTask {
  const status =
    task.status && BOARD_STATUSES.includes(task.status)
      ? task.status
      : task.completed
        ? "done"
        : "backlog";
  return {
    ...task,
    status,
    dayKey: task.dayKey ?? null,
    order: typeof task.order === "number" ? task.order : 0,
    studyBlockId: task.studyBlockId ?? null,
  };
}

function cloneTasksByStatus(tasksByStatus: TasksByStatus) {
  return {
    backlog: [...tasksByStatus.backlog],
    planned: [...tasksByStatus.planned],
    in_progress: [...tasksByStatus.in_progress],
    done: [...tasksByStatus.done],
  };
}

export default function BoardPage() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [tasksByStatus, setTasksByStatus] = useState<TasksByStatus>(initialBoardTasks);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [legacyCount, setLegacyCount] = useState<number | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [draggingFromStatus, setDraggingFromStatus] = useState<BoardStatus | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftStatus, setDraftStatus] = useState<BoardStatus>("backlog");
  const [isCreating, setIsCreating] = useState(false);

  const dayKey = useMemo(() => toLocalDayKey(selectedDate), [selectedDate]);
  const dateLabel = useMemo(() => formatDateLabel(selectedDate), [selectedDate]);

  const inProgressCount = tasksByStatus.in_progress.length;
  const totalCount = useMemo(
    () => BOARD_STATUSES.reduce((sum, status) => sum + tasksByStatus[status].length, 0),
    [tasksByStatus],
  );

  const showSoftWipWarning = inProgressCount > 1;

  const redirectToLogin = useCallback(() => {
    router.replace("/login");
  }, [router]);

  const loadBoard = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const response = await fetch(`/api/board?day=${dayKey}`);
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) {
        throw new Error("Unable to load board data");
      }
      const data = (await response.json()) as {
        tasksByStatus: Record<BoardStatus, Task[]>;
      };

      const normalized: TasksByStatus = {
        backlog: (data.tasksByStatus.backlog || []).map(normalizeTask),
        planned: (data.tasksByStatus.planned || []).map(normalizeTask),
        in_progress: (data.tasksByStatus.in_progress || []).map(normalizeTask),
        done: (data.tasksByStatus.done || []).map(normalizeTask),
      };
      setTasksByStatus(normalized);
    } catch (error) {
      console.error("Loading board failed", error);
      setErrorMessage("Could not load board. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [dayKey, redirectToLogin]);

  const loadLegacyCount = useCallback(async () => {
    try {
      const response = await fetch("/api/legacy-tasks");
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) return;
      const data = (await response.json()) as { count?: number };
      setLegacyCount(typeof data.count === "number" ? data.count : 0);
    } catch (error) {
      console.error("Loading legacy task count failed", error);
    }
  }, [redirectToLogin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadBoard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBoard]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLegacyCount();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLegacyCount]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const persistReorder = useCallback(
    async (nextTasksByStatus: TasksByStatus) => {
      const updates = BOARD_STATUSES.flatMap((status) =>
        nextTasksByStatus[status].map((task, index) => ({
          id: task.id,
          status,
          order: index,
          dayKey,
        })),
      );

      const response = await fetch("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

      if (!response.ok) {
        throw new Error("Unable to persist task reordering");
      }
    },
    [dayKey, redirectToLogin],
  );

  const showWipWarnings = useCallback(
    (nextTasksByStatus: TasksByStatus, movedTaskId: string, targetStatus: BoardStatus) => {
      const nextInProgress = nextTasksByStatus.in_progress;
      if (targetStatus !== "in_progress") return;

      const hasAnotherInProgress = nextInProgress.some((task) => task.id !== movedTaskId);
      if (hasAnotherInProgress) {
        setToastMessage("You already have an active task. Keep focus on one at a time.");
      }
    },
    [],
  );

  const moveTaskToStatus = useCallback(
    async (taskId: string, fromStatus: BoardStatus, toStatus: BoardStatus) => {
      if (isSaving) return;
      const sourceTasks = tasksByStatus[fromStatus];
      const task = sourceTasks.find((item) => item.id === taskId);
      if (!task) return;
      if (fromStatus === toStatus) return;

      const previousState = cloneTasksByStatus(tasksByStatus);
      const nextState = cloneTasksByStatus(tasksByStatus);
      nextState[fromStatus] = nextState[fromStatus].filter((item) => item.id !== taskId);
      nextState[toStatus] = [
        ...nextState[toStatus],
        {
          ...task,
          status: toStatus,
          completed: toStatus === "done",
          dayKey,
        },
      ];

      setTasksByStatus(nextState);
      showWipWarnings(nextState, taskId, toStatus);

      try {
        setIsSaving(true);
        await persistReorder(nextState);
      } catch (error) {
        console.error("Moving task failed", error);
        setTasksByStatus(previousState);
        setErrorMessage("Could not move task. Please try again.");
      } finally {
        setIsSaving(false);
      }
    },
    [dayKey, isSaving, persistReorder, showWipWarnings, tasksByStatus],
  );

  const handleCreateTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!name || isCreating) return;

    try {
      setErrorMessage(null);
      setIsCreating(true);
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          status: draftStatus,
          dayKey,
          order: tasksByStatus[draftStatus].length,
        }),
      });

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

      if (!response.ok) {
        throw new Error("Unable to create task");
      }

      const createdTask = normalizeTask((await response.json()) as Task);
      const nextState = cloneTasksByStatus(tasksByStatus);
      nextState[draftStatus] = [...nextState[draftStatus], createdTask];
      setTasksByStatus(nextState);
      setDraftName("");
      showWipWarnings(nextState, createdTask.id, draftStatus);
    } catch (error) {
      console.error("Creating board task failed", error);
      setErrorMessage("Could not create task. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.9rem] font-bold leading-[1.1] tracking-[-0.03em]">Today&apos;s Board</h1>
          <p className="mt-1.5 text-[0.92rem]" style={{ color: "var(--text-2)" }}>
            Plan, focus, and finish — one task at a time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 rounded-[12px] border p-1"
            style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
          >
            <button
              type="button"
              onClick={() => setSelectedDate((current) => addDays(current, -1))}
              className="grid h-8 w-8 place-items-center rounded-[8px] transition hover:bg-[var(--surface-hover)]"
              aria-label="Previous day"
            >
              <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" style={{ stroke: "currentColor" }}>
                <path d="M10 12 6 8l4-4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="px-2 text-[0.86rem] font-semibold">{dateLabel}</div>
            <button
              type="button"
              onClick={() => setSelectedDate((current) => addDays(current, 1))}
              className="grid h-8 w-8 place-items-center rounded-[8px] transition hover:bg-[var(--surface-hover)]"
              aria-label="Next day"
            >
              <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" style={{ stroke: "currentColor" }}>
                <path d="m6 4 4 4-4 4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {legacyCount && legacyCount > 0 ? (
        <section
          className="mb-4 rounded-[14px] border px-4 py-3"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
        >
          <p className="text-[0.86rem] font-medium">
            You have {legacyCount} existing task{legacyCount > 1 ? "s" : ""} that are not assigned to a board day yet.
          </p>
          <p className="mt-1 text-[0.8rem]" style={{ color: "var(--text-2)" }}>
            We&apos;ll add the guided assignment flow in the migration stage. Existing tasks remain safe.
          </p>
        </section>
      ) : null}

      {showSoftWipWarning ? (
        <section
          className="mb-4 flex items-center gap-2 rounded-[12px] border px-4 py-2.5 text-[0.82rem] font-medium"
          style={{
            background: "rgba(255, 149, 0, 0.08)",
            borderColor: "rgba(255, 149, 0, 0.22)",
            color: "#ff9500",
          }}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4A.5.5 0 0 1 8 4zm0 7a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
          </svg>
          You currently have multiple tasks in progress. Monotasking works best with one.
        </section>
      ) : null}

      {toastMessage ? (
        <section
          className="mb-4 rounded-[12px] border px-4 py-2.5 text-[0.82rem] font-medium"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
        >
          {toastMessage}
        </section>
      ) : null}

      <section
        className="mb-5 rounded-[14px] border px-4 py-4"
        style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
      >
        <form className="flex flex-wrap items-center gap-2" onSubmit={handleCreateTask}>
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Add a new task..."
            className="h-10 min-w-[260px] flex-1 rounded-[10px] border px-3.5 text-[0.9rem] outline-none"
            style={{
              borderColor: "var(--line)",
              background: "var(--surface-solid)",
              color: "var(--text)",
            }}
          />
          <select
            value={draftStatus}
            onChange={(event) => setDraftStatus(event.target.value as BoardStatus)}
            className="h-10 rounded-[10px] border px-3 text-[0.86rem] font-medium outline-none"
            style={{ borderColor: "var(--line)", background: "var(--surface-solid)" }}
          >
            {BOARD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusMeta[status].title}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isCreating}
            className="h-10 rounded-[10px] px-4 text-[0.85rem] font-semibold text-white transition active:scale-[0.97]"
            style={{ background: "var(--accent)", opacity: isCreating ? 0.65 : 1 }}
          >
            {isCreating ? "Adding..." : "Add task"}
          </button>
        </form>
      </section>

      {errorMessage ? (
        <p className="mb-4 text-[0.84rem]" style={{ color: "var(--danger)" }}>
          {errorMessage}
        </p>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[700px]:grid-cols-1">
          {BOARD_STATUSES.map((status) => (
            <div
              key={status}
              className="min-h-[380px] animate-pulse rounded-[16px] border"
              style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4 max-[1100px]:grid-cols-2 max-[700px]:grid-cols-1">
          {BOARD_STATUSES.map((status) => (
            <section
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={async (event) => {
                event.preventDefault();
                if (!draggingTaskId || !draggingFromStatus) return;
                await moveTaskToStatus(draggingTaskId, draggingFromStatus, status);
                setDraggingTaskId(null);
                setDraggingFromStatus(null);
              }}
              className="min-h-[420px] rounded-[16px] border p-3"
              style={{
                background: statusMeta[status].softBackground,
                borderColor: status === "in_progress" ? "rgba(255,149,0,0.3)" : "var(--line)",
              }}
            >
              <header className="mb-2.5 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: statusMeta[status].dot,
                    }}
                  />
                  <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.03em]">
                    {statusMeta[status].title}
                  </h2>
                  <span
                    className="rounded-full px-2 py-0.5 text-[0.72rem] font-semibold"
                    style={{ background: "var(--surface-solid)", color: "var(--text-3)" }}
                  >
                    {tasksByStatus[status].length}
                  </span>
                </div>
              </header>

              <div className="space-y-2">
                {tasksByStatus[status].map((task) => (
                  <article
                    key={task.id}
                    draggable
                    onDragStart={() => {
                      setDraggingTaskId(task.id);
                      setDraggingFromStatus(status);
                    }}
                    onDragEnd={() => {
                      setDraggingTaskId(null);
                      setDraggingFromStatus(null);
                    }}
                    className="cursor-grab rounded-[12px] border p-3 shadow-[var(--shadow-sm)] transition hover:-translate-y-[1px] hover:shadow-[var(--shadow-md)]"
                    style={{
                      background: "var(--surface-solid)",
                      borderColor: "var(--line)",
                      opacity: draggingTaskId === task.id ? 0.65 : 1,
                    }}
                  >
                    <p
                      className="text-[0.9rem] font-medium leading-[1.4]"
                      style={{
                        color: status === "done" ? "var(--text-3)" : "var(--text)",
                        textDecoration: status === "done" ? "line-through" : "none",
                      }}
                    >
                      {task.name}
                    </p>
                    {task.meta ? (
                      <p className="mt-1 text-[0.78rem]" style={{ color: "var(--text-3)" }}>
                        {task.meta}
                      </p>
                    ) : null}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {task.studyBlockId ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[0.7rem] font-medium"
                          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                        >
                          Linked to block
                        </span>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>

              {tasksByStatus[status].length === 0 ? (
                <div
                  className="mt-2 rounded-[12px] border border-dashed px-3 py-6 text-center text-[0.8rem]"
                  style={{ borderColor: "var(--line-strong)", color: "var(--text-3)" }}
                >
                  {statusMeta[status].empty}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}

      <p className="mt-5 text-[0.78rem]" style={{ color: "var(--text-3)" }}>
        {isSaving ? "Saving board changes..." : `${totalCount} task${totalCount === 1 ? "" : "s"} on this board`}
      </p>
    </div>
  );
}
