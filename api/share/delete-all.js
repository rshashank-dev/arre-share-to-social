const { supabase } = require('../../lib/supabase');
const { getToken } = require('../../lib/tokens');
const { google }   = require('googleapis');

const GRAPH = 'https://graph.instagram.com';

function getYTClient(tokenRow) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({
    access_token:  tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date:   tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : undefined,
  });
  return client;
}

function ytVideoId(url) {
  if (!url) return null;
  const m = url.match(/shorts\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

module.exports = async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { data: jobs } = await supabase
    .from('share_jobs')
    .select('id, category, platform, post_url, platform_post_id')
    .eq('status', 'success')
    .not('post_url', 'is', null);

  const results = {
    instagram_deleted: 0, instagram_failed: 0, instagram_no_id: 0,
    youtube_deleted:   0, youtube_failed:   0, youtube_no_id:   0,
    errors: [], db_cleared: false
  };

  const categories = [...new Set((jobs || []).map(j => j.category).filter(Boolean))];
  const tokenMap = {};
  for (const cat of categories) {
    const [igT, ytT] = await Promise.all([
      getToken(cat, 'instagram'),
      getToken(cat, 'youtube'),
    ]);
    if (igT) tokenMap[`${cat}:instagram`] = igT;
    if (ytT) tokenMap[`${cat}:youtube`]   = ytT;
  }

  for (const job of (jobs || [])) {
    const token = tokenMap[`${job.category}:${job.platform}`];

    if (job.platform === 'youtube') {
      const videoId = job.platform_post_id || ytVideoId(job.post_url);
      if (!videoId) { results.youtube_no_id++; continue; }
      if (!token)   { results.youtube_failed++; results.errors.push(`No token for ${job.category} youtube`); continue; }

      try {
        const client = getYTClient(token);

        // Proactively refresh if expired
        const expiry = token.expires_at ? new Date(token.expires_at).getTime() : 0;
        if (expiry < Date.now() + 60000 && token.refresh_token) {
          try { await client.refreshAccessToken(); } catch (_) {}
        }

        const yt = google.youtube({ version: 'v3', auth: client });
        await yt.videos.delete({ id: videoId });
        results.youtube_deleted++;
      } catch (e) {
        if (e.code === 404 || e.status === 404) {
          results.youtube_deleted++; // already gone
        } else {
          results.youtube_failed++;
          results.errors.push(`YT [${job.category}/${videoId}]: ${e.message}`);
          console.error(`YT delete failed:`, e.message, e.code);
        }
      }

    } else if (job.platform === 'instagram') {
      const mediaId = job.platform_post_id;
      if (!mediaId) { results.instagram_no_id++; continue; }
      if (!token)   { results.instagram_failed++; continue; }

      try {
        const delRes  = await fetch(`${GRAPH}/${mediaId}?access_token=${token.access_token}`, { method: 'DELETE' });
        const delData = await delRes.json();
        if (delData.success || delRes.ok) {
          results.instagram_deleted++;
        } else {
          results.instagram_failed++;
          results.errors.push(`IG [${job.category}/${mediaId}]: ${JSON.stringify(delData)}`);
        }
      } catch (e) {
        results.instagram_failed++;
        results.errors.push(`IG [${job.category}/${mediaId}]: ${e.message}`);
      }
    }
  }

  // Clear DB
  try {
    await supabase.from('engagement_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('share_jobs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    results.db_cleared = true;
  } catch (e) {
    results.errors.push(`DB clear: ${e.message}`);
  }

  console.log('Delete All results:', JSON.stringify(results));
  return res.status(200).json(results);
};
