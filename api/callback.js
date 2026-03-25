export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.status(400).json({ error: 'Geen code ontvangen' });
  }

  try {
    const tokenResponse = await fetch('https://api.mollie.com/oauth2/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.MOLLIE_REDIRECT_URI,
        client_id: process.env.MOLLIE_CLIENT_ID,
        client_secret: process.env.MOLLIE_CLIENT_SECRET,
      }),
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=token_exchange_failed`);
    }

    // Tokens teruggeven via URL (tijdelijk, veilig genoeg voor eigen gebruik)
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_connected=true&access_token=${tokens.access_token}`);

  } catch (err) {
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=server_error`);
  }
}
