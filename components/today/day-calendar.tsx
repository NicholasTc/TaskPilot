"use client";

import {
  DragEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type CalendarBlockStatus = "upcoming" | "active" | "completed" | "missed";

export type CalendarBlock = {
  id: string;
  title: string;
  startMinutes: number;
  durationMin: number;
  liveStatus: CalendarBlockStatus;
  isFocusActive?: boolean;
  taskCount?: number;
  isLocked?: boolean;
};

type DayCalendarProps = {
  blocks: CalendarBlock[];
  nowMs: number;
  isToday: boolean;
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string) => void;
  onSwapBlocks: (blockAId: string, blockBId: string) => void | Promise<void>;
  onCreateBlockAt: (startMinutes: number) => void;
  onAddBlockClick: () => void;
  onClearDay?: () => void;
  isClearingDay?: boolean;
};

const MINUTES_PER_DAY = 1440;
/**
 * Pixel height of one minute in the calendar. 1 minute = 1px keeps math
 * trivial and gives a comfortable density: an hour is 60px tall, the full
 * day (24h) is 1440px which is the scrollable canvas height.
 */
const PX_PER_MINUTE = 1;
const HOUR_LABEL_WIDTH = 64;
/**
 * Visible viewport height of the scrollable calendar. Picked to comfortably
 * show ~7 hours of content while keeping the page from feeling cramped.
 */
const VIEWPORT_HEIGHT = 460;
const SLOT_SNAP_MINUTES = 15;

function minutesToTimeLabel(minutes: number) {
  const safe = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.floor(minutes)));
  const date = new Date(1970, 0, 1, Math.floor(safe / 60), safe % 60);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatHourLabel(hour: number) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function formatHoursLeft(totalMinutes: number) {
  if (totalMinutes <= 0) return "0m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

type StatusVisual = {
  /** Solid fill for the block surface. */
  background: string;
  /** Border color for the block surface. */
  border: string;
  /** Vertical accent stripe color along the left edge. */
  stripe: string;
  /** Title text color. */
  titleColor: string;
  /** Secondary meta text color. */
  metaColor: string;
  /** Optional badge label rendered in the top-right corner. */
  badge?: { label: string; bg: string; color: string };
  /** Whether the block should appear visually muted (past, dashed). */
  muted?: boolean;
};

function getStatusVisual(status: CalendarBlockStatus): StatusVisual {
  switch (status) {
    case "active":
      return {
        background:
          "linear-gradient(135deg, rgba(0,122,255,0.12), rgba(88,86,214,0.10))",
        border: "var(--accent)",
        stripe: "var(--accent)",
        titleColor: "var(--text)",
        metaColor: "var(--text-2)",
        badge: { label: "Now", bg: "var(--accent)", color: "#fff" },
      };
    case "completed":
      return {
        background: "transparent",
        border: "var(--line)",
        stripe: "var(--done)",
        titleColor: "var(--text-2)",
        metaColor: "var(--text-3)",
        badge: { label: "Done", bg: "var(--done-soft)", color: "var(--done)" },
        muted: true,
      };
    case "missed":
      return {
        background:
          "linear-gradient(135deg, rgba(255,59,48,0.10), rgba(255,59,48,0.04))",
        border: "var(--danger)",
        stripe: "var(--danger)",
        titleColor: "var(--text)",
        metaColor: "var(--text-2)",
        badge: { label: "Missed", bg: "var(--danger-soft)", color: "var(--danger)" },
      };
    case "upcoming":
    default:
      return {
        background: "var(--surface-solid)",
        border: "var(--line)",
        stripe: "var(--accent-soft)",
        titleColor: "var(--text)",
        metaColor: "var(--text-2)",
      };
  }
}

export function DayCalendar({
  blocks,
  nowMs,
  isToday,
  selectedBlockId,
  onSelectBlock,
  onSwapBlocks,
  onCreateBlockAt,
  onAddBlockClick,
  onClearDay,
  isClearingDay = false,
}: DayCalendarProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const pendingHoverMinutesRef = useRef<number | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [hoverDropTargetId, setHoverDropTargetId] = useState<string | null>(null);
  const [hoverEmptyMinutes, setHoverEmptyMinutes] = useState<number | null>(null);
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);

  const nowMinutes = useMemo(() => {
    const date = new Date(nowMs);
    return date.getHours() * 60 + date.getMinutes();
  }, [nowMs]);

  const sortedBlocks = useMemo(
    () =>
      [...blocks].sort(
        (a, b) => a.startMinutes - b.startMinutes || a.durationMin - b.durationMin,
      ),
    [blocks],
  );

  /**
   * Total minutes between the live cursor (today) and 23:00 that are NOT
   * occupied by an existing block. We cap at 11 PM to match the planning
   * window the rest of the app uses. For non-today views, we report the
   * unbooked minutes across the standard 8 AM – 11 PM window so the label
   * is still meaningful.
   */
  const focusableMinutesLeft = useMemo(() => {
    const cursor = isToday ? nowMinutes : 8 * 60;
    const horizonEnd = 23 * 60;
    if (cursor >= horizonEnd) return 0;
    let booked = 0;
    for (const block of sortedBlocks) {
      if (block.liveStatus === "completed" || block.liveStatus === "missed") continue;
      const start = Math.max(block.startMinutes, cursor);
      const end = Math.min(block.startMinutes + block.durationMin, horizonEnd);
      if (end > start) booked += end - start;
    }
    return Math.max(0, horizonEnd - cursor - booked);
  }, [isToday, nowMinutes, sortedBlocks]);

  /**
   * Auto-scroll into the active planning window once on mount (and again
   * when the day or first-load shifts). For today we anchor to ~30 minutes
   * before the current time; otherwise we anchor to the earliest block.
   */
  useLayoutEffect(() => {
    if (hasAutoScrolled) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const anchorMinutes = isToday
      ? Math.max(0, nowMinutes - 30)
      : sortedBlocks.length > 0
        ? Math.max(0, sortedBlocks[0]!.startMinutes - 30)
        : 8 * 60;
    scroller.scrollTo({ top: anchorMinutes * PX_PER_MINUTE, behavior: "auto" });
    setHasAutoScrolled(true);
  }, [hasAutoScrolled, isToday, nowMinutes, sortedBlocks]);

  useEffect(() => {
    return () => {
      if (hoverRafRef.current !== null) {
        window.cancelAnimationFrame(hoverRafRef.current);
      }
    };
  }, []);

  const scheduleHoverUpdate = useCallback((nextMinutes: number | null) => {
    pendingHoverMinutesRef.current = nextMinutes;
    if (hoverRafRef.current !== null) return;
    hoverRafRef.current = window.requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const pending = pendingHoverMinutesRef.current;
      setHoverEmptyMinutes((current) => (current === pending ? current : pending));
    });
  }, []);

  const handleEmptyClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest("[data-block-card='true']")) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      const rawMinutes = Math.max(0, Math.min(MINUTES_PER_DAY - 15, Math.floor(offsetY / PX_PER_MINUTE)));
      const snapped = Math.round(rawMinutes / SLOT_SNAP_MINUTES) * SLOT_SNAP_MINUTES;
      onCreateBlockAt(snapped);
    },
    [onCreateBlockAt],
  );

  const handleEmptyHover = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // While dragging, drop target feedback is enough; suppress empty-slot
      // hover updates to keep drag interactions smooth.
      if (draggingBlockId) {
        scheduleHoverUpdate(null);
        return;
      }
      if ((event.target as HTMLElement).closest("[data-block-card='true']")) {
        scheduleHoverUpdate(null);
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      const rawMinutes = Math.max(
        0,
        Math.min(MINUTES_PER_DAY - 15, Math.floor(offsetY / PX_PER_MINUTE)),
      );
      const snapped = Math.round(rawMinutes / SLOT_SNAP_MINUTES) * SLOT_SNAP_MINUTES;
      scheduleHoverUpdate(snapped);
    },
    [draggingBlockId, scheduleHoverUpdate],
  );

  const handleEmptyLeave = useCallback(() => {
    scheduleHoverUpdate(null);
  }, [scheduleHoverUpdate]);

  const handleBlockDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, blockId: string, locked: boolean) => {
      if (locked) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", blockId);
      setDraggingBlockId(blockId);
      scheduleHoverUpdate(null);
    },
    [scheduleHoverUpdate],
  );

  const handleBlockDragEnd = useCallback(() => {
    setDraggingBlockId(null);
    setHoverDropTargetId(null);
  }, []);

  const handleBlockDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, blockId: string, locked: boolean) => {
      if (!draggingBlockId || draggingBlockId === blockId || locked) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (hoverDropTargetId !== blockId) {
        setHoverDropTargetId(blockId);
      }
    },
    [draggingBlockId, hoverDropTargetId],
  );

  const handleBlockDragLeave = useCallback(
    (blockId: string) => {
      if (hoverDropTargetId === blockId) {
        setHoverDropTargetId(null);
      }
    },
    [hoverDropTargetId],
  );

  const handleBlockDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, targetId: string, locked: boolean) => {
      event.preventDefault();
      const sourceId = event.dataTransfer.getData("text/plain") || draggingBlockId;
      setDraggingBlockId(null);
      setHoverDropTargetId(null);
      if (!sourceId || sourceId === targetId || locked) return;
      void onSwapBlocks(sourceId, targetId);
    },
    [draggingBlockId, onSwapBlocks],
  );

  const hourMarkers = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), []);

  const showNowLine = isToday && nowMinutes >= 0 && nowMinutes < MINUTES_PER_DAY;

  return (
    <div
      className="relative overflow-hidden rounded-[18px] border"
      style={{
        background: "var(--surface-solid)",
        borderColor: "var(--line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="flex items-baseline gap-2">
          <span
            className="text-[0.74rem] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--text-3)" }}
          >
            Day calendar
          </span>
          <span
            className="rounded-full px-2 py-[2px] text-[0.7rem] font-semibold tabular-nums"
            style={{
              background: focusableMinutesLeft > 0 ? "var(--accent-soft)" : "var(--surface-hover)",
              color: focusableMinutesLeft > 0 ? "var(--accent)" : "var(--text-3)",
            }}
            title={isToday ? "Unbooked time between now and 11 PM" : "Unbooked time between 8 AM and 11 PM"}
          >
            {formatHoursLeft(focusableMinutesLeft)} free
          </span>
          {isToday ? (
            <span className="text-[0.72rem] tabular-nums" style={{ color: "var(--text-3)" }}>
              · now {minutesToTimeLabel(nowMinutes)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onAddBlockClick}
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[0.78rem] font-semibold text-white transition active:scale-[0.98]"
            style={{ background: "var(--accent)", boxShadow: "0 3px 10px rgba(0,122,255,0.22)" }}
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add block
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative overflow-y-auto"
        style={{ height: VIEWPORT_HEIGHT, scrollbarGutter: "stable" }}
      >
        <div
          ref={canvasRef}
          onClick={handleEmptyClick}
          onMouseMove={handleEmptyHover}
          onMouseLeave={handleEmptyLeave}
          className="relative cursor-cell"
          style={{ height: MINUTES_PER_DAY * PX_PER_MINUTE }}
          role="presentation"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to bottom, transparent 0 59px, var(--line) 59px 60px)",
              marginLeft: HOUR_LABEL_WIDTH,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0"
            style={{ width: HOUR_LABEL_WIDTH }}
          >
            {hourMarkers.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 pl-3 pr-2 text-right text-[0.68rem] font-semibold tabular-nums"
                style={{
                  top: hour * 60 * PX_PER_MINUTE - 6,
                  color: "var(--text-3)",
                }}
              >
                {hour === 0 ? "" : formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {hoverEmptyMinutes !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute flex items-center"
              style={{
                top: hoverEmptyMinutes * PX_PER_MINUTE,
                left: HOUR_LABEL_WIDTH,
                right: 8,
                height: 60 * PX_PER_MINUTE,
              }}
            >
              <div
                className="flex h-full w-full items-center gap-2 rounded-[12px] border-2 border-dashed px-3 text-[0.78rem] font-medium"
                style={{
                  borderColor: "var(--accent)",
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                }}
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 3v10M3 8h10" />
                </svg>
                <span>New block at {minutesToTimeLabel(hoverEmptyMinutes)}</span>
              </div>
            </div>
          ) : null}

          {showNowLine ? (
            <div
              aria-hidden
              className="pointer-events-none absolute z-10 flex items-center"
              style={{
                top: nowMinutes * PX_PER_MINUTE,
                left: HOUR_LABEL_WIDTH - 6,
                right: 0,
                height: 1,
              }}
            >
              <span
                className="-ml-1 h-2.5 w-2.5 rounded-full"
                style={{ background: "var(--danger)", boxShadow: "0 0 0 3px rgba(255,59,48,0.18)" }}
              />
              <span
                className="h-px flex-1"
                style={{ background: "var(--danger)" }}
              />
            </div>
          ) : null}

          {sortedBlocks.map((block) => {
            const visual = getStatusVisual(block.liveStatus);
            const top = block.startMinutes * PX_PER_MINUTE;
            const height = Math.max(28, block.durationMin * PX_PER_MINUTE - 4);
            const isSelected = selectedBlockId === block.id;
            const isDragSource = draggingBlockId === block.id;
            const isDropTarget = hoverDropTargetId === block.id;
            const locked = block.isLocked === true;
            const durationLabel = formatHoursLeft(block.durationMin);
            const timeLabel = `${minutesToTimeLabel(block.startMinutes)} – ${minutesToTimeLabel(block.startMinutes + block.durationMin)}`;
            const isCompact = block.durationMin < 45;

            return (
              <div
                key={block.id}
                data-block-card="true"
                draggable={!locked}
                onDragStart={(event) => handleBlockDragStart(event, block.id, locked)}
                onDragEnd={handleBlockDragEnd}
                onDragOver={(event) => handleBlockDragOver(event, block.id, locked)}
                onDragLeave={() => handleBlockDragLeave(block.id)}
                onDrop={(event) => handleBlockDrop(event, block.id, locked)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectBlock?.(block.id);
                }}
                className="absolute overflow-hidden rounded-[12px] border transition-[border-color,box-shadow,opacity] duration-150"
                style={{
                  top,
                  left: HOUR_LABEL_WIDTH + 8,
                  right: 8,
                  height,
                  background: visual.background,
                  borderColor: isDropTarget
                    ? "var(--accent)"
                    : isSelected
                      ? "var(--accent)"
                      : visual.border,
                  borderStyle: visual.muted ? "dashed" : "solid",
                  borderWidth: isDropTarget || isSelected ? 2 : 1,
                  boxShadow: isDropTarget
                    ? "0 0 0 4px var(--accent-soft)"
                    : isSelected
                      ? "0 0 0 3px var(--accent-soft)"
                      : visual.muted
                        ? "none"
                        : "0 1px 2px rgba(15,23,42,0.04)",
                  cursor: locked ? "default" : "grab",
                  opacity: isDragSource ? 0.45 : 1,
                }}
                title={locked ? "Done blocks can't be moved" : "Drag to swap with another block"}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: visual.stripe }}
                />
                <div className={`flex h-full ${isCompact ? "items-center gap-2" : "flex-col justify-between gap-1"} pl-3 pr-3 ${isCompact ? "py-1" : "py-2"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p
                        className="truncate text-[0.86rem] font-semibold leading-tight"
                        style={{
                          color: visual.titleColor,
                          textDecoration: visual.muted ? "line-through" : "none",
                        }}
                      >
                        {block.title}
                      </p>
                      {visual.badge ? (
                        <span
                          className="shrink-0 rounded-full px-1.5 py-[1px] text-[0.62rem] font-bold uppercase tracking-[0.06em]"
                          style={{ background: visual.badge.bg, color: visual.badge.color }}
                        >
                          {visual.badge.label}
                        </span>
                      ) : null}
                    </div>
                    {!isCompact ? (
                      <p
                        className="mt-0.5 truncate text-[0.72rem]"
                        style={{ color: visual.metaColor }}
                      >
                        {timeLabel} · {durationLabel}
                        {block.taskCount ? ` · ${block.taskCount} task${block.taskCount === 1 ? "" : "s"}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {isCompact ? (
                    <span
                      className="shrink-0 text-[0.7rem] tabular-nums"
                      style={{ color: visual.metaColor }}
                    >
                      {minutesToTimeLabel(block.startMinutes)} · {durationLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-2.5"
        style={{ borderColor: "var(--line)", color: "var(--text-3)" }}
      >
        <span className="text-[0.72rem]">
          Click an empty slot to add · drag a block to swap times
        </span>
        {onClearDay && sortedBlocks.length > 0 ? (
          <button
            type="button"
            onClick={onClearDay}
            disabled={isClearingDay}
            className="inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[0.72rem] font-medium transition-colors hover:text-[var(--danger)] disabled:opacity-55"
            style={{
              borderColor: "var(--line)",
              background: "transparent",
              color: "var(--text-3)",
            }}
            title="Delete every block on this day"
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h10M6 4V2.5h4V4M5 4l.6 9a1 1 0 0 0 1 1h2.8a1 1 0 0 0 1-1L11 4" />
            </svg>
            {isClearingDay ? "Clearing…" : "Clear day"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
