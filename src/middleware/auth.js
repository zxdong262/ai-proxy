/**
 * Authentication middleware.
 *
 * The Anthropic CLI sends requests with:
 *   Authorization: Bearer <ANTHROPIC_AUTH_TOKEN>
 *
 * When the service has an api_key configured: accepts any bearer token from the
 * client, and uses the service's api_key to authenticate with the upstream.
 *
 * When the service has no api_key (passthrough mode): forwards the client's
 * Authorization header directly to the upstream remote service.
 */

export function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ error: 'Invalid Authorization format. Expected "Bearer <token>"' });
  }

  // When the service has no api_key configured, store the client's token for passthrough.
  const serviceConfig = req._serviceConfig;
  if (!serviceConfig || !serviceConfig.api_key) {
    req._passthroughToken = token;
  }

  next();
}
