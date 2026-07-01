const { upsertToken, getToken } = require('./tokens');

const GRAPH = 'https://graph.instagram.com';
const IG_OAUTH = 'https://www.instagram.com/oauth';
const FB_OAUTH = 'https://api.instagram.com/oauth';

function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    scope: 'instagram_business_basic,instagram_business_content_publish',
    response_type: 'code',
  });
  return `${IG_OAUTH}/authorize?${params.toString()}`;
}

async function handleOAuthCallback({ code, arreUserId }) {
  // 1. exchange code -> short-lived token
  const shortRes = await fetch(`${FB_OAUTH}/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: process.env.META_REDIRECT_URI,
      code,
    }),
  });
  const shortDataRaw = await shortRes.json();
  if (shortDataRaw.error) throw new Error(`Instagram token exchange failed: ${shortDataRaw.error.message}`);

  // Meta's newer "Instagram API with Instagram Login" wraps the result in a
  // `data` array; the older Basic Display API returned it flat. Handle both.
  const shortData = Array.isArray(shortDataRaw.data) ? shortDataRaw.data[0] : shortDataRaw;
  if (!shortData?.access_token) {
    throw new Error(`Instagram token exchange returned no access_token. Raw response: ${JSON.stringify(shortDataRaw)}`);
  }

  // 2. exchange short-lived -> long-lived (60 day) token
  const longParams = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: process.env.META_APP_SECRET,
    access_token: shortData.access_token,
  });
  const longRes = await fetch(`${GRAPH}/access_token?${longParams.toString()}`);
  const longData = await longRes.json();
  if (longData.error) throw new Error(`Instagram long-lived token exchange failed: ${longData.error.message}`);

  // 3. fetch the connected IG user's profile info
  const meRes = await fetch(`${GRAPH}/me?fields=id,username&access_token=${longData.access_token}`);
  const me = await meRes.json();

  const expiresAt = new Date(Date.now() + longData.expires_in * 1000).toISOString();

  return upsertToken({
    arreUserId,
    platform: 'instagram',
    platformUserId: me.id,
    username: me.username,
    accessToken: longData.access_token,
    refreshToken: null, // IG long-lived tokens are refreshed via /refresh_access_token, not a refresh_token
    expiresAt,
  });
}

/** Refreshes a long-lived IG token if it's within 10 days of expiry. Call before publish. */
async function ensureFreshToken(tokenRow) {
  const daysToExpiry = (new Date(tokenRow.expires_at) - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysToExpiry > 10) return tokenRow;

  const params = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: tokenRow.access_token,
  });
  const res = await fetch(`${GRAPH}/refresh_access_token?${params.toString()}`);
  const data = await res.json();
  if (data.error) throw new Error(`Instagram token refresh failed: ${data.error.message}`);

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  return upsertToken({
    arreUserId: tokenRow.arre_user_id,
    platform: 'instagram',
    platformUserId: tokenRow.platform_user_id,
    username: tokenRow.username,
    accessToken: data.access_token,
    refreshToken: null,
    expiresAt,
  });
}

const MEDIA_TYPE_MAP = { reel: 'REELS', post: 'REELS', story: 'STORIES' };

async function publish({ arreUserId, videoUrl, caption, format }) {
  let tokenRow = await getToken(arreUserId, 'instagram');
  if (!tokenRow) {
    const err = new Error('User has not connected an Instagram account');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  tokenRow = await ensureFreshToken(tokenRow);
  const mediaType = MEDIA_TYPE_MAP[format];
  if (!mediaType) throw new Error(`Unsupported Instagram format: ${format}`);

  // Build container params based on format
  // - post: REELS + share_to_feed=true (VIDEO type is deprecated in newer IG API)
  // - reel: REELS (default, goes to Reels tab only)
  // - story: STORIES (no caption supported)
  const containerParams = {
    video_url: videoUrl,
    media_type: mediaType,
    access_token: tokenRow.access_token,
  };
  if (format === 'post') {
    containerParams.share_to_feed = 'true';
  }
  if (format !== 'story') {
    containerParams.caption = caption || '';
  }

  // Step 1: create media container
  const createParams = new URLSearchParams(containerParams);
  const createRes = await fetch(`${GRAPH}/me/media?${createParams.toString()}`, { method: 'POST' });
  const createData = await createRes.json();
  if (createData.error) {
    const err = new Error(`Instagram container creation failed: ${createData.error.message}`);
    err.code = 'CONTAINER_FAILED';
    throw err;
  }
  const creationId = createData.id;

  // Step 2: poll processing status (max 60s)
  let status = 'IN_PROGRESS';
  for (let attempt = 0; attempt < 12 && status === 'IN_PROGRESS'; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${tokenRow.access_token}`);
    const statusData = await statusRes.json();
    status = statusData.status_code;
  }
  if (status !== 'FINISHED') {
    const err = new Error(`Instagram media processing did not finish in time (status: ${status})`);
    err.code = 'PROCESSING_TIMEOUT';
    throw err;
  }

  // Step 3: publish
  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: tokenRow.access_token,
  });
  const publishRes = await fetch(`${GRAPH}/me/media_publish?${publishParams.toString()}`, { method: 'POST' });
  const publishData = await publishRes.json();
  if (publishData.error) {
    const err = new Error(`Instagram publish failed: ${publishData.error.message}`);
    err.code = 'PUBLISH_FAILED';
    throw err;
  }

  // Fetch the real permalink (the published media id is not the same as the URL shortcode)
  let postUrl = null;
  try {
    const permalinkRes = await fetch(`${GRAPH}/${publishData.id}?fields=permalink&access_token=${tokenRow.access_token}`);
    const permalinkData = await permalinkRes.json();
    postUrl = permalinkData.permalink || null;
  } catch (_) {
    // Stories don't return a permalink — that's expected, not an error
  }

  return {
    postId: publishData.id,
    postUrl,
  };
}

module.exports = { getAuthUrl, handleOAuthCallback, publish };
