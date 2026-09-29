function clean(value, max = 5000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  let raw = '';
  if (typeof req.body === 'string') {
    raw = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    raw = req.body.toString('utf8');
  } else {
    raw = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
        if (data.length > 100000) req.destroy();
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('application/json')) {
    return raw ? JSON.parse(raw) : {};
  }

  return Object.fromEntries(new URLSearchParams(raw));
}

function splitName(fullName) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    firstname: parts.shift() || '',
    lastname: parts.join(' '),
  };
}

function sourceFromRequest(req, body) {
  if (body.subject) return clean(body.subject, 250);
  if (body.form_name) return clean(body.form_name, 250);

  try {
    const ref = req.headers.referer || req.headers.referrer;
    if (ref) {
      const url = new URL(ref);
      return `CNIP website: ${url.pathname}`;
    }
  } catch (_) {}

  return 'CNIP website';
}

async function sendResend({ email, name, company, phone, interest, message, source }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, skipped: true, reason: 'RESEND_API_KEY ontbreekt' };

  const to = process.env.CONTACT_TO_EMAIL || 'christophe@cnip.be';
  const from = process.env.CONTACT_FROM_EMAIL || 'CNIP Website <contact@oryen.be>';

  const rows = [
    ['Naam', name],
    ['E-mail', email],
    ['Bedrijf', company],
    ['Telefoon', phone],
    ['Interesse', interest],
    ['Bron', source],
    ['Bericht', message],
  ].filter(([, value]) => value);

  const html = `
    <h2>Nieuwe CNIP-aanvraag</h2>
    <table cellpadding="6" cellspacing="0" border="0">
      ${rows.map(([label, value]) => `<tr><td><strong>${label}</strong></td><td>${String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')}</td></tr>`).join('')}
    </table>
  `;

  const text = [
    'Nieuwe CNIP-aanvraag',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `Nieuwe CNIP-aanvraag${company ? ` | ${company}` : ''}`,
      html,
      text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend fout ${response.status}: ${await response.text()}`);
  }

  return { ok: true };
}

async function upsertHubSpot({ email, name, company, phone, interest, message, source }) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return { ok: false, skipped: true, reason: 'HUBSPOT_ACCESS_TOKEN ontbreekt' };

  const { firstname, lastname } = splitName(name);
  const combinedMessage = [
    source ? `Bron: ${source}` : '',
    interest ? `Interesse: ${interest}` : '',
    message || '',
  ].filter(Boolean).join('\n');

  const properties = {};
  if (firstname) properties.firstname = firstname;
  if (lastname) properties.lastname = lastname;
  if (company) properties.company = company;
  if (phone) properties.phone = phone;
  if (combinedMessage) properties.message = combinedMessage.slice(0, 5000);

  const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: [
        {
          idProperty: 'email',
          id: email,
          properties,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`HubSpot fout ${response.status}: ${await response.text()}`);
  }

  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed');
  }

  try {
    const body = await parseBody(req);

    // Honeypot. Bots krijgen een normale redirect, maar er wordt niets verstuurd.
    if (body.botcheck) {
      res.setHeader('Location', '/bedankt.html');
      return res.status(303).end();
    }

    const name = clean(body.name || body.naam, 200);
    const email = clean(body.email, 320).toLowerCase();
    const company = clean(body.company || body.bedrijf, 300);
    const phone = clean(body.phone || body.telefoon, 100);
    const interest = clean(body.interest || body.vraag, 500);
    const message = clean(body.message || body.bericht, 5000);
    const source = sourceFromRequest(req, body);

    if (!name || !email || !email.includes('@')) {
      return res.status(400).send('Naam en geldig e-mailadres zijn verplicht.');
    }

    const results = await Promise.allSettled([
      sendResend({ email, name, company, phone, interest, message, source }),
      upsertHubSpot({ email, name, company, phone, interest, message, source }),
    ]);

    const resend = results[0];
    const hubspot = results[1];

    if (resend.status === 'rejected') console.error(resend.reason);
    if (hubspot.status === 'rejected') console.error(hubspot.reason);

    const delivered =
      (resend.status === 'fulfilled' && resend.value.ok) ||
      (hubspot.status === 'fulfilled' && hubspot.value.ok);

    if (!delivered) {
      console.error('CNIP contactformulier: geen afleverpad beschikbaar of beide paden faalden.');
      return res.status(500).send('Je aanvraag kon niet worden verstuurd. Probeer later opnieuw.');
    }

    res.setHeader('Location', '/bedankt.html');
    return res.status(303).end();
  } catch (error) {
    console.error('CNIP contactformulier fout:', error);
    return res.status(500).send('Je aanvraag kon niet worden verstuurd. Probeer later opnieuw.');
  }
}
