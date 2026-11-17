import { z } from "zod";

const conditionSchema = z.object({
  fieldId: z.string(),
  equals: z.union([
    z.string(),
    z.number(),
    z.boolean(),
  ]),
}).strict();

const fieldSchema = z.object({
  id: z.string(),
  label: z.string(),

  type: z.enum([
    "text",
    "textarea",
    "number",
    "boolean",
    "select",
  ]),

  required: z.boolean(),

  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string()).optional(),

  visibleWhen: conditionSchema.optional(),
  requiredWhen: conditionSchema.optional(),
}).strict();

export const extractionSchema = z.object({
  title: z.string(),
  description: z.string(),
  fields: z.array(fieldSchema),
}).strict();