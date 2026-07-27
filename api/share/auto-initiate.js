/**
 * POST /api/share/auto-initiate
 *
 * 1. Validates request + API key
 * 2. Looks up category tokens
 * 3. Creates all job records in DB immediately
 * 4. Returns { status: accepted } immediately
 * 5. Fires one independent /api/share/process-job call per job (parallel)
 *    Each runs in its own Vercel function invocation — no memory conflicts,
 *    no sequential bottleneck. Total time = 1 job (~90s) not 6 (~9min).
 */

const { supabase }  = require('../../lib/supabase');
const { getToken }  = require('../../lib/tokens');

const REQUIRED_POST_FIELDS = ['creator_id', 'language', 'pod_id', 'audio_url', 'image_url', 'title'];
const VALID_LANGUAGES      = ['Tamil', 'Hinglish', 'English'];

function validateRequest(body) {
  if (!body?.category)            return 'category is required';
  if (!Array.isArray(body.posts)) return 'posts must be an array';
  if (body.posts.length !== 3)    return 'posts must be an array of exactly 3';
  for (const [i, post] of body.posts.entries()) {
    const missing = REQUIRED_POST_FIELDS.filter(k => !post[k]);
    if (missing.length) return `posts[${i}] missing: ${missing.join(', ')}`;
    if (!VALID_LANGUAGES.includes(post.language))
      return `posts[${i}].language must be Tamil | Hinglish | English`;
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const validationError = validateRequest(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { category, posts } = req.body;

  const [igToken, ytToken] = await Promise.all([
    getToken(category, 'instagram'),
    getToken(category, 'youtube'),
  ]);

  if (!igToken && !ytToken) {
    return res.status(404).json({ error: `No social accounts connected for category: ${category}` });
  }

  const platforms = [
    ...(igToken ? ['instagram'] : []),
    ...(ytToken ? ['youtube']   : []),
  ];

  // ── Create ALL job records immediately ────────────────────────────────────
  const jobs = [];
  for (const post of posts) {
    for (const platform of platforms) {
      const { data, error } = await supabase
        .from('share_jobs')
        .insert({
          creator_id: post.creator_id,
          pod_id:     post.pod_id,
          platform,
          format:     platform === 'instagram' ? 'reel' : 'shorts',
          status:     'processing',
          step:       'queued',
          audio_url:  post.audio_url,
          image_url:  post.image_url,
          category,
          language:   post.language,
        })
        .select()
        .single();

      if (error) {
        console.error(`Failed to create job [${platform}/${post.language}]:`, error.message);
        continue;
      }
      jobs.push({ jobId: data.id, post, platform, category });
    }
  }

  // ── Return immediately ────────────────────────────────────────────────────
  res.status(200).json({ status: 'accepted', category, jobs: jobs.length, platforms });

  // ── Fire one process-job call per job — all in parallel ──────────────────
  // Each runs in its own Vercel function invocation with its own memory/timeout.
  const baseUrl = `https://${req.headers.host}`;
  await Promise.allSettled(
    jobs.map(({ jobId, post, platform, category }) =>
      fetch(`${baseUrl}/api/share/process-job`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    process.env.API_SECRET_KEY,
        },
        body: JSON.stringify({ jobId, category, post, platform }),
      }).catch(err => console.error(`Failed to dispatch job ${jobId}:`, err.message))
    )
  );
};
