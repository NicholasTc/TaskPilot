/**
 * Slot generation.
 *
 * For each day, we pre-compute a fixed list of focus-block slots using
 * the planner settings. Slots are:
 *
 *   - Exactly `blockSizeMinutes` long
 *   - Separated by `shortBreakMinutes` gaps
 *   - Contained within [dayStartHour, dayEndHour)
 *   - Capped at `maxFocusBlocksPerDay`
 *
 * Example (dayStart=10, dayEnd=18, block=60, break=10, max=4):
 *   10:00–11:00
 *   11:10–12:10
 *   12:20–13:20
 *   13:30–14:30
 *
 * The cap is a product safety rail: even if the day has more clock time,
 * we never schedule more than N deep-focus blocks so users aren't crushed.
 */

import { minutesToHhmm } from "./dates";
import type { PlannerSettings } from "./types";

export type DaySlot = {
  /** 0-based index of this slot within the day. */
  slotIndex: number;
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
};

export function generateDaySlots(settings: PlannerSettings): DaySlot[] {
  const {
    dayStartHour,
    dayEndHour,
    blockSizeMinutes,
    shortBreakMinutes,
    maxFocusBlocksPerDay,
  } = settings;

  validateSettings(settings);

  const dayStart = dayStartHour * 60;
  const dayEnd = dayEndHour * 60;

  const slots: DaySlot[] = [];
  let cursor = dayStart;
  let index = 0;

  while (
    slots.length < maxFocusBlocksPerDay &&
    cursor + blockSizeMinutes <= dayEnd
  ) {
    const startMinutes = cursor;
    const endMinutes = cursor + blockSizeMinutes;
    slots.push({
      slotIndex: index,
      startMinutes,
      endMinutes,
      startTime: minutesToHhmm(startMinutes),
      endTime: minutesToHhmm(endMinutes),
      durationMinutes: blockSizeMinutes,
    });
    cursor = endMinutes + shortBreakMinutes;
    index += 1;
  }

  return slots;
}

function validateSettings(s: PlannerSettings): void {
  if (s.dayEndHour <= s.dayStartHour) {
    throw new Error(
      `PlannerSettings: dayEndHour (${s.dayEndHour}) must be greater than dayStartHour (${s.dayStartHour}).`,
    );
  }
  if (s.blockSizeMinutes < 15) {
    throw new Error(`PlannerSettings: blockSizeMinutes must be >= 15.`);
  }
  if (s.shortBreakMinutes < 0) {
    throw new Error(`PlannerSettings: shortBreakMinutes must be >= 0.`);
  }
  if (s.maxFocusBlocksPerDay < 1) {
    throw new Error(`PlannerSettings: maxFocusBlocksPerDay must be >= 1.`);
  }
  if (s.planningHorizonDays < 1) {
    throw new Error(`PlannerSettings: planningHorizonDays must be >= 1.`);
  }
}
