# CNIP.be - Fly.io Deployment

Boutique marketing bureau website gehost op Fly.io met volledige GTM support.

## 📋 Vereisten

- [Fly.io account](https://fly.io/app/sign-up) (gratis tier beschikbaar)
- flyctl CLI geïnstalleerd
- Git (optioneel, voor version control)

## 🚀 Snelle Start

### 1. Installeer flyctl

**macOS/Linux:**
```bash
curl -L https://fly.io/install.sh | sh
```

**Windows (PowerShell):**
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

### 2. Login bij Fly.io

```bash
flyctl auth login
```

### 3. Deploy (Automatisch)

```bash
chmod +x deploy.sh
./deploy.sh
```

**Of manueel:**

```bash
# Eerste keer
flyctl launch --no-deploy

# Deploy
flyctl deploy

# Check status
flyctl status
```

## 🌐 Custom Domain Setup

### Stap 1: Voeg certificaten toe

```bash
flyctl certs create cnip.be
flyctl certs create www.cnip.be
```

### Stap 2: Update DNS records bij je domain registrar

Fly.io geeft je de DNS records na het aanmaken van certificaten.

**A Record:**
```
Type: A
Name: @ (of cnip.be)
Value: [IP van Fly.io]
TTL: 3600
```

**AAAA Record (IPv6):**
```
Type: AAAA
Name: @ (of cnip.be)
Value: [IPv6 van Fly.io]
TTL: 3600
```

**CNAME voor www:**
```
Type: CNAME
Name: www
Value: cnip-website.fly.dev
TTL: 3600
```

### Stap 3: Verifieer certificaten

```bash
flyctl certs show cnip.be
flyctl certs show www.cnip.be
```

Wacht tot status = "Ready" (kan 1-60 minuten duren).

## 📊 Handige Commands

```bash
# View logs (live)
flyctl logs

# View logs (history)
flyctl logs --past 1h

# Open dashboard
flyctl dashboard

# Check app status
flyctl status

# Scale app (indien nodig)
flyctl scale count 2

# SSH into container
flyctl ssh console

# Restart app
flyctl apps restart cnip-website

# Monitor app
flyctl monitor
```

## 🔧 Lokaal Testen (voor deployment)

```bash
# Build Docker image lokaal
docker build -t cnip-website .

# Run lokaal
docker run -p 8080:8080 cnip-website

# Open in browser
open http://localhost:8080
```

## 📁 Project Structuur

```
cnip-website/
├── Dockerfile          # Container configuratie
├── fly.toml           # Fly.io app configuratie
├── nginx.conf         # Nginx server configuratie (met GTM support!)
├── .dockerignore      # Files om uit te sluiten
├── deploy.sh          # Deployment script
├── README.md          # Deze file
├── index.html         # Homepage
├── gtm-test.html      # GTM debug pagina
└── images/            # Website afbeeldingen
    ├── Hof van Cleve.jpg
    ├── willems_2.jpg
    ├── christophecnip.png
    ├── Oryen_logo_v5112025.png
    ├── klanten/
    └── certificaten/
```

## 💰 Kosten Overzicht

**Fly.io Free Tier:**
- 3x shared-cpu-1x 256MB VMs
- 3GB persistent storage
- 160GB outbound data transfer

**Deze configuratie:**
- 1x shared-cpu-1x 256MB VM
- Minimale storage (~50MB)
- Verwacht: **€0-3/maand**

Als je meer traffic krijgt:
- **€5-10/maand** voor normale traffic
- **€15-20/maand** voor high traffic

## 🔍 GTM Verificatie

Na deployment, bezoek:
```
https://jouw-app.fly.dev/gtm-test.html
```

Je zou moeten zien:
- ✅ DataLayer Gevonden
- ✅ GTM Script Geladen
- ✅ GTM Container Actief

## 🆘 Troubleshooting

### App start niet

```bash
# Check logs
flyctl logs

# Check builds
flyctl builds list

# Rebuild
flyctl deploy --build-only
```

### DNS niet werkend

```bash
# Check certificates
flyctl certs list
flyctl certs show cnip.be

# Check DNS propagation
dig cnip.be
nslookup cnip.be
```

### GTM werkt niet

1. Check nginx.conf CSP headers
2. Test op gtm-test.html
3. Check browser console voor errors
4. Disable ad blockers

### Out of memory errors

```bash
# Increase memory
flyctl scale memory 512

# Check current scale
flyctl scale show
```

## 📈 Performance Optimalisatie

### Enable gzip compression
✅ Al enabled in nginx.conf

### Browser caching
✅ Al geconfigureerd in nginx.conf

### CDN
Optioneel: Voeg Cloudflare toe voor extra CDN (gratis tier beschikbaar)

## 🔐 Security

Security headers zijn geconfigureerd in nginx.conf:
- ✅ X-Frame-Options
- ✅ X-Content-Type-Options
- ✅ X-XSS-Protection
- ✅ Referrer-Policy
- ✅ Content-Security-Policy (GTM compatible!)

## 📞 Support

**Fly.io Docs:** https://fly.io/docs/
**Fly.io Community:** https://community.fly.io/
**CNIP Support:** info@cnip.be

## 🎯 Volgende Stappen

Na eerste deployment:

1. ✅ Setup custom domain (cnip.be)
2. ✅ Verifieer GTM werkt
3. ✅ Setup monitoring/alerts
4. ✅ Configure auto-scaling (indien nodig)
5. ✅ Backup strategy (Git is genoeg voor static site)

---

**Made with ❤️ by CNIP | Boutique Marketing Bureau Gent**
