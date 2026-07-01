# Arré Voice — Share to Social

Standalone Vercel project. After a pod is posted, the app calls this API to get share options, lets the user pick a platform and format, then the API generates an audiogram and publishes it directly to Instagram or YouTube Shorts.

> **Separate deliverable.** New Meta App, Google Cloud project, Supabase project, R2 bucket, Vercel project. Nothing here touches existing production infrastructure. See `SETUP_CHECKLIST.md` for exact setup steps.

> **No auth yet.** All endpoints are currently open. Add an API key check on all routes and sign the OAuth `state` parameter (HMAC) before going live to real users.

> **YouTube quota not yet increased.** Default 10,000 units/day (~6 uploads). Increase to 50,000 units/day before production. Google Cloud Console → APIs & Services → YouTube Data API v3 → Quotas.

> **Meta App Review not yet submitted.** Currently only works for Instagram Tester accounts. Submit for App Review once QA-approved for the feature.

---

## Proven status

All four formats tested end to end. Real posts, real live URLs.

| Platform | Format | Status | Live URL |
|---|---|---|---|
| Instagram | Reel | ✅ Proven | [instagram.com/reel/DaOI21vFM2d/](https://www.instagram.com/reel/DaOI21vFM2d/) |
| Instagram | Post (Feed) | ✅ Proven | [instagram.com/reel/DaQI0p4iZ0-/](https://www.instagram.com/reel/DaQI0p4iZ0-/) |
| Instagram | Story | ✅ Proven | [instagram.com/stories/shashankmbb1911/...](https://www.instagram.com/stories/shashankmbb1911/3931682291651547252) |
| YouTube | Shorts | ✅ Proven | [youtube.com/shorts/SzfQ81aaxa0](https://youtube.com/shorts/SzfQ81aaxa0) |

---

## UI — Add to Socials flow

The "Add to socials" row lives in the existing share sheet between "Share to" and "As a clip". Tapping it slides up a second bottom sheet with platform options.

<img src="https://github.com/rshashank-dev/arre-share-to-social/blob/main/design.png?raw=true" width="320" alt="Add to Socials UI flow" />

**Flow summary:**
1. Pod is posted → share sheet opens with existing rows + new **Add to socials** row
2. User taps **Add to socials** → app calls `GET /api/share/options` → second sheet renders
3. Connected platforms show format chips (Reel / Post / Story / Shorts)
4. Unconnected platforms show a **Connect** button → opens OAuth WebView
5. User picks a format → app calls `POST /api/share/initiate` → loading state shown
6. API generates audiogram, uploads to R2, publishes to platform → returns `post_url`
7. App shows **Posted — View on [Platform]** with a link

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/share/options?user_id={id}` | Returns platforms/formats to render + connection status |
| GET | `/api/share/connect/instagram?user_id={id}` | Returns Instagram OAuth URL |
| GET | `/api/share/connect/youtube?user_id={id}` | Returns YouTube OAuth URL |
| GET | `/api/share/connect/callback/instagram` | OAuth redirect target — registered in Meta App |
| GET | `/api/share/connect/callback/youtube` | OAuth redirect target — registered in Google Cloud |
| POST | `/api/share/initiate` | Full pipeline: audiogram → R2 upload → publish |
| GET | `/api/share/status/:jobId` | Look up a past job result |

---

## App integration — exact trigger points

The app makes exactly **two API calls** for this entire feature.

| User action | API call | What to do with response |
|---|---|---|
| Taps **Add to socials** | `GET /api/share/options?user_id={id}` | For each platform: `connected: true` → show `formats` as tappable chips. `connected: false` → show Connect button, open `connect_url`'s returned `auth_url` in a WebView |
| WebView OAuth completes | — | Listen for `arrevoice://share/connect/success` deep link → close WebView → re-call `GET /api/share/options` to refresh |
| Taps a format chip | `POST /api/share/initiate` | Show loading state (up to ~90s). `status: success` → show Posted + `post_url`. `status: failed` → show `error_message` + retry button |

### `POST /api/share/initiate` — request body

```json
{
  "pod_id":    "string — Arré Voice internal pod ID",
  "audio_url": "string — direct CDN URL to pod audio file",
  "image_url": "string — direct CDN URL to pod cover image (square)",
  "title":     "string — pod title",
  "caption":   "string — caption for the post (user-editable)",
  "platform":  "instagram | youtube",
  "format":    "reel | post | story | shorts",
  "user_id":   "string — Arré Voice user ID"
}
```

### `POST /api/share/initiate` — response

**Success:**
```json
{
  "job_id":   "uuid",
  "status":   "success",
  "platform": "instagram",
  "format":   "reel",
  "post_url": "https://www.instagram.com/reel/..."
}
```

**Failure:**
```json
{
  "job_id":        "uuid",
  "status":        "failed",
  "error_code":    "string",
  "error_message": "Human-readable string — safe to show to user"
}
```

> **Critical:** `audio_url` and `image_url` must be full-resolution, publicly
> accessible CDN URLs — e.g. `https://dev-media.arredigital.co/PodAudio/...`
> and `https://dev-media.arredigital.co/PodPicture/...`. Do NOT pass Next.js
> image proxy URLs (`/_next/image?url=...&w=96`). The app already has the
> correct URLs in its own state from rendering the pod.

---

## Testing — end to end

Follow these steps in order after deployment to verify the full pipeline works.

### Prerequisites
- Vercel project deployed with all env vars set (see `.env.example`)
- Supabase migration run (`supabase/migration.sql`)
- Instagram Tester account added and invite accepted on the IG side
- Google test user added to OAuth consent screen

### Step 1 — Confirm the deploy is healthy
```bash
curl "https://arre-share-to-social.vercel.app/api/share/options?user_id=test"
```
Expected: `{"instagram":{"connected":false,...},"youtube":{"connected":false,...}}`

### Step 2 — Connect Instagram
```bash
curl "https://arre-share-to-social.vercel.app/api/share/connect/instagram?user_id=test"
```
Open the returned `auth_url` in a browser. Log in with your Instagram Tester account. After approving, the browser will show "can't open this page" (the `arrevoice://` deep link) — this is expected and means OAuth completed successfully.

Verify: Supabase → Table Editor → `social_tokens` → should have a row with `platform: instagram`.

Re-run Step 1 — Instagram should now show `"connected": true`.

### Step 3 — Test Instagram Reel publish
Get a fresh `audio_url` and `image_url` from the dev-app network tab (play a pod → copy the `PodAudio/....mp3` and `PodPicture/....jpeg` requests). Then:

```bash
curl -X POST "https://arre-share-to-social.vercel.app/api/share/initiate" \
  -H "Content-Type: application/json" \
  -d '{
    "pod_id": "test_reel",
    "audio_url": "<PodAudio CDN URL>",
    "image_url": "<PodPicture CDN URL>",
    "title": "Test pod",
    "caption": "Test caption",
    "platform": "instagram",
    "format": "reel",
    "user_id": "test"
  }' --max-time 200
```
Expected: `{"status":"success","post_url":"https://www.instagram.com/reel/..."}`. Check the URL on Instagram to confirm the Reel is live.

### Step 4 — Test Instagram Post and Story
Same curl as Step 3, change `"format"` to `"post"` then `"story"`. Use fresh URLs each time (signed CDN URLs are single-use).

> Story response will have `"post_url": "https://www.instagram.com/stories/..."` or `null` — both are fine. What matters is `"status": "success"`.

### Step 5 — Connect YouTube
```bash
curl "https://arre-share-to-social.vercel.app/api/share/connect/youtube?user_id=test"
```
Open the returned `auth_url`. Log in with your Google test user account. After approving, same "can't open this page" expected.

Verify: Supabase → `social_tokens` → new row with `platform: youtube`.

### Step 6 — Test YouTube Shorts publish
```bash
curl -X POST "https://arre-share-to-social.vercel.app/api/share/initiate" \
  -H "Content-Type: application/json" \
  -d '{
    "pod_id": "test_shorts",
    "audio_url": "<PodAudio CDN URL>",
    "image_url": "<PodPicture CDN URL>",
    "title": "Test pod - Arre Voice",
    "caption": "Test caption",
    "platform": "youtube",
    "format": "shorts",
    "user_id": "test"
  }' --max-time 200
```
Expected: `{"status":"success","post_url":"https://youtube.com/shorts/..."}`. YouTube takes 2-3 minutes to process before the Short is playable — check the URL after waiting.

### Common errors during testing

| Error | Cause | Fix |
|---|---|---|
| `FUNCTION_INVOCATION_FAILED` | Missing FFmpeg binary or env var | Check Vercel logs for exact message; ensure `vercel.json` `includeFiles` is present |
| `Failed to download audio_url: 403` | Signed CDN URL already consumed or expired | Grab a fresh URL from the dev-app network tab |
| `CONTAINER_FAILED` | Instagram rejected the video | Check Vercel logs for Meta's exact message; usually image too small or format mismatch |
| `NOT_CONNECTED` | No token in `social_tokens` for this user | Re-run the connect flow for that platform |
| `QUOTA_EXCEEDED` | YouTube daily upload limit hit | Wait 24h or request quota increase |

---

## Setup

Full click-by-click steps in `SETUP_CHECKLIST.md`. Summary:

1. **Supabase** — new project, run `supabase/migration.sql`, disable RLS on both tables
2. **Meta** — new app, Instagram API with Instagram Login, add `instagram_business_basic` + `instagram_business_content_publish` permissions, set redirect URI, add Instagram Tester account and accept invite on IG side
3. **Google Cloud** — new project, enable YouTube Data API v3, OAuth consent screen with `youtube.upload` + `youtube.readonly` scopes, create Web OAuth client, set redirect URI, add test user
4. **Cloudflare R2** — new bucket, enable public R2.dev subdomain access, create scoped API token (Object Read & Write)
5. **Vercel** — set all env vars from `.env.example`, deploy

---

## Deploy

```bash
npm install
vercel --prod
```

No build step — the `api/` folder maps directly to routes.

---

## Environment variables

See `.env.example` for the full list. All values must come from new resources created for this project — do not reuse production credentials.

---

## Known limitations

- **Synchronous pipeline.** `/api/share/initiate` runs everything in one request (180s cap). For very long pods or high concurrency, split into a background queue (Upstash QStash or Inngest) and use `/api/share/status` for polling.
- **No authentication.** Add API key or JWT check on all routes before production.
- **YouTube quota.** 10,000 units/day default (~6 uploads). Request increase before launch.
- **Meta App Review required.** Only Instagram Tester accounts work until App Review is approved.
- **Spotify not included.** No public API exists for publishing audio content to Spotify.
