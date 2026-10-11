# Public deployment guide — Commonpaper

This repo includes a Render Blueprint that creates a Python web service plus managed PostgreSQL. You must authorize GitHub/Render in your own accounts; this guide does not create a hosted service or URL by itself.

## 1. Push source to GitHub (Windows CMD)

Create an **empty** repository named `commonpaper-ajaia` on GitHub. Do not initialize it with a README or license. Then run the following from the project root (change the GitHub username in the remote URL):

```bat
git --version
git init -b main
git add .
git status
git commit -m "Prepare Commonpaper for Render deployment"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/commonpaper-ajaia.git
git push -u origin main
```

Before committing, make sure `.env`, `.venv`, `instance/*.sqlite3`, `__pycache__`, and `.pytest_cache` are not staged. The included `.gitignore` excludes these. Never commit real credentials. If `git init -b main` is not supported, run `git init` and then `git branch -M main`.

## 2. Deploy on Render

1. Sign in to the Render Dashboard.
2. Select **New → Blueprint**.
3. Connect GitHub and choose `commonpaper-ajaia`, branch `main`.
4. Keep Blueprint path as `render.yaml`.
5. Review the resources: one web service (`commonpaper-demo`) and one Postgres database (`commonpaper-db`), both on the free tier.
6. Select **Deploy Blueprint**. Wait for the web service deploy to show **Live**.
7. Open the actual public URL displayed on the web-service page. Do not guess the URL from the service name.

## 3. Verify the live app

Open `https://YOUR-ACTUAL-SERVICE-URL/health`; it should return `{"ok":true,"app":"Commonpaper"}`. Then test in the UI: create a document, edit and wait for the save indicator, refresh, confirm content remains, import a small `.txt`/`.md` file, share with `sam@example.com` as viewer or `jordan@example.com` as editor, and switch demo users to verify permissions.

## 4. Save the actual URL

Once the real URL is available, in Windows CMD run this from the repo root, replacing the placeholder with the URL copied from Render:

```bat
echo https://YOUR-ACTUAL-SERVICE-URL.onrender.com> LIVE_PRODUCT_URL.txt
git add LIVE_PRODUCT_URL.txt
git commit -m "Add live product URL"
git push
```

Also replace `LIVE_PRODUCT_URL.txt` in the Google Drive submission copy or ask for an updated ZIP after sharing the real URL. Check that the URL is accessible in a private/incognito browser window.

## Persistence note

Hosted mode uses managed Postgres via `DATABASE_URL`; local mode keeps SQLite. Render's free Postgres database expires after 30 days, so this configuration is suitable only for a short assessment/demo, not production data.
