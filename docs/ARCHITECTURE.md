# Architecture note — Commonpaper

## Product slice

I optimized for one complete loop: a user opens a workspace, creates or imports a document, edits formatted content, sees it persist after navigation/refresh, and grants another seeded user a defined access level. The primary success criterion is an end-to-end path that a reviewer can exercise in a few minutes.

## System shape

- **UI:** server-served HTML, responsive CSS, and vanilla JavaScript. A small contentEditable surface avoids a large editor dependency under the time constraint.
- **API:** FastAPI JSON endpoints for session/demo users, documents, import, and sharing.
- **Persistence:** SQLite locally and managed PostgreSQL when `DATABASE_URL` is set. Both use `users`, `documents`, and `shares` tables; foreign keys and uniqueness constraints make one grant per user/document explicit. Content remains HTML so basic document structure survives refresh. The Render Blueprint provisions Postgres because Render free web-service filesystems are ephemeral.
- **Access checks:** every document read/update/delete checks ownership or a share grant. Owners can rename, delete, and manage shares; editors can change content; viewers are read-only. Those checks live server-side rather than relying only on disabled UI controls.
- **Import:** UTF-8 `.txt` and `.md` files up to 1 MB become documents. Markdown headings and simple lists are converted to HTML with escaped text.
- **Rich-text safety:** saved editor HTML is reduced to a formatting tag allowlist; attributes are discarded to prevent event handlers and unsafe links from being stored. This is intentionally more restrictive than a full editor schema.

## Key trade-offs

1. **Vanilla editor over a full editor framework.** It kept setup light and gave the reviewer core formatting controls quickly. The trade-off is less predictable browser editing and no sophisticated schema, tables, images, or collaborative cursors.
2. **SQLite locally, Postgres in the hosted demo.** Local setup stays frictionless; the Render Blueprint supplies a managed database so demo documents survive web-service sleep/redeploy. Render free Postgres expires after 30 days, so the assessment database is temporary. A production deployment needs a durable plan, migrations, backups, and monitoring.
3. **Seeded users over real authentication.** This makes owner/editor/viewer flows easy to review. It is a deliberate demo-only shortcut, not a production security model.
4. **Import-to-new-document over generic attachments.** It is a clear document workflow and avoids adding a separate file object/storage service.
5. **Single-user editing with persisted sharing over real-time co-editing.** Access semantics and persistence are core requirements; realtime conflict resolution is an optional stretch and was deprioritized.

## Next 2–4 hours

- Add stronger editor behavior/tests with a schema-aware editor package.
- Add schema migrations, backups, and production database monitoring.
- Add real authentication and CSRF/origin protections appropriate to the hosting model.
- Add document versions or comments only after the core experience and storage are hardened.
- Add a browser-level test for rich-text toolbar operations and key responsive breakpoints.
