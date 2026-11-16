import mongoose, { Schema } from "mongoose";

const conditionSchema = new Schema(
  {
    fieldId: { type: String, required: true },
    equals: {
      type: Schema.Types.Mixed,
      required: true,
    },
  },
  { _id: false },
);

const fieldSchema = new Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    type: {
      type: String,
      enum: ["text", "number", "boolean", "select", "textarea"],
      required: true,
    },
    unit: String,
    min: Number,
    max: Number,
    required: { type: Boolean, default: false },
    options: { type: [String], default: undefined },
    visibleWhen: {
      type: conditionSchema,
      default: undefined,
    },
    requiredWhen: {
      type: conditionSchema,
      default: undefined,
    },
  },
  { _id: false },
);

const formSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["draft"],
      default: "draft",
    },
    fields: { type: [fieldSchema], default: [] },
  },
  { timestamps: true },
);

export const Form = mongoose.model("Form", formSchema);