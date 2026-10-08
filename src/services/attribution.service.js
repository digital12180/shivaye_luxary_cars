/* services/attribute.service.js
   BRD 11.2 — Capture UTM, Google Ads, Meta IDs, landing page,
   first-touch and latest-touch attribution.
*/

const ALLOWED_SOURCES = [
  "google_ads",
  "facebook_ads",
  "instagram",
  "organic",
  "direct_website",
  "whatsapp",
  "phone",
  "walk_in",
  "referral",
  "manual",
  "other",
];

/**
 * Extract attribution from incoming request.
 * Frontend should send `attribution` in body OR utm_* keys in query,
 * OR we derive from referrer + user-agent as a fallback.
 */
export const extractAttribution = (req) => {
  const body = req.body?.attribution || {};
  const q = req.query || {};
  const headers = req.headers || {};

  const utmSource = body.utmSource || q.utm_source || null;
  const utmMedium = body.utmMedium || q.utm_medium || null;
  const utmCampaign = body.utmCampaign || q.utm_campaign || null;
  const utmTerm = body.utmTerm || q.utm_term || null;
  const utmContent = body.utmContent || q.utm_content || null;

  const gclid = body.gclid || q.gclid || null;      // Google Ads
  const fbclid = body.fbclid || q.fbclid || null;   // Meta

  const landingPage =
    body.landingPage || q.landing_page || headers.referer || null;

  const referrer = headers.referer || body.referrer || null;

  const now = new Date();

  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
    gclid,
    fbclid,
    landingPage,
    referrer,
    firstTouchSource: body.firstTouchSource || utmSource || deriveSourceFromReferrer(referrer),
    latestTouchSource: utmSource || deriveSourceFromReferrer(referrer),
    firstTouchAt: body.firstTouchAt ? new Date(body.firstTouchAt) : now,
    latestTouchAt: now,
  };
};

/**
 * Merge existing attribution (from customer) with new (from current request).
 * Keeps first-touch intact, updates latest-touch.
 */
export const mergeAttribution = (existing = {}, incoming = {}) => {
  return {
    utmSource: incoming.utmSource ?? existing.utmSource ?? null,
    utmMedium: incoming.utmMedium ?? existing.utmMedium ?? null,
    utmCampaign: incoming.utmCampaign ?? existing.utmCampaign ?? null,
    utmTerm: incoming.utmTerm ?? existing.utmTerm ?? null,
    utmContent: incoming.utmContent ?? existing.utmContent ?? null,
    gclid: incoming.gclid ?? existing.gclid ?? null,
    fbclid: incoming.fbclid ?? existing.fbclid ?? null,
    landingPage: existing.landingPage || incoming.landingPage || null,
    referrer: existing.referrer || incoming.referrer || null,
    firstTouchSource:
      existing.firstTouchSource || incoming.firstTouchSource || null,
    latestTouchSource: incoming.latestTouchSource || existing.latestTouchSource || null,
    firstTouchAt: existing.firstTouchAt || incoming.firstTouchAt || new Date(),
    latestTouchAt: new Date(),
  };
};

/**
 * Classify source from referrer URL when no UTM given.
 */
export const deriveSourceFromReferrer = (referrer) => {
  if (!referrer) return "direct_website";
  const r = referrer.toLowerCase();
  if (r.includes("google.")) return "google_ads";
  if (r.includes("facebook.")) return "facebook_ads";
  if (r.includes("instagram.")) return "instagram";
  if (r.includes("wa.me") || r.includes("whatsapp")) return "whatsapp";
  return "organic";
};

/**
 * Normalize a source string to our allowed enum.
 */
export const normalizeSource = (source) => {
  if (!source) return "direct_website";
  return ALLOWED_SOURCES.includes(source) ? source : "other";
};