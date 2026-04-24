import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { applyElapsedAndPauseIfNeeded } from "@/lib/focus-timer";
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

export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (isInvalidObjectId(id)) {
      return NextResponse.json({ error: "Invalid block id." }, { status: 400 });
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
    block.status = "done";
    normalizeBlockSessionState(block);
    await block.save();

    return NextResponse.json({
      success: true,
      block: {
        id: block._id.toString(),
        status: block.status,
        activeTaskId: block.activeTaskId,
        timerState: block.timerState,
        remainingSeconds: block.remainingSeconds,
      },
    });
  } catch (error) {
    console.error(`POST /api/blocks/${id}/end failed`, error);
    return NextResponse.json({ error: "Failed to end study block." }, { status: 500 });
  }
}
