FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations

ENV NODE_ENV=production
ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads && chown -R app:app /app

# Remove the package manager from the runtime image.
#
# Nothing here needs it: dependencies are installed in the deps stage above and
# copied in, the healthcheck runs node, and so does the entrypoint. What it does
# do is carry its own bundled dependencies into production, and one of them,
# node-tar 6.2.1, is the only CRITICAL this image reports (CVE-2026-59873, a
# gzip-bomb denial of service). The application never touches it.
#
# It is also simply good hygiene. A package manager in a production image is the
# first thing anyone who gets code execution would reach for.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx

# The nightly npm audit used to run inside this image and cannot any more. It now
# copies node_modules out and audits it in a throwaway node container, which
# still describes exactly what shipped. See maintenance.sh step 3.

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/healthz', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
