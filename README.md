# Arré Voice — Share to Social

Standalone Vercel project. After a pod is posted, the app calls this API to
get share options, lets the user pick a platform/format, then this API
generates an audiogram and publishes it directly to Instagram or YouTube Shorts.

> **This is a fully separate, new deliverable.** New Meta App, new Google Cloud
> project, new Supabase project, new Cloudflare R2 bucket, new Vercel project.
> See `SETUP_CHECKLIST.md` for exact setup steps. Nothing here touches any
> existing production infrastructure.

> **No authentication yet.** Every endpoint is currently open. Before going
> live to real users, add an API key check on all routes and sign the OAuth
> `state` parameter (HMAC). This is intentional for the current testing phase.

> **YouTube quota not yet increased.** Default is 10,000 units/day (~6 uploads).
> Must be increased to 50,000 units/day before production launch.
> See: Google Cloud Console → APIs & Services → YouTube Data API v3 → Quotas.

---

## Proven status (tested end to end, real posts)

| Platform | Format | Tested | Live URL |
|---|---|---|---|
| Instagram | Reel | ✅ | instagram.com/reel/DaOI21vFM2d/ |
| Instagram | Post (Feed) | ✅ | instagram.com/reel/DaQI0p4iZ0-/ |
| Instagram | Story | ✅ | instagram.com/stories/shashankmbb1911/... |
| YouTube | Shorts | ✅ | youtube.com/shorts/SzfQ81aaxa0 |

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/share/options?user_id={id}` | Returns platforms/formats to show + connection status |
| GET | `/api/share/connect/instagram?user_id={id}` | Returns OAuth URL to connect Instagram |
| GET | `/api/share/connect/youtube?user_id={id}` | Returns OAuth URL to connect YouTube |
| GET | `/api/share/connect/callback/instagram` | OAuth redirect target (registered in Meta App) |
| GET | `/api/share/connect/callback/youtube` | OAuth redirect target (registered in Google Cloud) |
| POST | `/api/share/initiate` | Full pipeline: generate audiogram → upload to R2 → publish |
| GET | `/api/share/status/:jobId` | Look up a past job result |

---

## App integration — trigger points

The app fires exactly two API calls for this feature:

| User action | API call | What to do with response |
|---|---|---|
| Taps "Add to socials" | `GET /api/share/options?user_id={id}` | For each platform: if `connected: true` show `formats` as chips; if `connected: false` show "Connect" button using `connect_url` |
| Taps "Connect Instagram/YouTube" | `GET` the `connect_url` from options response | Open returned `auth_url` in a WebView. On `arrevoice://share/connect/success` deep link, close WebView and re-fetch options |
| Taps a format chip | `POST /api/share/initiate` with `{ pod_id, audio_url, image_url, title, caption, platform, format, user_id }` | Show loading state (up to ~90s). On `status: success` show "Posted" with `post_url`. On `status: failed` show `error_message` with retry |

**Important:** `audio_url` and `image_url` must be the full-resolution, publicly
accessible CDN URLs — not Next.js image proxy URLs (`/_next/image?...`).
The app already has these in its own state from rendering the pod.

---

## Setup

Full click-by-click steps in `SETUP_CHECKLIST.md`. Summary:

1. **Supabase** — new project, run `supabase/migration.sql`
2. **Meta** — new app, Instagram API with Instagram Login, add `instagram_business_basic` + `instagram_business_content_publish` permissions, set redirect URI, add Instagram Tester account
3. **Google Cloud** — new project, enable YouTube Data API v3, OAuth consent screen with `youtube.upload` + `youtube.readonly` scopes, create Web OAuth client, set redirect URI
4. **Cloudflare R2** — new bucket with public access enabled, scoped API token
5. **Vercel** — set all env vars from `.env.example`, deploy

## Deploy

```bash
npm install
vercel --prod
```

## Environment variables

See `.env.example` for the full list. All values come from new resources
created specifically for this project — do not reuse production credentials.

## Known limitations (by design, current version)

- **Synchronous pipeline.** `/api/share/initiate` runs everything in one
  request (capped at 180s). For pods significantly longer than 60s or under
  heavy concurrency, consider splitting into an async queue (Upstash QStash
  or Inngest) and using `/api/share/status` for polling.
- **No authentication.** Add an API key or JWT check before production.
- **YouTube quota.** Default 10,000 units/day. Request increase before launch.
- **Spotify not included.** No public API for publishing audio to Spotify.
- **Meta App Review required before public launch.** Currently only works for
  Instagram Tester accounts. Submit for App Review once feature is QA-approved.
