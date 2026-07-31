/**
 * Run this once as a Vercel function or local script to backfill
 * platform_post_id for existing share_jobs rows.
 *
 * YouTube: extract video ID from post_url
 * Instagram: call Graph API to match permalink → media ID
 *
 * Run via: GET /api/share/backfill-post-ids (one-time use, then delete)
 */

const { supabase } = require('../../lib/supabase');
const { getToken } = require('../../lib/tokens');

const GRAPH = 'https://graph.instagram.com';

module.exports = async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Get all successful jobs without platform_post_id
  const { data: jobs } = await supabase
    .from('share_jobs')
    .select('id, category, platform, post_url')
    .eq('status', 'success')
    .not('post_url', 'is', null)
    .is('platform_post_id', null);

  if (!jobs?.length) return res.status(200).json({ message: 'Nothing to backfill', count: 0 });

  const results = { youtube: 0, instagram: 0, failed: 0 };

  // ── YouTube — extract from URL ────────────────────────────────────────────
  const ytJobs = jobs.filter(j => j.platform === 'youtube');
  for (const job of ytJobs) {
    const m = job.post_url.match(/shorts\/([A-Za-z0-9_-]+)/);
    if (!m) { results.failed++; continue; }
    await supabase.from('share_jobs').update({ platform_post_id: m[1] }).eq('id', job.id);
    results.youtube++;
  }

  // ── Instagram — look up media ID by permalink per category ────────────────
  const igJobs = jobs.filter(j => j.platform === 'instagram');
  const igCats = [...new Set(igJobs.map(j => j.category).filter(Boolean))];

  for (const cat of igCats) {
    const token = await getToken(cat, 'instagram');
    if (!token) continue;

    // Fetch all media for this account (up to 100)
    let allMedia = [];
    let url = `${GRAPH}/me/media?fields=id,permalink&limit=100&access_token=${token.access_token}`;
    while (url) {
      const r = await fetch(url);
      const d = await r.json();
      if (d.data) allMedia = allMedia.concat(d.data);
      url = d.paging?.next || null;
    }

    // Match each job's post_url to a media item
    const catJobs = igJobs.filter(j => j.category === cat);
    for (const job of catJobs) {
      const media = allMedia.find(m => m.permalink && job.post_url && (
        m.permalink.replace(/\/$/, '') === job.post_url.replace(/\/$/, '')
      ));
      if (!media) { results.failed++; continue; }
      await supabase.from('share_jobs').update({ platform_post_id: media.id }).eq('id', job.id);
      results.instagram++;
    }
  }

  return res.status(200).json({ ...results, total_backfilled: results.youtube + results.instagram });
};
