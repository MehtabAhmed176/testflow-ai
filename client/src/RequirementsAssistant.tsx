import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FileText, MessageSquare, Send, Sparkles, X } from "lucide-react";
import type { FormDraft } from "./App";
import { FormChatSession, formFingerprint } from "./formChat";

export function RequirementsAssistant({ draft, formId, revision, contextId, onClearContext, onDependencies, onApply }: {
  draft: FormDraft;
  formId: string;
  revision: number;
  contextId: string;
  onClearContext: () => void;
  onDependencies: (id: string) => void;
  onApply: (form: FormDraft, expectedRevision: number, expectedFingerprint: string) => boolean;
}) {
  const [session] = useState(() => new FormChatSession(formId));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [tab, setTab] = useState("Conversation");
  const [input, setInput] = useState("");
  const [reviewId, setReviewId] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const context = draft.fields.find((field) => field.id === contextId);
  const fingerprint = formFingerprint(draft);
  const blocked = !formId || state.pending || state.expired;
  useEffect(() => () => session.cancel(), [session]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [state.messages, state.pending]);

  async function send(text: string) {
    if (blocked || !text.trim()) return;
    setInput(text);
    setTab("Conversation");
    if (await session.send(text, draft, revision, context?.id)) setInput("");
  }

  return <aside className="panel requirements-assistant" aria-label="Requirements assistant">
    <header className="assistant-heading"><Sparkles size={20} /><h2>Requirements assistant</h2></header>
    <div className="demo-label">{formId ? "AI chat · Review changes before applying" : "Save this form before chatting"}</div>
    <nav className="tabs assistant-tabs" aria-label="Assistant views">
      {["Conversation", "Evidence"].map((name) => <button type="button" key={name} aria-pressed={tab === name}
        className={tab === name ? "active" : ""} onClick={() => setTab(name)}>
        {name === "Conversation" ? <MessageSquare size={15} /> : <FileText size={15} />}{name}</button>)}
    </nav>
    {context && <div className="chat-context"><span>Field context: <strong>{context.label}</strong><small>{context.id}</small></span>
      <button type="button" aria-label="Clear selected field context" onClick={onClearContext}><X size={15} /></button>
    </div>}
    {state.error && <div className="chat-error" role="alert">{state.error}
      {state.expired && <button type="button" onClick={() => { session.startNew(); setReviewId(""); }}>Start new conversation</button>}
    </div>}
    {tab === "Evidence" ? <div className="evidence-empty"><FileText size={28} /><h3>Source evidence not available yet</h3>
      <p>Document-to-field mappings have not been implemented. No stored quotes, page references, or confidence scores are available.</p></div> : <>
      <div className="chat-messages" role="log" aria-label="Form conversation" aria-live="polite" aria-busy={state.pending}>
        {!state.messages.length && <p>Ask about requirements, dependencies, or a change to this form. Proposals stay unsaved until you apply and save them.</p>}
        {state.messages.map((item) => {
          const proposal = item.proposal;
          const stale = proposal?.status === "pending" && (proposal.fingerprint !== fingerprint || proposal.revision !== revision);
          const affected = proposal ? [...new Set([...proposal.before.fields, ...proposal.after.fields].map((field) => field.id))]
            .filter((id) => {
              const before = proposal.before.fields.filter((field) => field.id === id);
              const after = proposal.after.fields.filter((field) => field.id === id);
              return formFingerprint({ title: "", description: "", fields: before }) !==
                formFingerprint({ title: "", description: "", fields: after });
            }) : [];
          return <div key={item.id} className={`chat-message ${item.role}`}>
            <small>{item.role === "user" ? "You" : "Assistant"}{item.failed && " · Request failed"}</small><p>{item.text}</p>
            {proposal && <section className="proposal-card" aria-label="Form change proposal">
              <strong>Proposed form update</strong>
              <p>{proposal.before.fields.length} fields before · {proposal.after.fields.length} fields after. Review the complete definition before applying.</p>
              {affected.length > 0 && <ul aria-label="Affected fields">{affected.map((id) => <li key={id}>
                {(proposal.after.fields.find((field) => field.id === id) ?? proposal.before.fields.find((field) => field.id === id))?.label} <code>({id})</code>
              </li>)}</ul>}
              <span className="proposal-status">{stale ? "Stale — the draft changed. Request an updated proposal." : proposal.status}</span>
              {proposal.status === "pending" && <>
                {reviewId === item.id ? <div className="proposal-review">
                  <h4>Review changes</h4>
                  <div className="proposal-diff"><section><h4>Before</h4><pre>{JSON.stringify(proposal.before, null, 2)}</pre></section>
                    <section><h4>After</h4><pre>{JSON.stringify(proposal.after, null, 2)}</pre></section></div>
                  <p>Apply updates this working draft only. Use Save draft to persist changes.</p>
                  <div className="action-row"><button type="button" className="primary" disabled={stale || state.pending}
                    onClick={() => { if (!stale && onApply(proposal.after, proposal.revision, proposal.fingerprint)) {
                      session.finish(item.id, "applied"); setReviewId("");
                    } }}>Apply</button>
                    <button type="button" onClick={() => setReviewId("")}>Cancel</button></div>
                </div> : <div className="action-row"><button type="button" onClick={() => setReviewId(item.id)}>Review</button>
                  <button type="button" onClick={() => session.finish(item.id, "discarded")}>Discard</button></div>}
              </>}
            </section>}
          </div>;
        })}
        {state.pending && <p role="status">Generating a response…</p>}
        <div ref={end} />
      </div>
      <div className="suggested-prompts" aria-label="Suggested prompts">
        {["Explain this requirement", "Check dependencies", "Identify missing information"].map((text) =>
          <button type="button" key={text} disabled={blocked} onClick={() => void send(text)}>{text}</button>)}
        {context && <button type="button" onClick={() => onDependencies(context.id)}>View context in graph</button>}
      </div>
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
        <label className="sr-only" htmlFor="assistant-message">Message the requirements assistant</label>
        <textarea id="assistant-message" value={input} disabled={state.pending} onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); void send(input);
            }
          }} placeholder="Ask about requirements or dependencies…" rows={2} />
        <button type="submit" className="primary" aria-label="Send message" disabled={blocked || !input.trim()}><Send size={17} /></button>
      </form><p className="assistant-footnote">{!formId ? "Save this form first. " : ""}Enter to send · Shift+Enter for a new line. Chat is local to this page and is not saved with your form.</p>
    </>}
  </aside>;
}
