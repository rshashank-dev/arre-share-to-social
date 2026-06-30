const { supabase } = require('./supabase');

async function getToken(arreUserId, platform) {
  const { data, error } = await supabase
    .from('social_tokens')
    .select('*')
    .eq('arre_user_id', arreUserId)
    .eq('platform', platform)
    .single();

  if (error) return null;
  return data;
}

async function upsertToken({ arreUserId, platform, platformUserId, username, accessToken, refreshToken, expiresAt }) {
  const { data, error } = await supabase
    .from('social_tokens')
    .upsert({
      arre_user_id: arreUserId,
      platform,
      platform_user_id: platformUserId,
      username,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'arre_user_id,platform' })
    .select()
    .single();

  if (error) throw new Error(`Failed to store token: ${error.message}`);
  return data;
}

module.exports = { getToken, upsertToken };
