import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./DocumentsPage.css";

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
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data as T;
}

function statusLabel(status: DocumentSummary["status"]) {
  return status === "text_extracted"
    ? "Text extracted"
    : "OCR needed";
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selected, setSelected] = useState<CustomerDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
                disabled={uploading}
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
              disabled={!file || uploading}
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
                disabled={uploading}
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
                <span>03 AI review — coming next</span>
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
                    AI proposals and source evidence will appear here
                    once extraction is connected.
                  </p>
                </div>
                <button type="button" disabled>
                  Generate form draft
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}