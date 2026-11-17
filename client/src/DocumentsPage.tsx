import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./DocumentsPage.css";
import type { FormDraft } from "./App";

const API = "http://localhost:4000/api/documents";

type DocumentSummary = {
  _id: string;
  filename: string;
  size: number;
  status: "text_extracted" | "needs_ocr";
  createdAt: string;
};

type CustomerDocument = DocumentSummary & {
  pages: {
    pageNumber: number;
    text: string;
  }[];
};

async function request<T>(
  path = "",
  options?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, options);
  } catch {
    throw new Error("Could not reach the document API at localhost:4000. Check that the backend is running, then try again.");
  }
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const details = Array.isArray(data?.errors)
      ? data.errors.map((issue: { message?: string; path?: (string | number)[] }) =>
          `${issue.path?.length ? `${issue.path.join(".")}: ` : ""}${issue.message || "Validation failed"}`,
        ).join("; ")
      : "";
    throw new Error([data?.message, details].filter(Boolean).join(": ") ||
      `Request failed (${response.status}). Please try again.`);
  }

  if (data === null) throw new Error("The document API returned an invalid JSON response. Please try again.");
  return data as T;
}

function statusLabel(status: DocumentSummary["status"]) {
  return status === "text_extracted"
    ? "Text extracted"
    : "OCR needed";
}

export default function DocumentsPage({ onOpenDraft }: {
  onOpenDraft: (form: FormDraft) => void;
}) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selected, setSelected] = useState<CustomerDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<FormDraft | null>(null);
  const [extracting, setExtracting] = useState(false);
  const extractionInFlight = useRef(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const selectionRequest = useRef(0);

  useEffect(() => {
    let active = true;

    request<DocumentSummary[]>()
      .then((result) => {
        if (active) setDocuments(result);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load documents",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function openDocument(id: string) {
    if (extractionInFlight.current) return;
    setGenerated(null);
    const requestId = ++selectionRequest.current;

    setLoading(true);
    setSelected(null);
    setError("");
    setMessage("");

    try {
      const document = await request<CustomerDocument>(`/${id}`);

      if (requestId === selectionRequest.current) {
        setSelected(document);
      }
    } catch (cause) {
      if (requestId === selectionRequest.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load document",
        );
      }
    } finally {
      if (requestId === selectionRequest.current) {
        setLoading(false);
      }
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (extractionInFlight.current || uploading) return;
    setError("");
    setMessage("");

    if (!file) {
      setError("Choose a PDF first.");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF file.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("The PDF must be smaller than 10 MB.");
      return;
    }

    // Invalidate any older document-selection request.
    ++selectionRequest.current;
    setLoading(false);
    setUploading(true);

    try {
      const body = new FormData();
      body.append("file", file);

      const document = await request<CustomerDocument>("", {
        method: "POST",
        body,
      });

      setSelected(document);
      setGenerated(null);
      setDocuments((current) => [
        document,
        ...current.filter((item) => item._id !== document._id),
      ]);

      setFile(null);
      if (fileInput.current) fileInput.current.value = "";

      setMessage(
        document.status === "needs_ocr"
          ? "Document saved. It needs OCR before its text can be read."
          : "Document uploaded and text extracted.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Upload failed",
      );
    } finally {
      setUploading(false);
    }
  }

  async function generateForm() {
    if (!selected || selected.status !== "text_extracted" ||
        uploading || loading || extractionInFlight.current) return;
    extractionInFlight.current = true;
    setExtracting(true);
    setError("");
    setMessage("");
    try {
      const form = await request<FormDraft>(`/${selected._id}/extract-form`, { method: "POST" });
      setGenerated(form);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate a form. Please try again.");
    } finally {
      extractionInFlight.current = false;
      setExtracting(false);
    }
  }

  return (
    <div className="documents-page">
      <section className="documents-heading">
        <div className="eyebrow">WORKSPACE / CUSTOMER REQUIREMENTS</div>
        <h1>Start with the customer’s words.</h1>
        <p>
          Upload a PDF and inspect the extracted text before creating a form.
        </p>
      </section>

      {error && (
        <div className="documents-error" role="alert">
          {error}
        </div>
      )}

      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}

      <div className="documents-layout">
        <aside className="documents-sidebar">
          <form className="panel upload-panel" onSubmit={uploadDocument}>
            <div className="eyebrow">NEW DOCUMENT</div>
            <h3>Upload requirements</h3>
            <p>
              Customer letters, specifications, or meeting notes.
              No template required.
            </p>

            <label className="upload-zone">
              <span className="upload-symbol">↑</span>
              <strong>Choose a PDF</strong>
              <span>Up to 10 MB</span>

              <input
                ref={fileInput}
                type="file"
                accept=".pdf,application/pdf"
                disabled={uploading || extracting}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError("");
                  setMessage("");
                }}
              />
            </label>

            {file && (
              <div className="chosen-file">
                <strong>{file.name}</strong>
                <span>{(file.size / 1024).toFixed(0)} KB</span>
              </div>
            )}

            <button
              className="primary upload-submit"
              type="submit"
              disabled={!file || uploading || extracting}
            >
              {uploading ? "Uploading and extracting…" : "Upload document"}
            </button>
          </form>

          <section className="panel document-library">
            <div className="eyebrow">YOUR DOCUMENTS</div>
            <h3>Recent uploads</h3>

            {loadingList && <p>Loading documents…</p>}

            {!loadingList && documents.length === 0 && (
              <p>Your uploaded documents will appear here.</p>
            )}

            {documents.map((document) => (
              <button
                type="button"
                key={document._id}
                disabled={uploading || extracting}
                className={`document-item ${
                  selected?._id === document._id ? "is-selected" : ""
                }`}
                onClick={() => void openDocument(document._id)}
              >
                <strong>{document.filename}</strong>

                <span>
                  {new Date(document.createdAt).toLocaleDateString()}
                  {" · "}
                  {(document.size / 1024).toFixed(0)} KB
                </span>

                <span
                  className={`document-status ${
                    document.status === "needs_ocr" ? "ocr" : ""
                  }`}
                >
                  {statusLabel(document.status)}
                </span>
              </button>
            ))}
          </section>
        </aside>

        <section className="panel document-reader">
          {loading ? (
            <div className="document-empty">
              <h2>Opening document…</h2>
            </div>
          ) : !selected ? (
            <div className="document-empty">
              <span className="empty-document-icon">▤</span>
              <h2>Your requirements start here</h2>
              <p>
                Upload a customer PDF or choose a previous upload
                to inspect its text.
              </p>

              <div className="intake-steps">
                <span>01 Upload</span>
                <span>02 Inspect text</span>
                <span>03 Generate draft</span>
              </div>
            </div>
          ) : (
            <>
              <div className="document-reader-header">
                <div>
                  <div className="eyebrow">EXTRACTED CONTENT</div>
                  <h2>{selected.filename}</h2>
                  <p>
                    {selected.pages.length} page(s)
                    {" · "}
                    {(selected.size / 1024).toFixed(0)} KB
                  </p>
                </div>

                <span
                  className={`document-status ${
                    selected.status === "needs_ocr" ? "ocr" : ""
                  }`}
                >
                  {statusLabel(selected.status)}
                </span>
              </div>

              {selected.status === "needs_ocr" ? (
                <div className="ocr-message">
                  <h3>This document needs OCR</h3>
                  <p>
                    No readable text was found. This may be an image-only
                    or scanned PDF. OCR processing has not been connected yet.
                  </p>
                </div>
              ) : (
                <div className="extracted-pages">
                  {selected.pages.map((page) => (
                    <article className="extracted-page" key={page.pageNumber}>
                      <div className="page-label">
                        PAGE {page.pageNumber}
                      </div>
                      <pre>
                        {page.text || "No text was found on this page."}
                      </pre>
                    </article>
                  ))}
                </div>
              )}

              <div className="document-next-step">
                <div>
                  <strong>Next: turn requirements into a form</strong>
                  <p>
                    Generate an editable draft from this document’s text.
                    Review the result before saving it.
                  </p>
                </div>
                <button type="button"
                  disabled={selected.status !== "text_extracted" || extracting || uploading || loading}
                  onClick={() => void generateForm()}>
                  {extracting ? "Generating form draft…" : "Generate form draft"}
                </button>
              </div>
              {extracting && <p role="status">Generating a draft. Document selection is locked until extraction finishes.</p>}
              {generated && (
                <section className="generated-draft" aria-label="Generated form draft">
                  <div className="eyebrow">GENERATED DRAFT · UNSAVED</div>
                  <h3>{generated.title}</h3>
                  <p>{generated.fields.length} field(s). Review and edit in the builder before saving.</p>
                  <details>
                    <summary>View form JSON</summary>
                    <pre>{JSON.stringify(generated, null, 2)}</pre>
                  </details>
                  <button type="button" className="primary" disabled={extracting || uploading}
                    onClick={() => onOpenDraft(generated)}>Open in builder</button>
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
