const { getToken } = require('../../lib/tokens');

/**
 * GET /api/share/options?user_id={id}
 *
 * Call this right after a pod is posted to know which share options
 * to render in the app's "Share to Social" sheet.
 *
 * Response shape is designed to map 1:1 to UI:
 * - connected: false  -> show a "Connect {Platform}" button instead of share options
 * - connected: true   -> show the listed `formats` as tappable options
 */
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id: userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    const [instagramToken, youtubeToken] = await Promise.all([
      getToken(userId, 'instagram'),
      getToken(userId, 'youtube'),
    ]);

    return res.status(200).json({
      instagram: {
        connected: !!instagramToken,
        username: instagramToken?.username || null,
        formats: ['reel', 'post', 'story'],
        connect_url: instagramToken ? null : `/api/share/connect/instagram?user_id=${encodeURIComponent(userId)}`,
      },
      youtube: {
        connected: !!youtubeToken,
        channel_name: youtubeToken?.username || null,
        formats: ['shorts'],
        connect_url: youtubeToken ? null : `/api/share/connect/youtube?user_id=${encodeURIComponent(userId)}`,
      },
    });
  } catch (e) {
    console.error('share/options error:', e);
    return res.status(500).json({ error: 'Failed to fetch share options' });
  }
};
