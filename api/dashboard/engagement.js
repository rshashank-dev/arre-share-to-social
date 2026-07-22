/**
 * GET /api/dashboard/engagement
 *
 * Query params:
 *   start     YYYY-MM-DD
 *   end       YYYY-MM-DD
 *   platform  instagram | youtube
 *   user_id   filter by specific creator
 *
 * Returns aggregated totals per metric, plus a per-post rows array.
 * If engagement_cache has no data yet, returns empty arrays with a
 * `no_data` flag so the dashboard can show a friendly empty state.
 */

const { supabase } = require('../../lib/supabase');

// Canonical metric order for display
const IG_METRICS = ['reach', 'impressions', 'likes', 'comments', 'shares', 'saved', 'profile_visits'];
const YT_METRICS = ['views', 'likes', 'comments', 'watch_time_minutes', 'subscribers_gained'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { start, end, platform, user_id } = req.query;

  // First, get share_jobs in the date range to know which job IDs to filter
  let jobQuery = supabase
    .from('share_jobs')
    .select('id, platform, format, arre_user_id, post_url, created_at')
    .eq('status', 'success');

  if (start)   jobQuery = jobQuery.gte('created_at', `${start}T00:00:00.000Z`);
  if (end)     jobQuery = jobQuery.lte('created_at', `${end}T23:59:59.999Z`);
  if (platform) jobQuery = jobQuery.eq('platform', platform);
  if (user_id) jobQuery = jobQuery.eq('arre_user_id', user_id);

  const { data: jobs, error: jobError } = await jobQuery;
  if (jobError) return res.status(500).json({ error: jobError.message });

  if (!jobs || jobs.length === 0) {
    return res.status(200).json({ no_data: true, summary: [], by_post: [], last_synced: null });
  }

  const jobIds = jobs.map(j => j.id);

  // Get engagement cache for those jobs
  const { data: cache, error: cacheError } = await supabase
    .from('engagement_cache')
    .select('job_id, platform, metric, value, pulled_at')
    .in('job_id', jobIds)
    .order('pulled_at', { ascending: false });

  if (cacheError) return res.status(500).json({ error: cacheError.message });

  if (!cache || cache.length === 0) {
    return res.status(200).json({ no_data: true, summary: [], by_post: [], last_synced: null });
  }

  // ── Aggregate totals per metric ──────────────────────────────────────────────
  const totals = {};
  let lastSynced = null;

  cache.forEach(row => {
    const key = `${row.platform}:${row.metric}`;
    if (!totals[key]) totals[key] = { platform: row.platform, metric: row.metric, total: 0, post_count: 0 };
    totals[key].total += row.value || 0;
    totals[key].post_count++;
    if (!lastSynced || new Date(row.pulled_at) > new Date(lastSynced)) lastSynced = row.pulled_at;
  });

  // ── Build per-post pivot ─────────────────────────────────────────────────────
  const jobMap = {};
  jobs.forEach(j => { jobMap[j.id] = { ...j, metrics: {} }; });

  cache.forEach(row => {
    if (jobMap[row.job_id]) {
      // keep latest pull for each metric
      if (!jobMap[row.job_id].metrics[row.metric]) {
        jobMap[row.job_id].metrics[row.metric] = row.value;
      }
    }
  });

  // Sort summary by canonical metric order
  const allMetrics = [...IG_METRICS, ...YT_METRICS];
  const summary = Object.values(totals).sort((a, b) => {
    return allMetrics.indexOf(a.metric) - allMetrics.indexOf(b.metric);
  });

  return res.status(200).json({
    no_data:     false,
    summary,
    by_post:     Object.values(jobMap),
    last_synced: lastSynced,
  });
};
