# Draft persistence

Accept extracted forms with `POST /api/documents/:documentId/accept-form` and
`{ form: { title, description, fields } }`. The server verifies the document,
validates editable fields, and creates revision 1 with an immutable source link.
Manual forms use `POST /api/forms` with the editable form directly and no source.

Updates use `PUT /api/forms/:id` with
`{ form: { title, description, fields }, expectedRevision: 1 }`.
The update matches the stored revision atomically and increments it. A stale
revision returns 409; a missing ID returns 404. Reads expose legacy forms with
no stored revision as revision 0. Their first conditional update creates
revision 1. Clients must supply expectedRevision; old blind-update requests
receive a validation error rather than overwriting concurrent work.

The frontend opens saved drafts at `/forms/:formId`; `/forms/new` starts a
manual draft. Vite development and preview use SPA fallback. A production
static host must serve `client/dist/index.html` for unknown frontend routes
(for example nginx `try_files $uri $uri/ /index.html;`). Keep API paths routed
to Express. Unsaved edits are in browser memory, not local storage; refresh
loads the last saved revision. Conflicts retain in-memory edits and require
an explicit reload/merge decision.

Run the local MongoDB integration check from `server`:
`node --import tsx --test tests/draftPersistence.test.mjs`.
It creates and drops a uniquely named verification database on localhost:27017,
leaving application data untouched. It makes no AI calls.

Acceptance prevents repeated clicks and reuses the accepted draft within the
current document view. Separate acceptance requests (for example from separate
tabs or after a lost response) can create separate drafts; the endpoint is not
an idempotency service.
