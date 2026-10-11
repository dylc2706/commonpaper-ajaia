# AI-native workflow note

> This note describes the AI-assisted development and verification process for this assessment. Review it for accuracy before submission and remove any tool or step you did not personally use.

## Tools used

- ChatGPT: requirement decomposition, UI/API drafting, permission-model review, test design, implementation iteration, and Markdown documentation.
- Local Python/ASGI tooling: run automated API tests, check Python/JavaScript syntax, and prepare a browser smoke test.

## Where AI helped

- Broke the open-ended brief into a small user journey: create/edit → persist/reopen → import → share → verify roles.
- Proposed a seeded-account pattern to demonstrate sharing without spending the timebox on a full identity provider.
- Helped identify server-side authorization checks as necessary even when the UI hides editing controls.
- Drafted test cases for persistence, malformed/unsafe rich text, import validation, and editor/viewer permission boundaries.

## Judgment and changes

- Chose FastAPI with SQLite locally so setup and tests are simple, then added a small PostgreSQL adapter and Render-managed Postgres for deployment because Render free web services have ephemeral filesystems.
- Changed an earlier Flask-based approach to FastAPI when Flask was not available in the isolated environment; this kept the app aligned with the installed toolchain and made local API tests possible.
- Kept real-time collaboration, public links, `.docx`, and version history out of scope to protect completion and testing time.
- Treated seeded-user switching as demo scaffolding, not real authentication.
- Kept import limited to UTF-8 `.txt` and `.md`, with a documented 1 MB limit.
- Added a strict rich-text allowlist and discarded arbitrary HTML attributes instead of trusting browser editor markup.
- Preserved local SQLite while using the `DATABASE_URL` environment variable to select PostgreSQL in hosted mode. Render free Postgres is time-limited (30 days), so it is intended for the assessment/demo only.

## Verification performed

- [x] `pytest -q`: 6 tests passed, covering app/health response, persisted document reads and rich-text sanitization, editor/viewer permission boundaries, Markdown upload conversion, unsupported file rejection, unshared access denial, and PostgreSQL placeholder translation.
- [x] `node --check static/app.js`: JavaScript syntax check passed.
- [x] Applicant reported that the application was run and locally verified on Windows. Recheck the main flow after deployment.
- [ ] Independent browser automation and responsive breakpoint review: not independently completed in this environment; an attempted Playwright navigation was blocked by the execution environment policy.
- [ ] Public deployment verification: pending.
- [ ] Walkthrough video: pending.

The automated tests exercise API behavior. They do not replace a manual check of the browser toolbar, autosave timing, and mobile/desktop layout; complete those checks before final submission.

## Limitations

No email invitations, real sign-in, public share links, realtime co-editing, comments, version history, `.docx`, or multi-instance database support are claimed as implemented.
