import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Beveilig dit endpoint — alleen aanroepen vanaf je eigen site
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin.includes(process.env.FRONTEND_URL)) {
    return res.status(403).json({ error: 'Niet toegestaan' });
  }

  const refreshToken = await kv.get('mollie_refresh_token');

  if (!refreshToken) {
    return res.status(400).json({ error: 'Geen refresh token beschikbaar. Verbind eerst met Mollie.' });
  }

  try {
    const tokenResponse = await fetch('https://api.mollie.com/oauth2/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.MOLLIE_CLIENT_ID,
        client_secret: process.env.MOLLIE_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('Refresh fout:', err);
      return res.status(500).json({ error: 'Token vernieuwen mislukt' });
    }

    const tokens = await tokenResponse.json();

    await kv.set('mollie_access_token', tokens.access_token);
    await kv.set('mollie_token_expires_at', Date.now() + tokens.expires_in * 1000);
    if (tokens.refresh_token) {
      await kv.set('mollie_refresh_token', tokens.refresh_token);
    }

    return res.status(200).json({ success: true, expires_in: tokens.expires_in });

  } catch (err) {
    console.error('Refresh fout:', err);
    return res.status(500).json({ error: 'Serverfout bij vernieuwen token' });
  }
}
