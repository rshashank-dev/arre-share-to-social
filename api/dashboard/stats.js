/**
 * GET /api/dashboard/stats?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns:
 *  - KPI cards: total posts, success, failed, success rate, avg/day, IG posts, YT posts
 *  - By-platform breakdown
 *  - By-format breakdown (reel, post, story, shorts)
 *  - Each KPI includes delta vs the equivalent previous period
 */

const { supabase } = require('../../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end query params required (YYYY-MM-DD)' });

  // ── Current period ──────────────────────────────────────────────────────────
  const { data: jobs, error } = await supabase
    .from('share_jobs')
    .select('status, platform, format, created_at')
    .gte('created_at', `${start}T00:00:00.000Z`)
    .lte('created_at', `${end}T23:59:59.999Z`);

  if (error) return res.status(500).json({ error: error.message });

  // ── Previous period (same duration) ─────────────────────────────────────────
  const days = Math.round((new Date(end) - new Date(start)) / 86_400_000) + 1;
  const prevEnd   = new Date(new Date(`${start}T00:00:00Z`).getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  const pStart = prevStart.toISOString().split('T')[0];
  const pEnd   = prevEnd.toISOString().split('T')[0];

  const { data: prevJobs } = await supabase
    .from('share_jobs')
    .select('status, platform, format')
    .gte('created_at', `${pStart}T00:00:00.000Z`)
    .lte('created_at', `${pEnd}T23:59:59.999Z`);

  const prev = prevJobs || [];
  const curr = jobs || [];

  // ── Aggregations ─────────────────────────────────────────────────────────────
  function agg(arr) {
    return {
      total:        arr.length,
      success:      arr.filter(j => j.status === 'success').length,
      failed:       arr.filter(j => j.status === 'failed').length,
      instagram:    arr.filter(j => j.platform === 'instagram').length,
      youtube:      arr.filter(j => j.platform === 'youtube').length,
      reel:         arr.filter(j => j.format === 'reel').length,
      post:         arr.filter(j => j.format === 'post').length,
      story:        arr.filter(j => j.format === 'story').length,
      shorts:       arr.filter(j => j.format === 'shorts').length,
    };
  }

  const c = agg(curr);
  const p = agg(prev);

  function delta(cVal, pVal) {
    if (pVal === 0) return { pct: null, up: null };
    const pct = Math.round(Math.abs(cVal - pVal) / pVal * 100);
    return { pct, up: cVal >= pVal };
  }

  const successRate = c.total > 0 ? Math.round(c.success / c.total * 100) : 0;
  const prevSuccessRate = p.total > 0 ? Math.round(p.success / p.total * 100) : 0;

  return res.status(200).json({
    period: { start, end, days, prev_start: pStart, prev_end: pEnd },
    kpi: {
      total_posts:    { value: c.total,       ...delta(c.total,       p.total) },
      success:        { value: c.success,     ...delta(c.success,     p.success) },
      failed:         { value: c.failed,      ...delta(c.failed,      p.failed) },
      success_rate:   { value: successRate,   ...delta(successRate,   prevSuccessRate) },
      avg_per_day:    { value: +(c.total / days).toFixed(1), pct: null, up: null },
      instagram_posts:{ value: c.instagram,   ...delta(c.instagram,   p.instagram) },
      youtube_posts:  { value: c.youtube,     ...delta(c.youtube,     p.youtube) },
    },
    by_platform: {
      instagram: c.instagram,
      youtube:   c.youtube,
    },
    by_format: {
      reel:   c.reel,
      post:   c.post,
      story:  c.story,
      shorts: c.shorts,
    },
  });
};
