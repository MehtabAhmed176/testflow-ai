import type { FormDraft } from "./App";
import { apiRequest, ApiError } from "./api";

export type ChatResponse = { conversationId: string; result: { reply: string; proposedForm: FormDraft | null } };
export type ChatRequest = { message: string; currentForm: FormDraft; conversationId?: string; selectedFieldId?: string };
export type Proposal = { before: FormDraft; after: FormDraft; fingerprint: string; revision: number; status: "pending" | "applied" | "discarded" };
export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; failed?: boolean; proposal?: Proposal };
type ChatState = { messages: ChatMessage[]; conversationId?: string; pending: boolean; error: string; expired: boolean };

export function editableForm(form: FormDraft): FormDraft {
  return structuredClone({ title: form.title, description: form.description, fields: form.fields });
}

export function formFingerprint(form: FormDraft): string {
  function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
    return value;
  }
  return JSON.stringify(stable(editableForm(form)));
}

export async function sendFormChat(formId: string, body: ChatRequest, signal: AbortSignal): Promise<ChatResponse> {
  return apiRequest<ChatResponse>(`/forms/${encodeURIComponent(formId)}/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
}

// Local session only. Transport is replaceable for offline integration tests.
export class FormChatSession {
  private state: ChatState = { messages: [], pending: false, error: "", expired: false };
  private listeners = new Set<() => void>();
  private requestId = 0;
  private controller?: AbortController;
  private formId: string;
  private transport: typeof sendFormChat;
  constructor(formId: string, transport = sendFormChat) { this.formId = formId; this.transport = transport; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  cancel = () => {
    ++this.requestId;
    this.controller?.abort();
    this.update({ pending: false });
  };
  startNew = () => {
    this.cancel();
    this.update({ messages: [], conversationId: undefined, error: "", expired: false });
  };
  finish(id: string, status: Proposal["status"]) {
    this.update({ messages: this.state.messages.map((item) => item.id === id && item.proposal
      ? { ...item, proposal: { ...item.proposal, status } } : item) });
  }
  async send(text: string, draft: FormDraft, revision: number, selectedFieldId?: string): Promise<boolean> {
    const message = text.trim();
    if (!this.formId || !message || this.state.pending || this.state.expired) return false;
    const before = editableForm(draft);
    const fingerprint = formFingerprint(before);
    const last = this.state.messages.at(-1);
    const user = last?.role === "user" && last.failed && last.text === message
      ? { ...last, failed: false } : { id: crypto.randomUUID(), role: "user" as const, text: message };
    const messages = last?.id === user.id ? [...this.state.messages.slice(0, -1), user] : [...this.state.messages, user];
    const identity = ++this.requestId;
    this.controller = new AbortController();
    this.update({ messages, pending: true, error: "", expired: false });
    try {
      const response = await this.transport(this.formId, {
        message, currentForm: before,
        ...(this.state.conversationId ? { conversationId: this.state.conversationId } : {}),
        ...(selectedFieldId && before.fields.some((field) => field.id === selectedFieldId) ? { selectedFieldId } : {}),
      }, this.controller.signal);
      if (identity !== this.requestId) return false;
      this.update({ conversationId: response.conversationId, messages: [...this.state.messages, {
        id: crypto.randomUUID(), role: "assistant", text: response.result.reply,
        ...(response.result.proposedForm !== null ? { proposal: {
          before, after: editableForm(response.result.proposedForm), fingerprint, revision, status: "pending" as const,
        } } : {}),
      }] });
      return true;
    } catch (error) {
      if (identity !== this.requestId) return false;
      const expired = error instanceof ApiError && error.status === 404 &&
        /^Conversation not found or expired\./i.test(error.serverMessage);
      this.update({ error: error instanceof Error ? error.message : "Could not send message.", expired,
        messages: this.state.messages.map((item) => item.id === user.id ? { ...item, failed: true } : item) });
      return false;
    } finally {
      if (identity === this.requestId) this.update({ pending: false });
    }
  }
}
