FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# Self-signed cert, baked into the image at build time so the app can serve
# HTTPS inside the ECS task without any secret material in the image itself
# (CN=localhost, 825 days - the LB terminates the public-facing cert; this
# one only covers the LB-to-task hop and is never presented to a browser).
# Generated here, not the final stage, so the openssl package doesn't end
# up in the runtime image - only the resulting cert/key files are copied.
RUN apk add --no-cache openssl && \
    mkdir -p /certs && \
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout /certs/tls.key -out /certs/tls.crt \
      -subj "/CN=localhost"

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /certs ./certs
COPY package.json ./
COPY src ./src
COPY migrations ./migrations

ENV NODE_ENV=production
ENV UPLOAD_PATH=/app/uploads
# Deliberately NOT setting TLS_CERT_PATH / TLS_KEY_PATH here even though the
# cert files exist at /app/certs - those two variables are set only in the
# ECS task definition. Without them, the app starts over plain HTTP, which
# is what `docker compose up` and local/no-AWS testing need.
RUN mkdir -p /app/uploads && chown -R app:app /app

USER app
EXPOSE 3000

# Protocol-aware: when TLS_CERT_PATH is set (HTTPS mode, see src/server.js),
# this checks over https with certificate validation off, since the baked-in
# cert is self-signed and only ever meant to satisfy an LB, not a browser.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require(process.env.TLS_CERT_PATH?'https':'http').get({host:'localhost',port:process.env.PORT||3000,path:'/healthz',rejectUnauthorized:false}, r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
