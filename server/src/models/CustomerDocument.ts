import mongoose, { Schema } from "mongoose";

const customerDocumentSchema = new Schema(
  {
    filename: { type: String, required: true },
    size: { type: Number, required: true },
    status: {
      type: String,
      enum: ["text_extracted", "needs_ocr"],
      required: true,
    },
    pages: [
      {
        _id: false,
        pageNumber: { type: Number, required: true },
        text: { type: String, default: "" },
      },
    ],
  },
  { timestamps: true },
);

export const CustomerDocument = mongoose.model(
  "CustomerDocument",
  customerDocumentSchema,
);