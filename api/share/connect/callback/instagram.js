const instagram = require('../../../../lib/instagram');

/**
 * GET /api/share/connect/callback/instagram?code={code}&state={arre_user_id}
 * This is the META_REDIRECT_URI registered in the Meta Developer App.
 */
module.exports = async (req, res) => {
  const { code, state: arreUserId, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`arrevoice://share/connect/failed?platform=instagram&reason=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !arreUserId) {
    return res.status(400).send('Missing code or state (user id)');
  }

  try {
    const tokenRow = await instagram.handleOAuthCallback({ code, arreUserId });
    // Deep link back into the app so the WebView can close itself
    return res.redirect(`arrevoice://share/connect/success?platform=instagram&username=${encodeURIComponent(tokenRow.username || '')}`);
  } catch (e) {
    console.error('instagram callback error:', e);
    return res.redirect(`arrevoice://share/connect/failed?platform=instagram&reason=${encodeURIComponent(e.message)}`);
  }
};
