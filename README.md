# Arré Voice — Share to Social

Standalone Vercel project. After a pod is posted, the app calls this API to
get share options, lets the user pick a platform/format, then this API
generates an audiogram and publishes it directly to Instagram or YouTube
Shorts.

> **This is a fully separate, new deliverable.** It does not reuse or modify
> any existing production infrastructure — new Meta App, new Google Cloud
> project, new Supabase project, new Cloudflare R2 bucket, new Vercel
> project. See `SETUP_CHECKLIST.md` for the exact steps to create all of
> these from scratch. Nothing here touches `clickup-automation` or any other
> existing project.

> **No authentication yet.** Every endpoint below is currently open — any
> caller who knows a `user_id` can call `/api/share/initiate` on their
> behalf, and OAuth `state` is unsigned. This is intentional for the current
> testing phase. Before this goes to real users, add an API key / session
> check on all routes and sign the OAuth `state` parameter (HMAC). Flagging
> this explicitly so it isn't missed during handoff.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/share/options?user_id={id}` | Returns which platforms/formats to show, and connection status |
| GET | `/api/share/connect/instagram?user_id={id}` | Returns OAuth URL to connect Instagram |
| GET | `/api/share/connect/youtube?user_id={id}` | Returns OAuth URL to connect YouTube |
| GET | `/api/share/connect/callback/instagram` | OAuth redirect target (registered in Meta App) |
| GET | `/api/share/connect/callback/youtube` | OAuth redirect target (registered in Google Cloud) |
| POST | `/api/share/initiate` | Runs the full pipeline: generate audiogram → upload to R2 → publish |
| GET | `/api/share/status/:jobId` | Look up a past job's result (history / retry / debugging) |

## 1. Setup

**Full click-by-click steps are in `SETUP_CHECKLIST.md`.** Summary below.

### Supabase (new project — not your production one)
Create a new Supabase project. Run `supabase/migration.sql` in its SQL editor. Creates `social_tokens` and `share_jobs`.

### Meta (Instagram) — new app
1. developers.facebook.com → Create App → type: Business
2. Add product: **Instagram Graph API**
3. Add permission: `instagram_content_publish`
4. Add a redirect URI: `https://<your-vercel-url>/api/share/connect/callback/instagram`
5. For testing (no App Review needed yet): add your own Instagram **Business or Creator** account as a Test User in the app dashboard
6. Copy App ID + App Secret into env vars

### Google (YouTube) — new project
1. console.cloud.google.com → New Project
2. Enable **YouTube Data API v3**
3. Create OAuth 2.0 credentials → type: Web application
4. Add redirect URI: `https://<your-vercel-url>/api/share/connect/callback/youtube`
5. Copy Client ID + Secret into env vars
6. Note the default quota: 10,000 units/day = ~6 uploads/day. Request an increase before scaling.

### Cloudflare R2 — new bucket
Create a brand new bucket (e.g. `arre-audiograms-dev`), not your existing production bucket. Enable public access, generate a scoped API token with read/write to just this bucket.

### Env vars
Copy `.env.example` → set all values in Vercel project settings.

## 2. Deploy

```bash
npm install
vercel --prod
```

This is a plain Vercel Functions project (no framework) — the `api/` folder
maps directly to routes, no build step needed.

## 3. Test it manually

### Check options for a user
```bash
curl "https://<your-app>.vercel.app/api/share/options?user_id=test-user-1"
```

### Connect Instagram (open this URL in a browser)
```bash
curl "https://<your-app>.vercel.app/api/share/connect/instagram?user_id=test-user-1"
# returns { auth_url: "..." } — open auth_url in a browser, log in, approve
```

### Initiate a share (after connecting)
```bash
curl -X POST "https://<your-app>.vercel.app/api/share/initiate" \
  -H "Content-Type: application/json" \
  -d '{
    "pod_id": "pod_123",
    "audio_url": "https://example.com/pod.mp3",
    "image_url": "https://example.com/cover.jpg",
    "title": "My Pod Title",
    "caption": "Check out my new pod on Arre Voice!",
    "platform": "instagram",
    "format": "reel",
    "user_id": "test-user-1"
  }'
```

This call will take up to ~30-60s since audiogram generation + publish
happens inline. The response includes the live `post_url` on success.

## 4. App integration

The app's job is small. This section maps each UI interaction to the exact
API call it should fire — no other backend logic needed on the app side.

| User action | API call | What happens with the response |
|---|---|---|
| Pod finishes posting, share sheet opens | none yet | App shows the existing "Share to" / "As a clip" rows plus the new "Add to socials" row |
| Taps "Add to socials" | `GET /api/share/options?user_id={id}` | Render the second sheet: for each platform, if `connected: true` show its `formats` as tappable chips (Reel/Post/Story for Instagram, Shorts for YouTube); if `connected: false` show a "Connect" button using `connect_url` |
| Taps "Connect Instagram" / "Connect YouTube" | `GET` the `connect_url` from the platform's entry in the last `/options` response — already includes `user_id` | This returns `{ auth_url }`. Open `auth_url` in a WebView. On the `arrevoice://share/connect/success` deep link, close the WebView and re-fetch `/api/share/options` to refresh the sheet |
| Taps a format chip (Reel / Post / Story / Shorts) | `POST /api/share/initiate` with `{ pod_id, audio_url, image_url, title, caption, platform, format, user_id }` | Show a loading state for up to ~60s. On response: `status: "success"` → show "Posted" with `post_url`; `status: "failed"` → show `error_message` with a retry button that re-fires the same call |

Two calls drive the entire flow: `options` on opening the social sheet,
`initiate` on picking a format. Nothing else is needed from the app beyond
the OAuth WebView handoff for connecting a new platform.

## Known limitations (by design, for this MVP)

- **Synchronous pipeline.** `/api/share/initiate` does everything in one
  request (capped at 60s via `vercel.json`). Fine for pods under ~60s. If you
  need longer clips or want true async with push notifications, split this
  into a queue (Upstash QStash or Inngest) and use `/api/share/status` for
  polling.
- **Spotify is not included.** There is no public API for publishing audio
  content to Spotify — see the implementation doc for details.
- **Instagram requires a Business or Creator account.** Personal accounts
  cannot use the Content Publishing API. Surface this clearly in the connect
  flow.
- **YouTube quota.** Default 10,000 units/day (~6 uploads). Request an
  increase from Google before launch.
