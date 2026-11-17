import { useRef, useState } from "react";
import App from "./App";
import type { BuilderHandle } from "./App";
import DocumentsPage from "./DocumentsPage";

export default function Workspace() {
  const [page, setPage] = useState<"documents" | "builder">("documents");
  const builder = useRef<BuilderHandle>(null);

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
        <DocumentsPage onOpenDraft={(form) => {
          if (builder.current?.openDraft(form)) setPage("builder");
        }} />
      </div>

      <div hidden={page !== "builder"}>
        <App ref={builder} />
      </div>
    </>
  );
}
