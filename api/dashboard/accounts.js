/**
 * GET /api/dashboard/accounts
 *
 * Returns all AI creator accounts with:
 *  - IG and YT connection status (from social_tokens)
 *  - Total posts and last post date (from share_jobs)
 *  - Display metadata (from ai_accounts table if it exists and is populated)
 *
 * Falls back gracefully if ai_accounts table is empty —
 * derives the account list from social_tokens instead.
 */

const { supabase } = require('../../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Pull all three sources in parallel ──────────────────────────────────────
  const [tokensRes, jobsRes, accountsRes] = await Promise.all([
    supabase.from('social_tokens').select('arre_user_id, platform, username, expires_at, updated_at'),
    supabase.from('share_jobs').select('arre_user_id, status, platform, created_at').order('created_at', { ascending: false }),
    supabase.from('ai_accounts').select('*'),
  ]);

  const tokens   = tokensRes.data   || [];
  const jobs     = jobsRes.data     || [];
  const aiAccts  = accountsRes.data || [];

  // ── Build account registry keyed by creator_id ──────────────────────────────
  const registry = {};

  // Seed from ai_accounts table if populated
  aiAccts.forEach(a => {
    registry[a.creator_id] = {
      creator_id:      a.creator_id,
      display_name:    a.display_name || a.creator_id,
      category:        a.category     || null,
      language:        a.language     || null,
      ig_connected:    a.ig_connected || false,
      ig_username:     a.ig_username  || null,
      yt_connected:    a.yt_connected || false,
      yt_channel_name: a.yt_channel_name || null,
      total_posts:     0,
      ig_posts:        0,
      yt_posts:        0,
      last_post_at:    null,
    };
  });

  // Supplement / seed from social_tokens (source of truth for connection status)
  tokens.forEach(t => {
    if (!registry[t.arre_user_id]) {
      registry[t.arre_user_id] = {
        creator_id:      t.arre_user_id,
        display_name:    t.arre_user_id,
        category:        null,
        language:        null,
        ig_connected:    false,
        ig_username:     null,
        yt_connected:    false,
        yt_channel_name: null,
        total_posts:     0,
        ig_posts:        0,
        yt_posts:        0,
        last_post_at:    null,
      };
    }
    if (t.platform === 'instagram') {
      registry[t.arre_user_id].ig_connected = true;
      registry[t.arre_user_id].ig_username  = t.username;
    }
    if (t.platform === 'youtube') {
      registry[t.arre_user_id].yt_connected    = true;
      registry[t.arre_user_id].yt_channel_name = t.username;
    }
  });

  // Add job counts
  jobs.forEach(j => {
    if (!registry[j.arre_user_id]) return;
    registry[j.arre_user_id].total_posts++;
    if (j.platform === 'instagram') registry[j.arre_user_id].ig_posts++;
    if (j.platform === 'youtube')   registry[j.arre_user_id].yt_posts++;
    if (!registry[j.arre_user_id].last_post_at) {
      registry[j.arre_user_id].last_post_at = j.created_at;
    }
  });

  const accounts = Object.values(registry).sort((a, b) =>
    (a.display_name || '').localeCompare(b.display_name || '')
  );

  const summary = {
    total:          accounts.length,
    fully_connected: accounts.filter(a => a.ig_connected && a.yt_connected).length,
    ig_only:         accounts.filter(a => a.ig_connected && !a.yt_connected).length,
    yt_only:         accounts.filter(a => !a.ig_connected && a.yt_connected).length,
    not_connected:   accounts.filter(a => !a.ig_connected && !a.yt_connected).length,
  };

  return res.status(200).json({ accounts, summary });
};
