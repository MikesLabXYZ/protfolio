FROM node:22-alpine AS deps
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

# Amazon RDS's public global CA bundle, so the app can validate the RDS
# server certificate (DB_SSL_CA_PATH) instead of connecting with
# rejectUnauthorized: false. Free, public, ~200 KB, no runtime dependency -
# it's a static file copied into the final image below, same as the
# self-signed cert above. wget here is a build-time-only tool (this stage
# is never copied into the runtime image as a whole, only /certs is).
RUN apk add --no-cache wget && \
    wget -q -O /certs/rds-ca-bundle.pem \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

FROM node:22-alpine
WORKDIR /app
# Runs as the official image's own preexisting `node` user (uid=1000,
# gid=1000) rather than a custom one - creating a new user at uid 1000 fails
# outright ("addgroup: gid '1000' in use") because the base image already
# defines it. That uid is also not incidental here: it's the exact POSIX
# user/group the EFS access point mounting UPLOAD_PATH on AWS is configured
# with, and it must match this exact number or writes silently start failing.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /certs ./certs
COPY package.json ./
COPY src ./src
COPY migrations ./migrations

ENV NODE_ENV=production
ENV UPLOAD_PATH=/app/uploads
# Deliberately NOT setting TLS_CERT_PATH / TLS_KEY_PATH / DB_SSL_CA_PATH here
# even though /app/certs/tls.crt, tls.key, and rds-ca-bundle.pem all exist -
# all three are set only in the ECS task definition. Without them, the app
# starts over plain HTTP and connects to Postgres with no SSL config at all,
# which is what `docker compose up` and local/no-AWS testing need.
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node
EXPOSE 3000

# Protocol-aware: when TLS_CERT_PATH is set (HTTPS mode, see src/server.js),
# this checks over https with certificate validation off, since the baked-in
# cert is self-signed and only ever meant to satisfy an LB, not a browser.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require(process.env.TLS_CERT_PATH?'https':'http').get({host:'localhost',port:process.env.PORT||3000,path:'/healthz',rejectUnauthorized:false}, r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
