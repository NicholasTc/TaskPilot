import { InferSchemaType, Model, Schema, model, models } from "mongoose";

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
  },
  {
    timestamps: true,
  },
);

export type TaskDocument = InferSchemaType<typeof taskSchema> & { _id: string };

export const TaskModel: Model<InferSchemaType<typeof taskSchema>> =
  models.Task || model("Task", taskSchema);
