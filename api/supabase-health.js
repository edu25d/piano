module.exports = async function supabaseHealth(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ connected: false, code: 'method_not_allowed' });
  }

  const projectUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!projectUrl || !serviceKey) {
    return res.status(503).json({ connected: false, code: 'missing_configuration' });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`
  };

  try {
    const auth = await fetch(`${projectUrl}/auth/v1/health`, { headers });
    if (!auth.ok) {
      return res.status(502).json({ connected: false, code: 'supabase_unavailable' });
    }

    const schema = await fetch(`${projectUrl}/rest/v1/classes?select=id&limit=0`, { headers });
    if (!schema.ok) {
      const details = await schema.json().catch(() => ({}));
      const missingTable = schema.status === 404 || details.code === 'PGRST205';
      return res.status(200).json({
        connected: true,
        schemaReady: false,
        code: missingTable ? 'schema_not_installed' : 'schema_check_failed'
      });
    }

    return res.status(200).json({ connected: true, schemaReady: true });
  } catch {
    return res.status(502).json({ connected: false, code: 'supabase_unavailable' });
  }
};
