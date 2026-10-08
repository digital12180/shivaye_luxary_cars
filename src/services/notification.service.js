import Notification from "../models/Notification.js";

/* ============================================================
   Provider stubs — replace with real SDK calls
   ============================================================ */
const providers = {
    whatsapp: async (to, payload) => {
        // TODO: Meta WhatsApp Business API / Gupshup / Twilio
        if (process.env.NODE_ENV !== "production") {
            console.log(`[WA] ${to} -> ${payload.body}`);
        }
        return { id: `wa_${Date.now()}`, success: true };
    },

    sms: async (to, payload) => {
        // TODO: MSG91 / Twilio / Gupshup SMS
        if (process.env.NODE_ENV !== "production") {
            console.log(`[SMS] ${to} -> ${payload.body}`);
        }
        return { id: `sms_${Date.now()}`, success: true };
    },

    email: async (to, payload) => {
        // TODO: SendGrid / Nodemailer
        if (process.env.NODE_ENV !== "production") {
            console.log(`[EMAIL] ${to} -> ${payload.title}`);
        }
        return { id: `em_${Date.now()}`, success: true };
    },

    push: async (to, payload) => {
        // TODO: FCM
        if (process.env.NODE_ENV !== "production") {
            console.log(`[PUSH] ${to} -> ${payload.title}`);
        }
        return { id: `pu_${Date.now()}`, success: true };
    },

    in_app: async () => ({ id: `in_${Date.now()}`, success: true }),
};

/* ============================================================
   Send a notification (creates record + dispatches)
   ============================================================ */
export const sendNotification = async ({
    recipientType,
    customerId = null,
    userId = null,
    to,
    channel,
    type,
    title,
    body,
    template = null,
    data = {},
    priority = "normal",
    relatedTo = {},
    actionUrl = null,
    actionLabel = null,
    createdBy = null,
    scheduledAt = new Date(),
}) => {
    const notification = await Notification.create({
        recipientType,
        customer: customerId,
        user: userId,
        to,
        channel,
        type,
        title,
        body,
        template,
        data,
        priority,
        relatedTo,
        actionUrl,
        actionLabel,
        createdBy,
        scheduledAt,
        status: "queued",
    });

    // If scheduled for later, leave as queued — a cron will pick it up
    if (scheduledAt.getTime() > Date.now() + 5000) {
        return notification;
    }

    // Dispatch now
    try {
        notification.status = "sending";
        await notification.save();

        const provider = providers[channel];
        if (!provider) throw new Error(`No provider for channel ${channel}`);

        const result = await provider(to, { title, body, template, data });

        notification.status = "sent";
        notification.sentAt = new Date();
        notification.provider = channel;
        notification.providerMessageId = result.id;
        notification.providerResponse = result;
        await notification.save();
    } catch (err) {
        notification.status = "failed";
        notification.failedAt = new Date();
        notification.failureReason = err.message;
        notification.retryCount = (notification.retryCount || 0) + 1;
        await notification.save();
    }

    return notification;
};

/* ============================================================
   Bulk send (fan-out)
   ============================================================ */
export const sendBulkNotifications = async (items = []) => {
    const results = await Promise.all(
        items.map((item) =>
            sendNotification(item).catch((err) => ({ error: err.message }))
        )
    );
    return results;
};