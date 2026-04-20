import mongoose from "mongoose";
import { StudyBlockModel } from "@/models/StudyBlock";

export const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDayKey(value: string | null) {
  return !!value && dayKeyPattern.test(value);
}

export function isValidStartMinutes(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1439;
}

export function isValidDuration(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 15 && value <= 720;
}

export function getBlockEnd(startMinutes: number, durationMin: number) {
  return startMinutes + durationMin;
}

export function hasTimeOverlap(
  firstStart: number,
  firstDuration: number,
  secondStart: number,
  secondDuration: number,
) {
  const firstEnd = getBlockEnd(firstStart, firstDuration);
  const secondEnd = getBlockEnd(secondStart, secondDuration);
  return firstStart < secondEnd && secondStart < firstEnd;
}

export async function ensureNoBlockOverlap(params: {
  userId: mongoose.Types.ObjectId;
  dayKey: string;
  startMinutes: number;
  durationMin: number;
  excludeBlockId?: string;
}) {
  const { userId, dayKey, startMinutes, durationMin, excludeBlockId } = params;

  const sameDayBlocks = await StudyBlockModel.find({
    userId,
    dayKey,
    ...(excludeBlockId ? { _id: { $ne: new mongoose.Types.ObjectId(excludeBlockId) } } : {}),
  })
    .select("startMinutes durationMin")
    .lean();

  const hasOverlap = sameDayBlocks.some((block) =>
    hasTimeOverlap(startMinutes, durationMin, block.startMinutes, block.durationMin),
  );

  return !hasOverlap;
}
