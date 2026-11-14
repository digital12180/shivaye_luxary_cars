

import geoip from "geoip-lite";

/**
 * Get real client IP from Express request.
 * Render + Cloudflare: CF-Connecting-IP is the real client IP.
 */
export const getClientIp = (req) => {
  // 1. Cloudflare (Render ke aage) — sabse reliable
  const cfIp = req.headers["cf-connecting-ip"];
  if (cfIp && typeof cfIp === "string") return cfIp.trim();

  // 2. X-Forwarded-For fallback (local dev / non-Cloudflare)
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded && typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }

  // 3. Direct socket
  return req.ip || req.connection?.remoteAddress || null;
};

/**
 * Resolve IP → { country, state, city }
 * Uses local geoip-lite (no network, no rate limit).
 */
// export const resolveLocation = (ip) => {
//   const empty = { country: null, state: null, city: null };
//   if (!ip) return empty;

//   // Strip IPv6-mapped IPv4 prefix
//   let cleanIp = ip;
//   if (cleanIp.startsWith("::ffff:")) cleanIp = cleanIp.slice(7);

//   // Skip private/loopback
//   if (
//     cleanIp === "::1" ||
//     cleanIp === "127.0.0.1" ||
//     cleanIp.startsWith("127.") ||
//     cleanIp.startsWith("192.168.") ||
//     cleanIp.startsWith("10.") ||
//     /^172\.(1[6-9]|2\d|3[01])\./.test(cleanIp) ||
//     cleanIp.startsWith("fc00:") ||
//     cleanIp.startsWith("fe80:")
//   ) {
//     return empty;
//   }

//   const geo = geoip.lookup(cleanIp);
//   if (!geo) return empty;

//   return {
//     country: geo.country || null,
//     state: geo.region || null,
//     city: geo.city || null,
//   };
// };

// export const resolveLocation = (req) => {
//   if (req.cf?.country) {
//     return {
//       country: req.cf.country || null,
//       state: req.cf.region || null,
//       city: req.cf.city || null,
//       timezone: req.cf.timezone || null,
//       coordinates: req.cf.latitude && req.cf.longitude
//         ? [parseFloat(req.cf.latitude), parseFloat(req.cf.longitude)]
//         : null,
//       accuracyRadius: null,
//       source: 'cloudflare'
//     };
//   }

//   // Fallback: geoip-lite (sirf local dev ya non-CF ke liye)
//   const ip = getClientIp(req);
//   // ... aapka mojooda geoip-lite logic ...
// };
// /**
//  * One-shot helper: get IP + resolved location from request.
//  * Kabhi bhi throw nahi karta, always returns a valid shape.
//  */
// export const captureLocation = (req) => {
//   const ip = getClientIp(req);
//   const location = resolveLocation(ip);
//   return { ip, location };
// };


export const resolveLocation = (req, ip) => {
  // 1. Cloudflare data (sabse accurate, free)
  if (req?.cf?.country) {
    return {
      country: req.cf.country || null,
      state: req.cf.region || null,
      city: req.cf.city || null,
      timezone: req.cf.timezone || null,
      coordinates:
        req.cf.latitude && req.cf.longitude
          ? [parseFloat(req.cf.latitude), parseFloat(req.cf.longitude)]
          : null,
      accuracyRadius: null,
      source: "cloudflare",
    };
  }

  // 2. Fallback: geoip-lite (local dev / non-CF)
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

  // Private / loopback skip
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

export const captureLocation = (req) => {
  const ip = getClientIp(req);
  const location = resolveLocation(req, ip);
  return { ip, location };
};