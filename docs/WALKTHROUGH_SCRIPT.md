# 3–5 minute walkthrough plan

Use this as a guide while recording the actual running app. Do not claim a feature works unless you demonstrate it live.

## 0:00–0:25 — Product and scope

“This is Commonpaper, a lightweight shared document workspace. I optimized for the essential document lifecycle: create, edit, persist, import, and share. I intentionally left out realtime co-editing and public links to protect the timebox.”

## 0:25–1:20 — Document editing

- Create a new document and rename it.
- Enter a heading and a short paragraph.
- Demonstrate bold/italic or a list.
- Pause briefly for the autosave indicator, then refresh and reopen the document.

## 1:20–1:50 — Import

- Import a small UTF-8 `.md` file containing a heading and bullet list.
- Show the converted editable structure.
- Mention the `.txt`/`.md` limit and 1 MB size cap.

## 1:50–2:50 — Sharing and permissions

- As Alice, share a document with Jordan as editor and Sam as viewer.
- Switch to Jordan and show the item under “Shared with me”; edit content.
- Switch to Sam and demonstrate the document is read-only.
- Point out that the demo-user switcher is simulated authentication, not production auth.

## 2:50–3:35 — Architecture and verification

- Briefly describe FastAPI, SQLite tables, and server-side role checks.
- State the actual test result from `TEST_RESULTS.md`.
- Explain the rich-text HTML allowlist and simple Markdown import.

## 3:35–4:10 — Trade-offs and next steps

- Explain why real-time collaboration, `.docx`, and version history were deprioritized.
- Identify the next production steps: real auth, Postgres, browser tests, and conflict handling.

## 4:10–4:30 — Wrap-up

Show the README's run instructions and point out limitations. Upload the unlisted recording and replace `WALKTHROUGH_URL.txt` with the true URL.
