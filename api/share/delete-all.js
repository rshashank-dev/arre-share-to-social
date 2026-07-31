/**
 * POST /api/share/delete-all
 *
 * Deletes ALL posts from Instagram and YouTube (using stored platform_post_id),
 * then clears all records from share_jobs and engagement_cache.
 *
 * Returns a summary of what was deleted and what failed.
 * Auth: x-api-key header required.
 */

const { supabase }  = require('../../lib/supabase');
const { getToken }  = require('../../lib/tokens');
const { google }    = require('googleapis');

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

// Extract YouTube video ID from URL
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

  // ── Fetch all successful jobs that have a post to delete ─────────────────
  const { data: jobs, error: jobsErr } = await supabase
    .from('share_jobs')
    .select('id, category, platform, post_url, platform_post_id')
    .eq('status', 'success')
    .not('post_url', 'is', null);

  if (jobsErr) return res.status(500).json({ error: jobsErr.message });

  const results = { instagram_deleted: 0, instagram_failed: 0, youtube_deleted: 0, youtube_failed: 0, db_cleared: false };

  // ── Get unique categories ────────────────────────────────────────────────
  const categories = [...new Set((jobs || []).map(j => j.category).filter(Boolean))];

  // ── Fetch tokens for all categories ─────────────────────────────────────
  const tokenMap = {};
  for (const cat of categories) {
    const [igT, ytT] = await Promise.all([
      getToken(cat, 'instagram'),
      getToken(cat, 'youtube'),
    ]);
    if (igT) tokenMap[`${cat}:instagram`] = igT;
    if (ytT) tokenMap[`${cat}:youtube`]   = ytT;
  }

  // ── Delete each post from its platform ───────────────────────────────────
  for (const job of (jobs || [])) {
    const tokenKey = `${job.category}:${job.platform}`;
    const token    = tokenMap[tokenKey];
    if (!token) continue;

    try {
      if (job.platform === 'instagram') {
        // Use stored platform_post_id if available, otherwise skip (can't delete without media ID)
        const mediaId = job.platform_post_id;
        if (!mediaId) { results.instagram_failed++; continue; }
        const delRes = await fetch(`${GRAPH}/${mediaId}?access_token=${token.access_token}`, { method: 'DELETE' });
        const delData = await delRes.json();
        if (delData.success || delRes.ok) {
          results.instagram_deleted++;
        } else {
          console.warn(`IG delete failed [${mediaId}]:`, delData);
          results.instagram_failed++;
        }

      } else if (job.platform === 'youtube') {
        const videoId = job.platform_post_id || ytVideoId(job.post_url);
        if (!videoId) { results.youtube_failed++; continue; }
        const ytClient = getYTClient(token);
        const yt = google.youtube({ version: 'v3', auth: ytClient });
        try {
          await yt.videos.delete({ id: videoId });
          results.youtube_deleted++;
        } catch (e) {
          // 404 = already deleted — still count as success
          if (e.code === 404) { results.youtube_deleted++; }
          else { console.warn(`YT delete failed [${videoId}]:`, e.message); results.youtube_failed++; }
        }
      }
    } catch (e) {
      console.error(`Delete failed [${job.platform}/${job.id}]:`, e.message);
      if (job.platform === 'instagram') results.instagram_failed++;
      else results.youtube_failed++;
    }
  }

  // ── Clear DB ─────────────────────────────────────────────────────────────
  const { error: clearErr } = await supabase.rpc('truncate_share_jobs');
  if (!clearErr) {
    results.db_cleared = true;
  } else {
    // Fallback: delete all rows manually if rpc not available
    await supabase.from('engagement_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('share_jobs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    results.db_cleared = true;
  }

  return res.status(200).json(results);
};
