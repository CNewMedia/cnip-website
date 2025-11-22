# Dockerfile for CNIP.be on Fly.io
# Optimized for static site with GTM support

FROM nginx:alpine

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy website files
COPY . /app/public

# Create nginx user if not exists
RUN addgroup -g 1000 -S nginx 2>/dev/null || true
RUN adduser -u 1000 -D -S -G nginx nginx 2>/dev/null || true

# Set permissions
RUN chown -R nginx:nginx /app/public

# Expose port (Fly.io uses 8080 internally)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
