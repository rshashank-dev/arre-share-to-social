const instagram = require('../../../lib/instagram');
const youtube = require('../../../lib/youtube');

/**
 * GET /api/share/connect/instagram
 * GET /api/share/connect/youtube
 *
 * App opens the returned auth_url in a WebView. Pass arre_user_id as a query
 * param so it round-trips through state for the callback to know who to link.
 */
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { platform } = req.query;
  const { user_id: userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    let authUrl;
    if (platform === 'instagram') {
      authUrl = `${instagram.getAuthUrl()}&state=${encodeURIComponent(userId)}`;
    } else if (platform === 'youtube') {
      authUrl = `${youtube.getAuthUrl()}&state=${encodeURIComponent(userId)}`;
    } else {
      return res.status(400).json({ error: `Unsupported platform: ${platform}` });
    }

    return res.status(200).json({ auth_url: authUrl });
  } catch (e) {
    console.error('share/connect error:', e);
    return res.status(500).json({ error: 'Failed to generate auth URL' });
  }
};
