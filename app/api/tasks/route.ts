import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { TASK_STATUSES, TaskModel } from "@/models/Task";
import { toTaskResponse } from "@/lib/task-response";
import {
  DEFAULT_TASK_PRIORITY,
  parseDueDate,
  parseEstimatedMinutes,
  parseTaskPriority,
} from "@/lib/task-fields";

const taskSortOrder = { completed: 1 as const, createdAt: -1 as const };
const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function parseDayKey(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return dayKeyPattern.test(trimmed) ? trimmed : null;
}

function parseTaskStatus(value: unknown) {
  if (typeof value !== "string") return null;
  return TASK_STATUSES.includes(value as (typeof TASK_STATUSES)[number])
    ? (value as (typeof TASK_STATUSES)[number])
    : null;
}

function parseTaskOrder(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export async function GET() {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    await connectToDatabase();
    const tasks = await TaskModel.find({ userId: toObjectId(userId) }).sort(taskSortOrder).lean();
    const response = tasks.map(toTaskResponse);

    return NextResponse.json(response);
  } catch (error) {
    console.error("GET /api/tasks failed", error);
    return NextResponse.json({ error: "Failed to load tasks." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const meta = typeof body.meta === "string" ? body.meta.trim() : "";
    const dayKey = parseDayKey(body.dayKey);
    const status = parseTaskStatus(body.status) ?? "backlog";
    const order = parseTaskOrder(body.order) ?? 0;
    const priority = parseTaskPriority(body.priority) ?? DEFAULT_TASK_PRIORITY;
    // For create, `undefined` (invalid or absent) collapses to null.
    const dueDateParsed = parseDueDate(body.dueDate);
    const dueDate = dueDateParsed === undefined ? null : dueDateParsed;
    const estimateParsed = parseEstimatedMinutes(body.estimatedMinutes);
    const estimatedMinutes = estimateParsed === undefined ? null : estimateParsed;

    if (!name) {
      return NextResponse.json({ error: "Task name is required." }, { status: 400 });
    }

    await connectToDatabase();
    const createdTask = await TaskModel.create({
      userId: toObjectId(userId),
      name,
      meta,
      completed: status === "done",
      dayKey,
      status,
      order,
      priority,
      dueDate,
      estimatedMinutes,
    });

    return NextResponse.json(toTaskResponse(createdTask), { status: 201 });
  } catch (error) {
    console.error("POST /api/tasks failed", error);
    return NextResponse.json({ error: "Failed to create task." }, { status: 500 });
  }
}
