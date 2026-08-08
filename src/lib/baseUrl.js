// CloudFront sits in front of this app on AWS, so the Host header the app
// receives is not necessarily the public hostname. When PUBLIC_BASE_URL is
// set, it's treated as the source of truth for every absolute URL the app
// generates (canonical tags, Open Graph tags, absolute redirects). When
// unset, fall back to deriving it from the request, as before - this keeps
// local/no-AWS testing working without any extra configuration.
function resolveBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

function baseUrlMiddleware(req, res, next) {
  const baseUrl = resolveBaseUrl(req);
  res.locals.baseUrl = baseUrl;
  res.locals.canonicalUrl = baseUrl + req.path;
  next();
}

module.exports = { resolveBaseUrl, baseUrlMiddleware };
