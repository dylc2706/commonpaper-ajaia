# Submission contents — Commonpaper

This package contains the application source and supporting assessment materials. Extract the ZIP before uploading the files into the Google Drive submission folder so the reviewer can open each item without downloading a nested archive.

## Included files

- `app.py` — FastAPI application, API endpoints, access checks, import parsing, SQLite/Postgres schema support, and seed data.
- `templates/index.html` — application page structure and accessible dialogs.
- `static/styles.css` — responsive workspace and editor styling.
- `static/app.js` — editor interactions, autosave, document views, demo-user switching, file import, and sharing UI.
- `tests/test_app.py` — automated API and permission tests.
- `requirements.txt` — Python dependencies.
- `.env.example` and `.gitignore` — configuration template and local-file exclusions.
- `README.md` — Windows/macOS/Linux setup, seeded accounts, tests, configuration, and known limitations.
- `docs/ARCHITECTURE.md` — system design and trade-offs.
- `docs/AI_WORKFLOW.md` — AI-assisted workflow and verification record.
- `docs/WALKTHROUGH_SCRIPT.md` — suggested 3–5 minute recording outline.
- `TEST_RESULTS.md` — checks executed and remaining verification limits.
- `LIVE_PRODUCT_URL.txt` — **replace with the real public deployment URL before submission**.
- `WALKTHROUGH_URL.txt` — **replace with the real unlisted Loom/YouTube URL before submission**.
- `render.yaml` — Render Blueprint for a web service plus managed PostgreSQL.
- `DEPLOY_RENDER.md` — steps to publish from GitHub to Render and verify the live instance.

## Required finalization before submitting to Ajaia

1. Deploy the app publicly and test the deployed `/health` endpoint and core document/sharing flow. Put the working URL in `LIVE_PRODUCT_URL.txt`.
2. Record a 3–5 minute walkthrough, upload it as unlisted, and put the actual URL in `WALKTHROUGH_URL.txt`.
3. Create one Google Drive folder and upload the extracted project folder and its files, keeping this `SUBMISSION.md` at the top level.
4. Reopen the Drive folder and verify that the reviewer can access it. Submit the Drive folder link and the public app URL in Ajaia's assessment form.

## Deployment status

The source package is prepared and automated tests pass locally. A public deployment, walkthrough recording, and Google Drive folder have **not** been created by this package. The Render Blueprint is configured to provision hosted PostgreSQL, but the resources must still be created in your Render account. Do not submit placeholder URLs as if they were live.

## Known scope limits

Authentication is simulated with seeded demo users. Sharing is limited to the seeded accounts; email invitations and public links are not implemented. The app does not claim real-time collaboration, comments, version history, `.docx` imports, or production-grade identity/access management. See `README.md` and `docs/ARCHITECTURE.md`.
