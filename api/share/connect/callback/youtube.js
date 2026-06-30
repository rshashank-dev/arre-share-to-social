const youtube = require('../../../../lib/youtube');

/**
 * GET /api/share/connect/callback/youtube?code={code}&state={arre_user_id}
 * This is the GOOGLE_REDIRECT_URI registered in the Google Cloud OAuth client.
 */
module.exports = async (req, res) => {
  const { code, state: arreUserId, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`arrevoice://share/connect/failed?platform=youtube&reason=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !arreUserId) {
    return res.status(400).send('Missing code or state (user id)');
  }

  try {
    const tokenRow = await youtube.handleOAuthCallback({ code, arreUserId });
    return res.redirect(`arrevoice://share/connect/success?platform=youtube&channel=${encodeURIComponent(tokenRow.username || '')}`);
  } catch (e) {
    console.error('youtube callback error:', e);
    return res.redirect(`arrevoice://share/connect/failed?platform=youtube&reason=${encodeURIComponent(e.message)}`);
  }
};
