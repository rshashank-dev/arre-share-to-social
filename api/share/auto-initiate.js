/**
 * POST /api/share/auto-initiate
 * Creates all job records, then processes them sequentially IN THIS SAME FUNCTION
 * before returning. This guarantees execution — no fire-and-forget race condition.
 * 
 * Returns response AFTER all jobs complete (or fail).
 * Backend should not await — fire and forget on their side.
 * maxDuration: 300s covers 6 jobs × ~45s each.
 */

const { generateAudiogram } = require('../../lib/audiogram');
const { uploadToR2 }         = require('../../lib/r2');
const { supabase }           = require('../../lib/supabase');
const instagram              = require('../../lib/instagram');
const youtube                = require('../../lib/youtube');
const { getToken }           = require('../../lib/tokens');
const fs                     = require('fs');

const REQUIRED_POST_FIELDS = ['creator_id', 'language', 'pod_id', 'audio_url', 'image_url', 'title'];
const VALID_LANGUAGES      = ['Tamil', 'Hinglish', 'English'];

function validateRequest(body) {
  if (!body?.category)            return 'category is required';
  if (!Array.isArray(body.posts)) return 'posts must be an array';
  for (const [i, post] of body.posts.entries()) {
    const missing = REQUIRED_POST_FIELDS.filter(k => !post[k]);
    if (missing.length) return `posts[${i}] missing: ${missing.join(', ')}`;
    if (!VALID_LANGUAGES.includes(post.language))
      return `posts[${i}].language must be Tamil | Hinglish | English`;
  }
  return null;
}

async function updateJob(jobId, fields) {
  const { error } = await supabase
    .from('share_jobs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) console.error(`updateJob failed [${jobId}]:`, error.message);
}

async function processJob({ job, post, platform, category }) {
  let audiogramPath = null;
  try {
    await updateJob(job.id, { step: 'generating_audiogram' });

    const result = await generateAudiogram({
      audioUrl:      post.audio_url,
      imageUrl:      post.image_url,
      format:        'vertical',
      durationLimit: 15,
    });
    audiogramPath = result.localPath;

    await updateJob(job.id, { step: 'uploading_to_cdn' });
    const audiogramUrl = await uploadToR2(audiogramPath, `audiograms/${job.id}.mp4`);
    await updateJob(job.id, { audiogram_url: audiogramUrl });

    await updateJob(job.id, { step: 'publishing_to_platform' });

    let postResult;
    const igDesc = `Listen to this pod on Arre Voice — https://app.arrevoice.com/voicepod/${post.pod_id}\n\nDownload Arre Voice — https://arrevoice.app.link/insta`;
    const ytDesc = `Listen to this pod on Arre Voice — https://app.arrevoice.com/voicepod/${post.pod_id}\n\nDownload Arre Voice — https://arrevoice.app.link/youtube`;
    if (platform === 'instagram') {
      postResult = await instagram.publish({
        arreUserId: category,
        videoUrl:   audiogramUrl,
        caption:    igDesc,
        format:     'reel',
      });
    } else {
      postResult = await youtube.publish({
        arreUserId:  category,
        localPath:   audiogramPath,
        title:       post.title,
        description: ytDesc,
      });
    }

    if (audiogramPath && fs.existsSync(audiogramPath)) fs.unlinkSync(audiogramPath);
    await updateJob(job.id, {
      status:             'success',
      step:               null,
      post_url:           postResult.postUrl,
      platform_post_id:   postResult.postId || null,
    });
    console.log(`SUCCESS [${category}/${platform}/${post.language}]: ${postResult.postUrl}`);

  } catch (err) {
    if (audiogramPath && fs.existsSync(audiogramPath)) {
      try { fs.unlinkSync(audiogramPath); } catch (_) {}
    }
    await updateJob(job.id, {
      status:        'failed',
      step:          null,
      error_code:    err.code || 'UNKNOWN_ERROR',
      error_message: err.message || 'Unknown error',
    });
    console.error(`FAILED [${category}/${platform}/${post.language}]:`, err.message);
  }
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

  // ── Step 1: Create ALL job records immediately ────────────────────────────
  const jobQueue = [];
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
        console.error(`createJob failed [${platform}/${post.language}]:`, error.message);
        continue;
      }
      jobQueue.push({ job: data, post, platform, category });
    }
  }

  // ── Step 2: Process sequentially — guaranteed to run ─────────────────────
  // We do NOT return early. Vercel keeps function alive until handler resolves.
  // maxDuration: 300s in vercel.json — enough for 6 × 15s jobs + overhead.
  const results = [];
  for (const item of jobQueue) {
    await processJob(item);
    results.push({ jobId: item.job.id, platform: item.platform, language: item.post.language });
  }

  // ── Step 3: Return after all jobs complete ────────────────────────────────
  return res.status(200).json({
    status:   'completed',
    category,
    jobs:     results.length,
    platforms,
    results,
  });
};
