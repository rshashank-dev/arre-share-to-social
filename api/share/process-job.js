/**
 * POST /api/share/process-job
 *
 * Internal endpoint — called by auto-initiate only, not by external clients.
 * Handles one job: audiogram generation → R2 upload → platform publish.
 * Runs in its own Vercel function invocation (maxDuration: 180s).
 */

const { generateAudiogram } = require('../../lib/audiogram');
const { uploadToR2 }         = require('../../lib/r2');
const { supabase }           = require('../../lib/supabase');
const instagram              = require('../../lib/instagram');
const youtube                = require('../../lib/youtube');
const fs                     = require('fs');

async function updateJob(jobId, fields) {
  const { error } = await supabase
    .from('share_jobs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) console.error(`updateJob failed [${jobId}]:`, error.message);
}

module.exports = async (req, res) => {
  // Internal auth — same API key
  if (req.headers['x-api-key'] !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { jobId, category, post, platform } = req.body || {};
  if (!jobId || !category || !post || !platform) {
    return res.status(400).json({ error: 'jobId, category, post, platform are required' });
  }

  // Return 200 immediately so auto-initiate's fetch doesn't wait
  res.status(200).json({ status: 'processing', jobId });

  let audiogramPath = null;
  try {
    await updateJob(jobId, { step: 'generating_audiogram' });

    const result = await generateAudiogram({
      audioUrl:      post.audio_url,
      imageUrl:      post.image_url,
      format:        'vertical',
      durationLimit: 60,
    });
    audiogramPath = result.localPath;

    await updateJob(jobId, { step: 'uploading_to_cdn' });
    const audiogramUrl = await uploadToR2(audiogramPath, `audiograms/${jobId}.mp4`);
    await updateJob(jobId, { audiogram_url: audiogramUrl });

    await updateJob(jobId, { step: 'publishing_to_platform' });

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

    await updateJob(jobId, { status: 'success', step: null, post_url: postResult.postUrl });
    console.log(`SUCCESS [${category}/${platform}/${post.language}]: ${postResult.postUrl}`);

  } catch (err) {
    if (audiogramPath && fs.existsSync(audiogramPath)) {
      try { fs.unlinkSync(audiogramPath); } catch (_) {}
    }
    await updateJob(jobId, {
      status:        'failed',
      step:          null,
      error_code:    err.code || 'UNKNOWN_ERROR',
      error_message: err.message || 'Unknown error',
    });
    console.error(`FAILED [${category}/${platform}/${post.language}]:`, err.message);
  }
};
