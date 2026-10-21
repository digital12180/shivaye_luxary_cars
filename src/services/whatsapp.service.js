import axios from "axios";
import WhatsAppMessage from "../models/Whatsapp.js";

const WABA_TOKEN = process.env.WABA_TOKEN;
const WABA_PHONE_NUMBER_ID = process.env.WABA_PHONE_NUMBER_ID;
const WABA_API_VERSION = process.env.WABA_API_VERSION || "v19.0";
const WABA_BASE_URL = `https://graph.facebook.com/${WABA_API_VERSION}`;

export const isWhatsAppEnabled = () =>
    process.env.WHATSAPP_ENABLED === "true" &&
    Boolean(WABA_TOKEN) &&
    Boolean(WABA_PHONE_NUMBER_ID);

export const normalizePhone = (phone, defaultCountryCode = "91") => {
    if (!phone) return null;
    let digits = String(phone).replace(/\D/g, "");
    if (digits.length === 10) digits = `${defaultCountryCode}${digits}`;
    if (digits.length === 12 && digits.startsWith(defaultCountryCode)) return digits;
    return digits;
};

const buildTemplateComponents = (variables = {}) => {
    const keys = Object.keys(variables);
    if (!keys.length) return [];
    const params = keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => ({ type: "text", text: String(variables[k] ?? "") }));
    return [{ type: "body", parameters: params }];
};

/* ============================================================
   MAIN SEND — ab DB mein bhi save karega
   ============================================================ */
export const sendWhatsAppMessage = async ({
    to,
    templateName = null,
    language = "en",
    variables = {},
    body = null,
    relatedTo = null,          // NEW: optional link (Lead/User/Vehicle)
}) => {
    const phone = normalizePhone(to);
    if (!phone) throw new Error("Invalid WhatsApp recipient");

    // 1️⃣ Pehle DB mein "queued" record bana dein
    const record = await WhatsAppMessage.create({
        direction: "outbound",
        type: templateName ? "template" : "text",
        phone,
        templateName,
        language,
        variables,
        body,
        relatedTo,
        status: "queued",
    });

    /* ---- Stub mode ---- */
    if (!isWhatsAppEnabled()) {
        if (process.env.NODE_ENV !== "production") {
            console.log(
                `[WA-DISABLED] to=${phone} template=${templateName || "-"} body=${body || "-"}`
            );
        }
        record.status = "sent";
        record.providerResponse = { mode: "stub", phone, templateName };
        record.statusHistory.push({ status: "sent" });
        await record.save();

        return {
            id: `wa_stub_${Date.now()}`,
            success: true,
            provider: "internal",
            stub: true,
            dbId: record._id,
            response: { mode: "stub", phone, templateName },
        };
    }

    /* ---- Live mode ---- */
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

        const waMessageId = res.data?.messages?.[0]?.id || null;

        // 2️⃣ Success → DB update
        record.waMessageId = waMessageId;
        record.status = "sent";
        record.providerResponse = res.data;
        record.statusHistory.push({ status: "sent" });
        await record.save();

        return {
            id: waMessageId,
            success: true,
            provider: "meta_waba",
            dbId: record._id,
            response: res.data,
        };
    } catch (err) {
        const apiError =
            err?.response?.data?.error?.message ||
            err?.response?.data?.error?.error_data?.details ||
            err.message;

        // 3️⃣ Failure → DB update
        record.status = "failed";
        record.error = { message: apiError, raw: err?.response?.data };
        record.statusHistory.push({ status: "failed" });
        await record.save();

        const wrapped = new Error(`WABA send failed: ${apiError}`);
        wrapped.raw = err?.response?.data;
        wrapped.dbId = record._id;
        throw wrapped;
    }
};

/* ============================================================
   WEBHOOK PARSER — ab DB mein inbound/status save karega
   ============================================================ */
export const parseWhatsAppWebhook = async (body) => {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return null;

    /* ---- Inbound message ---- */
    if (value.messages?.length) {
        const msg = value.messages[0];
        const text =
            msg.text?.body ||
            msg.button?.text ||
            msg.interactive?.button_reply?.title ||
            null;

        const alreadyExists = await WhatsAppMessage.findOne({ waMessageId: msg.id });
        if (alreadyExists) {
            return { kind: "inbound", duplicate: true, dbId: alreadyExists._id };
        }
        // DB mein inbound message save karein
        const saved = await WhatsAppMessage.create({
            direction: "inbound",
            type: msg.type || "text",
            phone: msg.from,
            body: text,
            waMessageId: msg.id,
            status: "received",
            contact: value.contacts?.[0] || null,
            statusHistory: [{ status: "received" }],
        });

        return {
            kind: "inbound",
            from: msg.from,
            messageId: msg.id,
            text,
            timestamp: msg.timestamp,
            contact: value.contacts?.[0] || null,
            dbId: saved._id,
        };
    }

    /* ---- Delivery / read status ---- */
    if (value.statuses?.length) {
        const st = value.statuses[0];

        // waMessageId se record dhundein aur status update karein
        const existing = await WhatsAppMessage.findOne({ waMessageId: st.id });
        if (existing) {
            existing.status = st.status; // sent | delivered | read | failed
            existing.statusHistory.push({ status: st.status });
            if (st.errors?.[0]) existing.error = st.errors[0];
            await existing.save();
        }

        return {
            kind: "status",
            messageId: st.id,
            status: st.status,
            recipient: st.recipient_id,
            timestamp: st.timestamp,
            error: st.errors?.[0] || null,
            dbId: existing?._id || null,
        };
    }

    return null;
};

/* ---- Baaki functions (no change) ---- */
export const buildVehicleWhatsAppMessage = (vehicle, dealerName = "SLC Motors") => {
    const vehicleLine = [vehicle?.brand, vehicle?.model, vehicle?.variant, vehicle?.year]
        .filter(Boolean)
        .join(" ");
    const stockLine = vehicle?.stockId ? `Stock ID: ${vehicle.stockId}` : "";
    const priceLine = vehicle?.price
        ? `Price: ₹${Number(vehicle.price).toLocaleString("en-IN")}`
        : "";
    return `Hi ${dealerName}, I'm interested in the ${vehicleLine} (${stockLine}). ${priceLine}. Please share more details.`.trim();
};

export const buildWhatsAppClickUrl = (phone, message = "") => {
    const digits = normalizePhone(phone);
    const text = message ? `?text=${encodeURIComponent(message)}` : "";
    return `https://wa.me/${digits}${text}`;
};