import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TaskModel } from "@/models/Task";
import { StudyBlockModel } from "@/models/StudyBlock";
import {
  DailyFlowBlock,
  DailyFlowTask,
  deriveDailyFlow,
} from "@/lib/daily-flow";
import { normalizeTaskState } from "@/lib/task-status";

const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const dayParam = request.nextUrl.searchParams.get("day");
    const dayKey =
      dayParam && dayKeyPattern.test(dayParam) ? dayParam : getTodayKey();

    await connectToDatabase();
    const userObjectId = toObjectId(userId);

    const [tasks, blocks] = await Promise.all([
      TaskModel.find({ userId: userObjectId, dayKey }).lean(),
      StudyBlockModel.find({ userId: userObjectId, dayKey }).lean(),
    ]);

    const flowTasks: DailyFlowTask[] = tasks.map((t) => ({
      id: String(t._id),
      status: normalizeTaskState(t).status,
      studyBlockId: t.studyBlockId ? String(t.studyBlockId) : null,
    }));

    const flowBlocks: DailyFlowBlock[] = blocks.map((b) => ({
      id: String(b._id),
      status: (b.status ?? "planned") as DailyFlowBlock["status"],
    }));

    const flow = deriveDailyFlow(flowTasks, flowBlocks);

    return NextResponse.json({ dayKey, ...flow });
  } catch (error) {
    console.error("GET /api/daily-flow failed", error);
    return NextResponse.json({ error: "Failed to derive daily flow." }, { status: 500 });
  }
}
