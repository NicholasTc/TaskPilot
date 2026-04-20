import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { ReminderModel } from "@/models/Reminder";

function toObjectId(value: string) {
  return new mongoose.Types.ObjectId(value);
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toReminderResponse(reminder: {
  _id: mongoose.Types.ObjectId | string;
  title: string;
  note?: string;
  dueAt: Date;
  done: boolean;
}) {
  return {
    id: reminder._id.toString(),
    title: reminder.title,
    note: reminder.note || "",
    dueAt: reminder.dueAt.toISOString(),
    done: reminder.done,
  };
}

export async function GET() {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    await connectToDatabase();
    const reminders = await ReminderModel.find({ userId: toObjectId(userId) })
      .sort({ done: 1, dueAt: 1, createdAt: 1 })
      .lean();

    return NextResponse.json(reminders.map(toReminderResponse));
  } catch (error) {
    console.error("GET /api/reminders failed", error);
    return NextResponse.json({ error: "Failed to load reminders." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const dueAt = parseDate(body.dueAt);
    const done = typeof body.done === "boolean" ? body.done : false;

    if (!title) {
      return NextResponse.json({ error: "Reminder title is required." }, { status: 400 });
    }

    if (!dueAt) {
      return NextResponse.json({ error: "Invalid dueAt date/time." }, { status: 400 });
    }

    await connectToDatabase();
    const created = await ReminderModel.create({
      userId: toObjectId(userId),
      title,
      note,
      dueAt,
      done,
    });

    return NextResponse.json(toReminderResponse(created), { status: 201 });
  } catch (error) {
    console.error("POST /api/reminders failed", error);
    return NextResponse.json({ error: "Failed to create reminder." }, { status: 500 });
  }
}
