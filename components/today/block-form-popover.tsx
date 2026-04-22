"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Internal form body. Keep this component STATEFUL with `useState`
 * initializers seeded by props, and remount it whenever the parent wants
 * to reset the form by changing the React `key` (typically a counter or
 * the `initialStartMinutes`). This avoids the anti-pattern of calling
 * `setState` from an effect to sync props -> state.
 */

export type BlockFormSubmitPayload = {
  title: string;
  startMinutes: number;
  durationMin: number;
  activeTaskId: string | null;
};

export type BlockFormTaskOption = {
  id: string;
  name: string;
};

type BlockFormPopoverProps = {
  open: boolean;
  initialStartMinutes: number;
  initialDurationMin?: number;
  initialTitle?: string;
  initialTaskId?: string | null;
  taskOptions: BlockFormTaskOption[];
  isSubmitting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (payload: BlockFormSubmitPayload) => void | Promise<void>;
  /** Optional title override for the popover header (e.g. "Add a block"). */
  headerTitle?: string;
};

const DURATION_OPTIONS = [30, 45, 60, 75, 90, 120];

function minutesToHhmm(minutes: number) {
  const safe = Math.max(0, Math.min(1439, Math.floor(minutes)));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function hhmmToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number.parseInt(match[1]!, 10);
  const minutes = Number.parseInt(match[2]!, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function BlockFormPopover(props: BlockFormPopoverProps) {
  if (!props.open) return null;
  // Remount the body each time the form is opened with a fresh
  // initialStartMinutes/title so internal state seeds cleanly without
  // sync-from-props effects.
  return (
    <BlockFormBody
      key={`${props.initialStartMinutes}|${props.initialTitle ?? ""}|${props.initialTaskId ?? ""}`}
      {...props}
    />
  );
}

function BlockFormBody({
  initialStartMinutes,
  initialDurationMin = 60,
  initialTitle = "",
  initialTaskId = null,
  taskOptions,
  isSubmitting,
  errorMessage,
  onCancel,
  onSubmit,
  headerTitle = "Add a block",
}: BlockFormPopoverProps) {
  const [title, setTitle] = useState(initialTitle);
  const [startTime, setStartTime] = useState(() => minutesToHhmm(initialStartMinutes));
  const [durationMin, setDurationMin] = useState(initialDurationMin);
  const [taskId, setTaskId] = useState<string>(initialTaskId ?? "");
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => titleInputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, []);

  const startMinutes = useMemo(() => hhmmToMinutes(startTime), [startTime]);
  const trimmedTitle = title.trim();

  const validationError = (() => {
    if (!trimmedTitle) return "Title is required.";
    if (startMinutes === null) return "Start time must be in HH:MM format.";
    if (durationMin < 15 || durationMin > 720) return "Duration must be between 15m and 12h.";
    if (startMinutes + durationMin > 1440) return "Block ends after 11:59 PM.";
    return null;
  })();

  const submitDisabled = isSubmitting || !!validationError;

  const handleSubmit = async () => {
    if (submitDisabled || startMinutes === null) return;
    await onSubmit({
      title: trimmedTitle,
      startMinutes,
      durationMin,
      activeTaskId: taskId || null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-4 py-6 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-[420px] rounded-[18px] border p-5"
        style={{
          background: "var(--surface-solid)",
          borderColor: "var(--line)",
          boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void handleSubmit();
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[1.05rem] font-bold tracking-[-0.01em]">{headerTitle}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: "var(--text-2)" }}
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[0.72rem] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--text-3)" }}>
              Title
            </span>
            <input
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Deep work on chemistry"
              className="mt-1 w-full rounded-[10px] border px-3 py-2 text-[0.92rem] outline-none focus:border-[var(--accent)]"
              style={{ background: "var(--surface-hover)", borderColor: "var(--line)", color: "var(--text)" }}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[0.72rem] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--text-3)" }}>
                Start
              </span>
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="mt-1 w-full rounded-[10px] border px-3 py-2 text-[0.92rem] tabular-nums outline-none focus:border-[var(--accent)]"
                style={{ background: "var(--surface-hover)", borderColor: "var(--line)", color: "var(--text)" }}
              />
            </label>
            <label className="block">
              <span className="text-[0.72rem] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--text-3)" }}>
                Duration
              </span>
              <select
                value={durationMin}
                onChange={(event) => setDurationMin(Number.parseInt(event.target.value, 10))}
                className="mt-1 w-full rounded-[10px] border px-3 py-2 text-[0.92rem] outline-none focus:border-[var(--accent)]"
                style={{ background: "var(--surface-hover)", borderColor: "var(--line)", color: "var(--text)" }}
              >
                {DURATION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option >= 60
                      ? `${Math.floor(option / 60)}h${option % 60 ? ` ${option % 60}m` : ""}`
                      : `${option}m`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {taskOptions.length > 0 ? (
            <label className="block">
              <span className="text-[0.72rem] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--text-3)" }}>
                Link a task (optional)
              </span>
              <select
                value={taskId}
                onChange={(event) => {
                  const next = event.target.value;
                  setTaskId(next);
                  // Auto-prefill the title from the selected task only when
                  // the user hasn't typed something yet, so we never silently
                  // clobber their input.
                  if (next && !trimmedTitle) {
                    const task = taskOptions.find((option) => option.id === next);
                    if (task) setTitle(task.name);
                  }
                }}
                className="mt-1 w-full rounded-[10px] border px-3 py-2 text-[0.92rem] outline-none focus:border-[var(--accent)]"
                style={{ background: "var(--surface-hover)", borderColor: "var(--line)", color: "var(--text)" }}
              >
                <option value="">None</option>
                {taskOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {(validationError || errorMessage) && (
            <p className="text-[0.78rem]" style={{ color: "var(--danger)" }}>
              {errorMessage ?? validationError}
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-[10px] border px-3.5 text-[0.84rem] font-semibold"
            style={{ borderColor: "var(--line)", color: "var(--text-2)", background: "transparent" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitDisabled}
            className="h-9 rounded-[10px] px-4 text-[0.84rem] font-semibold text-white disabled:opacity-55"
            style={{ background: "var(--accent)", boxShadow: "0 4px 12px rgba(0,122,255,0.22)" }}
          >
            {isSubmitting ? "Adding…" : "Add block"}
          </button>
        </div>
      </div>
    </div>
  );
}
