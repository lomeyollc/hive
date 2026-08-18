---
name: local-qa
description: Use before any browser QA or screenshot pass on Hive — running the app locally with a real logged-in session, and seeding a board with tasks. Covers why `vite dev` cannot serve the API, how to mint a session cookie without Google OAuth, and the screenshot gotcha that silently clips the drawer.
---

# Hive — local QA with a logged-in session

Google Sign-In is the only real login. For QA you mint the session cookie yourself.

## 1. Serve the app with `wrangler dev`, not `vite dev`

`npm run dev` (vite) serves the SPA but **every `/api/*`, `/auth/*` route 404s with an empty
body** — the worker is not reached. Build once, then:

```bash
npm run build
npx wrangler dev --port 8788        # serves worker + dist/client together
```

Rebuild after each frontend change — `wrangler dev` serves the built `dist/client`, not source.

## 2. Mint the session cookie

`.dev.vars` must exist (gitignored). Any value works locally:

```
GOOGLE_CLIENT_ID=x
GOOGLE_CLIENT_SECRET=x
SESSION_SECRET=devsecret
```

The cookie is `base64url(json).base64url(hmac-sha256)` — same format as `auth/session.ts`:

```bash
node -e '
const c=require("crypto"), s="devsecret";
const b=x=>Buffer.from(x).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const p=b(JSON.stringify({email:"zakir@lomeyo.com",exp:Math.floor(Date.now()/1e3)+86400}));
console.log(p+"."+b(c.createHmac("sha256",s).update(p).digest()));' > /tmp/hive-cookie
curl -s -H "Cookie: hive_session=$(cat /tmp/hive-cookie)" localhost:8788/auth/session   # {"email":...}
```

## 3. Seed data — a workspace comes first

Boards are workspace-scoped and both take a caller-supplied `id` (lowercase, hyphens), so a
POST with only `name`/`slug` fails with a confusing "id is required":

```bash
curl -X POST localhost:8788/api/workspaces -d '{"id":"lomeyo","name":"Lomeyo LLC"}'
curl -X POST localhost:8788/api/boards     -d '{"id":"shiptell","name":"shiptell","workspace_id":"lomeyo"}'
curl -X POST localhost:8788/api/boards/shiptell/tasks -d '{"title":"…","status":"open"}'
```

(All with `-H "Cookie: hive_session=…" -H "Content-Type: application/json"`.)

Seed at least one task with a 1–2k-character description — that is the case every drawer/list
layout bug shows up in, and a short-description board hides all of them.

## 4. Screenshots — set the viewport on the page, and wait for the dialog

Two traps that produce wrong-looking screenshots rather than errors:

- **Viewport.** `launch_context(viewport=…)` is not enough; the window stays ~1920 wide while
  the capture is clipped to the requested width, so a right-hand sheet (`fixed right-0`) looks
  cut off or missing. Call `page.set_viewport_size({...})` on the page too.
- **Deep links.** `/boards/:slug/tasks/:id` opens the sheet only after the board's tasks load —
  `networkidle` is not sufficient. `page.wait_for_selector("[role=dialog]")` before capturing.

Use cloakbrowser (Playwright API) and add the cookie with
`ctx.add_cookies([{ "name":"hive_session", "value":…, "domain":"localhost", "path":"/" }])`.
