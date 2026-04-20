import { InferSchemaType, Model, Schema, model, models } from "mongoose";

const reminderSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    dueAt: {
      type: Date,
      required: true,
      index: true,
    },
    done: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

reminderSchema.index({ userId: 1, dueAt: 1, done: 1 });

export type ReminderDocument = InferSchemaType<typeof reminderSchema> & { _id: string };

export const ReminderModel: Model<InferSchemaType<typeof reminderSchema>> =
  models.Reminder || model("Reminder", reminderSchema);
