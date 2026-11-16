import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Form } from "../models/Form.js";

export const formsRouter = Router();

const conditionSchema = z.object({
  fieldId: z.string().trim().min(1),
  equals: z.union([z.string(), z.number(), z.boolean()]),
}).strict();

const fieldSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(["text", "number", "boolean", "select", "textarea"]),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  visibleWhen: conditionSchema.optional(),
  requiredWhen: conditionSchema.optional(),
}).strict();

const formInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(""),
  fields: z.array(fieldSchema).max(200).default([]),
}).strict().superRefine((form, ctx) => {
  const fieldsById = new Map(
    form.fields.map((field) => [field.id, field]),
  );

  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: "custom", path, message });
  };

  const seen = new Set<string>();

  form.fields.forEach((field, index) => {
    const path = ["fields", index];

    if (seen.has(field.id)) {
      issue([...path, "id"], "Field IDs must be unique");
    }
    seen.add(field.id);

    if (
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    ) {
      issue(path, "Minimum cannot exceed maximum");
    }

    if (
      field.type !== "number" &&
      (field.min !== undefined || field.max !== undefined)
    ) {
      issue(path, "Only number fields support min and max");
    }

    if (
      field.type === "select" &&
      (!field.options?.length ||
        new Set(field.options).size !== field.options.length ||
        field.options.some((option) => !option.trim()))
    ) {
      issue([...path, "options"], "Select fields need unique, non-empty options");
    }

    for (const key of ["visibleWhen", "requiredWhen"] as const) {
      const condition = field[key];
      if (!condition) continue;

      const source = fieldsById.get(condition.fieldId);

      if (!source) {
        issue([...path, key], "Referenced field does not exist");
        continue;
      }

      const expectedType =
        source.type === "boolean" ? "boolean" :
        source.type === "number" ? "number" : "string";

      if (typeof condition.equals !== expectedType) {
        issue([...path, key, "equals"], `Expected a ${expectedType} value`);
      }

      if (
        source.type === "select" &&
        !source.options?.includes(String(condition.equals))
      ) {
        issue([...path, key, "equals"], "Value must match a select option");
      }
    }
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function hasCycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;

    visiting.add(id);

    const field = fieldsById.get(id);
    const conditions = [field?.visibleWhen, field?.requiredWhen];

    for (const condition of conditions) {
      if (condition && hasCycle(condition.fieldId)) return true;
    }

    visiting.delete(id);
    visited.add(id);
    return false;
  }

  if (form.fields.some((field) => hasCycle(field.id))) {
    issue(["fields"], "Dependencies must not contain cycles");
  }
});

// Validate IDs before querying MongoDB.
formsRouter.param("id", (_req, res, next, id) => {
  if (!mongoose.isObjectIdOrHexString(id)) {
    res.status(400).json({ message: "Invalid form ID" });
    return;
  }
  next();
});

// Create a draft.
formsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = formInputSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.issues });
      return;
    }

    const form = await Form.create(parsed.data);
    res.status(201).json(form);
  } catch (error) {
    next(error);
  }
});

// List drafts without downloading all their fields.
formsRouter.get("/", async (_req, res, next) => {
  try {
    const forms = await Form.find()
      .select("title description status createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    res.json(forms);
  } catch (error) {
    next(error);
  }
});

// Load one complete form.
formsRouter.get("/:id", async (req, res, next) => {
  try {
    const form = await Form.findById(req.params.id).lean();

    if (!form) {
      res.status(404).json({ message: "Form not found" });
      return;
    }

    res.json(form);
  } catch (error) {
    next(error);
  }
});

// Replace the editable draft content.
formsRouter.put("/:id", async (req, res, next) => {
  try {
    const parsed = formInputSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ errors: parsed.error.issues });
      return;
    }

    const form = await Form.findByIdAndUpdate(
      req.params.id,
      { $set: parsed.data },
      { new: true, runValidators: true },
    );

    if (!form) {
      res.status(404).json({ message: "Form not found" });
      return;
    }

    res.json(form);
  } catch (error) {
    next(error);
  }
});