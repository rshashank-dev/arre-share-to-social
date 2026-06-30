const { google } = require('googleapis');
const fs = require('fs');
const { upsertToken, getToken } = require('./tokens');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces refresh_token to be returned every time
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
  });
}

async function handleOAuthCallback({ code, arreUserId }) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const youtube = google.youtube({ version: 'v3', auth: client });
  const channelRes = await youtube.channels.list({ part: ['snippet'], mine: true });
  const channel = channelRes.data.items?.[0];

  return upsertToken({
    arreUserId,
    platform: 'youtube',
    platformUserId: channel?.id || 'unknown',
    username: channel?.snippet?.title || null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(tokens.expiry_date).toISOString(),
  });
}

async function getAuthedClient(arreUserId) {
  const tokenRow = await getToken(arreUserId, 'youtube');
  if (!tokenRow) {
    const err = new Error('User has not connected a YouTube account');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const client = getOAuthClient();
  client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
  });

  // googleapis auto-refreshes the access token using the refresh_token when expired.
  // Persist the refreshed token back to Supabase.
  client.on('tokens', async (newTokens) => {
    await upsertToken({
      arreUserId,
      platform: 'youtube',
      platformUserId: tokenRow.platform_user_id,
      username: tokenRow.username,
      accessToken: newTokens.access_token || tokenRow.access_token,
      refreshToken: newTokens.refresh_token || tokenRow.refresh_token,
      expiresAt: newTokens.expiry_date ? new Date(newTokens.expiry_date).toISOString() : tokenRow.expires_at,
    });
  });

  return client;
}

/**
 * Uploads a local video file as a YouTube Short.
 * YouTube auto-classifies videos <=60s and vertical (9:16) as Shorts — no special flag needed.
 * @param {object} opts
 * @param {string} opts.arreUserId
 * @param {string} opts.localPath - local file path on disk (downloaded from R2 or kept from generation step)
 * @param {string} opts.title
 * @param {string} opts.description
 * @returns {Promise<{ postUrl: string, postId: string }>}
 */
async function publish({ arreUserId, localPath, title, description }) {
  const client = await getAuthedClient(arreUserId);
  const youtube = google.youtube({ version: 'v3', auth: client });

  try {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title?.slice(0, 100) || 'Arre Voice Pod',
          description: description || '',
          tags: ['podcast', 'audio', 'arrevoice', 'shorts'],
          categoryId: '22', // People & Blogs
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(localPath),
      },
    });

    return {
      postId: res.data.id,
      postUrl: `https://youtube.com/shorts/${res.data.id}`,
    };
  } catch (e) {
    if (e.code === 403 && /quota/i.test(e.message)) {
      const err = new Error('YouTube daily upload quota exceeded');
      err.code = 'QUOTA_EXCEEDED';
      throw err;
    }
    const err = new Error(`YouTube upload failed: ${e.message}`);
    err.code = 'UPLOAD_FAILED';
    throw err;
  }
}

module.exports = { getAuthUrl, handleOAuthCallback, publish };
