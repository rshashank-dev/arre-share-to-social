const { supabase } = require('./supabase');

async function createJob({ arreUserId, podId, platform, format, audioUrl, imageUrl }) {
  const { data, error } = await supabase
    .from('share_jobs')
    .insert({
      creator_id: arreUserId,
      pod_id:     podId,
      platform,
      format,
      audio_url:  audioUrl,
      image_url:  imageUrl,
      status:     'processing',
      step:       'generating_audiogram',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return data;
}

async function updateJob(jobId, fields) {
  const { data, error } = await supabase
    .from('share_jobs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update job ${jobId}: ${error.message}`);
  return data;
}

async function getJob(jobId) {
  const { data, error } = await supabase
    .from('share_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) return null;
  return data;
}

module.exports = { createJob, updateJob, getJob };
