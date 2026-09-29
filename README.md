# cnip.be

Statische website van CNIP, gehost op Vercel vanuit deze repository.

## Structuur

- `index.html` – homepage
- `*.html` – landingspagina's (marketing-bureau-gent, marketing-uitbesteden, marketing-advies, hubspot-gold-partner-gent), privacy, bedankt, 404
- `cases/` – casepagina's
- `api/contact.js` – contactformulier: formulier → `/api/contact` → Resend → mailbox → `/bedankt.html`
- `vercel.json` – redirects en headers

## Omgevingsvariabelen (Vercel)

| Variabele | Doel |
| --- | --- |
| `RESEND_API_KEY` | API-key voor Resend (nooit in code of Git) |
| `CONTACT_FROM_EMAIL` | Afzender, bv. `CNIP Website <website@cnip.be>` |
| `CONTACT_TO_EMAIL` | Ontvanger (standaard `christophe@cnip.be`) |

## Werkwijze

Niet rechtstreeks op `main` werken. Maak een branch, controleer de Vercel Preview en merge pas na review.
