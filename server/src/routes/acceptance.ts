import { Router } from "express";
import mongoose from "mongoose";
import { CustomerDocument } from "../models/CustomerDocument.js";
import { Form } from "../models/Form.js";
import { formInputSchema } from "./forms.js";

export const acceptanceRouter = Router();

acceptanceRouter.post(
  "/:documentId/accept-form",
  async (req, res, next) => {
    try {
      const { documentId } = req.params;

      if (!mongoose.isObjectIdOrHexString(documentId)) {
        res.status(400).json({ message: "Invalid document ID" });
        return;
      }

      const extractedDocument =
        await CustomerDocument.findById(documentId).lean();

      if (!extractedDocument) {
        res.status(404).json({
          message: "Document with this ID not found",
        });
        return;
      }

      if (extractedDocument.status !== "text_extracted" ||
          !extractedDocument.pages.some((page) => page.text?.trim())) {
        res.status(422).json({
          message: "Document must have extracted text before acceptance",
        });
        return;
      }

      const parsed = formInputSchema.safeParse(req.body?.form);

      if (!parsed.success) {
        res.status(400).json({
          message: "Invalid form definition",
          errors: parsed.error.issues,
        });
        return;
      }

      const savedForm = await Form.create({
        ...parsed.data,
        sourceDocumentId: extractedDocument._id,
        status: "draft",
        revision: 1,
      });

      res.status(201).json(savedForm);
    } catch (error) {
      next(error);
    }
  },
);
