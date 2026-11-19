import type { Field, FormDraft } from "./App";

export type DemoReply = { text: string; propose?: boolean };

// Replace this adapter with a backend call later; the UI owns no AI credentials.
export function demoReply(prompt: string, draft: FormDraft, field?: Field): DemoReply {
  if (/sample|proposal/i.test(prompt)) return {
    text: "Sample proposal only — no AI analysis: add ‘(reviewed)’ to a field label to demonstrate review and approval.",
    propose: true,
  };
  if (/dependenc/i.test(prompt)) {
    const targets = field ? draft.fields.filter((f) => f.id === field.id ||
      f.visibleWhen?.fieldId === field.id || f.requiredWhen?.fieldId === field.id) : draft.fields;
    const rules = targets.flatMap((f) => (["visibleWhen", "requiredWhen"] as const).flatMap((key) => {
      const rule = f[key];
      if (!rule) return [];
      const source = draft.fields.find((item) => item.id === rule.fieldId);
      return [`${f.label} (${f.id}): ${key} ${source?.label ?? rule.fieldId} = ${String(rule.equals)}.`];
    }));
    return { text: `Current form definitions only; no document analysis.\n${rules.join("\n") || "No conditional rules in this context."}` };
  }
  if (/why|explain|evidence|source/i.test(prompt)) return {
    text: `${field ? `Selected field: ${field.label} (${field.id}).\n` : ""}Source evidence not available yet. The demo cannot explain the customer's intent. AI is not connected.`,
  };
  if (/missing/i.test(prompt)) return {
    text: "Demo review checklist, not findings: Are required answers agreed? Are units and numeric limits confirmed? Are conditional rules complete? Source evidence not available yet; the demo cannot determine what the document is missing.",
  };
  return { text: "Demo — AI not connected. This request is unsupported. Try checking current dependencies or reviewing a sample proposal. No form changes were made." };
}

export function sampleProposal(draft: FormDraft, contextId: string) {
  const field = draft.fields.find((item) => item.id === contextId) ?? draft.fields[0];
  if (!field) return null;
  const after = structuredClone(draft);
  const label = `${field.label} (reviewed)`;
  after.fields = after.fields.map((item) => item.id === field.id ? { ...item, label } : item);
  return { fieldId: field.id, beforeLabel: field.label, afterLabel: label, after };
}
