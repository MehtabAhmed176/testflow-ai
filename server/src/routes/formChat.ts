import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { CustomerDocument } from "../models/CustomerDocument.js";
import { Form } from "../models/Form.js";
import { chatWithForm, ExtractionError } from "../service/chatWithForm.js";
import { formInputSchema } from "./forms.js";

const chatInputSchema = z.object({
  message: z.string().trim().min(1),
  currentForm: formInputSchema,
  conversationId: z.string().uuid().optional(),
  selectedFieldId: z.string().trim().min(1).optional(),
}).strict();

// Replaceable in endpoint tests so they never call Claude.
export function createFormChatRouter(chat = chatWithForm) {
  const router = Router();
  router.post("/:formId/chat", async (req, res, next) => {
    try {
      const { formId } = req.params;
      if (!mongoose.isObjectIdOrHexString(formId)) {
        res.status(400).json({ message: "Invalid form ID" });
        return;
      }
      const parsed = chatInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid chat request", errors: parsed.error.issues });
        return;
      }
      const { message, currentForm, conversationId, selectedFieldId } = parsed.data;
      const savedForm = await Form.findById(formId).lean();
      if (!savedForm) {
        res.status(404).json({ message: "Form not found" });
        return;
      }
      if (selectedFieldId && !currentForm.fields.some((field) => field.id === selectedFieldId)) {
        res.status(400).json({ message: "Selected field is not in the current form", errors: [{
          code: "custom", path: ["selectedFieldId"], message: "Field not found in currentForm.fields",
        }] });
        return;
      }
      let extractedText = "";
      if (savedForm.sourceDocumentId) {
        const source = await CustomerDocument.findById(savedForm.sourceDocumentId).lean();
        if (!source) {
          res.status(404).json({ message: "Linked source document not found" });
          return;
        }
        if (source.status !== "text_extracted" || !source.pages.some((page) => page.text?.trim())) {
          res.status(422).json({ message: "Linked source document has no readable extracted text" });
          return;
        }
        extractedText = source.pages.map((page) => `Page ${page.pageNumber}:\n${page.text}`).join("\n\n");
      }
      console.log(`Req Body: ${req.body}`)
      const response = await chat({
        formId: String(savedForm._id), conversationId, extractedText,
        suggestedForm: JSON.stringify(currentForm), CSMessage: message, selectedFieldId,
      });
      // The service validates before committing history; defend the HTTP contract too.
      if (response.result.proposedForm !== null) {
        const proposal = formInputSchema.safeParse(response.result.proposedForm);
        if (!proposal.success) {
          throw new ExtractionError("Proposed form failed business validation.", 502, proposal.error.issues);
        }
        response.result.proposedForm = proposal.data;
      }
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export const formChatRouter = createFormChatRouter();
