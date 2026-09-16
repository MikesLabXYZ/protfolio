// Everything a crawler or a link preview reads about this site, in one place.
//
// The templates take `seo` from res.locals (set by the middleware in
// server.js) and print it; nothing here renders HTML. Titles and descriptions
// are content and belong to whoever owns the copy: the ones below were written
// from the pages' own text on 2026-09-16 so that no page ships without one, and
// they are meant to be replaced line by line when the content review lands.
//
// PUBLIC_BASE_URL is the same optional variable the AWS deployment already
// reads; unset, the site is https://mdlabs.website.

const SITE_URL = (process.env.PUBLIC_BASE_URL || 'https://mdlabs.website').replace(/\/+$/, '');
const SITE_NAME = 'Michael Dagan';

// Who the site is about. `github` and `email` are null until the real values
// are known: the templates omit those links rather than point at a
// placeholder, which is what they did until 2026-09-16 (github.com/your-handle
// and you@example.com on every page).
const PERSON = {
  name: 'Michael Dagan',
  jobTitle: 'Cloud infrastructure and operations professional',
  locality: 'Tel Aviv District, Israel',
  linkedin: 'https://linkedin.com/in/michael-dagan',
  github: null,
  email: null,
};

const DEFAULT_IMAGE = '/static/og/og-default.png';

// Per page. `title` is the full document title; the home page leads with the
// name because that is the page a search for the name should land on, the
// others carry it as a suffix.
const PAGES = {
  '/': {
    title: 'Michael Dagan · Cloud infrastructure, security and technical operations',
    description: 'Michael Dagan: cloud infrastructure, security engineering and technical operations, based in Israel. Projects, experience and how to get in touch.',
    ogType: 'profile',
  },
  '/about': {
    title: 'About · Michael Dagan',
    description: 'How Michael Dagan got here: five years of hands-on operations and infrastructure across startups and nonprofits, now focused on cloud infrastructure and security.',
  },
  '/experience': {
    title: 'Experience · Michael Dagan',
    description: 'Michael Dagan\'s timeline: the Certified Network Defender program at Bar-Ilan University, technical operations lead at XP.NETWORK, and the setup of a regulated legal firm.',
  },
  '/projects': {
    title: 'Projects · Michael Dagan',
    description: 'Selected work by Michael Dagan: AWS architecture, infrastructure and operations projects, with the design decisions behind each.',
  },
  '/contact': {
    title: 'Contact · Michael Dagan',
    description: 'How to reach Michael Dagan.',
  },
};

// The static pages the sitemap lists. Project pages are added from the
// database at request time.
const STATIC_PATHS = ['/', '/about', '/experience', '/projects', '/contact'];

function absolute(path) {
  return SITE_URL + (path.startsWith('/') ? path : '/' + path);
}

// One canonical form: no query string, no trailing slash except the root.
function canonicalPath(reqPath) {
  const p = (reqPath || '/').split('?')[0].replace(/\/+$/, '');
  return p || '/';
}

function jsonLdPerson() {
  const sameAs = [PERSON.linkedin, PERSON.github].filter(Boolean);
  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: PERSON.name,
    url: SITE_URL + '/',
    jobTitle: PERSON.jobTitle,
    address: { '@type': 'PostalAddress', addressLocality: PERSON.locality },
    sameAs,
  };
  if (PERSON.email) person.email = 'mailto:' + PERSON.email;
  return person;
}

// What the head partial prints for a request. `extra` lets a route override
// any field (the project page passes its own title and summary).
function forRequest(reqPath, extra) {
  const path = canonicalPath(reqPath);
  const page = PAGES[path] || {};
  const seo = {
    siteName: SITE_NAME,
    title: page.title || (SITE_NAME),
    description: page.description || PAGES['/'].description,
    canonical: absolute(path),
    ogType: page.ogType || 'website',
    image: absolute(DEFAULT_IMAGE),
    imageAlt: 'Michael Dagan: cloud infrastructure, security engineering, technical operations',
    imageWidth: 1200,
    imageHeight: 630,
    noindex: false,
    jsonld: path === '/' ? jsonLdPerson() : null,
    person: PERSON,
  };
  return Object.assign(seo, extra || {});
}

function forProject(reqPath, project) {
  return forRequest(reqPath, {
    title: project.title + ' · ' + SITE_NAME,
    description: (project.summary || '').slice(0, 300),
    ogType: 'article',
  });
}

function forNotFound(reqPath) {
  return forRequest(reqPath, {
    title: 'Not found · ' + SITE_NAME,
    description: 'There is no page at this address.',
    noindex: true,
    canonical: absolute('/'),
  });
}

function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /healthz',
    '',
    'Sitemap: ' + absolute('/sitemap.xml'),
    '',
  ].join('\n');
}

// `projects` are rows with slug and created_at; the static pages carry no
// lastmod because nothing records when their copy last changed, and a made-up
// date is worse than none.
function sitemapXml(projects) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const urls = STATIC_PATHS.map((p) => '  <url><loc>' + esc(absolute(p)) + '</loc></url>');
  for (const p of projects || []) {
    const loc = absolute('/projects/' + encodeURIComponent(p.slug));
    const mod = p.created_at ? new Date(p.created_at).toISOString().slice(0, 10) : null;
    urls.push('  <url><loc>' + esc(loc) + '</loc>' + (mod ? '<lastmod>' + mod + '</lastmod>' : '') + '</url>');
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.join('\n') + '\n</urlset>\n';
}

module.exports = {
  SITE_URL, SITE_NAME, PERSON, PAGES, STATIC_PATHS,
  forRequest, forProject, forNotFound, robotsTxt, sitemapXml, canonicalPath,
};
