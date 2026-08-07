/**
 * POST /api/engagement/sync
 *
 * Fetches real-time engagement data from Instagram and YouTube APIs
 * for all successful posts in the requested date range.
 * Writes results to engagement_cache, then returns the data.
 *
 * Called by the dashboard Engagement tab on every load.
 */

const { supabase }  = require('../../lib/supabase');
const { getToken }  = require('../../lib/tokens');
const { google }    = require('googleapis');

const GRAPH = 'https://graph.instagram.com';

const IG_METRICS = ['plays','reach','likes','comments','shares','saved','total_interactions'];
const YT_METRICS = ['viewCount','likeCount','commentCount'];

function ytVideoId(url) {
  if (!url) return null;
  const m = url.match(/shorts\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { start, end } = req.body || {};

  // Fetch successful jobs in date range
  let jobQuery = supabase
    .from('share_jobs')
    .select('id, category, platform, post_url, platform_post_id, creator_id, created_at')
    .eq('status', 'success')
    .not('post_url', 'is', null);

  if (start) jobQuery = jobQuery.gte('created_at', `${start}T00:00:00.000Z`);
  if (end)   jobQuery = jobQuery.lte('created_at', `${end}T23:59:59.999Z`);

  const { data: jobs } = await jobQuery;
  if (!jobs?.length) return res.status(200).json({ synced: 0, metrics: [] });

  // Get tokens per category
  const cats = [...new Set(jobs.map(j => j.category).filter(Boolean))];
  const tokenMap = {};
  for (const cat of cats) {
    const [igT, ytT] = await Promise.all([getToken(cat, 'instagram'), getToken(cat, 'youtube')]);
    if (igT) tokenMap[`${cat}:instagram`] = igT;
    if (ytT) tokenMap[`${cat}:youtube`]   = ytT;
  }

  const upserts = [];
  let synced = 0;

  for (const job of jobs) {
    const token = tokenMap[`${job.category}:${job.platform}`];
    if (!token) continue;

    try {
      if (job.platform === 'instagram' && job.platform_post_id) {
        // Fetch Instagram insights
        const url = `${GRAPH}/${job.platform_post_id}/insights?metric=${IG_METRICS.join(',')}&access_token=${token.access_token}`;
        const r   = await fetch(url);
        const d   = await r.json();
        if (d.data) {
          for (const item of d.data) {
            upserts.push({ job_id: job.id, platform: 'instagram', metric: item.name, value: item.values?.[0]?.value || item.value || 0, pulled_at: new Date().toISOString() });
          }
          synced++;
        }

      } else if (job.platform === 'youtube') {
        const videoId = job.platform_post_id || ytVideoId(job.post_url);
        if (!videoId) continue;

        const ytClient = getYTClient(token);
        const yt = google.youtube({ version: 'v3', auth: ytClient });
        const resp = await yt.videos.list({ part: ['statistics'], id: [videoId] });
        const stats = resp.data.items?.[0]?.statistics;
        if (stats) {
          const metricMap = { viewCount: 'views', likeCount: 'likes', commentCount: 'comments' };
          for (const [key, label] of Object.entries(metricMap)) {
            if (stats[key] !== undefined) {
              upserts.push({ job_id: job.id, platform: 'youtube', metric: label, value: parseInt(stats[key]) || 0, pulled_at: new Date().toISOString() });
            }
          }
          synced++;
        }
      }
    } catch (e) {
      console.warn(`Engagement sync failed [${job.category}/${job.platform}]:`, e.message);
    }
  }

  // Write to engagement_cache (delete old entries for these jobs, then insert fresh)
  if (upserts.length) {
    const jobIds = [...new Set(upserts.map(u => u.job_id))];
    await supabase.from('engagement_cache').delete().in('job_id', jobIds);
    await supabase.from('engagement_cache').insert(upserts);
  }

  return res.status(200).json({ synced, metrics: upserts.length });
};
