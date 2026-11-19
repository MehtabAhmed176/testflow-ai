import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";

// Set before loading the service; all SDK calls below are mocked.
process.env.ANTHROPIC_API_KEY = "offline-test-placeholder";
process.env.ANTHROPIC_MODEL = "offline-test-model";
const { createFormChatRouter } = await import("../src/routes/formChat.ts");
const { chatWithForm, ExtractionError } = await import("../src/service/chatWithForm.ts");
const { Form } = await import("../src/models/Form.ts");
const { CustomerDocument } = await import("../src/models/CustomerDocument.ts");
const { errorHandler } = await import("../src/middleware/errorHandler.ts");
const { Messages } = await import("@anthropic-ai/sdk/resources/messages/messages");

const formId = "507f1f77bcf86cd799439011";
const sourceId = "507f1f77bcf86cd799439012";
const currentForm = { title: "Temperature test", description: "Unsaved form context", fields: [
  { id: "enabled", label: "Temperature testing", type: "boolean", required: false },
  { id: "temperature", label: "Temperature", type: "number", required: false,
    visibleWhen: { fieldId: "enabled", equals: true } },
] };
const validResult = { reply: "Temperature is visible when testing is enabled.", proposedForm: null };
const sdkMessage = (result) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(result) }] });

test("chat endpoint validates context and forwards only verified data without saving", async (t) => {
  t.after(() => t.mock.restoreAll());
  let savedForm = { _id: formId, sourceDocumentId: sourceId };
  let source = { status: "text_extracted", pages: [
    { pageNumber: 1, text: "First page" }, { pageNumber: 2, text: "Second page" },
  ] };
  const calls = [];
  let serviceError;
  let result = validResult;
  const conversationId = randomUUID();
  t.mock.method(Form, "findById", () => ({ lean: async () => savedForm }));
  const sourceLookup = t.mock.method(CustomerDocument, "findById", (id) => {
    assert.equal(String(id), sourceId);
    return { lean: async () => source };
  });
  t.mock.method(Form, "create", () => { throw new Error("Chat must not create forms"); });
  t.mock.method(Form, "findOneAndUpdate", () => { throw new Error("Chat must not update forms"); });
  const app = express();
  app.use(express.json({ strict: false }));
  app.use("/api/forms", createFormChatRouter(async (input) => {
    calls.push(input);
    if (serviceError) throw serviceError;
    return { conversationId, result: structuredClone(result) };
  }));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/forms`;
  async function post(body, id = formId) {
    const response = await fetch(`${base}/${id}/chat`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const body = { message: "  Explain the temperature dependency  ", currentForm, selectedFieldId: " temperature " };
  assert.equal((await post(body, "invalid")).status, 400);
  for (const invalid of [undefined, null, {}, { ...body, message: null }, { ...body, message: " " },
    { ...body, currentForm: null }, { ...body, conversationId: "invalid" },
    { ...body, selectedFieldId: " " }, { ...body, sourceDocumentId: sourceId },
    { ...body, currentForm: { ...currentForm, sourceDocumentId: sourceId } }]) {
    const response = await post(invalid);
    assert.equal(response.status, 400);
    assert.ok(response.body.errors.length);
  }
  assert.equal((await post({ ...body, selectedFieldId: "unknown" })).status, 400);
  assert.equal(calls.length, 0);
  savedForm = null;
  assert.equal((await post(body)).status, 404);
  savedForm = { _id: formId, sourceDocumentId: sourceId };
  source = null;
  assert.equal((await post(body)).status, 404);
  for (const invalid of [{ status: "needs_ocr", pages: [{ text: "Some text" }] },
    { status: "text_extracted", pages: [{ pageNumber: 1, text: "  " }] }]) {
    source = invalid;
    assert.equal((await post(body)).status, 422);
  }
  source = { status: "text_extracted", pages: [{ pageNumber: 1, text: "First page" }, { pageNumber: 2, text: "Second page" }] };
  const response = await post({ ...body, conversationId });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { conversationId, result: validResult });
  assert.deepEqual(calls.at(-1), { formId, conversationId, selectedFieldId: "temperature",
    CSMessage: "Explain the temperature dependency", suggestedForm: JSON.stringify(currentForm),
    extractedText: "Page 1:\nFirst page\n\nPage 2:\nSecond page" });
  savedForm = { _id: formId };
  const lookups = sourceLookup.mock.callCount();
  assert.equal((await post(body)).status, 200);
  assert.equal(calls.at(-1).extractedText, "");
  assert.equal(sourceLookup.mock.callCount(), lookups);
  result = { reply: "Proposal", proposedForm: { ...currentForm, fields: [currentForm.fields[1]] } };
  const invalidProposal = await post(body);
  assert.equal(invalidProposal.status, 502);
  assert.ok(invalidProposal.body.errors.length);
  result = { reply: "Proposal", proposedForm: currentForm };
  assert.deepEqual((await post(body)).body.result.proposedForm, currentForm);
  serviceError = new ExtractionError("Conversation belongs to another form", 409);
  assert.equal((await post(body)).status, 409);
  t.mock.restoreAll();
});

test("service preserves history, ownership and locking, and validates proposals before commit", async (t) => {
  t.after(() => t.mock.restoreAll());
  // Any accidental unmocked HTTP request fails locally rather than reaching Claude.
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Network forbidden in service tests"); });
  const requests = [];
  let reply = sdkMessage(validResult);
  let hold;
  t.mock.method(Messages.prototype, "create", async (input) => {
    requests.push(JSON.parse(JSON.stringify(input)));
    if (hold) return hold;
    return reply;
  });
  const input = { formId, extractedText: "", suggestedForm: JSON.stringify(currentForm),
    CSMessage: "Explain this", selectedFieldId: "temperature" };
  const first = await chatWithForm(input);
  assert.match(first.conversationId, /^[0-9a-f-]{36}$/);
  const context = JSON.parse(requests[0].messages[0].content);
  assert.equal(context.sourceAvailable, false);
  assert.equal(context.sourceDocument, "");
  assert.equal(context.selectedFieldId, "temperature");
  assert.equal(context.userMessage, input.CSMessage);
  assert.deepEqual(context.currentForm, currentForm);
  assert.match(requests[0].system, /Never invent quotes/);
  const continued = { ...input, conversationId: first.conversationId };
  const before = requests.length;
  await assert.rejects(() => chatWithForm({ ...input, conversationId: randomUUID() }), (error) => error.status === 404);
  await assert.rejects(() => chatWithForm({ ...continued, formId: sourceId }), (error) => error.status === 409);
  assert.equal(requests.length, before);
  const invalidForms = [
    { ...currentForm, fields: [currentForm.fields[0], currentForm.fields[0]] },
    { ...currentForm, fields: [currentForm.fields[1]] },
    { ...currentForm, fields: [{ id: "n", label: "N", type: "number", required: false, min: 10, max: 1 }] },
  ];
  for (const proposedForm of invalidForms) {
    reply = sdkMessage({ reply: "Invalid proposal", proposedForm });
    await assert.rejects(() => chatWithForm(continued), (error) => error.status === 502 && error.errors.length > 0);
    assert.equal(requests.at(-1).messages.length, 3);
  }
  for (const invalid of [
    { stop_reason: "refusal", content: [] }, { stop_reason: "max_tokens", content: [] },
    { stop_reason: "end_turn", content: [] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "invalid json" }] },
  ]) {
    reply = invalid;
    await assert.rejects(() => chatWithForm(continued), (error) => error.status === 502);
    assert.equal(requests.at(-1).messages.length, 3);
  }
  let release;
  hold = new Promise((resolve) => { release = resolve; });
  const pending = chatWithForm(continued);
  await assert.rejects(() => chatWithForm(continued), (error) => error.status === 409);
  release(sdkMessage({ reply: "Valid proposal", proposedForm: { ...currentForm, title: "  Updated  " } }));
  const valid = await pending;
  assert.equal(valid.result.proposedForm.title, "Updated");
  hold = undefined;
  reply = sdkMessage(validResult);
  await chatWithForm(continued);
  assert.equal(requests.at(-1).messages.length, 5);
  assert.equal(JSON.parse(requests.at(-1).messages[3].content).proposedForm.title, "Updated");
  t.mock.restoreAll();
});
