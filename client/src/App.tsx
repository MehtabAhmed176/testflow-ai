import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref, SetStateAction } from "react";
import { RequirementsAssistant } from "./RequirementsAssistant";
import { apiRequest } from "./api";
import { formFingerprint } from "./formChat";
import { ChevronDown, ChevronUp, GitBranch, Info, Plus, Save, Sparkles } from "lucide-react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./App.css";



type FieldType = "text" | "textarea" | "number" | "boolean" | "select";
type Value = string | number | boolean;
type Condition = { fieldId: string; equals: Value };

export type Field = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
  visibleWhen?: Condition;
  requiredWhen?: Condition;
};

export type FormDraft = {
  title: string;
  description: string;
  fields: Field[];
};

type SavedForm = { _id: string; title: string };
export type SavedDraft = FormDraft & { _id: string; sourceDocumentId?: string; revision: number };

const initial: FormDraft = {
  title: "Sensor qualification",
  description: "Configure the information needed for your test request.",
  fields: [
    {
      id: "sampleId",
      label: "Sample ID",
      type: "text",
      required: true,
    },
    {
      id: "vibrationEnabled",
      label: "Perform vibration testing",
      type: "boolean",
      required: false,
    },
    {
      id: "frequencyHz",
      label: "Frequency",
      type: "number",
      unit: "Hz",
      min: 10,
      max: 500,
      required: false,
      visibleWhen: { fieldId: "vibrationEnabled", equals: true },
      requiredWhen: { fieldId: "vibrationEnabled", equals: true },
    },
  ],
};

async function request<T = SavedDraft>(path = "", options?: RequestInit) {
  return apiRequest<T>(`/forms${path}`, options);
}

export type BuilderHandle = {
  canReplace: () => boolean;
  openSaved: (form: SavedDraft) => void;
  loadSaved: (id: string) => Promise<boolean>;
  openNew: () => boolean;
};

export default function App({ ref, onSaved, onBusyChange }: {
  ref?: Ref<BuilderHandle>;
  onSaved: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<FormDraft>(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [formId, setFormId] = useState("");
  const [saved, setSaved] = useState<SavedForm[]>([]);
  const [selectedId, setSelectedId] = useState("frequencyHz");
  const [tab, setTab] = useState("Builder");
  const [values, setValues] = useState<Record<string, Value>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusyState] = useState(false);
  const [revision, setRevision] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [contextId, setContextId] = useState("frequencyHz");
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [serverRevision, setServerRevision] = useState(0);
  const [sourceDocumentId, setSourceDocumentId] = useState<string>();
  const operation = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);

  function setBusy(value: boolean) {
    setBusyState(value);
    onBusyChange(value);
  }

  function changeDraft(update: SetStateAction<FormDraft>) {
    setDraft(update);
    setRevision((value) => value + 1);
  }

  function explainField(id: string) {
    setContextId(id);
    setAssistantOpen(true);
  }

  function canReplace() {
    return !operation.current && (JSON.stringify(draft) === baseline ||
      window.confirm("Replace your unsaved builder edits with another saved form?"));
  }

  function openSaved(form: SavedDraft) {
    setLoadFailed(false);
    const editable = { title: form.title, description: form.description, fields: form.fields };
    changeDraft(editable);
    setBaseline(JSON.stringify(editable));
    setFormId(form._id);
    setServerRevision(form.revision ?? 0);
    setSourceDocumentId(form.sourceDocumentId);
    setSelectedId(form.fields[0]?.id ?? "");
    setContextId(form.fields[0]?.id ?? "");
    setValues({});
    setTab("Builder");
    setSaved((current) => [form, ...current.filter((item) => item._id !== form._id)]);
    setMessage("Saved draft opened.");
  }

  function openNew() {
    if (!canReplace()) return false;
    changeDraft(structuredClone(initial));
    setBaseline(JSON.stringify(initial));
    setFormId("");
    setSourceDocumentId(undefined);
    setServerRevision(0);
    setLoadFailed(false);
    setValues({});
    setSelectedId(initial.fields[0]?.id ?? "");
    setContextId(initial.fields[0]?.id ?? "");
    setTab("Builder");
    setMessage("New manual draft. Save when ready.");
    onSaved("new");
    return true;
  }

  useImperativeHandle(ref, () => ({ canReplace, openSaved, loadSaved: load, openNew }));

  const selected = draft.fields.find((field) => field.id === selectedId);

  useEffect(() => {
    request<SavedForm[]>()
      .then(setSaved)
      .catch((error: Error) => setMessage(error.message));
  }, []);

  function updateField(id: string, patch: Partial<Field>) {
    changeDraft((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    }));
  }

  function addField(type: FieldType) {
    const id = crypto.randomUUID();
    const field: Field = {
      id,
      label: `New ${type} field`,
      type,
      required: false,
      ...(type === "select" ? { options: ["Option A", "Option B"] } : {}),
    };

    changeDraft((current) => ({
      ...current,
      fields: [...current.fields, field],
    }));
    setSelectedId(id);
    setContextId(id);
    setTab("Builder");
    setMessage("");
  }

  function removeField(id: string) {
    const dependents = draft.fields.filter(
      (field) =>
        field.visibleWhen?.fieldId === id ||
        field.requiredWhen?.fieldId === id,
    );

    if (dependents.length) {
      setMessage(
        `Remove dependencies first: ${dependents.map((f) => f.label).join(", ")}`,
      );
      return;
    }

    changeDraft((current) => ({
      ...current,
      fields: current.fields.filter((field) => field.id !== id),
    }));
    setSelectedId("");
    setMessage("");
  }

  async function save() {
    if (operation.current || loadFailed) return;
    operation.current = true;
    setBusy(true);
    setMessage("");

    try {
      const result = await request(formId ? `/${formId}` : "", {
        method: formId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formId ? { form: draft, expectedRevision: serverRevision } : draft),
      });

      setFormId(result._id);
      setServerRevision(result.revision);
      setSourceDocumentId(result.sourceDocumentId);
      setBaseline(JSON.stringify(draft));
      setSaved((current) => [result, ...current.filter((item) => item._id !== result._id)]);
      onSaved(result._id);
      setMessage("Form saved successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  async function load(id: string) {
    if (!id || operation.current || !canReplace()) return false;
    operation.current = true;
    setBusy(true);

    try {
      const result = await request(`/${id}`);

      openSaved(result);
      onSaved(result._id);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
      setLoadFailed(true);
      return false;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  // Missing answers are treated as false for checkbox fields.
  function matches(condition: Condition) {
    const source = draft.fields.find((f) => f.id === condition.fieldId);
    const value =
      values[condition.fieldId] ??
      (source?.type === "boolean" ? false : undefined);

    return value === condition.equals;
  }

  const nodes = draft.fields.map((field, index) => ({
    id: field.id,
    position: { x: index % 2 === 0 ? 30 : 390, y: index * 130 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: { label: `${field.label} · ${field.type}` },
    style: {
      borderRadius: 12,
      padding: 16,
      width: 230,
      border: field.id === selectedId || draft.fields.some((target) => target.id === selectedId && (target.visibleWhen?.fieldId === field.id || target.requiredWhen?.fieldId === field.id)) ? "2px solid #7c3aed" : "1px solid #c7d2fe",
      background: "#fff",
    },
  }));

  const edges = draft.fields.flatMap((field) =>
    (["visibleWhen", "requiredWhen"] as const).flatMap((rule) => {
      const condition = field[rule];
      if (!condition) return [];

      return [{
        id: `${field.id}-${rule}`,
        source: condition.fieldId,
        target: field.id,
        label: `${rule === "visibleWhen" ? "Visible" : "Required"} = ${String(condition.equals)}`,
        type: "smoothstep",
        animated: true,
        style: {
          stroke: rule === "visibleWhen" ? "#6366f1" : "#0d9488",
        },
        markerEnd: { type: MarkerType.ArrowClosed },
      }];
    }),
  );

  return (
    <div className="studio">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">T</span>
          <div>
            <strong>TestFlow</strong>
            <small>FORM STUDIO</small>
          </div>
        </div>

        <div className="toolbar">
          <select
            aria-label="Load a saved form"
            value={formId}
            disabled={busy}
            onChange={(event) => void load(event.target.value)}
          >
            <option value="">Load saved form…</option>
            {saved.map((form) => (
              <option key={form._id} value={form._id}>
                {form.title}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={openNew}>New form</button>
          {formId && <button type="button" disabled={busy} onClick={() => void load(formId)}>Reload saved</button>}
          <button className="primary" disabled={busy || loadFailed} onClick={save}>
            <Save size={15} />
            {busy ? "Please wait…" : "Save draft"}
          </button>
        </div>
      </header>

      <section className="heading">
        <div>
          <div className="eyebrow">WORKSPACE / TEST REQUESTS</div>
          <h1>Design with clarity.</h1>
          <p>Every field has a purpose. Every change stays in your control.</p>
        </div>
        <span className="badge" role="status">{busy ? "Saving / loading…" : !formId ? "Unsaved draft" : JSON.stringify(draft) !== baseline ? "Unsaved changes" : "Form saved"}</span>
      </section>
      {formId && <p>Revision {serverRevision}{serverRevision === 0 && " (legacy — upgraded on next save)"}
        {sourceDocumentId ? ` · Source document: ${sourceDocumentId}` : " · Manual form"}</p>}

      {message && <div className="notice" role="status">{message}</div>}

      <fieldset disabled={busy} className="draft-controls">
      <main className="workspace">
        <aside className="panel palette"><button type="button" className="palette-toggle" aria-expanded={paletteOpen} onClick={() => setPaletteOpen(!paletteOpen)}>Add controls {paletteOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button><div hidden={!paletteOpen}>

          {(["text", "textarea", "number", "boolean", "select"] as const).map(
            (type) => (
              <button
                className="control-button"
                key={type}
                onClick={() => addField(type)}
              >
                <span>{type === "boolean" ? "☑" : type === "number" ? "#" : "T"}</span>
                {type === "boolean" ? "Checkbox" : type}
                <Plus size={14} className="plus" />
              </button>
            ),
          )}
        </div></aside>

        <section className="canvas">
      <nav className="tabs">
        {["Builder", "Live preview", "Dependencies"].map((name) => (
          <button
            key={name}
            className={tab === name ? "active" : ""}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
          {tab === "Builder" && (
            <div className="form-sheet">
              <div className="eyebrow">FORM DETAILS</div>
              <input
                className="title-input"
                aria-label="Form title"
                value={draft.title}
                onChange={(e) => changeDraft({ ...draft, title: e.target.value })}
              />
              <textarea
                className="description-input"
                aria-label="Form description"
                value={draft.description}
                onChange={(e) =>
                  changeDraft({ ...draft, description: e.target.value })
                }
              />

              <div className="field-list">
                {draft.fields.map((field, index) => (
                  <article key={field.id} className={`field-card ${selectedId === field.id ? "selected" : ""}`}>
                    <div className="field-card-heading">
                      <button type="button" className="field-select" aria-expanded={selectedId === field.id}
                        aria-controls={`editor-${field.id}`} onClick={() => {
                          const next = selectedId === field.id ? "" : field.id;
                          setSelectedId(next); setContextId(next);
                        }}>
                        <span className="field-number">{index + 1}</span>
                        <span className="field-summary"><strong>{field.label || "Untitled field"}</strong>
                          <small>{field.type}{field.unit && ` · ${field.unit}`}{field.required && " · Required"}</small>
                        </span>
                        {selectedId === field.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <div className="field-actions">
                        <button type="button" onClick={() => explainField(field.id)}><Info size={14} />Why this field?</button>
                        <button type="button" onClick={() => { setSelectedId(field.id); setContextId(field.id); setTab("Dependencies"); }}><GitBranch size={14} />Dependencies</button>
                      </div>
                    </div>
                    {selectedId === field.id && selected && <div id={`editor-${field.id}`} className="properties inline-editor">
            <>
              <label>
                Label
                <input
                  value={selected.label}
                  onChange={(e) =>
                    updateField(selected.id, { label: e.target.value })
                  }
                />
              </label>

              <div className="type-label">{selected.type} control</div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selected.required}
                  onChange={(e) =>
                    updateField(selected.id, { required: e.target.checked })
                  }
                />
                Always required
              </label>

              {selected.type === "number" && (
                <>
                  <label>
                    Unit
                    <input
                      value={selected.unit ?? ""}
                      placeholder="e.g. Hz"
                      onChange={(e) =>
                        updateField(selected.id, { unit: e.target.value })
                      }
                    />
                  </label>
                  <div className="range-row">
                    {(["min", "max"] as const).map((key) => (
                      <label key={key}>
                        {key === "min" ? "Minimum" : "Maximum"}
                        <input
                          type="number"
                          value={selected[key] ?? ""}
                          onChange={(e) =>
                            updateField(selected.id, {
                              [key]: e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}

              {selected.type === "select" && (
                <label>
                  Options — one per line
                  <textarea
                    value={selected.options?.join("\n") ?? ""}
                    onChange={(e) =>
                      updateField(selected.id, {
                        options: e.target.value.split("\n"),
                      })
                    }
                  />
                </label>
              )}

              <hr />
              <h4>Conditional rules</h4>
              <p>A rule compares another field’s answer with a value.</p>

              {(["visibleWhen", "requiredWhen"] as const).map((key) => {
                const condition = selected[key];
                const source = draft.fields.find(
                  (field) => field.id === condition?.fieldId,
                );

                return (
                  <div className="rule-editor" key={key}>
                    <label>
                      {key === "visibleWhen" ? "Show when" : "Require when"}
                      <select
                        value={condition?.fieldId ?? ""}
                        onChange={(e) => {
                          const target = draft.fields.find(
                            (field) => field.id === e.target.value,
                          );

                          updateField(selected.id, {
                            [key]: target
                              ? {
                                  fieldId: target.id,
                                  equals: target.type === "boolean"
                                    ? true
                                    : target.type === "number"
                                      ? 0
                                      : target.type === "select"
                                        ? target.options?.[0] ?? ""
                                        : "",
                                }
                              : undefined,
                          });
                        }}
                      >
                        <option value="">No condition</option>
                        {draft.fields
                          .filter((field) => field.id !== selected.id)
                          .map((field) => (
                            <option key={field.id} value={field.id}>
                              {field.label}
                            </option>
                          ))}
                      </select>
                    </label>

                    {condition && source && (
                      <label>
                        Equals
                        {source.type === "boolean" || source.type === "select" ? (
                          <select
                            value={String(condition.equals)}
                            onChange={(e) =>
                              updateField(selected.id, {
                                [key]: {
                                  ...condition,
                                  equals: source.type === "boolean"
                                    ? e.target.value === "true"
                                    : e.target.value,
                                },
                              })
                            }
                          >
                            {(source.type === "boolean"
                              ? ["true", "false"]
                              : source.options ?? []
                            ).map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={source.type === "number" ? "number" : "text"}
                            value={String(condition.equals)}
                            onChange={(e) =>
                              updateField(selected.id, {
                                [key]: {
                                  ...condition,
                                  equals: source.type === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                                },
                              })
                            }
                          />
                        )}
                      </label>
                    )}
                  </div>
                );
              })}

              <button
                className="danger"
                onClick={() => removeField(selected.id)}
              >
                Remove field
              </button>
            </>
                      <div className="source-unavailable">Source evidence not available yet</div>
                    </div>}
                  </article>
                ))}
                {!draft.fields.length && (
                  <p>Add your first field using the controls on the left.</p>
                )}
              </div>
            </div>
          )}

          {tab === "Live preview" && (
            <form
              className="form-sheet preview"
              onSubmit={(event) => {
                event.preventDefault();
                setMessage("Preview validation passed. No test answers were saved.");
              }}
            >
              <div className="eyebrow">CUSTOMER VIEW</div>
              <h2>{draft.title}</h2>
              <p>{draft.description}</p>

              {draft.fields.map((field) => {
                if (field.visibleWhen && !matches(field.visibleWhen)) return null;

                const required =
                  field.required ||
                  Boolean(field.requiredWhen && matches(field.requiredWhen));

                const setValue = (value: Value) =>
                  setValues((current) => ({ ...current, [field.id]: value }));

                return (
                  <div className="preview-field" key={field.id}>
                    <label htmlFor={field.id}>
                      {field.label} {required && <span className="required">*</span>}
                      {field.unit && <small> ({field.unit})</small>}
                    </label>

                    {field.type === "boolean" ? (
                      <input
                        id={field.id}
                        type="checkbox"
                        checked={values[field.id] === true}
                        required={required}
                        onChange={(e) => setValue(e.target.checked)}
                      />
                    ) : field.type === "textarea" ? (
                      <textarea
                        id={field.id}
                        required={required}
                        value={String(values[field.id] ?? "")}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    ) : field.type === "select" ? (
                      <select
                        id={field.id}
                        required={required}
                        value={String(values[field.id] ?? "")}
                        onChange={(e) => setValue(e.target.value)}
                      >
                        <option value="">Choose an option</option>
                        {field.options?.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={field.id}
                        type={field.type}
                        step={field.type === "number" ? "any" : undefined}
                        min={field.min}
                        max={field.max}
                        required={required}
                        value={String(values[field.id] ?? "")}
                        onChange={(e) =>
                          setValue(
                            field.type === "number" && e.target.value !== ""
                              ? Number(e.target.value)
                              : e.target.value,
                          )
                        }
                      />
                    )}
                    {field.type === "number" && (
                      <small>
                        Allowed range: {field.min ?? "No minimum"} – {field.max ?? "No maximum"}
                      </small>
                    )}
                  </div>
                );
              })}
              <button className="primary" type="submit">Validate preview</button>
            </form>
          )}

          {tab === "Dependencies" && (
            <div className="graph">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                onNodeClick={(_event, node) => { setSelectedId(node.id); setContextId(node.id); }}
              >
                <Background />
                <Controls />
              </ReactFlow>
            </div>
          )}
        </section>

        <div className={`assistant-slot ${assistantOpen ? "is-open" : ""}`}>
          <button type="button" className="assistant-toggle" aria-expanded={assistantOpen} onClick={() => setAssistantOpen(!assistantOpen)}><Sparkles size={16} />{assistantOpen ? "Hide assistant" : "Show assistant"}</button>
          <div hidden={!assistantOpen}>
            <RequirementsAssistant key={formId || "unsaved"} formId={formId} draft={draft} revision={revision} contextId={contextId}
              onClearContext={() => setContextId("")}
              onDependencies={(id) => { setSelectedId(id); setTab("Dependencies"); }}
              onApply={(form, expectedRevision, expectedFingerprint) => {
                if (expectedRevision !== revision || expectedFingerprint !== formFingerprint(draft) || busy) return false;
                changeDraft(form);
                return true;
              }} />
          </div>
        </div>
      </main>
      </fieldset>
    </div>
  );
}
