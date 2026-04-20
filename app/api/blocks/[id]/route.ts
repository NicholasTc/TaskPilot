import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  ensureNoBlockOverlap,
  isValidDayKey,
  isValidDuration,
  isValidStartMinutes,
} from "@/lib/study-blocks";
import { STUDY_BLOCK_STATUSES, StudyBlockModel } from "@/models/StudyBlock";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isInvalidObjectId(id: string) {
  return !mongoose.Types.ObjectId.isValid(id);
}

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
}) {
  return {
    id: block._id.toString(),
    dayKey: block.dayKey,
    title: block.title,
    startMinutes: block.startMinutes,
    durationMin: block.durationMin,
    status: block.status,
    activeTaskId: block.activeTaskId ? block.activeTaskId.toString() : null,
  };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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

    await connectToDatabase();
    const existing = await StudyBlockModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });
    if (!existing) {
      return NextResponse.json({ error: "Study block not found." }, { status: 404 });
    }

    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return NextResponse.json({ error: "Block title is required." }, { status: 400 });
      }
      existing.title = title;
    }

    if (body.dayKey !== undefined) {
      if (typeof body.dayKey !== "string" || !isValidDayKey(body.dayKey.trim())) {
        return NextResponse.json({ error: "Invalid dayKey." }, { status: 400 });
      }
      existing.dayKey = body.dayKey.trim();
    }

    if (body.status !== undefined) {
      if (
        typeof body.status !== "string" ||
        !STUDY_BLOCK_STATUSES.includes(body.status as (typeof STUDY_BLOCK_STATUSES)[number])
      ) {
        return NextResponse.json({ error: "Invalid status value." }, { status: 400 });
      }
      existing.status = body.status;
    }

    if (body.startMinutes !== undefined) {
      if (!isValidStartMinutes(body.startMinutes)) {
        return NextResponse.json({ error: "Invalid startMinutes value." }, { status: 400 });
      }
      existing.startMinutes = body.startMinutes;
    }

    if (body.durationMin !== undefined) {
      if (!isValidDuration(body.durationMin)) {
        return NextResponse.json({ error: "Invalid durationMin value." }, { status: 400 });
      }
      existing.durationMin = body.durationMin;
    }

    if (body.activeTaskId !== undefined) {
      if (
        body.activeTaskId !== null &&
        (typeof body.activeTaskId !== "string" || !mongoose.Types.ObjectId.isValid(body.activeTaskId))
      ) {
        return NextResponse.json({ error: "Invalid activeTaskId." }, { status: 400 });
      }
      existing.activeTaskId = body.activeTaskId ? toObjectId(body.activeTaskId) : null;
    }

    if (existing.startMinutes + existing.durationMin > 1440) {
      return NextResponse.json({ error: "Block cannot end after 23:59." }, { status: 400 });
    }

    const noOverlap = await ensureNoBlockOverlap({
      userId: toObjectId(userId),
      dayKey: existing.dayKey,
      startMinutes: existing.startMinutes,
      durationMin: existing.durationMin,
      excludeBlockId: id,
    });

    if (!noOverlap) {
      return NextResponse.json(
        { error: "Block overlaps with an existing block.", code: "BLOCK_OVERLAP" },
        { status: 409 },
      );
    }

    await existing.save();
    return NextResponse.json(toBlockResponse(existing));
  } catch (error) {
    console.error(`PATCH /api/blocks/${id} failed`, error);
    return NextResponse.json({ error: "Failed to update study block." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
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
    const deletedBlock = await StudyBlockModel.findOneAndDelete({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });

    if (!deletedBlock) {
      return NextResponse.json({ error: "Study block not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/blocks/${id} failed`, error);
    return NextResponse.json({ error: "Failed to delete study block." }, { status: 500 });
  }
}
