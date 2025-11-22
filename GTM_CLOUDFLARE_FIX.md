# Google Tag Manager - Cloudflare Fix

## Probleem
`ERR_NAME_NOT_RESOLVED` betekent dat `googletagmanager.com` niet kan worden bereikt. Dit wordt meestal veroorzaakt door Cloudflare WAF of firewall regels.

## Oplossing in Cloudflare Dashboard

### Stap 1: WAF (Web Application Firewall) Controleren
1. Ga naar **Security** → **WAF**
2. Controleer **Custom Rules** en **Managed Rules**
3. Zoek naar regels die `googletagmanager.com` blokkeren
4. Voeg een **Allow Rule** toe voor:
   - Domain: `www.googletagmanager.com`
   - Path: `/gtm.js`

### Stap 2: Firewall Rules Controleren
1. Ga naar **Security** → **Firewall Rules**
2. Controleer of er regels zijn die externe scripts blokkeren
3. Voeg een uitzondering toe voor `googletagmanager.com`

### Stap 3: Page Rules (Optioneel)
1. Ga naar **Rules** → **Page Rules**
2. Maak een nieuwe rule voor `*googletagmanager.com*`
3. Settings:
   - **Security Level**: Medium
   - **Disable Security**: OFF
   - **Cache Level**: Bypass (voor GTM scripts)

### Stap 4: DNS Settings Controleren
1. Ga naar **DNS** → **Records**
2. Zorg dat je site **Proxied** (oranje wolk) is
3. Test DNS resolutie: `nslookup www.googletagmanager.com`

### Stap 5: SSL/TLS Settings
1. Ga naar **SSL/TLS** → **Overview**
2. Zet op **Full (strict)** of **Full**
3. Zorg dat **Always Use HTTPS** aan staat

### Stap 6: Speed → Optimization
1. Ga naar **Speed** → **Optimization**
2. **JavaScript Minification**: Zet UIT (kan GTM verstoren)
3. **Rocket Loader**: Zet UIT (kan GTM verstoren)

## Testen

### Browser Console Test
Open Developer Tools (F12) en voer uit:
```javascript
// Test 1: Check dataLayer
console.log('DataLayer:', window.dataLayer);

// Test 2: Check if GTM script loaded
console.log('GTM Script:', document.querySelector('script[src*="googletagmanager.com"]'));

// Test 3: Manual DNS test
fetch('https://www.googletagmanager.com/gtm.js?id=GTM-M3QJK6VR')
  .then(r => console.log('✅ GTM reachable'))
  .catch(e => console.error('❌ GTM blocked:', e));
```

### Network Tab Test
1. Open Developer Tools → **Network** tab
2. Refresh pagina
3. Zoek naar `gtm.js`
4. Check status:
   - ✅ **200**: GTM laadt correct
   - ❌ **ERR_NAME_NOT_RESOLVED**: DNS/Firewall blokkade
   - ❌ **403/404**: WAF blokkade

## Alternatieve Oplossing: Direct IP (Niet Aanbevolen)
Als bovenstaande niet werkt, kan je tijdelijk GTM via IP gebruiken (niet aanbevolen voor productie):

```html
<!-- Tijdelijk: gebruik IP in plaats van domain -->
<script src="https://216.239.36.21/gtm.js?id=GTM-M3QJK6VR"></script>
```

**Let op**: IP's kunnen veranderen, gebruik dit alleen voor testen!

## Contact Cloudflare Support
Als niets werkt:
1. Open ticket bij Cloudflare Support
2. Vraag om `www.googletagmanager.com` toe te voegen aan whitelist
3. Vermeld dat je Google Tag Manager gebruikt voor analytics

## Verificatie
Na fixes, test GTM Preview Mode opnieuw:
1. Ga naar tagmanager.google.com
2. Klik **Preview**
3. Voer `https://cnip.be` in
4. Check of GTM wordt gedetecteerd

