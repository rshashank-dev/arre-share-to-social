/**
 * POST /api/share/auto-initiate
 *
 * Called by Arré Voice backend cron — once per category.
 * Receives 1 category + 3 posts (Tamil, Hinglish, English).
 * Fans out into 6 jobs: 3 posts × 2 platforms (IG + YT).
 *
 * Flow:
 *  1. Validate + auth
 *  2. Look up category tokens
 *  3. Create ALL job records in DB immediately (dashboard shows all 6 at once)
 *  4. Return { status: accepted } immediately
 *  5. Process each job sequentially in background
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
  if (!body?.category)                return 'category is required';
  if (!Array.isArray(body.posts))     return 'posts must be an array';
  if (body.posts.length !== 3)        return 'posts must be an array of exactly 3';
  for (const [i, post] of body.posts.entries()) {
    const missing = REQUIRED_POST_FIELDS.filter(k => !post[k]);
    if (missing.length) return `posts[${i}] missing: ${missing.join(', ')}`;
    if (!VALID_LANGUAGES.includes(post.language))
      return `posts[${i}].language must be Tamil | Hinglish | English`;
  }
  return null;
}

async function createJobRecord({ category, post, platform }) {
  const { data, error } = await supabase
    .from('share_jobs')
    .insert({
      creator_id: category,
      pod_id:       post.pod_id,
      platform,
      format:       platform === 'instagram' ? 'reel' : 'shorts',
      status:       'processing',
      step:         'queued',
      audio_url:    post.audio_url,
      image_url:    post.image_url,
      category,
      language:     post.language,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return data;
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
      durationLimit: 60,
    });
    audiogramPath = result.localPath;

    await updateJob(job.id, { step: 'uploading_to_cdn' });
    const audiogramUrl = await uploadToR2(audiogramPath, `audiograms/${job.id}.mp4`);
    await updateJob(job.id, { audiogram_url: audiogramUrl });

    await updateJob(job.id, { step: 'publishing_to_platform' });

    let postResult;
    if (platform === 'instagram') {
      postResult = await instagram.publish({
        arreUserId: category,
        videoUrl:   audiogramUrl,
        caption:    '',
        format:     'reel',
      });
    } else {
      postResult = await youtube.publish({
        arreUserId:  category,
        localPath:   audiogramPath,
        title:       post.title,
        description: '',
      });
    }

    if (audiogramPath && fs.existsSync(audiogramPath)) fs.unlinkSync(audiogramPath);
    await updateJob(job.id, { status: 'success', step: null, post_url: postResult.postUrl });
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

  // ── Create ALL job records before any processing ──────────────────────────
  const jobQueue = [];
  for (const post of posts) {
    for (const platform of platforms) {
      try {
        const job = await createJobRecord({ category, post, platform });
        jobQueue.push({ job, post, platform, category });
      } catch (err) {
        console.error(`createJobRecord failed [${platform}/${post.language}]:`, err.message);
      }
    }
  }

  // ── Return immediately ────────────────────────────────────────────────────
  res.status(200).json({ status: 'accepted', category, jobs: jobQueue.length, platforms });

  // ── Process sequentially in background ───────────────────────────────────
  for (const item of jobQueue) {
    await processJob(item);
  }
};
