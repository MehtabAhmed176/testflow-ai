import { Router } from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { CustomerDocument } from "../models/CustomerDocument.js";

export const documentsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
});

documentsRouter.post("/", (req, res, next) => {
  upload.single("file")(req, res, (uploadError) => {
    if (uploadError) {
      res.status(400).json({
        message:
          uploadError instanceof multer.MulterError &&
          uploadError.code === "LIMIT_FILE_SIZE"
            ? "PDF must be smaller than 10 MB"
            : "Upload failed. Send one PDF using the 'file' field.",
      });
      return;
    }

    async function processDocument() {
      const file = req.file;

      if (!file) {
        res.status(400).json({ message: "Please upload a PDF" });
        return;
      }

      // Check file contents instead of trusting the filename.
      const header = file.buffer.subarray(0, 1024).toString("latin1");

      if (!header.includes("%PDF-")) {
        res.status(400).json({ message: "The uploaded file is not a PDF" });
        return;
      }

      let pages: { pageNumber: number; text: string }[];

      try {
        const parser = new PDFParse({ data: file.buffer });

        try {
          const result = await parser.getText();

          pages = result.pages.map((page) => ({
            pageNumber: page.num,
            text: page.text.trim(),
          }));
        } finally {
          await parser.destroy();
        }
      } catch (error) {
        console.error("PDF extraction failed:", error);

        res.status(422).json({
          message:
            "Could not read this PDF. It may be damaged or password-protected.",
        });
        return;
      }

      const hasText = pages.some((page) => page.text.length > 0);

      const document = await CustomerDocument.create({
        filename: file.originalname,
        size: file.size,
        status: hasText ? "text_extracted" : "needs_ocr",
        pages,
      });

      res.status(201).json(document);
    }

    processDocument().catch(next);
  });
});

documentsRouter.get("/", async (_req, res, next) => {
  try {
    const documents = await CustomerDocument.find()
      .select("filename size status createdAt")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(documents);
  } catch (error) {
    next(error);
  }
});

documentsRouter.get("/:id", async (req, res, next) => {
  try {
    const { default: mongoose } = await import("mongoose");

    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      res.status(400).json({ message: "Invalid document ID" });
      return;
    }

    const document = await CustomerDocument.findById(req.params.id).lean();

    if (!document) {
      res.status(404).json({ message: "Document not found" });
      return;
    }

    res.json(document);
  } catch (error) {
    next(error);
  }
});