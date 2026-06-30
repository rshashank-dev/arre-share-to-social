const { generateAudiogram } = require('../../lib/audiogram');
const { uploadToR2 } = require('../../lib/r2');
const { createJob, updateJob } = require('../../lib/jobs');
const instagram = require('../../lib/instagram');
const youtube = require('../../lib/youtube');
const fs = require('fs');

const FORMAT_TO_RATIO = {
  reel: 'vertical',
  story: 'vertical',
  shorts: 'vertical',
  post: 'square',
};

/**
 * POST /api/share/initiate
 * body: {
 *   pod_id, audio_url, image_url, title, caption,
 *   platform: 'instagram' | 'youtube',
 *   format:   'reel' | 'post' | 'story' | 'shorts',
 *   user_id
 * }
 *
 * NOTE ON SYNC vs ASYNC:
 * This runs the full pipeline (generate -> upload -> publish) within a single
 * request, capped at 60s via vercel.json's maxDuration. This is fine for short
 * pods. The response IS the final result — no polling needed for this MVP.
 * GET /api/share/status/:job_id is still provided so the app can look up a
 * job's result later (e.g. share history) or if you later split this into a
 * true background queue (Upstash/Inngest) for longer clips.
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pod_id: podId, audio_url: audioUrl, image_url: imageUrl, title, caption, platform, format, user_id: userId } = req.body || {};

  const missing = ['pod_id', 'audio_url', 'image_url', 'platform', 'format', 'user_id'].filter(
    (k) => !req.body?.[k]
  );
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }
  if (!['instagram', 'youtube'].includes(platform)) {
    return res.status(400).json({ error: `Unsupported platform: ${platform}` });
  }
  if (!FORMAT_TO_RATIO[format]) {
    return res.status(400).json({ error: `Unsupported format: ${format}` });
  }

  let job;
  try {
    job = await createJob({ arreUserId: userId, podId, platform, format, audioUrl, imageUrl });
  } catch (e) {
    console.error('Failed to create job:', e);
    return res.status(500).json({ error: 'Failed to create share job' });
  }

  let audiogramResult;
  try {
    // ── Step 1: generate audiogram ──────────────────────────────────────
    audiogramResult = await generateAudiogram({
      audioUrl,
      imageUrl,
      format: FORMAT_TO_RATIO[format],
      durationLimit: platform === 'youtube' ? 60 : format === 'post' ? 0 : 60,
    });

    // ── Step 2: upload to R2 ─────────────────────────────────────────────
    await updateJob(job.id, { step: 'uploading_to_cdn' });
    const r2Key = `audiograms/${job.id}.mp4`;
    const audiogramUrl = await uploadToR2(audiogramResult.localPath, r2Key);
    await updateJob(job.id, { audiogram_url: audiogramUrl });

    // ── Step 3: publish to platform ──────────────────────────────────────
    await updateJob(job.id, { step: 'publishing_to_platform' });

    let result;
    if (platform === 'instagram') {
      result = await instagram.publish({
        arreUserId: userId,
        videoUrl: audiogramUrl, // IG needs a public URL, not a local file
        caption: caption || title || '',
        format,
      });
    } else {
      result = await youtube.publish({
        arreUserId: userId,
        localPath: audiogramResult.localPath, // YT needs the file stream, not a URL
        title: title || 'Arre Voice Pod',
        description: caption || '',
      });
    }

    fs.existsSync(audiogramResult.localPath) && fs.unlinkSync(audiogramResult.localPath);

    const finalJob = await updateJob(job.id, {
      status: 'success',
      step: null,
      post_url: result.postUrl,
    });

    return res.status(200).json({
      job_id: finalJob.id,
      status: 'success',
      platform,
      format,
      post_url: result.postUrl,
    });

  } catch (e) {
    console.error(`share/initiate failed for job ${job.id}:`, e);

    if (audiogramResult?.localPath && fs.existsSync(audiogramResult.localPath)) {
      fs.unlinkSync(audiogramResult.localPath);
    }

    const errorCode = e.code || 'UNKNOWN_ERROR';
    const errorMessage = friendlyError(errorCode, e.message);

    await updateJob(job.id, {
      status: 'failed',
      step: null,
      error_code: errorCode,
      error_message: errorMessage,
    });

    return res.status(422).json({
      job_id: job.id,
      status: 'failed',
      error_code: errorCode,
      error_message: errorMessage,
    });
  }
};

function friendlyError(code, raw) {
  const map = {
    NOT_CONNECTED: 'Please connect your account before sharing.',
    QUOTA_EXCEEDED: 'YouTube sharing is temporarily unavailable. Please try again later.',
    PROCESSING_TIMEOUT: 'The platform is taking longer than usual to process this video. Please try again.',
    CONTAINER_FAILED: 'Could not prepare the post for Instagram. Please try again.',
    PUBLISH_FAILED: 'Could not publish to Instagram. Please try again.',
    UPLOAD_FAILED: 'Could not upload to YouTube. Please try again.',
  };
  return map[code] || raw || 'Something went wrong. Please try again.';
}
