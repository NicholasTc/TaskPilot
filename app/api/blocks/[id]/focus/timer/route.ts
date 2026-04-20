import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { applyElapsedAndPauseIfNeeded, getRemainingSeconds } from "@/lib/focus-timer";
import { connectToDatabase } from "@/lib/db";
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
    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "pause" && action !== "resume") {
      return NextResponse.json({ error: "Invalid action. Use pause or resume." }, { status: 400 });
    }

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

    if (action === "pause") {
      block.timerState = "paused";
      block.runningSince = null;
    } else if (block.remainingSeconds > 0) {
      block.status = "active";
      block.timerState = "running";
      block.runningSince = new Date();
    }

    normalizeBlockSessionState(block);

    await block.save();

    return NextResponse.json({
      success: true,
      block: {
        id: block._id.toString(),
        status: block.status,
        timerState: block.timerState,
        remainingSeconds: block.remainingSeconds,
        effectiveRemainingSeconds: getRemainingSeconds(block),
        runningSince: block.runningSince ? block.runningSince.toISOString() : null,
      },
    });
  } catch (error) {
    console.error(`POST /api/blocks/${id}/focus/timer failed`, error);
    return NextResponse.json({ error: "Failed to update timer state." }, { status: 500 });
  }
}

