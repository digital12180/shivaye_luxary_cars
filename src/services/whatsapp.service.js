// services/whatsapp.service.js
import axios from "axios";

/* ============================================================
   BRD 13 — WhatsApp Business API
   Integration enabled only when the client provides the
   business account and template approvals.
   ============================================================ */
const WABA_TOKEN = process.env.WABA_TOKEN;
const WABA_PHONE_NUMBER_ID = process.env.WABA_PHONE_NUMBER_ID;
const WABA_API_VERSION = process.env.WABA_API_VERSION || "v19.0";
const WABA_BASE_URL = `https://graph.facebook.com/${WABA_API_VERSION}`;

/* ------------------------------------------------------------
   Enabled check
   ------------------------------------------------------------ */
export const isWhatsAppEnabled = () =>
    process.env.WHATSAPP_ENABLED === "true" &&
    Boolean(WABA_TOKEN) &&
    Boolean(WABA_PHONE_NUMBER_ID);

/* ------------------------------------------------------------
   Phone normalization → E.164 without "+"
   Handles India formats: 10-digit, +91XXXXXXXXXX, 91XXXXXXXXXX
   ------------------------------------------------------------ */
export const normalizePhone = (phone, defaultCountryCode = "91") => {
    if (!phone) return null;
    let digits = String(phone).replace(/\D/g, "");

    // 10-digit local number → prefix country code
    if (digits.length === 10) digits = `${defaultCountryCode}${digits}`;

    // 12-digit starting with 91 → already OK
    if (digits.length === 12 && digits.startsWith(defaultCountryCode)) {
        return digits;
    }

    // Otherwise return as-is (international)
    return digits;
};

/* ------------------------------------------------------------
   Build WABA template components from positional variables
   Input : { "1": "Rahul", "2": "RES-001" }
   Output: [{ type: "body", parameters: [{type:"text",text:"Rahul"}, ...] }]
   ------------------------------------------------------------ */
const buildTemplateComponents = (variables = {}) => {
    const keys = Object.keys(variables);
    if (!keys.length) return [];

    const params = keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => ({
            type: "text",
            text: String(variables[k] ?? ""),
        }));

    return [{ type: "body", parameters: params }];
};

/* ------------------------------------------------------------
   Send WhatsApp message — template or free text
   ------------------------------------------------------------ */
export const sendWhatsAppMessage = async ({
    to,
    templateName = null,
    language = "en",
    variables = {},
    body = null,
}) => {
    const phone = normalizePhone(to);
    if (!phone) throw new Error("Invalid WhatsApp recipient");

    /* ---- Stub mode (no WABA approval yet) ---- */
    if (!isWhatsAppEnabled()) {
        if (process.env.NODE_ENV !== "production") {
            console.log(
                `[WA-DISABLED] to=${phone} template=${templateName || "-"} body=${body || "-"}`
            );
        }
        return {
            id: `wa_stub_${Date.now()}`,
            success: true,
            provider: "internal",
            stub: true,
            response: { mode: "stub", phone, templateName },
        };
    }

    /* ---- Live mode: Meta WABA API ---- */
    const payload = templateName
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone,
            type: "template",
            template: {
                name: templateName,
                language: { code: language },
                components: buildTemplateComponents(variables),
            },
        }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: phone,
            type: "text",
            text: { preview_url: false, body: body || "" },
        };

    try {
        const res = await axios.post(
            `${WABA_BASE_URL}/${WABA_PHONE_NUMBER_ID}/messages`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${WABA_TOKEN}`,
                    "Content-Type": "application/json",
                },
                timeout: 10000,
            }
        );

        return {
            id: res.data?.messages?.[0]?.id || null,
            success: true,
            provider: "meta_waba",
            response: res.data,
        };
    } catch (err) {
        const apiError =
            err?.response?.data?.error?.message ||
            err?.response?.data?.error?.error_data?.details ||
            err.message;

        // Attach raw API response for audit
        const wrapped = new Error(`WABA send failed: ${apiError}`);
        wrapped.raw = err?.response?.data;
        throw wrapped;
    }
};

/* ------------------------------------------------------------
   BRD 13 — Vehicle-specific WhatsApp message builder
   ------------------------------------------------------------ */
export const buildVehicleWhatsAppMessage = (vehicle, dealerName = "SLC Motors") => {
    const vehicleLine = [
        vehicle?.brand,
        vehicle?.model,
        vehicle?.variant,
        vehicle?.year,
    ]
        .filter(Boolean)
        .join(" ");

    const stockLine = vehicle?.stockId ? `Stock ID: ${vehicle.stockId}` : "";
    const priceLine = vehicle?.price
        ? `Price: ₹${Number(vehicle.price).toLocaleString("en-IN")}`
        : "";

    return `Hi ${dealerName}, I'm interested in the ${vehicleLine} (${stockLine}). ${priceLine}. Please share more details.`.trim();
};

/* ------------------------------------------------------------
   BRD 13 — Click-to-chat URL (no API call)
   Used for the persistent WhatsApp CTA on the website.
   ------------------------------------------------------------ */
export const buildWhatsAppClickUrl = (phone, message = "") => {
    const digits = normalizePhone(phone);
    const text = message ? `?text=${encodeURIComponent(message)}` : "";
    return `https://wa.me/${digits}${text}`;
};

/* ------------------------------------------------------------
   Optional: parse inbound WABA webhook
   Returns { kind: "inbound" | "status", ... }
   ------------------------------------------------------------ */
export const parseWhatsAppWebhook = (body) => {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return null;

    /* Inbound message from user */
    if (value.messages?.length) {
        const msg = value.messages[0];
        return {
            kind: "inbound",
            from: msg.from,
            messageId: msg.id,
            text:
                msg.text?.body ||
                msg.button?.text ||
                msg.interactive?.button_reply?.title ||
                null,
            timestamp: msg.timestamp,
            contact: value.contacts?.[0] || null,
        };
    }

    /* Delivery / read status update */
    if (value.statuses?.length) {
        const st = value.statuses[0];
        return {
            kind: "status",
            messageId: st.id,
            status: st.status,              
            recipient: st.recipient_id,
            timestamp: st.timestamp,
            error: st.errors?.[0] || null,
        };
    }

    return null;
};