"""Commonpaper — a lightweight collaborative document workspace."""
from __future__ import annotations

import html
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Generator

from fastapi import Body, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from starlette.templating import Jinja2Templates

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DB = BASE_DIR / "instance" / "commonpaper.sqlite3"
MAX_UPLOAD_BYTES = 1_000_000
ALLOWED_UPLOAD_EXTENSIONS = {".txt", ".md"}
ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "h1", "h2", "h3",
    "ul", "ol", "li", "blockquote", "pre", "code", "hr",
}
VOID_TAGS = {"br", "hr"}
BLOCKED_TAGS = {"script", "style", "iframe", "object", "svg", "math"}

SEED_USERS = [
    {"id": "alice", "name": "Alice Morgan", "email": "alice@example.com", "initials": "AM", "color": "lavender"},
    {"id": "bob", "name": "Jordan Lee", "email": "jordan@example.com", "initials": "JL", "color": "mint"},
    {"id": "charlie", "name": "Sam Rivera", "email": "sam@example.com", "initials": "SR", "color": "peach"},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class SafeRichTextParser(HTMLParser):
    """Allow limited rich text; drop attributes, active markup, and comments."""
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.output: list[str] = []
        self.stack: list[str] = []
        self.blocked: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in BLOCKED_TAGS:
            self.blocked.append(tag)
            return
        if self.blocked:
            return
        if tag not in ALLOWED_TAGS:
            return
        tag = {"b": "strong", "i": "em"}.get(tag, tag)
        self.output.append(f"<{tag}>")
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in BLOCKED_TAGS:
            if self.blocked and self.blocked[-1] == tag:
                self.blocked.pop()
            return
        if self.blocked:
            return
        tag = {"b": "strong", "i": "em"}.get(tag, tag)
        if tag not in self.stack:
            return
        while self.stack:
            current = self.stack.pop()
            self.output.append(f"</{current}>")
            if current == tag:
                break

    def handle_data(self, data: str) -> None:
        if not self.blocked:
            self.output.append(html.escape(data, quote=False))

    def handle_comment(self, data: str) -> None:
        return

    def finish(self) -> str:
        while self.stack:
            self.output.append(f"</{self.stack.pop()}>")
        return "".join(self.output).strip()


def sanitize_rich_text(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("Content must be a string.")
    parser = SafeRichTextParser()
    parser.feed(value[:500_000])
    parser.close()
    return parser.finish()


def text_to_html(raw_text: str, extension: str) -> str:
    """Convert UTF-8 text or a small Markdown subset to editable, escaped HTML."""
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    blocks: list[str] = []
    list_type: str | None = None
    list_items: list[str] = []

    def flush_list() -> None:
        nonlocal list_type, list_items
        if list_type and list_items:
            blocks.append(f"<{list_type}>" + "".join(f"<li>{item}</li>" for item in list_items) + f"</{list_type}>")
        list_type, list_items = None, []

    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            flush_list()
            continue
        if extension == ".md":
            heading = re.match(r"^(#{1,3})\s+(.+)$", stripped)
            bullet = re.match(r"^[-*+]\s+(.+)$", stripped)
            numbered = re.match(r"^\d+[.)]\s+(.+)$", stripped)
            if heading:
                flush_list()
                level = len(heading.group(1))
                blocks.append(f"<h{level}>{html.escape(heading.group(2))}</h{level}>")
                continue
            if bullet or numbered:
                wanted = "ul" if bullet else "ol"
                if list_type != wanted:
                    flush_list()
                    list_type = wanted
                list_items.append(html.escape((bullet or numbered).group(1)))
                continue
        flush_list()
        blocks.append(f"<p>{html.escape(stripped)}</p>")
    flush_list()
    return "".join(blocks) or "<p></p>"


class PostgresCompatConnection:
    """Small adapter so the app can use qmark SQL with psycopg in hosted mode."""

    def __init__(self, connection: Any):
        self._connection = connection

    def execute(self, sql: str, parameters: tuple | list = ()):
        return self._connection.execute(sql.replace("?", "%s"), parameters)

    def executescript(self, sql: str) -> None:
        # The schema contains independent DDL statements; psycopg executes each.
        for statement in sql.split(";"):
            statement = statement.strip()
            if statement:
                self.execute(statement)

    def commit(self) -> None:
        self._connection.commit()

    def close(self) -> None:
        self._connection.close()


def create_app(test_config: dict[str, Any] | None = None) -> FastAPI:
    settings: dict[str, Any] = {
        "SECRET_KEY": os.environ.get("SECRET_KEY", "dev-only-change-this-before-deploying"),
        "DATABASE": os.environ.get("DATABASE_PATH", str(DEFAULT_DB)),
        "DATABASE_URL": os.environ.get("DATABASE_URL"),
        "SEED_DATA": True,
        "COOKIE_SECURE": os.environ.get("COOKIE_SECURE", "false").lower() == "true",
    }
    if test_config:
        settings.update(test_config)

    if not settings.get("DATABASE_URL"):
        Path(settings["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    application = FastAPI(title="Commonpaper", version="1.0.0", docs_url=None, redoc_url=None)
    application.state.settings = settings
    application.add_middleware(
        SessionMiddleware,
        secret_key=settings["SECRET_KEY"],
        same_site="lax",
        https_only=settings["COOKIE_SECURE"],
    )
    templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
    application.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

    def connect_db() -> Any:
        database_url = settings.get("DATABASE_URL")
        if database_url:
            # Render injects DATABASE_URL when the managed Postgres service is ready.
            import psycopg
            from psycopg.rows import dict_row

            if database_url.startswith("postgres://"):
                database_url = "postgresql://" + database_url[len("postgres://"): ]
            raw_connection = psycopg.connect(database_url, row_factory=dict_row, connect_timeout=10)
            return PostgresCompatConnection(raw_connection)

        connection = sqlite3.connect(settings["DATABASE"], timeout=5.0, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def get_db() -> Generator[Any, None, None]:
        connection = connect_db()
        try:
            yield connection
        finally:
            connection.close()

    def user_by_id(connection: Any, user_id: str) -> Any | None:
        return connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    def current_user(request: Request, connection: Any) -> Any:
        user_id = request.session.get("user_id", "alice")
        user = user_by_id(connection, user_id)
        if user is None:
            request.session["user_id"] = "alice"
            user = user_by_id(connection, "alice")
        if user is None:
            raise HTTPException(status_code=500, detail="Demo users are not initialized.")
        return user

    def user_payload(row: Any) -> dict[str, str]:
        return {"id": row["id"], "name": row["name"], "email": row["email"], "initials": row["initials"], "color": row["color"]}

    def doc_access(connection: Any, document_id: str, user_id: str) -> tuple[Any | None, str | None]:
        document = connection.execute(
            "SELECT d.*, u.name AS owner_name, u.email AS owner_email, u.initials AS owner_initials, u.color AS owner_color "
            "FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ?", (document_id,)
        ).fetchone()
        if document is None:
            return None, None
        if document["owner_id"] == user_id:
            return document, "owner"
        share = connection.execute("SELECT role FROM shares WHERE document_id = ? AND user_id = ?", (document_id, user_id)).fetchone()
        return (document, share["role"]) if share else (None, None)

    def doc_payload(document: Any, role: str) -> dict[str, Any]:
        return {
            "id": document["id"], "title": document["title"], "content": document["content"],
            "owner_id": document["owner_id"], "owner_name": document["owner_name"],
            "owner_email": document["owner_email"], "owner_initials": document["owner_initials"],
            "owner_color": document["owner_color"], "role": role,
            "created_at": document["created_at"], "updated_at": document["updated_at"],
        }

    def initialize_database() -> None:
        connection = connect_db()
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
                initials TEXT NOT NULL, color TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
                content TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS shares (
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('viewer', 'editor')),
                created_at TEXT NOT NULL,
                PRIMARY KEY(document_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_documents_owner_updated ON documents(owner_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id, document_id);
        """)
        if settings.get("SEED_DATA", True):
            for user in SEED_USERS:
                connection.execute(
                    "INSERT INTO users(id,name,email,initials,color) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
                    (user["id"], user["name"], user["email"], user["initials"], user["color"]),
                )
            existing = connection.execute("SELECT COUNT(*) AS count FROM documents").fetchone()["count"]
            if existing == 0:
                timestamp = now_iso()
                seeded_documents = [
                    ("briefing", "Product sync — weekly briefing", "<h1>Product sync</h1><p>A shared place to turn conversations into momentum.</p><h2>This week</h2><ul><li>Finalize the onboarding flow</li><li>Review feedback from five pilot users</li><li>Agree on the next release milestone</li></ul><h2>Open questions</h2><p>What is the smallest improvement that makes the biggest difference?</p>", "alice"),
                    ("research", "Customer interview notes", "<h1>Customer interview notes</h1><p><strong>Goal:</strong> understand where handoffs slow teams down.</p><ol><li>Ask how work is currently documented.</li><li>Find where context gets lost.</li><li>Validate the ideal sharing workflow.</li></ol><p><em>Next:</em> consolidate the recurring themes.</p>", "alice"),
                    ("roadmap", "Q4 launch checklist", "<h1>Q4 launch checklist</h1><p>A focused launch plan for the next product milestone.</p><ul><li>Confirm scope and owners</li><li>Run accessibility checks</li><li>Prepare release notes</li></ul>", "bob"),
                ]
                for document_id, title, content, owner_id in seeded_documents:
                    connection.execute("INSERT INTO documents(id,title,content,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?)", (document_id, title, content, owner_id, timestamp, timestamp))
                connection.execute("INSERT INTO shares(document_id,user_id,role,created_at) VALUES('briefing','bob','editor',?) ON CONFLICT(document_id,user_id) DO NOTHING", (timestamp,))
                connection.execute("INSERT INTO shares(document_id,user_id,role,created_at) VALUES('research','charlie','viewer',?) ON CONFLICT(document_id,user_id) DO NOTHING", (timestamp,))
        connection.commit()
        connection.close()

    initialize_database()

    @application.exception_handler(HTTPException)
    async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse({"error": detail}, status_code=exc.status_code, headers=exc.headers)

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": "The request could not be understood. Check the submitted fields."}, status_code=422)

    @application.get("/", response_class=HTMLResponse)
    def index(request: Request):
        return templates.TemplateResponse(request=request, name="index.html", context={})

    @application.get("/health")
    def health():
        return {"ok": True, "app": "Commonpaper"}

    @application.get("/api/session")
    def get_session(request: Request, connection: Any = Depends(get_db)):
        user = current_user(request, connection)
        return {"user": user_payload(user), "users": [user_payload(row) for row in connection.execute("SELECT * FROM users ORDER BY name").fetchall()], "demo_auth": True}

    @application.post("/api/session")
    def switch_session(payload: dict = Body(...), request: Request = None, connection: Any = Depends(get_db)):
        recipient = user_by_id(connection, str(payload.get("user_id", "")))
        if not recipient:
            raise HTTPException(status_code=400, detail="Choose one of the seeded demo users.")
        request.session["user_id"] = recipient["id"]
        return {"user": user_payload(recipient)}

    @application.get("/api/documents")
    def list_documents(request: Request, scope: str = "owned", connection: Any = Depends(get_db)):
        user = current_user(request, connection)
        if scope == "shared":
            rows = connection.execute(
                "SELECT d.*, owner.name AS owner_name, owner.email AS owner_email, owner.initials AS owner_initials, owner.color AS owner_color, s.role AS access_role "
                "FROM shares s JOIN documents d ON d.id=s.document_id JOIN users owner ON owner.id=d.owner_id "
                "WHERE s.user_id=? ORDER BY d.updated_at DESC", (user["id"],)
            ).fetchall()
            return {"documents": [doc_payload(row, row["access_role"]) for row in rows]}
        if scope != "owned":
            raise HTTPException(status_code=400, detail="Scope must be 'owned' or 'shared'.")
        rows = connection.execute(
            "SELECT d.*, u.name AS owner_name, u.email AS owner_email, u.initials AS owner_initials, u.color AS owner_color "
            "FROM documents d JOIN users u ON u.id=d.owner_id WHERE d.owner_id=? ORDER BY d.updated_at DESC", (user["id"],)
        ).fetchall()
        return {"documents": [doc_payload(row, "owner") for row in rows]}

    @application.post("/api/documents", status_code=201)
    def create_document(payload: dict = Body(...), request: Request = None, connection: Any = Depends(get_db)):
        title = str(payload.get("title", "Untitled document")).strip()[:160]
        if not title:
            raise HTTPException(status_code=400, detail="Give your document a title.")
        try:
            content = sanitize_rich_text(payload.get("content", "<p></p>"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        user = current_user(request, connection)
        document_id, timestamp = uuid.uuid4().hex, now_iso()
        connection.execute("INSERT INTO documents(id,title,content,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?)", (document_id, title, content, user["id"], timestamp, timestamp))
        connection.commit()
        document, role = doc_access(connection, document_id, user["id"])
        return {"document": doc_payload(document, role or "owner")}

    @application.get("/api/documents/{document_id}")
    def get_document(document_id: str, request: Request, connection: Any = Depends(get_db)):
        user = current_user(request, connection)
        document, role = doc_access(connection, document_id, user["id"])
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found or you do not have access.")
        return {"document": doc_payload(document, role or "viewer")}

    @application.patch("/api/documents/{document_id}")
    def update_document(document_id: str, payload: dict = Body(...), request: Request = None, connection: Any = Depends(get_db)):
        user = current_user(request, connection)
        document, role = doc_access(connection, document_id, user["id"])
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found or you do not have access.")
        updates: list[str] = []
        values: list[Any] = []
        if "title" in payload:
            if role != "owner":
                raise HTTPException(status_code=403, detail="Only the owner can rename a document.")
            title = str(payload["title"]).strip()[:160]
            if not title:
                raise HTTPException(status_code=400, detail="Document title cannot be empty.")
            updates.append("title=?")
            values.append(title)
        if "content" in payload:
            if role not in {"owner", "editor"}:
                raise HTTPException(status_code=403, detail="You have view-only access to this document.")
            try:
                content = sanitize_rich_text(payload["content"])
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            updates.append("content=?")
            values.append(content)
        if not updates:
            raise HTTPException(status_code=400, detail="No supported fields to update.")
        updates.append("updated_at=?")
        values.append(now_iso())
        values.append(document_id)
        connection.execute(f"UPDATE documents SET {', '.join(updates)} WHERE id=?", values)
        connection.commit()
        updated, updated_role = doc_access(connection, document_id, user["id"])
        return {"document": doc_payload(updated, updated_role or role or "viewer")}

    @application.delete("/api/documents/{document_id}")
    def delete_document(document_id: str, request: Request, connection: Any = Depends(get_db)):
        user = current_user(request, connection)
        document, role = doc_access(connection, document_id, user["id"])
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found or you do not have access.")
        if role != "owner":
            raise HTTPException(status_code=403, detail="Only the owner can delete a document.")
        connection.execute("DELETE FROM documents WHERE id=?", (document_id,))
        connection.commit()
        return {"ok": True}

    @application.get("/api/documents/{document_id}/shares")
    def list_shares(document_id: str, request: Request, connection: Any = Depends(get_db)):
        user = current_user(request, connection)
        document, role = doc_access(connection, document_id, user["id"])
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found or you do not have access.")
        rows = connection.execute("SELECT u.id,u.name,u.email,u.initials,u.color,s.role,s.created_at FROM shares s JOIN users u ON u.id=s.user_id WHERE s.document_id=? ORDER BY u.name", (document_id,)).fetchall()
        shares = [{"user": {"id": row["id"], "name": row["name"], "email": row["email"], "initials": row["initials"], "color": row["color"]}, "role": row["role"], "created_at": row["created_at"]} for row in rows]
        return {"shares": shares, "can_manage": role == "owner"}

    @application.post("/api/documents/{document_id}/shares")
    def add_share(document_id: str, payload: dict = Body(...), request: Request = None, connection: Any = Depends(get_db)):
        user = current_user(request, connection)
        document, role = doc_access(connection, document_id, user["id"])
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found or you do not have access.")
        if role != "owner":
            raise HTTPException(status_code=403, detail="Only the owner can manage sharing.")
        email = str(payload.get("email", "")).strip().lower()
        share_role = str(payload.get("role", ""))
        if share_role not in {"viewer", "editor"}:
            raise HTTPException(status_code=400, detail="Choose viewer or editor access.")
        recipient = connection.execute("SELECT * FROM users WHERE lower(email)=?", (email,)).fetchone()
        if not recipient:
            raise HTTPException(status_code=404, detail="That email is not a seeded demo user. Try jordan@example.com or sam@example.com.")
        if recipient["id"] == document["owner_id"]:
            raise HTTPException(status_code=400, detail="The owner already has full access.")
        connection.execute("INSERT INTO shares(document_id,user_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(document_id,user_id) DO UPDATE SET role=excluded.role,created_at=excluded.created_at", (document_id, recipient["id"], share_role, now_iso()))
        connection.commit()
        return {"ok": True, "user": user_payload(recipient), "role": share_role}

    @application.delete("/api/documents/{document_id}/shares/{recipient_id}")
    def remove_share(document_id: str, recipient_id: str, request: Request, connection: Any = Depends(get_db)):
        user = current_user(request, connection)
        document, role = doc_access(connection, document_id, user["id"])
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found or you do not have access.")
        if role != "owner":
            raise HTTPException(status_code=403, detail="Only the owner can manage sharing.")
        connection.execute("DELETE FROM shares WHERE document_id=? AND user_id=?", (document_id, recipient_id))
        connection.commit()
        return {"ok": True}

    @application.post("/api/import", status_code=201)
    async def import_file(request: Request, file: UploadFile | None = File(default=None), connection: Any = Depends(get_db)):
        user = current_user(request, connection)
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="Choose a .txt or .md file first.")
        filename = Path(file.filename.replace("\\", "/")).name
        extension = Path(filename).suffix.lower()
        if extension not in ALLOWED_UPLOAD_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Unsupported file type. Upload a .txt or .md file.")
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File is too large. Maximum upload size is 1 MB.")
        try:
            raw_text = data.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=400, detail="The file must be UTF-8 text.") from exc
        content = text_to_html(raw_text, extension)
        title = Path(filename).stem.replace("_", " ").replace("-", " ").strip()[:160] or "Imported document"
        timestamp, document_id = now_iso(), uuid.uuid4().hex
        connection.execute("INSERT INTO documents(id,title,content,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?)", (document_id, title, content, user["id"], timestamp, timestamp))
        connection.commit()
        document, role = doc_access(connection, document_id, user["id"])
        return {"document": doc_payload(document, role or "owner"), "imported_filename": filename}

    return application


app = create_app()
