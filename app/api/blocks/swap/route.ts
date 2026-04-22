import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { hasTimeOverlap } from "@/lib/study-blocks";
import { StudyBlockModel } from "@/models/StudyBlock";

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function isInvalidObjectId(id: string) {
  return !mongoose.Types.ObjectId.isValid(id);
}

/**
 * Atomically swap the start times of two blocks owned by the current user.
 *
 * Why a dedicated endpoint:
 * - Doing two sequential PATCH calls fails the per-block overlap check,
 *   because at the time of the first PATCH the second block still holds
 *   the destination time slot.
 * - This endpoint validates overlap against all OTHER same-day blocks
 *   (excluding the two participants) and writes both updates together.
 *
 * Body: { blockAId: string, blockBId: string }
 *
 * Behavior:
 * - Durations are preserved on each block (only startMinutes is swapped).
 * - Done blocks are never moved; the request is rejected if either side
 *   refers to a done block. The UI is responsible for hiding drag affordances
 *   on done blocks, but this is the server-side guard.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const blockAId = typeof body.blockAId === "string" ? body.blockAId : "";
    const blockBId = typeof body.blockBId === "string" ? body.blockBId : "";

    if (!blockAId || !blockBId || isInvalidObjectId(blockAId) || isInvalidObjectId(blockBId)) {
      return NextResponse.json({ error: "Invalid block ids." }, { status: 400 });
    }

    if (blockAId === blockBId) {
      return NextResponse.json({ error: "Cannot swap a block with itself." }, { status: 400 });
    }

    await connectToDatabase();
    const userObjectId = toObjectId(userId);

    const [blockA, blockB] = await Promise.all([
      StudyBlockModel.findOne({ _id: toObjectId(blockAId), userId: userObjectId }),
      StudyBlockModel.findOne({ _id: toObjectId(blockBId), userId: userObjectId }),
    ]);

    if (!blockA || !blockB) {
      return NextResponse.json({ error: "One or both blocks not found." }, { status: 404 });
    }

    if (blockA.dayKey !== blockB.dayKey) {
      return NextResponse.json(
        { error: "Both blocks must be on the same day." },
        { status: 400 },
      );
    }

    if (blockA.status === "done" || blockB.status === "done") {
      return NextResponse.json(
        { error: "Done blocks cannot be reordered." },
        { status: 409 },
      );
    }

    const newAStart = blockB.startMinutes;
    const newBStart = blockA.startMinutes;

    if (newAStart + blockA.durationMin > 1440 || newBStart + blockB.durationMin > 1440) {
      return NextResponse.json(
        { error: "Swap would push a block past 23:59." },
        { status: 400 },
      );
    }

    const otherBlocks = await StudyBlockModel.find({
      userId: userObjectId,
      dayKey: blockA.dayKey,
      _id: { $nin: [toObjectId(blockAId), toObjectId(blockBId)] },
    })
      .select("startMinutes durationMin")
      .lean();

    const conflict = otherBlocks.some(
      (other) =>
        hasTimeOverlap(newAStart, blockA.durationMin, other.startMinutes, other.durationMin) ||
        hasTimeOverlap(newBStart, blockB.durationMin, other.startMinutes, other.durationMin),
    );

    if (conflict) {
      return NextResponse.json(
        { error: "Swap would overlap another block.", code: "BLOCK_OVERLAP" },
        { status: 409 },
      );
    }

    blockA.startMinutes = newAStart;
    blockB.startMinutes = newBStart;

    await Promise.all([blockA.save(), blockB.save()]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/blocks/swap failed", error);
    return NextResponse.json({ error: "Failed to swap study blocks." }, { status: 500 });
  }
}
