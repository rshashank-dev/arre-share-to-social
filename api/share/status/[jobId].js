const { getJob } = require('../../../lib/jobs');

/**
 * GET /api/share/status/:jobId
 * Useful for share history, retry UI, or debugging. Since /initiate is
 * currently synchronous, this will already reflect the final state by the
 * time the app calls it — but keep using it if you split initiate into a
 * true background job later.
 */
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { jobId } = req.query;
  const job = await getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.status(200).json({
    job_id: job.id,
    status: job.status,
    step: job.step,
    platform: job.platform,
    format: job.format,
    post_url: job.post_url,
    error_code: job.error_code,
    error_message: job.error_message,
  });
};
