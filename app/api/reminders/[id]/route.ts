import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUserIdFromCookies } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { ReminderModel } from "@/models/Reminder";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isInvalidObjectId(id: string) {
  return !mongoose.Types.ObjectId.isValid(id);
}

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const userId = await getAuthUserIdFromCookies();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (isInvalidObjectId(id)) {
      return NextResponse.json({ error: "Invalid reminder id." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    await connectToDatabase();

    const reminder = await ReminderModel.findOne({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });
    if (!reminder) {
      return NextResponse.json({ error: "Reminder not found." }, { status: 404 });
    }

    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return NextResponse.json({ error: "Reminder title is required." }, { status: 400 });
      }
      reminder.title = title;
    }

    if (body.note !== undefined) {
      if (typeof body.note !== "string") {
        return NextResponse.json({ error: "Invalid note value." }, { status: 400 });
      }
      reminder.note = body.note.trim();
    }

    if (body.dueAt !== undefined) {
      const dueAt = parseDate(body.dueAt);
      if (!dueAt) {
        return NextResponse.json({ error: "Invalid dueAt date/time." }, { status: 400 });
      }
      reminder.dueAt = dueAt;
    }

    if (body.done !== undefined) {
      if (typeof body.done !== "boolean") {
        return NextResponse.json({ error: "Invalid done value." }, { status: 400 });
      }
      reminder.done = body.done;
    }

    await reminder.save();
    return NextResponse.json(toReminderResponse(reminder));
  } catch (error) {
    console.error(`PATCH /api/reminders/${id} failed`, error);
    return NextResponse.json({ error: "Failed to update reminder." }, { status: 500 });
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
      return NextResponse.json({ error: "Invalid reminder id." }, { status: 400 });
    }

    await connectToDatabase();
    const deleted = await ReminderModel.findOneAndDelete({
      _id: toObjectId(id),
      userId: toObjectId(userId),
    });

    if (!deleted) {
      return NextResponse.json({ error: "Reminder not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/reminders/${id} failed`, error);
    return NextResponse.json({ error: "Failed to delete reminder." }, { status: 500 });
  }
}
