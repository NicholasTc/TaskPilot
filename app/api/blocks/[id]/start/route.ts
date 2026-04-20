import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { applyElapsedAndPauseIfNeeded, getDefaultRemainingSeconds } from "@/lib/focus-timer";
import { normalizeBlockSessionState } from "@/lib/study-block-state";
import { StudyBlockModel } from "@/models/StudyBlock";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isInvalidObjectId(id: string) {
  return !mongoose.Types.ObjectId.isValid(id);
}

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (isInvalidObjectId(id)) {
      return NextResponse.json({ error: "Invalid block id." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const activeTaskId =
      typeof body.activeTaskId === "string" && mongoose.Types.ObjectId.isValid(body.activeTaskId)
        ? body.activeTaskId
        : null;

    await connectToDatabase();
    const block = await StudyBlockModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });
    if (!block) {
      return NextResponse.json({ error: "Study block not found." }, { status: 404 });
    }

    applyElapsedAndPauseIfNeeded(block);
    if (block.status === "done") {
      return NextResponse.json(
        { error: "Block is already done." },
        { status: 409 },
      );
    }
    block.status = "active";
    if (block.remainingSeconds <= 0) {
      block.remainingSeconds = getDefaultRemainingSeconds(block.durationMin);
    }
    block.timerState = "running";
    block.runningSince = new Date();
    if (activeTaskId !== null) {
      block.activeTaskId = toObjectId(activeTaskId);
    }
    normalizeBlockSessionState(block);

    await block.save();

    return NextResponse.json({
      success: true,
      block: {
        id: block._id.toString(),
        status: block.status,
        activeTaskId: block.activeTaskId ? block.activeTaskId.toString() : null,
        timerState: block.timerState,
        remainingSeconds: block.remainingSeconds,
        runningSince: block.runningSince ? block.runningSince.toISOString() : null,
      },
    });
  } catch (error) {
    console.error(`POST /api/blocks/${id}/start failed`, error);
    return NextResponse.json({ error: "Failed to start study block." }, { status: 500 });
  }
}
