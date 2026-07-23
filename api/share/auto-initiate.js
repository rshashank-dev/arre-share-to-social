/**
 * POST /api/share/auto-initiate
 *
 * Called by the Arré Voice backend cron — once per category per run.
 * Receives 1 category + 3 posts (Tamil, Hinglish, English).
 * Fans out into 6 parallel jobs: 3 posts × 2 platforms (IG + YT).
 *
 * Auth: x-api-key header must match API_SECRET_KEY env var.
 *
 * The response is sent immediately (status: accepted).
 * The 6 jobs run in parallel after the response — Vercel keeps the
 * function alive until the async handler resolves (maxDuration: 300).
 */

const { generateAudiogram } = require('../../lib/audiogram');
const { uploadToR2 }         = require('../../lib/r2');
const { createJob, updateJob } = require('../../lib/jobs');
const instagram              = require('../../lib/instagram');
const youtube                = require('../../lib/youtube');
const { getToken }           = require('../../lib/tokens');
const fs                     = require('fs');

// ── Validation ────────────────────────────────────────────────────────────────
const REQUIRED_POST_FIELDS = ['creator_id', 'language', 'pod_id', 'audio_url', 'image_url', 'title'];
const VALID_LANGUAGES      = ['Tamil', 'Hinglish', 'English'];

function validateRequest(body) {
  if (!body?.category)                              return 'category is required';
  if (!Array.isArray(body.posts))                   return 'posts must be an array';
  if (body.posts.length !== 3)                      return 'posts must be an array of exactly 3';
  for (const [i, post] of body.posts.entries()) {
    const missing = REQUIRED_POST_FIELDS.filter(k => !post[k]);
    if (missing.length) return `posts[${i}] missing: ${missing.join(', ')}`;
    if (!VALID_LANGUAGES.includes(post.language))
      return `posts[${i}].language must be Tamil | Hinglish | English`;
  }
  return null;
}

// ── Single job runner ─────────────────────────────────────────────────────────
async function runJob({ category, post, platform }) {
  let job;
  let audiogramPath = null;

  try {
    job = await createJob({
      arreUserId: category,          // arre_user_id stores category name for AI accounts
      podId:      post.pod_id,
      platform,
      format:     platform === 'instagram' ? 'reel' : 'shorts',
      audioUrl:   post.audio_url,
      imageUrl:   post.image_url,
    });

    // Store category + language on the job record
    await updateJob(job.id, { category, language: post.language });

    // Step 1 — generate audiogram
    const result = await generateAudiogram({
      audioUrl:      post.audio_url,
      imageUrl:      post.image_url,
      format:        'vertical',   // always 9:16 for Reels and Shorts
      durationLimit: 60,
    });
    audiogramPath = result.localPath;

    // Step 2 — upload to R2
    await updateJob(job.id, { step: 'uploading_to_cdn' });
    const r2Key       = `audiograms/${job.id}.mp4`;
    const audiogramUrl = await uploadToR2(audiogramPath, r2Key);
    await updateJob(job.id, { audiogram_url: audiogramUrl });

    // Step 3 — publish
    await updateJob(job.id, { step: 'publishing_to_platform' });

    let postResult;
    if (platform === 'instagram') {
      postResult = await instagram.publish({
        arreUserId: category,
        videoUrl:   audiogramUrl,
        caption:    '',            // no captions for AI accounts
        format:     'reel',
      });
    } else {
      postResult = await youtube.publish({
        arreUserId: category,
        localPath:  audiogramPath,
        title:      post.title,
        description: '',
      });
    }

    // Cleanup
    if (audiogramPath && fs.existsSync(audiogramPath)) fs.unlinkSync(audiogramPath);

    await updateJob(job.id, {
      status:   'success',
      step:     null,
      post_url: postResult.postUrl,
    });

    return { platform, language: post.language, status: 'success', post_url: postResult.postUrl };

  } catch (err) {
    if (audiogramPath && fs.existsSync(audiogramPath)) {
      try { fs.unlinkSync(audiogramPath); } catch (_) {}
    }
    const errorMsg = err.message || 'Unknown error';
    if (job) {
      await updateJob(job.id, {
        status:        'failed',
        step:          null,
        error_code:    err.code || 'UNKNOWN_ERROR',
        error_message: errorMsg,
      }).catch(() => {});
    }
    console.error(`auto-initiate job failed [${category}/${platform}/${post.language}]:`, errorMsg);
    return { platform, language: post.language, status: 'failed', error: errorMsg };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Auth
  if (req.headers['x-api-key'] !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate body
  const validationError = validateRequest(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { category, posts } = req.body;

  // Check which platforms are connected for this category
  const [igToken, ytToken] = await Promise.all([
    getToken(category, 'instagram'),
    getToken(category, 'youtube'),
  ]);

  if (!igToken && !ytToken) {
    return res.status(404).json({
      error: `No social accounts connected for category: ${category}. Connect IG and YT accounts first.`,
    });
  }

  const platforms = [
    ...(igToken ? ['instagram'] : []),
    ...(ytToken ? ['youtube']   : []),
  ];

  const totalJobs = posts.length * platforms.length;

  // ── Return accepted immediately — jobs run after this ───────────────────────
  // Vercel keeps the function alive until the async handler fully resolves,
  // so the pipeline runs in the background after the HTTP response is sent.
  res.status(200).json({
    status:   'accepted',
    category,
    jobs:     totalJobs,
    platforms,
  });

  // ── Fan out: 3 posts × platforms in parallel ────────────────────────────────
  const jobCombinations = posts.flatMap(post =>
    platforms.map(platform => ({ category, post, platform }))
  );

  await Promise.allSettled(jobCombinations.map(runJob));
};
