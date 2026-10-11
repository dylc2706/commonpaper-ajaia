from __future__ import annotations

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

from app import PostgresCompatConnection, create_app


@pytest.fixture()
def client(tmp_path):
    application = create_app({"DATABASE": str(tmp_path / "test.sqlite3"), "DATABASE_URL": None, "SECRET_KEY": "test-secret", "SEED_DATA": True})
    with TestClient(application) as test_client:
        yield test_client


def test_create_document_persists_and_sanitizes_rich_text(client):
    response = client.post("/api/documents", json={
        "title": "A safe note",
        "content": '<h1>Plan</h1><p><strong>First</strong> step</p><script>alert(1)</script><p onclick="alert(2)">Second</p>',
    })
    assert response.status_code == 201
    created = response.json()["document"]
    assert created["title"] == "A safe note"
    assert "<h1>Plan</h1>" in created["content"]
    assert "<strong>First</strong>" in created["content"]
    assert "<script" not in created["content"]
    assert "onclick" not in created["content"]

    reopened = client.get(f"/api/documents/{created['id']}")
    assert reopened.status_code == 200
    assert reopened.json()["document"]["content"] == created["content"]


def test_sharing_enforces_editor_and_viewer_roles(client):
    created = client.post("/api/documents", json={"title": "Team plan", "content": "<p>Initial</p>"}).json()["document"]
    doc_id = created["id"]

    invite_editor = client.post(f"/api/documents/{doc_id}/shares", json={"email": "jordan@example.com", "role": "editor"})
    assert invite_editor.status_code == 200
    client.post("/api/session", json={"user_id": "bob"})
    shared_docs = client.get("/api/documents?scope=shared").json()["documents"]
    assert any(doc["id"] == doc_id for doc in shared_docs)
    assert client.get(f"/api/documents/{doc_id}").status_code == 200
    assert client.patch(f"/api/documents/{doc_id}", json={"content": "<p>Edited by Jordan</p>"}).status_code == 200
    assert client.patch(f"/api/documents/{doc_id}", json={"title": "Unauthorized rename"}).status_code == 403

    client.post("/api/session", json={"user_id": "alice"})
    assert client.post(f"/api/documents/{doc_id}/shares", json={"email": "sam@example.com", "role": "viewer"}).status_code == 200
    client.post("/api/session", json={"user_id": "charlie"})
    assert client.get(f"/api/documents/{doc_id}").status_code == 200
    assert client.patch(f"/api/documents/{doc_id}", json={"content": "<p>Should fail</p>"}).status_code == 403


def test_markdown_upload_creates_editable_document(client):
    markdown = b"# Launch plan\n\n- Confirm owner\n- Test sharing\n\nDone"
    response = client.post("/api/import", files={"file": ("launch-plan.md", io.BytesIO(markdown), "text/markdown")})
    assert response.status_code == 201
    result = response.json()
    assert result["document"]["title"] == "launch plan"
    assert "<h1>Launch plan</h1>" in result["document"]["content"]
    assert "<ul>" in result["document"]["content"]
    assert "<li>Confirm owner</li>" in result["document"]["content"]


def test_unsupported_upload_and_unshared_access_are_rejected(client):
    bad_file = client.post("/api/import", files={"file": ("script.js", io.BytesIO(b"alert(1)"), "text/javascript")})
    assert bad_file.status_code == 400

    client.post("/api/session", json={"user_id": "charlie"})
    assert client.get("/api/documents/briefing").status_code == 404


def test_home_and_health_are_available(client):
    page = client.get("/")
    assert page.status_code == 200
    assert "commonpaper" in page.text.lower()
    assert client.get("/health").json() == {"ok": True, "app": "Commonpaper"}


def test_postgres_adapter_translates_qmark_placeholders():
    class FakeConnection:
        def __init__(self):
            self.statement = None
            self.parameters = None

        def execute(self, statement, parameters=()):
            self.statement = statement
            self.parameters = parameters
            return "cursor"

    raw = FakeConnection()
    adapter = PostgresCompatConnection(raw)
    assert adapter.execute("SELECT * FROM documents WHERE id=?", ("doc-1",)) == "cursor"
    assert raw.statement == "SELECT * FROM documents WHERE id=%s"
    assert raw.parameters == ("doc-1",)
