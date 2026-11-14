
import geoip from "geoip-lite";

/**
 * Get real client IP from Express request.
 */
export const getClientIp = (req) => {
  if (!req) return null;

  const cfIp = req.headers?.["cf-connecting-ip"];
  if (cfIp && typeof cfIp === "string") return cfIp.trim();

  const forwarded = req.headers?.["x-forwarded-for"];
  if (forwarded && typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.connection?.remoteAddress || null;
};

/**
 * Resolve IP → location object.
 * Signature: resolveLocation(ip)  <-- SIRF IP leta hai, req nahi.
 */
export const resolveLocation = (ip) => {
  const empty = {
    country: null,
    state: null,
    city: null,
    timezone: null,
    coordinates: null,
    accuracyRadius: null,
    source: "none",
  };
  if (!ip) return empty;

  let cleanIp = ip;
  if (cleanIp.startsWith("::ffff:")) cleanIp = cleanIp.slice(7);

  // Skip private / loopback
  if (
    cleanIp === "::1" ||
    cleanIp === "127.0.0.1" ||
    cleanIp.startsWith("127.") ||
    cleanIp.startsWith("192.168.") ||
    cleanIp.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(cleanIp) ||
    cleanIp.startsWith("fc00:") ||
    cleanIp.startsWith("fe80:")
  ) {
    return empty;
  }

  const geo = geoip.lookup(cleanIp);
  if (!geo) return empty;

  return {
    country: geo.country || null,
    state: geo.region || null,
    city: geo.city || null,
    timezone: geo.timezone || null,
    coordinates: geo.ll || null,
    accuracyRadius: geo.area || null,
    source: "geoip-lite",
  };
};

/**
 * One-shot helper: request se IP + location.
 */
export const captureLocation = (req) => {
  const ip = getClientIp(req);
  const location = resolveLocation(ip);
  return { ip, location };
};