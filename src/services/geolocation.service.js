
// import geoip from "geoip-lite";

// /**
//  * Get real client IP from Express request.
//  */
// export const getClientIp = (req) => {
//   if (!req) return null;

//   const cfIp = req.headers?.["cf-connecting-ip"];
//   if (cfIp && typeof cfIp === "string") return cfIp.trim();

//   const forwarded = req.headers?.["x-forwarded-for"];
//   if (forwarded && typeof forwarded === "string") {
//     return forwarded.split(",")[0].trim();
//   }

//   return req.ip || req.connection?.remoteAddress || null;
// };

// /**
//  * Resolve IP → location object.
//  * Signature: resolveLocation(ip)  <-- SIRF IP leta hai, req nahi.
//  */
// export const resolveLocation = (ip) => {
//   const empty = {
//     country: null,
//     state: null,
//     city: null,
//     timezone: null,
//     coordinates: null,
//     accuracyRadius: null,
//     source: "none",
//   };
//   if (!ip) return empty;

//   let cleanIp = ip;
//   if (cleanIp.startsWith("::ffff:")) cleanIp = cleanIp.slice(7);

//   // Skip private / loopback
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
//     timezone: geo.timezone || null,
//     coordinates: geo.ll || null,
//     accuracyRadius: geo.area || null,
//     source: "geoip-lite",
//   };
// };

// /**
//  * One-shot helper: request se IP + location.
//  */
// export const captureLocation = (req) => {
//   const ip = getClientIp(req);
//   const location = resolveLocation(ip);
//   return { ip, location };
// };


import geoip from "geoip-lite";
import { isIP } from "node:net";

const EMPTY_LOCATION = {
  country: null,
  state: null,
  district: null,
  city: null,
  zipcode: null,
  timezone: null,
  coordinates: null,
  accuracyRadius: null,
  confidence: null,
  source: "none",
};

// 1. Extract client IP
export const getClientIp = (req) => {
  if (!req) return null;

  // Trust this header only behind a trusted Cloudflare proxy
  const cfIp = req.headers?.["cf-connecting-ip"];

  if (typeof cfIp === "string" && cfIp.trim()) {
    return cfIp.trim();
  }

  // Only trust forwarded IP when proxy infrastructure is trusted
  const forwarded = req.headers?.["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
};

// 2. Normalize and validate IP
const normalizeIp = (ip) => {
  if (!ip || typeof ip !== "string") return null;

  let cleanIp = ip.trim();

  if (cleanIp.startsWith("::ffff:")) {
    cleanIp = cleanIp.slice(7);
  }

  if (!isIP(cleanIp)) return null;

  // IPv4 private and reserved ranges
  if (isIP(cleanIp) === 4) {
    const parts = cleanIp.split(".").map(Number);
    const [a, b] = parts;

    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return null;
    }
  }

  // IPv6 private, loopback and link-local
  if (isIP(cleanIp) === 6) {
    const lower = cleanIp.toLowerCase();

    if (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    ) {
      return null;
    }
  }

  return cleanIp;
};

// 3. Online IP geolocation
const getOnlineLocation = async (ip) => {


  console.log("Fetching online location for IP:", process.env.IPGEOLOCATION_API_KEY);

  
  const apiKey = process.env.IPGEOLOCATION_API_KEY;

  if (!apiKey) {
    throw new Error("IP geolocation API key missing");
  }

  const url = new URL(
    "https://api.ipgeolocation.io/v3/ipgeo"
  );

  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("ip", ip);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) {
    throw new Error(`Geolocation API failed: ${response.status}`);
  }

  const data = await response.json();
  const loc = data.location;

  if (!loc) {
    throw new Error("Location data unavailable");
  }

  return {
    country: loc.country_code2 || null,
    state: loc.state_prov || null,
    district: loc.district || null,
    city: loc.city || null,
    zipcode: loc.zipcode || null,
    timezone: data.time_zone?.name || null,

    coordinates:
      loc.latitude && loc.longitude
        ? [Number(loc.latitude), Number(loc.longitude)]
        : null,

    accuracyRadius: loc.accuracy_radius
      ? Number(loc.accuracy_radius)
      : null,

    confidence: loc.confidence || null,
    source: "ipgeolocation",
  };
};

// 4. Local geoip-lite fallback
const getLocalLocation = (ip) => {
  const geo = geoip.lookup(ip);

  if (!geo) return EMPTY_LOCATION;

  return {
    country: geo.country || null,
    state: geo.region || null,
    district: null,
    city: geo.city || null,
    zipcode: null,
    timezone: geo.timezone || null,
    coordinates: geo.ll || null,
    accuracyRadius: null,
    confidence: null,
    source: "geoip-lite",
  };
};

// 5. Main resolver
export const resolveLocation = async (ip) => {
  const cleanIp = normalizeIp(ip);

  if (!cleanIp) return EMPTY_LOCATION;

  try {
    return await getOnlineLocation(cleanIp);
  } catch (error) {
    console.error("IP location lookup failed:", error.message);

    return getLocalLocation(cleanIp);
  }
};

// 6. Request helper
export const captureLocation = async (req) => {
  const ip = getClientIp(req);

  const location = await resolveLocation(ip);

  return {
    ip,
    location,
  };
};
