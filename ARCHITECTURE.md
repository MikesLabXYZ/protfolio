# Portfolio site — architecture overview (`aws-deployment` branch)

**What this is:** Michael Dagan's personal portfolio, a Node/Express/PostgreSQL web app. This branch is a separate, long-lived deployment target from `main`: it runs on AWS (ECS Fargate, RDS, EFS, Secrets Manager) on `mdlabs.website`, and does not describe or depend on any other hosting arrangement. `main` continues to run its own, separate deployment and is untouched by this branch.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS (Alpine) | No framework beyond Express. Alpine specifically (not a slim/distroless variant) - its bundled BusyBox `wget` is what the ECS task definition's own health check invokes directly, separately from the Dockerfile's `HEALTHCHECK` instruction |
| Web framework | Express 4 | Server-rendered, no API/SPA split |
| Templating | EJS | Server-rendered HTML, no client framework |
| Database | PostgreSQL | Via `pg` driver, raw parameterized SQL, no ORM |
| Credentials | AWS Secrets Manager (optional) | `@aws-sdk/client-secrets-manager`, only touched when `DB_SECRET_ARN` is set |
| Uploads | `multer` (memory storage) | Admin-only image upload route, gated behind a shared-secret token |
| Frontend JS | Vanilla JS | No bundler, no framework |
| CSS | Hand-written | Custom design system via CSS custom properties |
| Fonts | IBM Plex Sans (variable) + IBM Plex Mono | Self-hosted `.woff2` |
| Security middleware | Helmet, express-rate-limit | Full CSP (no `unsafe-inline`), HSTS, rate limiting |
| Containerization | Docker (multi-stage, non-root) | Same image runs locally and in ECS |

## Project structure

```
protfolio/
  src/
    server.js           Express app, TLS-conditional server, health checks, graceful shutdown
    db.js                Credential resolution (env or Secrets Manager), primary + read pools,
                         automatic rebuild-and-retry on credential rotation
    migrate.js           Applies migrations/*.sql in order
    lib/
      baseUrl.js          Resolves PUBLIC_BASE_URL (or derives from the request) for
                         canonical/Open Graph tags
      uploads.js          Resolves UPLOAD_PATH, startup writability check
    routes/
      pages.js            Public page routes (reads use the read pool)
      admin.js             Admin image upload route - module exports null, and is never
                         mounted, unless ADMIN_UPLOAD_TOKEN is set
    views/                EJS templates
    public/               Static assets: css/, js/, icons/, fonts/
  migrations/
    001_init.sql          projects table
    002_seed.sql          Seed content
    003_project_images.sql  Adds nullable image_filename to projects (idempotent)
  Dockerfile               Multi-stage; bakes a self-signed TLS cert at build time
  docker-compose.yml       app + db services for local/no-AWS testing
```

## Data model

Table `projects` (Postgres):

```sql
id, slug (unique), title, summary, description, tags (text[]),
is_draft (bool, default true), sort_order, created_at, image_filename (nullable)
```

- About/Experience/Contact pages: static content in EJS templates.
- Projects page: DB-driven, read via the read-replica pool when configured. `image_filename` is set by the admin upload route and rendered on the projects list/detail pages when present.

## Routes

`/`, `/about`, `/experience`, `/projects`, `/projects/:slug`, `/contact`, `/healthz`, `/healthz/deep`, and (only when `ADMIN_UPLOAD_TOKEN` is set) `POST /admin/projects/:slug/image`.

## Database credentials and rotation

`src/db.js` resolves credentials one of two ways:

- **`DB_SECRET_ARN` set** — username/password are fetched from that Secrets Manager secret at startup and cached in memory. Host, port, and database name still come from `DB_HOST`/`DB_PORT`/`DB_NAME` regardless.
- **`DB_SECRET_ARN` unset** — username/password come from `DB_USER`/`DB_PASSWORD`. The AWS SDK module is never `require`d and no AWS call is ever attempted in this path — this is what makes local/no-AWS testing work.

If a query fails with Postgres error `28P01` (`invalid_password` — the credential Secrets Manager just rotated out from under a running task), the app re-fetches the secret, rebuilds both connection pools, and retries that one query exactly once. This is what lets Secrets Manager's automatic RDS credential rotation happen without an application redeploy.

## Read/write split

If `DB_HOST_RO` is set, a second pool is created against it and used for read-only routes (project list, project detail). Writes and migrations always use the primary pool (`DB_HOST`). If `DB_HOST_RO` is unset, both point at the primary — no separate connection pool is created, so there's no behavior difference locally.

## RDS server certificate validation

RDS requires SSL and rejects a plaintext connection outright. Two real deployment failures, in sequence, drove this design:

1. **No SSL configured at all** →
   ```
   no pg_hba.conf entry for host "...", user "postgres", database "portfolio", no encryption
   ```
   RDS's `pg_hba.conf` has no rule that permits an unencrypted connection, full stop.

2. **SSL turned on but unverified** (e.g. via an external `PGSSLMODE=require`, without supplying a CA) →
   ```
   Error: self-signed certificate in certificate chain
   code: 'SELF_SIGNED_CERT_IN_CHAIN'
   ```
   Node's default trusted CA bundle doesn't include Amazon's RDS certificate authority, so any RSA cert RDS presents looks "self-signed" to it even though it's legitimately signed by Amazon's own CA. `PGSSLMODE=no-verify` "fixes" this by disabling certificate validation entirely — encrypted, but not authenticated, which is not an acceptable permanent state.

**Neither error message names SSL configuration as its cause** — the first looks like a plain auth/network issue, the second looks like a cert-authority problem unrelated to how the connection was configured. `DB_SSL_CA_PATH` is the single setting that resolves both, in order: setting it turns SSL on (fixing error 1) **and** gives node-postgres a CA bundle to validate the server certificate against, `rejectUnauthorized: true` (fixing error 2, properly, instead of via `no-verify`).

Implementation (`src/db.js`):

- The Dockerfile downloads Amazon's public RDS global CA bundle (`https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`, ~200 KB, free, no runtime dependency) to `/app/certs/rds-ca-bundle.pem` at build time — the same pattern already used for the self-signed LB-to-task cert.
- When `DB_SSL_CA_PATH` is set, `makePool()` builds `ssl: { rejectUnauthorized: true, ca: fs.readFileSync(process.env.DB_SSL_CA_PATH) }`.
- When unset, no `ssl` key is added to the pg config **at all** (not even `ssl: undefined`) — this preserves node-postgres's own existing behavior of falling back to whatever `PGSSLMODE` happens to be set in the environment, so nothing changes for local docker-compose testing against a plain, non-TLS Postgres container.
- `src/migrate.js` never builds its own `pg` connection — it only ever calls into `db.js`'s `init()`/`getPool()`, so migrations and the running app are structurally guaranteed to use identical connection configuration, including this SSL setting. They can't drift independently.
- If the path is set but unreadable, the app throws a clear error naming `DB_SSL_CA_PATH`, the path, and the expected Dockerfile-written location — not a bare `ENOENT`.

## TLS inside the container

If `TLS_CERT_PATH` and `TLS_KEY_PATH` are both set, `server.js` starts an `https` server; otherwise plain `http`. The Docker image bakes a self-signed certificate at build time (`openssl`, `CN=localhost`, 825 days) into `/app/certs/tls.crt` and `/app/certs/tls.key` — exactly the paths these two variables should point to — but does **not** set either environment variable as an image default — they're set only in the ECS task definition. The load balancer terminates the public-facing TLS certificate; this one only covers the LB-to-task hop and is never presented to a browser.

If either variable is set but the file at that path can't be read, startup no longer produces a raw `ENOENT` stack trace (previously indistinguishable in a log aggregator from any other crash, with the orchestrator reporting nothing more than "essential container exited"). It logs, then exits deliberately: which environment variable, the exact path it resolved to, and a directory listing of that path's parent — e.g. `TLS_CERT_PATH` pointed at `/app/certs/server.crt` (a typo for `/app/certs/tls.crt`) now logs that the file wasn't found *and* that the parent directory actually contains `tls.crt, tls.key, rds-ca-bundle.pem`.

## Public base URL

`PUBLIC_BASE_URL`, when set, is the origin used for every absolute URL the app generates (canonical `<link>` tags, Open Graph tags, and any future absolute redirect). This exists because CloudFront sits in front of the application, so the `Host` header the app receives is not necessarily the public hostname. When unset, the origin is derived from the request instead (`req.protocol` + `req.get('host')`), which is what local testing uses. The domain itself is never hardcoded anywhere in application code — it only ever comes from this variable.

## Admin image uploads

`POST /admin/projects/:slug/image`, protected by a bearer token compared against `ADMIN_UPLOAD_TOKEN` using a constant-time comparison. If `ADMIN_UPLOAD_TOKEN` is unset, `src/routes/admin.js` exports `null` and the route is never registered — not merely unauthenticated, structurally absent.

- Separate, much tighter rate limit than the page-route limiter (10 requests / 15 minutes vs. 500 / 5 minutes).
- Accepts JPEG/PNG/WebP only, up to 2 MB, validated via `multer`'s file filter and size limit.
- The filename is always server-generated (`crypto.randomUUID()` + an extension derived from the validated MIME type) — the client-supplied filename is never read or used anywhere, so there is no path-traversal surface.
- Files are served back out via the same static route (`/uploads`) as any other upload; since that's same-origin, the CSP's `img-src 'self'` already covers them without any CSP changes.

## Upload directory robustness

At startup, if `UPLOAD_PATH` doesn't exist, it's created (`mkdir -p`-equivalent). If it exists but isn't writable, the app logs the exact path and effective uid and continues serving existing files read-only rather than crashing — uploads are rejected (503) until the underlying permissions issue is fixed. The app never calls `chown`/`chmod` on this directory at runtime: on AWS it's an EFS mount governed by an access point with a fixed POSIX uid/gid, and fighting that at runtime would simply fail.

The container runs as the official `node:22-alpine` image's own built-in `node` user, `uid=1000, gid=1000` — not a custom user (creating one at uid 1000 fails outright, since the base image already defines it there) and not Alpine's auto-assigned default for a freshly created user either, which isn't guaranteed stable across a base image update. The EFS access point's "POSIX user" must be configured with this exact uid/gid, or writes fail silently from the access point's side.

## Health checks

- **`/healthz`** — always returns 200 without touching the database. This is what the ALB target group / ECS task health check hits. A database blip must not cause every healthy task to be killed and replaced simultaneously.
- **`/healthz/deep`** — actually queries the database (`SELECT 1`) and returns 503 if it's unreachable. For manual/diagnostic use, not for the load balancer.

## Cache-Control headers

Headers set:

| Route(s) | Header | Why |
|---|---|---|
| `/static/*` | `public, max-age=31536000, immutable` | Safe to cache for a year: these assets are versioned by deploy, not by filename |
| `/`, `/about`, `/experience`, `/projects`, `/projects/:slug`, `/contact` | none, by default | Behind CloudFront's `CachingOptimized` policy, an origin `Cache-Control` header is honoured at the edge **and** forwarded to the viewer's browser, where a CloudFront invalidation can't reach it. With no header, CloudFront applies its own policy default at the edge and sends nothing to the viewer, so an invalidation alone is enough. `PAGE_CACHE_MAX_AGE` (optional, advanced) overrides this with `public, max-age=<n>` for a reader who wants app-level control instead — any other value (unset, empty, `0`, `off` = no header either way; anything non-numeric or non-positive) fails fast at startup with a named error rather than being silently ignored |
| `/healthz`, `/healthz/deep` | `no-store` | A CDN or intermediary caching a stale "ok" would defeat the entire point of a health check |
| `POST /admin/projects/:slug/image` | `no-store` | Dynamic, auth-gated, never cacheable |

`/uploads/*` intentionally carries no explicit header (unchanged) — not in scope for this change.

## Docker build command

The documented build command is:

```bash
docker build --platform linux/amd64 --provenance=false --sbom=false -t lovely-portfolio:TAG .
```

(`npm run docker:build` runs the same command with a fixed local tag, for a quick local build.)

- **`--platform linux/amd64`** — the container platform runs x86_64. Building on an ARM machine (e.g. Apple Silicon) without this flag produces an image that pulls successfully but fails at container start with `exec format error`.
- **`--provenance=false --sbom=false`** — BuildKit attaches provenance and SBOM attestations by default, so a single `docker build` produces *three* entries in the registry per tag: the OCI image index, the actual image manifest, and a near-empty attestation manifest. Since the registry here uses immutable tags, those extra manifests accumulate and make the repository harder to read for no operational benefit in this deployment. Disabling both keeps one tag → one manifest.

## Graceful shutdown

On `SIGTERM` (which ECS sends before stopping a task, both on deploys and scale-in), the app stops accepting new connections, lets in-flight requests finish, drains both PostgreSQL pools, then exits — with a 25-second hard-exit safety net in case something hangs. Without this, deployments and scale-in events would drop live requests.

## Security posture

Audited with OWASP ZAP (spider + active scan): 0 High / 0 Medium / 0 Low. Carried forward unchanged onto this branch:

- Full CSP via Helmet: `default-src 'self'`, `script-src 'self'`, `style-src 'self'` (no `unsafe-inline` anywhere), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- HSTS, `X-Content-Type-Options: nosniff`, hidden `X-Powered-By`, and Helmet's other standard defaults.
- Rate limiting: 500 requests / 5 minutes per IP on page routes (matches AWS WAF's own published blanket-rule guidance for general website traffic), plus a separate, far tighter limit on the admin upload route.
- `trust proxy` set to `2` — CloudFront *and* the internal ALB are both in front of the app, so `req.ip` has to skip two hops of `X-Forwarded-For` to reach the real client IP. Set to `1` (a single hop), every client would resolve to CloudFront's own IP, silently collapsing the per-IP rate limiter onto one shared bucket.
- Global error handler: full error logged server-side, only a generic message ever reaches the client.
- Parameterized SQL throughout, on both the primary and read pools.
- Docker container runs as a non-root user; `.dockerignore` keeps `.env`/`node_modules`/`.git` out of any build context.
- Fonts and all static assets are self-hosted — no third-party runtime dependencies to add to the CSP allowlist.

## AWS deployment target

This branch runs as:

- **Compute**: ECS Fargate tasks, behind an **internal** Application Load Balancer. The ALB is not itself internet-facing.
- **Edge**: CloudFront sits in front of the internal ALB and is the actual public entry point for `mdlabs.website` — this is why `PUBLIC_BASE_URL` exists (the app never sees the public `Host` header directly) and why `trust proxy` is `2`, not `1` — two proxy hops (CloudFront, then the ALB) sit between the client and the app.
- **Database**: RDS PostgreSQL, with a read replica — the app's `DB_HOST_RO` support is what lets read-heavy page routes (project list/detail) offload onto it.
- **Credentials**: AWS Secrets Manager, with automatic rotation. The app's retry-on-`28P01` logic is what makes rotation transparent — no task restart or redeploy required when a rotation happens.
- **File storage**: EFS, mounted via an access point with a fixed POSIX uid/gid, for `UPLOAD_PATH` (project images uploaded via the admin route).
- **Network egress**: interface VPC endpoints for the AWS services the tasks talk to (Secrets Manager, ECR, CloudWatch Logs, etc.), so tasks reach those services without leaving the AWS network — no NAT gateway or public internet path required for that traffic.
- **TLS**: CloudFront/ALB terminate the public certificate; the ECS task definition sets `TLS_CERT_PATH`/`TLS_KEY_PATH` to the image's baked-in self-signed certificate for the LB-to-task hop.

## Running the image locally for testing

The same image is smoke-tested locally, with no AWS services reachable, before being pushed to ECR:

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec app npm run migrate
curl http://localhost:8081/healthz
```

Leave every AWS-specific variable unset for this: `DB_SECRET_ARN`, `DB_HOST_RO`, `DB_SSL_CA_PATH`, `TLS_CERT_PATH`, `TLS_KEY_PATH`, `PUBLIC_BASE_URL`, `ADMIN_UPLOAD_TOKEN`. With all of those unset, the app uses plain env-var DB credentials, a single pool with no `ssl` config at all, plain HTTP, a request-derived origin, and doesn't register the admin upload route at all — no AWS SDK call is ever attempted, and `docker compose up` behaves exactly as it did before this branch existed. `PAGE_CACHE_MAX_AGE` isn't AWS-specific and is left unset either way, which is also its default — see [Cache-Control headers](#cache-control-headers).

## Node.js version

The base image is `node:22-alpine` (bumped from 20). Reason: the AWS SDK for JavaScript v3 (used for Secrets Manager) emits a startup warning that versions published after the first week of January 2027 will require Node 22+ — noisy in every log stream and worth getting ahead of. At the time of that bump there was no `test` script or test suite in this repo to run as part of it; verification instead relied on the same docker-compose smoke test documented above (build, migrate, `/healthz`) plus confirming `npm install --omit=dev` completes cleanly under Node 22 during the image build. No dependency in `package.json` was found to be incompatible with Node 22. `npm test` (`node --test`, no dependency added — Node 22+'s own built-in test runner) now also exists, covering the page-cache behaviour below; it isn't part of the image build, just a local/CI check.
