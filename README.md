# Commonpaper

A lightweight collaborative document workspace built for the Ajaia Full Stack Product Engineer assessment. It focuses on a coherent end-to-end slice rather than trying to reproduce all of Google Docs.

## Features

- Create, rename, edit, save, reopen, and delete documents.
- Browser rich-text editor: bold, italic, underline, headings, bulleted/numbered lists, block quotes, undo/redo, and word count.
- SQLite persistence locally; managed PostgreSQL automatically when `DATABASE_URL` is configured (as in the included Render Blueprint).
- Three seeded demo accounts; shared documents show a distinct “Shared with me” view.
- Sharing model supports owner, editor, and viewer; the server rejects unauthorized writes and owner-only actions.
- Import `.txt` and `.md` files (UTF-8, up to 1 MB) into new editable documents. Markdown import supports headings and simple ordered/unordered lists.
- Server-side rich-text allowlist strips attributes and active markup before stored content is returned.
- Responsive layout, accessible button labels, empty/loading/error/save states, and a health endpoint.

## Local setup

Requires Python 3.10+.

### Windows Command Prompt (CMD)

```bat
py -m venv .venv
.venv\Scripts\activate.bat
python -m pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

### Windows PowerShell

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

Open <http://127.0.0.1:8000>. When `DATABASE_URL` is unset, the SQLite database is created automatically at `instance/commonpaper.sqlite3` and seeded on first run. When `DATABASE_URL` is present, the app uses PostgreSQL and initializes its schema on startup. The `/health` endpoint returns a small JSON readiness check.

## Demo accounts

Authentication is intentionally mocked for the exercise. Use the user switcher in the lower-left area of the sidebar to switch between these seeded profiles; no password is required.

| Name | Email | Example use |
|---|---|---|
| Alice Morgan | `alice@example.com` | Owns the seeded briefing and interview notes |
| Jordan Lee | `jordan@example.com` | Has editor access to the weekly briefing; owns the Q4 checklist |
| Sam Rivera | `sam@example.com` | Has viewer access to the interview notes |

Useful review path: start as Alice → open “Product sync — weekly briefing” → Share → grant Sam view access or update Jordan's access → switch to Jordan or Sam → confirm the document appears under “Shared with me” and that permissions are enforced.

## Tests

```bash
python -m pip install pytest httpx
pytest -q
```

The automated tests cover local persistence and rich-text sanitization, editor/viewer permissions, Markdown upload, unsupported file rejection, access denial, and PostgreSQL placeholder translation. Test databases live in a temporary directory and do not affect the local demo database.

## Configuration

- `DATABASE_PATH`: optional absolute path for the SQLite file (local mode).
- `DATABASE_URL`: optional PostgreSQL connection URL; takes precedence over SQLite and is configured automatically by the Render Blueprint.
- `SECRET_KEY`: set a long, random secret outside local development.
- `COOKIE_SECURE=true`: set when served exclusively over HTTPS.
- `PORT`: port supplied by hosting platforms; the local command uses `--port 8000`.

Do not commit secrets. The seeded-user switcher is for assessment demonstration only and must be replaced with real identity/authentication before production use.

## Deployment notes

The included Render Blueprint provisions a free web service and a managed PostgreSQL database, then injects `DATABASE_URL`. Render free web services use ephemeral filesystems, so hosted document data is stored in Postgres rather than SQLite. Render’s free Postgres tier expires after 30 days; that is a time-limited assessment/demo choice, not a long-term production database. For a production deployment, select an appropriate durable database plan, add migrations/backups, and implement real authentication.

## Public deployment with Render

1. Push the project root to a GitHub repository (do not commit `.env`, `.venv`, caches, or local SQLite files).
2. In Render, select **New → Blueprint**, connect that repository, keep the `main` branch, and review `render.yaml`.
3. Confirm the blueprint will create one web service and one PostgreSQL database, then deploy it.
4. Wait for the web service deploy status to show **Live** and open the URL shown on the service page.
5. Verify `/health`, then test create/edit/refresh, `.txt` or `.md` import, and owner/editor/viewer sharing.

The free Render Postgres database is time-limited (30 days). Do not use this assessment setup for production data.

## Scope and known limitations

- Demo authentication uses a client-switchable, signed session cookie; it is not real authentication and must not be exposed as a production access boundary.
- Sharing works only between seeded demo users; no emails are sent and there are no public links.
- Supported imports are `.txt` and `.md` only; `.docx`, images, and attachments are out of scope.
- Autosave is debounced and persisted, but simultaneous co-editing, presence, conflict resolution, version history, comments, and offline mode are not implemented.
- The editor is intentionally a small contentEditable implementation. It provides common formatting controls but not full Google Docs pagination or deterministic cross-browser rich-text behavior.
- SQLite is intended for this single-instance exercise, not horizontally scaled production workloads.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md) for the decisions and workflow notes.
