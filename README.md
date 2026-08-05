# Portfolio

A small containerized Node/Express + PostgreSQL app. Designed to run unchanged
in two very different places:

1. **On AWS**, as the R&D two-tier application for the AWS Solutions Architect
   capstone (EC2 + RDS + EFS, behind the existing multi-account org).
2. **Self-hosted later**, via `docker-compose`, on a local machine or a small
   VPS (e.g. Vultr's $5/mo tier).

The app itself has no AWS-specific code. Everything AWS-specific (Secrets
Manager, EFS) lives in *how the container is started*, not in the app.

## Local development

```bash
cp .env.example .env
docker compose up --build
docker compose exec app npm run migrate
```

Visit http://localhost:3000.

## Structure

```
src/
  server.js        Express app, static/uploads mounts, /healthz
  db.js             pg Pool, config from env vars only
  routes/pages.js   page routes
  views/            EJS templates (partials/head, nav, footer + pages)
  public/css        stylesheet
  public/uploads    served at /uploads - EFS mount point on AWS
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

## AWS deployment notes

- **Config**: the app reads `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`, `UPLOAD_DIR`, `PORT` from the environment only - never
  hardcoded. On EC2, populate these at container start (e.g. an entrypoint
  script that calls Secrets Manager via the AWS CLI and exports the result as
  `docker run -e` flags) rather than baking them into the image.
- **DB**: point `DB_HOST`/etc. at the RDS endpoint instead of the `db`
  compose service. Same schema, same migrations.
- **Uploads**: mount EFS at the path given in `UPLOAD_DIR` on the EC2 host,
  then bind-mount that into the container at `/app/uploads`.
- **Health check**: `/healthz` (used above by the Docker `HEALTHCHECK`) is
  also what the ALB target group / Route 53 health check should hit.
- **Credential rotation**: since the app never caches the DB password outside
  a single container lifetime, Secrets Manager's native RDS rotation can run
  on its normal schedule - a rotation just means the next container
  start (or restart) picks up the new credentials.

## Scaling down after the course

Point `docker-compose.yml`'s `app` service at a real Postgres instance (the
`db` service already does this) and run `docker compose up -d` on any host
with Docker installed - no AWS-specific pieces are required for this path.
