import { InferSchemaType, Model, Schema, model, models } from "mongoose";

export const STUDY_BLOCK_STATUSES = ["planned", "active", "done"] as const;
export type StudyBlockStatus = (typeof STUDY_BLOCK_STATUSES)[number];

const studyBlockSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    dayKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    startMinutes: {
      type: Number,
      required: true,
      min: 0,
      max: 1439,
    },
    durationMin: {
      type: Number,
      required: true,
      min: 15,
      max: 720,
      default: 120,
    },
    status: {
      type: String,
      enum: STUDY_BLOCK_STATUSES,
      default: "planned",
      index: true,
    },
    activeTaskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

studyBlockSchema.index({ userId: 1, dayKey: 1, startMinutes: 1 });

export type StudyBlockDocument = InferSchemaType<typeof studyBlockSchema> & { _id: string };

export const StudyBlockModel: Model<InferSchemaType<typeof studyBlockSchema>> =
  models.StudyBlock || model("StudyBlock", studyBlockSchema);
