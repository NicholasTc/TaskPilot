import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { getDefaultRemainingSeconds, getRemainingSeconds } from "@/lib/focus-timer";
import {
  ensureNoBlockOverlap,
  isValidDayKey,
  isValidDuration,
  isValidStartMinutes,
} from "@/lib/study-blocks";
import { STUDY_BLOCK_STATUSES, StudyBlockModel } from "@/models/StudyBlock";

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function toBlockResponse(block: {
  _id: mongoose.Types.ObjectId | string;
  dayKey: string;
  title: string;
  startMinutes: number;
  durationMin: number;
  status: string;
  activeTaskId?: mongoose.Types.ObjectId | string | null;
  remainingSeconds?: number;
  timerState?: "paused" | "running";
  runningSince?: Date | null;
}) {
  const remainingSeconds = Math.max(0, Math.floor(block.remainingSeconds ?? block.durationMin * 60));
  const timerState = block.timerState ?? "paused";
  const runningSince = block.runningSince ?? null;

  return {
    id: block._id.toString(),
    dayKey: block.dayKey,
    title: block.title,
    startMinutes: block.startMinutes,
    durationMin: block.durationMin,
    status: block.status,
    activeTaskId: block.activeTaskId ? block.activeTaskId.toString() : null,
    timerState,
    remainingSeconds,
    effectiveRemainingSeconds: getRemainingSeconds({
      remainingSeconds,
      timerState,
      runningSince,
    }),
    runningSince: runningSince ? runningSince.toISOString() : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const dayKey = request.nextUrl.searchParams.get("day");
    if (!isValidDayKey(dayKey)) {
      return NextResponse.json(
        { error: "Missing or invalid day query parameter. Expected YYYY-MM-DD." },
        { status: 400 },
      );
    }

    await connectToDatabase();
    const blocks = await StudyBlockModel.find({
      userId: toObjectId(userId),
      dayKey,
    })
      .sort({ startMinutes: 1, createdAt: 1 })
      .lean();

    return NextResponse.json({
      dayKey,
      blocks: blocks.map(toBlockResponse),
    });
  } catch (error) {
    console.error("GET /api/blocks failed", error);
    return NextResponse.json({ error: "Failed to load study blocks." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const dayKey = typeof body.dayKey === "string" ? body.dayKey.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const startMinutes = body.startMinutes;
    const durationMin = body.durationMin;
    const status =
      typeof body.status === "string" &&
      STUDY_BLOCK_STATUSES.includes(body.status as (typeof STUDY_BLOCK_STATUSES)[number])
        ? body.status
        : "planned";
    const activeTaskId =
      typeof body.activeTaskId === "string" && mongoose.Types.ObjectId.isValid(body.activeTaskId)
        ? body.activeTaskId
        : null;

    if (!isValidDayKey(dayKey)) {
      return NextResponse.json({ error: "Invalid dayKey." }, { status: 400 });
    }

    if (!title) {
      return NextResponse.json({ error: "Block title is required." }, { status: 400 });
    }

    if (!isValidStartMinutes(startMinutes)) {
      return NextResponse.json({ error: "Invalid startMinutes value." }, { status: 400 });
    }

    if (!isValidDuration(durationMin)) {
      return NextResponse.json({ error: "Invalid durationMin value." }, { status: 400 });
    }

    const endMinutes = startMinutes + durationMin;
    if (endMinutes > 1440) {
      return NextResponse.json({ error: "Block cannot end after 23:59." }, { status: 400 });
    }

    await connectToDatabase();
    const userObjectId = toObjectId(userId);
    const noOverlap = await ensureNoBlockOverlap({
      userId: userObjectId,
      dayKey,
      startMinutes,
      durationMin,
    });

    if (!noOverlap) {
      return NextResponse.json(
        { error: "Block overlaps with an existing block.", code: "BLOCK_OVERLAP" },
        { status: 409 },
      );
    }

    const createdBlock = await StudyBlockModel.create({
      userId: userObjectId,
      dayKey,
      title,
      startMinutes,
      durationMin,
      status,
      activeTaskId: activeTaskId ? toObjectId(activeTaskId) : null,
      remainingSeconds: getDefaultRemainingSeconds(durationMin),
      timerState: "paused",
      runningSince: null,
    });

    return NextResponse.json(toBlockResponse(createdBlock), { status: 201 });
  } catch (error) {
    console.error("POST /api/blocks failed", error);
    return NextResponse.json({ error: "Failed to create study block." }, { status: 500 });
  }
}
