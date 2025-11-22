#!/bin/bash
# deploy.sh - Easy deployment script for CNIP.be on Fly.io

set -e  # Exit on error

echo "🚀 CNIP.be Deployment Script"
echo "=============================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
    echo -e "${RED}❌ flyctl is not installed${NC}"
    echo "Install it with: curl -L https://fly.io/install.sh | sh"
    exit 1
fi

echo -e "${GREEN}✓ flyctl found${NC}"

# Check if logged in
if ! flyctl auth whoami &> /dev/null; then
    echo -e "${YELLOW}⚠ Not logged in to Fly.io${NC}"
    echo "Logging in..."
    flyctl auth login
fi

echo -e "${GREEN}✓ Logged in to Fly.io${NC}"
echo ""

# Check if app exists
if flyctl status &> /dev/null; then
    echo -e "${YELLOW}📦 App already exists, deploying update...${NC}"
    flyctl deploy
else
    echo -e "${YELLOW}🆕 First time deployment, launching app...${NC}"
    flyctl launch --no-deploy
    echo ""
    echo -e "${GREEN}✓ App created${NC}"
    echo -e "${YELLOW}Now deploying...${NC}"
    flyctl deploy
fi

echo ""
echo -e "${GREEN}=============================="
echo "✅ Deployment complete!"
echo "==============================${NC}"
echo ""
echo "📊 App info:"
flyctl info
echo ""
echo "🌐 Your site is live at:"
flyctl status --json 2>/dev/null | grep -o '"hostname":"[^"]*"' | cut -d'"' -f4 | head -1 || echo "https://cnip-website.fly.dev"
echo ""
echo "📝 Next steps:"
echo "  1. Setup custom domain: flyctl certs create cnip.be"
echo "  2. Check logs: flyctl logs"
echo "  3. Monitor: flyctl dashboard"
echo ""
