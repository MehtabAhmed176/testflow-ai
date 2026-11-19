import { useEffect, useRef, useState } from "react";
import App from "./App";
import type { BuilderHandle } from "./App";
import DocumentsPage from "./DocumentsPage";

export default function Workspace() {
  const [page, setPage] = useState<"documents" | "builder">(window.location.pathname.startsWith("/forms/") ? "builder" : "documents");
  const [accepting, setAccepting] = useState(false);
  const [builderBusy, setBuilderBusy] = useState(false);
  const builder = useRef<BuilderHandle>(null);
  const currentPath = useRef(window.location.pathname);
  const acceptancePending = useRef(false);
  const builderPending = useRef(false);
  const builderPath = useRef(window.location.pathname.startsWith("/forms/") ? window.location.pathname : "/forms/new");

  function savedLocation(id: string) {
    const path = `/forms/${encodeURIComponent(id)}`;
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    currentPath.current = path;
    builderPath.current = path;
  }

  useEffect(() => {
    async function restore() {
      if (acceptancePending.current || builderPending.current) {
        window.history.replaceState(null, "", currentPath.current);
        return;
      }
      const match = /^\/forms\/([^/]+)\/?$/.exec(window.location.pathname);
      if (match && match[1] !== "new") {
        setPage("builder");
        const opened = await builder.current?.loadSaved(match[1]);
        if (!opened && window.location.pathname !== currentPath.current) {
          window.history.replaceState(null, "", currentPath.current);
        }
      } else if (match?.[1] === "new") {
        if (builder.current?.openNew()) setPage("builder");
        else window.history.replaceState(null, "", currentPath.current);
      } else {
        currentPath.current = window.location.pathname;
        setPage("documents");
      }
    }
    void restore();
    const listener = () => { void restore(); };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);

  return (
    <>
      <nav className="app-navigation" aria-label="Workspace navigation">
        <button
          className={page === "documents" ? "active" : ""}
          disabled={accepting || builderBusy}
          onClick={() => {
            setPage("documents");
            if (window.location.pathname !== "/documents") window.history.pushState(null, "", "/documents");
            currentPath.current = "/documents";
          }}
        >
          Documents
        </button>

        <button
          className={page === "builder" ? "active" : ""}
          disabled={accepting || builderBusy}
          onClick={() => {
            setPage("builder");
            if (window.location.pathname !== builderPath.current) window.history.pushState(null, "", builderPath.current);
            currentPath.current = builderPath.current;
          }}
        >
          Form builder
        </button>
      </nav>

      <div hidden={page !== "documents"}>
        <DocumentsPage canAccept={() => builder.current?.canReplace() ?? false}
          onReopen={async (id) => {
            if (await builder.current?.loadSaved(id)) setPage("builder");
          }}
          onAcceptanceBusy={(pending) => { acceptancePending.current = pending; setAccepting(pending); }} onAccepted={(form) => {
            builder.current?.openSaved(form);
            savedLocation(form._id);
            setPage("builder");
          }} />
      </div>

      <div hidden={page !== "builder"}>
        <App ref={builder} onSaved={savedLocation} onBusyChange={(pending) => {
          builderPending.current = pending;
          setBuilderBusy(pending);
        }} />
      </div>
    </>
  );
}
