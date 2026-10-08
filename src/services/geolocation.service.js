/* services/geolocation.service.js
   BRD 12 — IP-based approximate location for demand analytics.
*/

import axios from "axios";

/**
 * Get client IP from Express request.
 */
export const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || null;
};

/**
 * Resolve IP to approximate location.
 * Uses ipapi.co (free tier) — swap provider by editing this file only.
 * Never throws — returns nulls on failure.
 */
export const resolveLocation = async (ip) => {
  const empty = { country: null, state: null, city: null };
  if (!ip) return empty;

  // Skip private/local IPs in dev
  if (
    ip === "::1" ||
    ip.startsWith("127.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    ip.startsWith("172.")
  ) {
    return empty;
  }

  try {
    const apiKey = process.env.IPAPI_KEY;
    const url = apiKey
      ? `https://ipapi.co/${ip}/json/?key=${apiKey}`
      : `https://ipapi.co/${ip}/json/`;

    const { data } = await axios.get(url, { timeout: 3000 });

    return {
      country: data.country_name || null,
      state: data.region || null,
      city: data.city || null,
    };
  } catch (err) {
    // Silent fail — location is best-effort, never block the request
    console.error("Geo lookup failed:", err.message);
    return empty;
  }
};

/**
 * Convenience: extract IP + resolve location in one call.
 */
export const captureLocation = async (req) => {
  const ip = getClientIp(req);
  const location = await resolveLocation(ip);
  return { ip, location };
};