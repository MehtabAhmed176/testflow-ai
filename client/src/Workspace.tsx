import { useState } from "react";
import App from "./App";
import DocumentsPage from "./DocumentsPage";

export default function Workspace() {
  const [page, setPage] = useState<"documents" | "builder">("documents");

  return (
    <>
      <nav className="app-navigation" aria-label="Workspace navigation">
        <button
          className={page === "documents" ? "active" : ""}
          onClick={() => setPage("documents")}
        >
          Documents
        </button>

        <button
          className={page === "builder" ? "active" : ""}
          onClick={() => setPage("builder")}
        >
          Form builder
        </button>
      </nav>

      <div hidden={page !== "documents"}>
        <DocumentsPage />
      </div>

      <div hidden={page !== "builder"}>
        <App />
      </div>
    </>
  );
}