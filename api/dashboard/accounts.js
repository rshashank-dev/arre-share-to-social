/**
 * GET /api/dashboard/accounts
 *
 * Returns the 17 category accounts with IG + YT connection status
 * and posting stats. social_tokens uses category name as arre_user_id
 * for AI accounts. Falls back gracefully if ai_accounts is empty.
 */

const { supabase } = require('../../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const [tokensRes, jobsRes, accountsRes] = await Promise.all([
    supabase.from('social_tokens').select('arre_user_id, platform, username, expires_at, updated_at'),
    supabase.from('share_jobs').select('arre_user_id, category, language, status, platform, created_at').order('created_at', { ascending: false }),
    supabase.from('ai_accounts').select('*'),
  ]);

  const tokens  = tokensRes.data  || [];
  const jobs    = jobsRes.data    || [];
  const aiAccts = accountsRes.data || [];

  // ── Build registry keyed by category ────────────────────────────────────────
  const registry = {};

  // Seed from ai_accounts (source of truth for display names)
  aiAccts.forEach(a => {
    registry[a.category] = {
      category:        a.category,
      display_name:    a.display_name || a.category,
      ig_connected:    false,
      ig_username:     a.ig_username  || null,
      yt_connected:    false,
      yt_channel_name: a.yt_channel_name || null,
      total_posts:     0,
      ig_posts:        0,
      yt_posts:        0,
      tamil_posts:     0,
      hinglish_posts:  0,
      english_posts:   0,
      last_post_at:    null,
    };
  });

  // Supplement from social_tokens — for AI accounts, arre_user_id = category name
  tokens.forEach(t => {
    const cat = t.arre_user_id;
    if (!registry[cat]) {
      registry[cat] = {
        category:        cat,
        display_name:    cat,
        ig_connected:    false,
        ig_username:     null,
        yt_connected:    false,
        yt_channel_name: null,
        total_posts:     0,
        ig_posts:        0,
        yt_posts:        0,
        tamil_posts:     0,
        hinglish_posts:  0,
        english_posts:   0,
        last_post_at:    null,
      };
    }
    if (t.platform === 'instagram') {
      registry[cat].ig_connected = true;
      registry[cat].ig_username  = t.username;
    }
    if (t.platform === 'youtube') {
      registry[cat].yt_connected    = true;
      registry[cat].yt_channel_name = t.username;
    }
  });

  // Add job counts — use category column when available, fall back to arre_user_id
  jobs.forEach(j => {
    const cat = j.category || j.arre_user_id;
    if (!registry[cat]) return;
    registry[cat].total_posts++;
    if (j.platform === 'instagram') registry[cat].ig_posts++;
    if (j.platform === 'youtube')   registry[cat].yt_posts++;
    if (j.language === 'Tamil')    registry[cat].tamil_posts++;
    if (j.language === 'Hinglish') registry[cat].hinglish_posts++;
    if (j.language === 'English')  registry[cat].english_posts++;
    if (!registry[cat].last_post_at) registry[cat].last_post_at = j.created_at;
  });

  const accounts = Object.values(registry).sort((a, b) =>
    (a.display_name || '').localeCompare(b.display_name || '')
  );

  const summary = {
    total:            accounts.length,
    fully_connected:  accounts.filter(a => a.ig_connected && a.yt_connected).length,
    ig_only:          accounts.filter(a => a.ig_connected && !a.yt_connected).length,
    yt_only:          accounts.filter(a => !a.ig_connected && a.yt_connected).length,
    not_connected:    accounts.filter(a => !a.ig_connected && !a.yt_connected).length,
  };

  return res.status(200).json({ accounts, summary });
};
