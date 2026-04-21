import { InferSchemaType, Model, Schema, model, models } from "mongoose";
import {
  DEFAULT_TASK_PRIORITY,
  TASK_PRIORITIES,
  type TaskPriority,
} from "@/lib/task-fields";

export const TASK_STATUSES = ["backlog", "planned", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export { TASK_PRIORITIES };
export type { TaskPriority };

const taskSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    meta: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    completed: {
      type: Boolean,
      default: false,
    },
    dayKey: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: "backlog",
      index: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    studyBlockId: {
      type: Schema.Types.ObjectId,
      ref: "StudyBlock",
      default: null,
      index: true,
    },
    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: DEFAULT_TASK_PRIORITY,
      index: true,
    },
    dueDate: {
      type: Date,
      default: null,
      index: true,
    },
    estimatedMinutes: {
      type: Number,
      default: null,
      min: 1,
      max: 24 * 60,
    },
  },
  {
    timestamps: true,
  },
);

taskSchema.index({ userId: 1, dayKey: 1, status: 1, order: 1 });
taskSchema.index({ userId: 1, dueDate: 1 });

export type TaskDocument = InferSchemaType<typeof taskSchema> & { _id: string };

export const TaskModel: Model<InferSchemaType<typeof taskSchema>> =
  models.Task || model("Task", taskSchema);
