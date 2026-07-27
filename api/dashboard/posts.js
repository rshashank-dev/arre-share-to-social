/**
 * GET /api/dashboard/posts
 *
 * Query params:
 *   start     YYYY-MM-DD
 *   end       YYYY-MM-DD
 *   platform  instagram | youtube
 *   status    success | failed | processing
 *   format    reel | post | story | shorts
 *   category  e.g. Poetry, News, Music
 *   language  Tamil | Hinglish | English
 *   page      default 1
 *   limit     default 50, max 200
 */

const { supabase } = require('../../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const {
    start, end,
    platform, status, format,
    category, language,
    page  = '1',
    limit = '50',
  } = req.query;

  const pageNum  = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset   = (pageNum - 1) * limitNum;

  let query = supabase
    .from('share_jobs')
    .select(
      'id, creator_id, category, language, pod_id, platform, format, status, step, post_url, error_message, error_code, created_at, updated_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (start)    query = query.gte('created_at', `${start}T00:00:00.000Z`);
  if (end)      query = query.lte('created_at', `${end}T23:59:59.999Z`);
  if (platform) query = query.eq('platform', platform);
  if (status)   query = query.eq('status', status);
  if (format)   query = query.eq('format', format);
  if (category) query = query.eq('category', category);
  if (language) query = query.eq('language', language);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    posts:       data || [],
    total:       count || 0,
    page:        pageNum,
    limit:       limitNum,
    total_pages: Math.ceil((count || 0) / limitNum),
  });
};
