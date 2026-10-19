module.exports = function supabasePublicConfig(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ configured: false });
  }

  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return res.status(503).json({ configured: false });
  }

  return res.status(200).json({ configured: true, url, publishableKey });
};
