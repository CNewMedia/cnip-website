export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=${encodeURIComponent(error)}`);
  }

  // CSRF validatie via cookie
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => c.trim().split('='))
  );
  const savedState = cookies['oauth_state'];

  if (!state || !savedState || state !== savedState) {
    return res.status(403).json({ error: 'Ongeldige state — mogelijke CSRF aanval' });
  }

  if (!code) {
    return res.status(400).json({ error: 'Geen code ontvangen' });
  }

  try {
    const credentials = Buffer.from(
      `${process.env.MOLLIE_CLIENT_ID}:${process.env.MOLLIE_CLIENT_SECRET}`
    ).toString('base64');

    // Wissel code in voor tokens
    const tokenResponse = await fetch('https://api.mollie.com/oauth2/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.MOLLIE_REDIRECT_URI,
      }),
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Token exchange fout:', tokens);
      return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=token_exchange_failed`);
    }

    // Haal organisatie info op
    const orgResponse = await fetch('https://api.mollie.com/v2/organizations/me', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    const org = await orgResponse.json();

    // Sla refresh token op als Vercel env variable via API (veilig)
    // Tijdelijk: log alleen de org info, NOOIT het token
    console.log('Verbonden organisatie:', org.id, org.name);

    // Sla refresh token op in een httpOnly cookie (veilig voor eigen gebruik)
    res.setHeader('Set-Cookie', [
      `mollie_refresh=${tokens.refresh_token}; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000; Path=/`,
      `mollie_org=${org.id}; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000; Path=/`
    ]);

    return res.redirect(`${process.env.FRONTEND_URL}?mollie_connected=true&org=${encodeURIComponent(org.name)}`);

  } catch (err) {
    console.error('Callback fout:', err);
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=server_error`);
  }
}
