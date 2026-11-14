// /* services/geolocation.service.js
//    BRD 12 — IP-based approximate location for demand analytics.
// */

// import axios from "axios";

// /**
//  * Get client IP from Express request.
//  */
// // export const getClientIp = (req) => {
// //   const forwarded = req.headers["x-forwarded-for"];
// //   if (forwarded) {
// //     return forwarded.split(",")[0].trim();
// //   }
// //   return req.ip || req.connection?.remoteAddress || null;
// // };

// export const getClientIp = (req) => {
//   // Render + Cloudflare: real client IP, client ise forge nahi kar sakta
//   const cfIp = req.headers["cf-connecting-ip"];
//   if (cfIp) return cfIp.trim();

//   // Fallback (local dev ya Cloudflare ke bagair): X-Forwarded-For
//   // Lekin dhyaan rahe, ye spoof ho sakta hai, production mein ispar depend na karein
//   const forwarded = req.headers["x-forwarded-for"];
//   if (forwarded) {
//     // Right se left ki taraf jayein, proxy IP ko skip karein
//     // Simple case mein, agar sirf ek proxy hai, to seedhe req.ip use karein
//     return forwarded.split(",")[0].trim();
//   }

//   return req.ip || req.connection?.remoteAddress || null;
// };

// /**
//  * Resolve IP to approximate location.
//  * Uses ipapi.co (free tier) — swap provider by editing this file only.
//  * Never throws — returns nulls on failure.
//  */
// export const resolveLocation = async (ip) => {
//   const empty = { country: null, state: null, city: null };
//   if (!ip) return empty;

//   // Skip private/local IPs in dev
//   if (
//     ip === "::1" ||
//     ip.startsWith("127.") ||
//     ip.startsWith("192.168.") ||
//     ip.startsWith("10.") ||
//     ip.startsWith("172.")
//   ) {
//     return empty;
//   }

//   try {
//     const apiKey = process.env.IPAPI_KEY;
//     const url = apiKey
//       ? `https://ipapi.co/${ip}/json/?key=${apiKey}`
//       : `https://ipapi.co/${ip}/json/`;

//     const { data } = await axios.get(url, { timeout: 3000 });

//     return {
//       country: data.country_name || null,
//       state: data.region || null,
//       city: data.city || null,
//     };
//   } catch (err) {
//     // Silent fail — location is best-effort, never block the request
//     console.error("Geo lookup failed:", err.message);
//     return empty;
//   }
// };

// /**
//  * Convenience: extract IP + resolve location in one call.
//  */
// export const captureLocation = async (req) => {
//   const ip = getClientIp(req);
//   const location = await resolveLocation(ip);
//   return { ip, location };
// };

/* services/geolocation.service.js */

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

export const resolveLocation = (ip) => {
  const empty = { country: null, state: null, city: null, timezone: null, coordinates: null, accuracyRadius: null };
  if (!ip) return empty;

  let cleanIp = ip;
  if (cleanIp.startsWith("::ffff:")) cleanIp = cleanIp.slice(7);

  // ... private IP check same rahega ...

  const geo = geoip.lookup(cleanIp);
  if (!geo) return empty;

  return {
    country: geo.country || null,
    state: geo.region || null,
    city: geo.city || null,
    timezone: geo.timezone || null,           // ✅ new
    coordinates: geo.ll || null,              // ✅ new: [latitude, longitude]
    accuracyRadius: geo.area || null,         // ✅ new: accuracy radius (km)
  };
};
/**
 * One-shot helper: get IP + resolved location from request.
 * Kabhi bhi throw nahi karta, always returns a valid shape.
 */
export const captureLocation = (req) => {
  const ip = getClientIp(req);
  const location = resolveLocation(ip);
  return { ip, location };
};