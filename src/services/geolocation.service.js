
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

const EMPTY_LOCATION = {
  country: null,
  state: null,
  stateCode: null,
  city: null,
  timezone: null,
  coordinates: null,
  accuracyRadius: null,
  source: "none",
};

// Existing IP extraction
export const getClientIp = (req) => {
  if (!req) return null;

  const cfIp = req.headers?.["cf-connecting-ip"];

  if (typeof cfIp === "string" && cfIp.trim()) {
    return cfIp.trim();
  }

  const forwarded = req.headers?.["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
};

// Validate and normalize IP
const cleanIpAddress = (ip) => {
  if (!ip || typeof ip !== "string") return null;

  let cleanIp = ip.trim();

  if (cleanIp.startsWith("::ffff:")) {
    cleanIp = cleanIp.slice(7);
  }

  if (
    cleanIp === "::1" ||
    cleanIp === "127.0.0.1" ||
    cleanIp.startsWith("127.") ||
    cleanIp.startsWith("192.168.") ||
    cleanIp.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(cleanIp) ||
    cleanIp.startsWith("fc") ||
    cleanIp.startsWith("fe80:")
  ) {
    return null;
  }

  return cleanIp;
};

// Existing geoip-lite fallback
const getLocalLocation = (ip) => {
  const geo = geoip.lookup(ip);

  if (!geo) return EMPTY_LOCATION;

  return {
    country: geo.country || null,
    state: geo.region || null,
    stateCode: geo.region || null,
    city: geo.city || null,
    timezone: geo.timezone || null,
    coordinates: geo.ll || null,
    accuracyRadius: geo.area || null,
    source: "geoip-lite",
  };
};

// More detailed IP lookup
const getOnlineLocation = async (ip) => {
  const response = await fetch(
    `https://ipwho.is/${encodeURIComponent(ip)}`,
    {
      signal: AbortSignal.timeout(3000),
    }
  );

  if (!response.ok) {
    throw new Error(`IP API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error("IP geolocation lookup failed");
  }

  return {
    country: data.country_code || null,
    state: data.region || null,
    stateCode: data.region_code || null,
    city: data.city || null,
    timezone: data.timezone?.id || null,
    coordinates:
      data.latitude != null && data.longitude != null
        ? [data.latitude, data.longitude]
        : null,
    accuracyRadius: null,
    source: "ipwho.is",
  };
};

// Main resolver
export const resolveLocation = async (ip) => {
  const cleanIp = cleanIpAddress(ip);

  if (!cleanIp) return EMPTY_LOCATION;

  try {
    return await getOnlineLocation(cleanIp);
  } catch (error) {
    console.error("Online geolocation failed:", error.message);

    return getLocalLocation(cleanIp);
  }
};

// One-shot helper
export const captureLocation = async (req) => {
  const ip = getClientIp(req);

  const location = await resolveLocation(ip);

  return {
    ip,
    location,
  };
};
