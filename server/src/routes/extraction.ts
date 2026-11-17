import { Router } from "express";
import mongoose from "mongoose";
import { CustomerDocument } from "../models/CustomerDocument.js";
import { extractForm, ExtractionError } from "../service/extractForm.js";
import { formInputSchema } from "./forms.js";

export const extractionRouter = Router();

extractionRouter.post(
    "/:documentId/extract-form",
    async (req, res, next) => {
        try {
            const { documentId } = req.params;


            if (!mongoose.isObjectIdOrHexString(documentId)) {
                res.status(400).json({ message: "Invalid document ID" });
                return;
            }


            const customerDoc = await CustomerDocument.findById(documentId).lean()

            if (!customerDoc) {
                res.status(404).json({ message: "Document not found" });
                return;
            }

            if (customerDoc.status !== "text_extracted" ||
                !customerDoc.pages.some((page) => page.text?.trim())) {
                res.status(422).json({
                    message: "This document has no readable text. OCR is required before form extraction.",
                });
                return;
            }

            const result = await extractForm(customerDoc.pages);
            const parsed = formInputSchema.safeParse(result);
            if (!parsed.success) {
                res.status(502).json({
                    message: "AI-generated form failed validation",
                    errors: parsed.error.issues,
                });
                return;
            }

            res.status(200).json(parsed.data);


        } catch (error) {
            if (error instanceof ExtractionError) {
                res.status(error.status).json({ message: error.message });
                return;
            }
            next(error);
        }
    },
);
