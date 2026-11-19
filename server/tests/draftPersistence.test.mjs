import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import mongoose from "mongoose";
import { formsRouter } from "../src/routes/forms.ts";
import { acceptanceRouter } from "../src/routes/acceptance.ts";
import { Form } from "../src/models/Form.ts";
import { CustomerDocument } from "../src/models/CustomerDocument.ts";

// Uses a unique local test database; never imports the AI extraction service.
test("accepted drafts retain source links and enforce atomic revisions", async () => {
  const dbName = `testflow_verification_${Date.now()}_${process.pid}`;
  let server;
  try {
    await mongoose.connect("mongodb://127.0.0.1:27017", { dbName, serverSelectionTimeoutMS: 5000 });
    const app = express();
    app.use(express.json());
    app.use("/api/forms", formsRouter);
    app.use("/api/documents", acceptanceRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(path, method = "GET", body) {
      const res = await fetch(base + path, {
        method, headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: await res.json() };
    }
    const form = { title: "Test", description: "Persistence test", fields: [
      { id: "sample", label: "Sample", type: "text", required: true },
    ] };
    const doc = await CustomerDocument.create({ filename: "test.pdf", size: 100,
      status: "text_extracted", pages: [{ pageNumber: 1, text: "Sample requirements" }] });
    const ocr = await CustomerDocument.create({ filename: "ocr.pdf", size: 100, status: "needs_ocr", pages: [] });
    const missing = new mongoose.Types.ObjectId();
    const blank = await CustomerDocument.create({ filename: "blank.pdf", size: 100,
      status: "text_extracted", pages: [{ pageNumber: 1, text: "  " }] });
    assert.equal((await call("/api/documents/invalid/accept-form", "POST", { form })).status, 400);
    assert.equal((await call(`/api/documents/${missing}/accept-form`, "POST", { form })).status, 404);
    assert.equal((await call(`/api/documents/${ocr._id}/accept-form`, "POST", { form })).status, 422);
    assert.equal((await call(`/api/documents/${blank._id}/accept-form`, "POST", { form })).status, 422);
    assert.equal((await call(`/api/documents/${doc._id}/accept-form`, "POST", { form: { ...form, sourceDocumentId: ocr._id } })).status, 400);
    assert.equal((await call(`/api/documents/${doc._id}/accept-form`, "POST", { form: { ...form, fields: [{ ...form.fields[0], visibleWhen: { fieldId: "missing", equals: true } }] } })).status, 400);
    const accepted = await call(`/api/documents/${doc._id}/accept-form`, "POST", { form });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.data.sourceDocumentId, String(doc._id));
    assert.equal(accepted.data.revision, 1);
    const id = accepted.data._id;
    const loaded = await call(`/api/forms/${id}`);
    assert.equal(loaded.data.sourceDocumentId, String(doc._id));
    assert.equal(loaded.data.revision, 1);
    assert.equal((await call("/api/forms")).data.find((item) => item._id === id).sourceDocumentId, String(doc._id));
    const updated = await call(`/api/forms/${id}`, "PUT", { form: { ...form, title: "Edited" }, expectedRevision: 1 });
    assert.equal(updated.status, 200);
    assert.equal(updated.data._id, id);
    assert.equal(updated.data.revision, 2);
    assert.equal(updated.data.sourceDocumentId, String(doc._id));
    assert.equal((await call(`/api/forms/${id}`, "PUT", { form, expectedRevision: 1 })).status, 409);
    assert.equal((await call(`/api/forms/${missing}`, "PUT", { form, expectedRevision: 1 })).status, 404);
    assert.equal((await call(`/api/forms/${id}`, "PUT", { form, expectedRevision: 2, sourceDocumentId: ocr._id })).status, 400);
    assert.equal((await call(`/api/forms/${id}`, "PUT", { form })).status, 400);
    assert.equal((await call(`/api/forms/${id}`, "PUT", { form, expectedRevision: -1 })).status, 400);
    const manual = await call("/api/forms", "POST", form);
    assert.equal(manual.status, 201);
    assert.equal(manual.data.revision, 1);
    assert.equal(manual.data.sourceDocumentId, undefined);
    assert.equal((await call("/api/forms", "POST", { ...form, sourceDocumentId: doc._id })).status, 400);
    assert.equal((await call(`/api/forms/${manual.data._id}`, "PUT", { form, expectedRevision: 1 })).data.revision, 2);
    // Clone: the Mongo driver adds _id to the object passed to insertOne.
    const legacy = await Form.collection.insertOne(structuredClone(form));
    assert.equal((await call(`/api/forms/${legacy.insertedId}`)).data.revision, 0);
    const legacySave = await call(`/api/forms/${legacy.insertedId}`, "PUT", { form, expectedRevision: 0 });
    assert.equal(legacySave.status, 200);
    assert.equal(legacySave.data.revision, 1);
    assert.equal((await call(`/api/forms/${legacy.insertedId}`, "PUT", { form, expectedRevision: 0 })).status, 409);
    const concurrent = await Promise.all([1, 2].map(() => call(`/api/forms/${id}`, "PUT", { form, expectedRevision: 2 })));
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
    assert.equal((await call(`/api/forms/${id}`)).data.revision, 3);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === dbName) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }
});
