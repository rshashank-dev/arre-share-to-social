# Setup Checklist — Meta App & Google Cloud Project

Do these in order. Nothing here needs code — it's all dashboard clicks.
Ping me at any step where what you see doesn't match what's described.

---

## PART A — Meta Developer App (Instagram)

1. Go to developers.facebook.com → log in with the account you want to own this app
2. Click **My Apps** (top right) → **Create App**
3. App type: choose **Business**
4. Name it something like `Arre Voice - Share to Social (Dev)`
5. Once created, you land on the App Dashboard. On the left sidebar, click **Add Product**
6. Find **Instagram** → click **Set Up** (this adds the Instagram Graph API product)
7. In the left sidebar under Instagram, go to **API Setup with Instagram Login**
8. You'll see a section called **Instagram business login settings** — note down:
   - **Instagram App ID** → this is your `META_APP_ID`
   - **Instagram App Secret** → click "Show" → this is your `META_APP_SECRET`
9. Find **Valid OAuth Redirect URIs** field → add:
   `https://<your-vercel-app>.vercel.app/api/share/connect/callback/instagram`
   (You won't have the real Vercel URL until after first deploy — placeholder it for now, come back and update once deployed.)
10. Scroll to **Permissions** → make sure `instagram_content_publish` and `instagram_basic` are listed. If not, search and add them.
11. Scroll to **Instagram Testers** (sometimes called "Roles → Instagram Testers" in older UI) → click **Add Instagram Testers**
12. Enter the username of the **Instagram Business or Creator account** you want to test with (this should be a real IG account you control, switched to Business/Creator mode — Settings → Account type in the IG app)
13. On that Instagram account, go to Settings → Apps and Websites → Tester Invites, and **accept** the invite that should appear
14. Done — you can now test without App Review. App Review is only needed before this goes live for all users (Part C below).

**What to send me once done:** `META_APP_ID`, `META_APP_SECRET` (paste securely, not in chat if you're cautious — Vercel env var is fine to just type directly during deploy).

---

## PART B — Google Cloud Project (YouTube)

1. Go to console.cloud.google.com
2. Top left, click the project dropdown → **New Project**
3. Name it `arre-voice-share-to-social` → Create
4. Once created, make sure it's selected as the active project (top dropdown)
5. In the left sidebar (hamburger menu) → **APIs & Services** → **Library**
6. Search for **YouTube Data API v3** → click it → **Enable**
7. Left sidebar → **APIs & Services** → **OAuth consent screen**
8. User Type: **External** (unless you have a Google Workspace org, then Internal is fine) → Create
9. Fill in:
   - App name: `Arre Voice Share to Social`
   - User support email: your email
   - Developer contact: your email
10. Scopes step → **Add or Remove Scopes** → search for `youtube.upload` → check it → Update → Save and Continue
11. Test users step → **Add Users** → add your own Google account (the one tied to the YouTube channel you'll test with) → Save and Continue
12. Left sidebar → **APIs & Services** → **Credentials**
13. **Create Credentials** → **OAuth client ID**
14. Application type: **Web application**
15. Name: `Arre Voice Share to Social - Web`
16. Under **Authorized redirect URIs** → Add URI:
    `https://<your-vercel-app>.vercel.app/api/share/connect/callback/youtube`
    (same placeholder note as above — update after first deploy)
17. Click Create → a popup shows **Client ID** and **Client Secret** → note both down

**What to send me once done:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

---

## PART C — App Review (only needed before public launch, not for testing)

Skip this for now. Once Part A/B testing works end-to-end with your own account, Meta will require **App Review** for the `instagram_content_publish` permission before any user outside your Testers list can use it. That's a separate step we'll do later — it needs a screen-recording of the feature working, which we can only make once it's actually working.

---

## PART D — New Supabase Project (separate from production)

Since this whole project is going to mobile devs as a standalone deliverable, use a **new Supabase project**, not your existing production one.

1. Go to supabase.com/dashboard → **New Project**
2. Name: `arre-voice-share-to-social`
3. Pick the same region as your existing project for consistency (not required, just convenience)
4. Once created, go to **SQL Editor** → paste the contents of `supabase/migration.sql` from the project I gave you → Run
5. Go to **Project Settings → API** → note down:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (not anon key) → `SUPABASE_SERVICE_KEY`

---

## PART E — New Cloudflare R2 Bucket (separate from production)

1. Cloudflare dashboard → **R2** → **Create Bucket**
2. Name: `arre-audiograms-dev` (or similar — keep it distinct from any production bucket name)
3. Once created, go to bucket **Settings** → **Public Access** → enable public access via the **R2.dev subdomain** (good enough for testing; you can attach a custom domain later)
4. Note the public URL shown — this is `R2_PUBLIC_URL`
5. Go to **Manage R2 API Tokens** (top right of R2 dashboard) → **Create API Token**
6. Permissions: **Object Read & Write**, scoped to the bucket you just created
7. Note down:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   - Your **Account ID** (shown in the R2 dashboard sidebar) → `R2_ACCOUNT_ID`
8. Bucket name → `R2_BUCKET_NAME`

---

## What happens after all 5 parts are done

You'll have a full `.env` ready to paste into Vercel. Send me the project for one round of "does this look right" before you deploy, or just deploy and we debug from real errors — either works.
