import { useEffect, useImperativeHandle, useState } from "react";
import type { Ref } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./App.css";

const API = "http://localhost:4000/api/forms";

type FieldType = "text" | "textarea" | "number" | "boolean" | "select";
type Value = string | number | boolean;
type Condition = { fieldId: string; equals: Value };

type Field = {
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

async function request(path = "", options?: RequestInit) {
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.errors
        ?.map((issue: { message: string }) => issue.message)
        .join(" · ") || data.message || "Request failed",
    );
  }

  return data;
}

export type BuilderHandle = { openDraft: (form: FormDraft) => boolean };

export default function App({ ref }: { ref?: Ref<BuilderHandle> }) {
  const [draft, setDraft] = useState<FormDraft>(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [formId, setFormId] = useState("");
  const [saved, setSaved] = useState<SavedForm[]>([]);
  const [selectedId, setSelectedId] = useState("frequencyHz");
  const [tab, setTab] = useState("Builder");
  const [values, setValues] = useState<Record<string, Value>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useImperativeHandle(ref, () => ({
    openDraft(form) {
      if (busy) {
        window.alert("Wait for the current save or load to finish before opening a draft.");
        return false;
      }
      if (JSON.stringify(draft) !== baseline &&
          !window.confirm("Replace your unsaved builder edits with the generated form?")) return false;
      setDraft(structuredClone(form));
      setBaseline(""); // An imported draft is unsaved, even before further edits.
      setFormId("");
      setSelectedId(form.fields[0]?.id ?? "");
      setValues({});
      setTab("Builder");
      setMessage("Generated draft opened. Review it, then save when ready.");
      return true;
    },
  }));

  const selected = draft.fields.find((field) => field.id === selectedId);

  useEffect(() => {
    request()
      .then(setSaved)
      .catch((error: Error) => setMessage(error.message));
  }, []);

  function updateField(id: string, patch: Partial<Field>) {
    setDraft((current) => ({
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

    setDraft((current) => ({
      ...current,
      fields: [...current.fields, field],
    }));
    setSelectedId(id);
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

    setDraft((current) => ({
      ...current,
      fields: current.fields.filter((field) => field.id !== id),
    }));
    setSelectedId("");
    setMessage("");
  }

  async function save() {
    setBusy(true);
    setMessage("");

    try {
      const result = await request(formId ? `/${formId}` : "", {
        method: formId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });

      setFormId(result._id);
      setBaseline(JSON.stringify(draft));
      setSaved(await request());
      setMessage("Form saved successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function load(id: string) {
    if (!id) return;
    setBusy(true);

    try {
      const result = await request(`/${id}`);

      setDraft({
        title: result.title,
        description: result.description,
        fields: result.fields,
      });
      setFormId(result._id);
      setBaseline(JSON.stringify({ title: result.title, description: result.description, fields: result.fields }));
      setSelectedId(result.fields[0]?.id || "");
      setValues({});
      setMessage("Saved form loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
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
      border: "1px solid #c7d2fe",
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
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? "Please wait…" : "Save draft"}
          </button>
        </div>
      </header>

      <section className="heading">
        <div>
          <div className="eyebrow">WORKSPACE / TEST REQUESTS</div>
          <h1>Build a better test request.</h1>
          <p>Design fields, connect rules, and preview the experience.</p>
        </div>
        <span className="badge">Draft</span>
      </section>

      {message && <div className="notice" role="status">{message}</div>}

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

      <main className="workspace">
        <aside className="panel palette">
          <div className="eyebrow">FORM CONTROLS</div>
          <h3>Add a field</h3>
          <p>Choose a control to add it to your form.</p>

          {(["text", "textarea", "number", "boolean", "select"] as const).map(
            (type) => (
              <button
                className="control-button"
                key={type}
                onClick={() => addField(type)}
              >
                <span>{type === "boolean" ? "☑" : type === "number" ? "#" : "T"}</span>
                {type === "boolean" ? "Checkbox" : type}
                <span className="plus">+</span>
              </button>
            ),
          )}
        </aside>

        <section className="canvas">
          {tab === "Builder" && (
            <div className="form-sheet">
              <div className="eyebrow">FORM DETAILS</div>
              <input
                className="title-input"
                aria-label="Form title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <textarea
                className="description-input"
                aria-label="Form description"
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />

              <div className="field-list">
                {draft.fields.map((field, index) => (
                  <button
                    key={field.id}
                    className={`field-card ${selectedId === field.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(field.id)}
                  >
                    <div className="field-number">{index + 1}</div>
                    <div className="field-summary">
                      <strong>{field.label || "Untitled field"}</strong>
                      <small>
                        {field.type}
                        {field.unit && ` · ${field.unit}`}
                        {field.required && " · Required"}
                      </small>
                      {(field.visibleWhen || field.requiredWhen) && (
                        <span className="rule-tag">Conditional rules</span>
                      )}
                    </div>
                    <span className="edit-label">Edit →</span>
                  </button>
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
                onNodeClick={(_event, node) => setSelectedId(node.id)}
              >
                <Background />
                <Controls />
              </ReactFlow>
            </div>
          )}
        </section>

        <aside className="panel properties">
          <div className="eyebrow">FIELD SETTINGS</div>
          <h3>{selected ? "Make it yours" : "Select a field"}</h3>

          {selected ? (
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
          ) : (
            <p>Choose a field on the canvas to configure its properties.</p>
          )}
        </aside>
      </main>
    </div>
  );
}
