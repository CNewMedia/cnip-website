import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  // Foutafhandeling van Mollie
  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.status(400).json({ error: 'Geen code ontvangen van Mollie' });
  }

  // Optioneel: state valideren tegen opgeslagen waarde
  const savedState = await kv.get('mollie_oauth_state');
  if (state && savedState && state !== savedState) {
    return res.status(400).json({ error: 'Ongeldige state parameter' });
  }

  try {
    // Wissel code in voor tokens
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

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('Mollie token fout:', err);
      return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();

    // Sla tokens op in Vercel KV
    await kv.set('mollie_access_token', tokens.access_token);
    await kv.set('mollie_refresh_token', tokens.refresh_token);
    await kv.set('mollie_token_expires_at', Date.now() + tokens.expires_in * 1000);

    console.log('Mollie tokens succesvol opgeslagen');

    // Stuur terug naar je HTML site
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_connected=true`);

  } catch (err) {
    console.error('OAuth callback fout:', err);
    return res.redirect(`${process.env.FRONTEND_URL}?mollie_error=server_error`);
  }
}
