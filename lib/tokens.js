const { supabase } = require('./supabase');

async function getToken(creatorId, platform) {
  const { data, error } = await supabase
    .from('social_tokens')
    .select('*')
    .eq('creator_id', creatorId)
    .eq('platform', platform)
    .single();

  if (error) return null;
  return data;
}

async function upsertToken({ arreUserId, platform, platformUserId, username, handle, accessToken, refreshToken, expiresAt }) {
  const { data, error } = await supabase
    .from('social_tokens')
    .upsert({
      creator_id:       arreUserId,
      platform,
      platform_user_id: platformUserId,
      username,
      handle:           handle || null,
      access_token:     accessToken,
      refresh_token:    refreshToken,
      expires_at:       expiresAt,
      updated_at:       new Date().toISOString(),
    }, { onConflict: 'creator_id,platform' })
    .select()
    .single();

  if (error) throw new Error(`Failed to store token: ${error.message}`);
  return data;
}

module.exports = { getToken, upsertToken };
