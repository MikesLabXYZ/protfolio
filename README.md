# Portfolio

A small containerized Node/Express + PostgreSQL app.

This branch (`aws-deployment`) targets a production AWS deployment: ECS
Fargate, RDS PostgreSQL, EFS, and Secrets Manager, on `mdlabs.website` - see
**ARCHITECTURE.md** for the full picture. The app itself has no AWS-specific
code; every AWS integration (Secrets Manager, TLS, the public base URL) is
gated behind an environment variable and simply doesn't activate when that
variable is unset, so the same image also runs correctly with plain
`docker compose` and no AWS services reachable at all - see **Local
development** below.

## Local development

```bash
cp .env.example .env
docker compose up --build
docker compose exec app npm run migrate
```

Visit http://localhost:3000.

## Configuration

`PAGE_CACHE_MAX_AGE` (optional) - Cache-Control `max-age` in seconds on the
page routes (`/`, `/about`, `/experience`, `/projects`, `/projects/:slug`,
`/contact`). Unset by default, and unset means no Cache-Control header is
sent on those routes at all - see `.env.example` for why (in short: behind
CloudFront, that lets a CloudFront invalidation alone make a change appear,
instead of a cached header sitting in the viewer's own browser out of
CloudFront's reach). Set it to a positive number of seconds only if this app,
rather than CloudFront, should control the page cache lifetime. `/static/*`
is always cached for a year; `/healthz`, `/healthz/deep`, and the admin route
are always `no-store`, regardless of this setting.

## Structure

```
src/
  server.js        Express app, static/uploads mounts, /healthz
  db.js             pg Pool, config from env vars only
  routes/pages.js   page routes
  views/            EJS templates (partials/head, nav, footer + pages)
  public/css        stylesheet
  lib/uploads.js    resolves UPLOAD_PATH, served at /uploads - EFS mount point on AWS
migrations/         plain SQL, applied in filename order by src/migrate.js
```

## Content still needed

Search the templates for placeholders and fill in:

- `[Your Name]` - in `views/partials/head.ejs`, `nav.ejs`, `footer.ejs`, `index.ejs`
- Hero copy on the home page (`views/index.ejs`)
- `you@example.com`, LinkedIn/GitHub handles (`views/contact.ejs`)
- `public/uploads/resume.pdf` - not included yet, add your resume there
- Review `about.ejs` / `experience.ejs` copy - it's a draft pulled from your CV,
  edit it to sound like you

## AWS deployment (this branch)

This branch (`aws-deployment`) targets ECS Fargate + RDS + EFS + Secrets
Manager on `mdlabs.website`. See **ARCHITECTURE.md** for the full picture -
this README only covers running the image locally; that file is the single
source of truth for the AWS target itself.

## Scaling down after the course

Point `docker-compose.yml`'s `app` service at a real Postgres instance (the
`db` service already does this) and run `docker compose up -d` on any host
with Docker installed - no AWS-specific pieces are required for this path.
