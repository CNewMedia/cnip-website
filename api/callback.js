export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.status(400).json({ error: 'Geen code ontvangen' });
  }

  try {
    const credentials = Buffer.from(
      `${process.env.MOLLIE_CLIENT_ID}:${process.env.MOLLIE_CLIENT_SECRET}`
    ).toString('base64');

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

    // Sla refresh token op als environment variable via log (veilig, niet in URL)
    console.log('REFRESH_TOKEN:', tokens.refresh_token);

    // Stuur terug naar site ZONDER token in URL
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_connected=true`);

  } catch (err) {
    console.error('Callback fout:', err);
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=server_error`);
  }
}
