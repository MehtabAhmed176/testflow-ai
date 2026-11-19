import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Compile the small browser-independent client modules in memory, no new test dependencies.
const nodeRequire = createRequire(import.meta.url);
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name).exports;
  const file = fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url));
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  modules.set(name, module);
  new Function("require", "module", "exports", source)(
    (path) => path.startsWith("./") ? load(path.slice(2)) : nodeRequire(path), module, module.exports,
  );
  return module.exports;
}
const { ApiError } = load("api");
const { FormChatSession, formFingerprint } = load("formChat");
const draft = { title: "Test", description: "Unsaved edits", fields: [
  { id: "temperature", label: "Temperature", type: "number", required: false },
] };
const response = (proposedForm = null) => ({ conversationId: "conversation-one", result: { reply: "Answer <script>text</script>", proposedForm } });

test("chat sends latest editable state and context, retains the conversation, and never auto-applies", async () => {
  const requests = [];
  const session = new FormChatSession("saved-id", async (id, body) => {
    requests.push({ id, body });
    return response({ ...draft, title: "Proposed" });
  });
  const original = structuredClone(draft);
  await session.send("  Explain  ", { ...draft, _id: "ignored", sourceDocumentId: "secret-source", revision: 7 }, 3, "temperature");
  assert.deepEqual(requests[0], { id: "saved-id", body: { message: "Explain", currentForm: draft, selectedFieldId: "temperature" } });
  assert.deepEqual(draft, original);
  const proposal = session.getSnapshot().messages[1].proposal;
  assert.deepEqual(proposal.before, draft);
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.fingerprint, formFingerprint(draft));
  assert.notEqual(proposal.fingerprint, formFingerprint({ ...draft, title: "Changed while waiting" }));
  const reordered = { fields: [{ required: false, type: "number", label: "Temperature", id: "temperature", unit: undefined }], description: "Unsaved edits", title: "Test" };
  assert.equal(formFingerprint(reordered), proposal.fingerprint);
  await session.send("Next", { ...draft, title: "Latest title" }, 4, "removed-field");
  assert.equal(requests[1].body.currentForm.title, "Latest title");
  assert.equal(requests[1].body.conversationId, "conversation-one");
  assert.equal("selectedFieldId" in requests[1].body, false);
  session.finish(session.getSnapshot().messages[1].id, "discarded");
  assert.equal(session.getSnapshot().messages[1].proposal.status, "discarded");
  assert.deepEqual(draft, original);
});

test("unsaved/blank/duplicate sends are blocked; failures retry without duplicate bubbles", async () => {
  let count = 0;
  const unsaved = new FormChatSession("", async () => { count++; return response(); });
  assert.equal(await unsaved.send("Hello", draft, 0), false);
  const session = new FormChatSession("saved", async () => { count++; throw new Error("Offline"); });
  assert.equal(await session.send("  ", draft, 0), false);
  assert.equal(count, 0);
  await session.send("Retry me", draft, 0);
  await session.send("Retry me", draft, 0);
  assert.equal(count, 2);
  assert.equal(session.getSnapshot().messages.length, 1);
  assert.equal(session.getSnapshot().messages[0].text, "Retry me");
  assert.equal(session.getSnapshot().error, "Offline");
  let release;
  const waiting = new FormChatSession("saved", () => new Promise((resolve) => { release = resolve; }));
  const first = waiting.send("Wait", draft, 0);
  assert.equal(waiting.getSnapshot().pending, true);
  assert.equal(await waiting.send("Duplicate", draft, 0), false);
  release(response());
  await first;
  assert.equal(waiting.getSnapshot().messages.length, 2);
  assert.equal(waiting.getSnapshot().messages[1].proposal, undefined);
});

test("only explicit conversation expiry offers reset, and reset/cleanup ignore late responses", async () => {
  let failure;
  const requests = [];
  const session = new FormChatSession("saved", async (_id, body) => {
    requests.push(body);
    if (failure) throw failure;
    return response();
  });
  await session.send("First", draft, 0);
  failure = new ApiError(404, "Linked source document not found");
  await session.send("Question", draft, 0);
  assert.equal(session.getSnapshot().expired, false);
  failure = new ApiError(404, "Conversation not found or expired. Start a new conversation.");
  await session.send("Question", draft, 0);
  assert.equal(session.getSnapshot().expired, true);
  assert.equal(session.getSnapshot().conversationId, "conversation-one");
  assert.equal(await session.send("Blocked", draft, 0), false);
  session.startNew();
  assert.equal(session.getSnapshot().conversationId, undefined);
  failure = undefined;
  await session.send("New conversation", draft, 0);
  assert.equal("conversationId" in requests.at(-1), false);
  let release;
  let signal;
  const old = new FormChatSession("old-form", (_id, _body, pendingSignal) => {
    signal = pendingSignal;
    return new Promise((resolve) => { release = resolve; });
  });
  const pending = old.send("Old request", draft, 0);
  old.startNew();
  release(response(draft));
  assert.equal(await pending, false);
  assert.equal(signal.aborted, true);
  assert.equal(old.getSnapshot().messages.length, 0);
  assert.equal(old.getSnapshot().conversationId, undefined);
});

test("real client adapter builds the API request with mocked fetch only", async (t) => {
  let request;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify(response()), { status: 200 });
  });
  const session = new FormChatSession("persisted-id");
  await session.send("Explain", draft, 0);
  assert.equal(request.url, "http://localhost:4000/api/forms/persisted-id/chat");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { message: "Explain", currentForm: draft });
  assert.equal(session.getSnapshot().messages[1].text, response().result.reply);
});
