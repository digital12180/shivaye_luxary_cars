// services/notification.service.js
import Notification from "../models/Notification.js";
import { getIO } from "./socket.service.js";
import {
    sendWhatsAppMessage,
    buildWhatsAppClickUrl,
    buildVehicleWhatsAppMessage as _buildVehicleWAMessage,
} from "./whatsapp.service.js";

/* ============================================================
   Provider map
   WhatsApp delegates to whatsapp.service.js
   ============================================================ */
const providers = {
    whatsapp: async (to, payload) => {
        const result = await sendWhatsAppMessage({
            to,
            templateName: payload.template?.name || null,
            language: payload.template?.language || "en",
            variables: payload.template?.variables || {},
            body: payload.body,
        });
        return {
            id: result?.id || `wa_${Date.now()}`,
            success: result?.success !== false,
            provider: result?.provider || "meta_waba",
            response: result?.response || result,
        };
    },

    sms: async (to, payload) => {
        if (process.env.NODE_ENV !== "production") {
            console.log(`[SMS] ${to} -> ${payload.body}`);
        }
        return { id: `sms_${Date.now()}`, success: true, provider: "internal" };
    },

    email: async (to, payload) => {
        if (process.env.NODE_ENV !== "production") {
            console.log(`[EMAIL] ${to} -> ${payload.title}`);
        }
        return { id: `em_${Date.now()}`, success: true, provider: "internal" };
    },

    push: async (to, payload) => {
        if (process.env.NODE_ENV !== "production") {
            console.log(`[PUSH] ${to} -> ${payload.title}`);
        }
        return { id: `pu_${Date.now()}`, success: true, provider: "internal" };
    },

    in_app: async () => ({
        id: `in_${Date.now()}`,
        success: true,
        provider: "internal",
    }),

    // BRD 13 — click-to-call is a logged event, no transport
    call: async () => ({
        id: `call_${Date.now()}`,
        success: true,
        provider: "internal",
    }),
};

/* ============================================================
   CRM Activity logging (BRD 13)
   Lazy import — do not fail notification on activity error
   ============================================================ */
const logActivity = async (notification) => {
    try {
        const { default: Activity } = await import("../models/Activity.js");
        if (!Activity) return null;

        const activity = await Activity.create({
            type: "communication",
            channel: notification.channel,
            direction: notification.direction,
            subject: notification.title,
            description: notification.body,
            customer: notification.customer,
            user: notification.user,
            relatedTo: notification.relatedTo,
            metadata: {
                notificationId: notification._id,
                provider: notification.provider,
                providerMessageId: notification.providerMessageId,
                templateName: notification.template?.name,
                status: notification.status,
            },
            createdBy: notification.createdBy,
        });

        notification.relatedTo = notification.relatedTo || {};
        notification.relatedTo.activity = activity._id;
        await notification.save();

        return activity;
    } catch (err) {
        console.error("[ActivityLog] Failed:", err.message);
        return null;
    }
};

/* ============================================================
   Core: sendNotification
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
    direction = "outbound",
    payloadMeta = {},
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
        direction,
        payloadMeta,
        status: "queued",
    });

    // Scheduled for later — leave queued (cron picks it up)
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
        notification.provider = result.provider || channel;
        notification.providerMessageId = result.id;
        notification.providerResponse = result.response || result;
        await notification.save();

        await logActivity(notification);
    } catch (err) {
        notification.status = "failed";
        notification.failedAt = new Date();
        notification.failureReason = err.message;
        notification.retryCount = (notification.retryCount || 0) + 1;
        notification.providerResponse = err.raw || { message: err.message };
        await notification.save();

        await logActivity(notification);
    }

    return notification;
};

/* ============================================================
   Bulk send
   ============================================================ */
export const sendBulkNotifications = async (items = []) => {
    return Promise.all(
        items.map((item) =>
            sendNotification(item).catch((err) => ({ error: err.message }))
        )
    );
};

/* ============================================================
   BRD 13 — CTA builders (delegate to whatsapp.service.js)
   ============================================================ */
export const buildVehicleWhatsAppMessage = (vehicle, dealerName) =>
    _buildVehicleWAMessage(vehicle, dealerName);

export const buildWhatsAppCTA = (vehicle, dealerWhatsApp) => {
    const message = _buildVehicleWAMessage(vehicle);
    return buildWhatsAppClickUrl(dealerWhatsApp, message);
};

export const buildCallCTA = (dealerPhone) =>
    `tel:${String(dealerPhone).replace(/\s+/g, "")}`;

/* ============================================================
   BRD 13 — Flow 1: Reservation Confirmation
   ============================================================ */
export const notifyReservationConfirmed = async (reservation) => {
    return sendNotification({
        recipientType: "customer",
        customerId: reservation.customer,
        to: reservation.buyerSnapshot?.phone,
        channel: "whatsapp",
        type: "reservation_confirmed",
        title: "Reservation Confirmed",
        body: `Hi ${reservation.buyerSnapshot?.name}, your reservation ${reservation.reservationNumber} is confirmed. Amount paid: ₹${reservation.amountPaid}. Balance: ₹${reservation.amountDue}.`,
        template: {
            name: "reservation_confirmed_v1",
            language: "en",
            provider: "meta_waba",
            variables: {
                "1": reservation.buyerSnapshot?.name || "Customer",
                "2": reservation.reservationNumber,
                "3": reservation.amountPaid ?? 0,
                "4": reservation.amountDue ?? 0,
            },
        },
        priority: "high",
        relatedTo: {
            reservation: reservation._id,
            vehicle: reservation.vehicle,
            customer: reservation.customer,
        },
        actionUrl: `/reservations/${reservation.reservationNumber}`,
        actionLabel: "View Reservation",
    });
};

/* ============================================================
   BRD 13 — Flow 2: Lead Assignment
   ============================================================ */
export const notifyLeadAssigned = async (lead, assigneeUser) => {
    const toStaff = sendNotification({
        recipientType: "staff",
        userId: assigneeUser._id,
        to: assigneeUser.phone || assigneeUser.email,
        channel: "in_app",
        type: "lead_assigned",
        title: "New Lead Assigned",
        body: `You have been assigned a new lead: ${lead.customer?.name || "Customer"}.`,
        priority: "high",
        relatedTo: {
            lead: lead._id,
            vehicle: lead.vehicle,
            customer: lead.customer,
        },
        actionUrl: `/crm/leads/${lead._id}`,
        actionLabel: "Open Lead",
    });

    const toCustomer = lead.customer?.phone
        ? sendNotification({
            recipientType: "customer",
            customerId: lead.customer._id,
            to: lead.customer.phone,
            channel: "whatsapp",
            type: "lead_created",
            title: "We received your enquiry",
            body: `Hi ${lead.customer.name}, thanks for your interest. Our team will contact you shortly.`,
            template: {
                name: "lead_ack_v1",
                language: "en",
                provider: "meta_waba",
                variables: { "1": lead.customer.name },
            },
            priority: "normal",
            relatedTo: {
                lead: lead._id,
                customer: lead.customer._id,
                vehicle: lead.vehicle,
            },
        })
        : Promise.resolve(null);

    return Promise.all([toStaff, toCustomer]);
};

/* ============================================================
   BRD 13 — Flow 3: Payment Success / Failure
   ============================================================ */
export const notifyPaymentSuccess = async (payment, reservation) => {
    return sendNotification({
        recipientType: "customer",
        customerId: payment.customer,
        to: payment.contact || reservation?.buyerSnapshot?.phone,
        channel: "whatsapp",
        type: "payment_success",
        title: "Payment Successful",
        body: `We received ₹${payment.amount} for reservation ${reservation?.reservationNumber}. Balance due: ₹${reservation?.amountDue}.`,
        template: {
            name: "payment_success_v1",
            language: "en",
            provider: "meta_waba",
            variables: {
                "1": payment.amount,
                "2": reservation?.reservationNumber || "-",
                "3": reservation?.amountDue ?? 0,
            },
        },
        priority: "high",
        relatedTo: {
            payment: payment._id,
            reservation: reservation?._id,
            customer: payment.customer,
        },
        actionUrl: `/payments/${payment._id}`,
        actionLabel: "View Receipt",
    });
};

export const notifyPaymentFailed = async (payment, reservation, reason) => {
    return sendNotification({
        recipientType: "customer",
        customerId: payment.customer,
        to: payment.contact || reservation?.buyerSnapshot?.phone,
        channel: "whatsapp",
        type: "payment_failed",
        title: "Payment Failed",
        body: `Your payment of ₹${payment.amount} for reservation ${reservation?.reservationNumber} failed. Reason: ${reason || "Unknown"}. Please retry.`,
        template: {
            name: "payment_failed_v1",
            language: "en",
            provider: "meta_waba",
            variables: {
                "1": payment.amount,
                "2": reservation?.reservationNumber || "-",
                "3": reason || "Unknown",
            },
        },
        priority: "urgent",
        relatedTo: {
            payment: payment._id,
            reservation: reservation?._id,
            customer: payment.customer,
        },
        actionUrl: `/reservations/${reservation?.reservationNumber}/pay`,
        actionLabel: "Retry Payment",
    });
};

/* ============================================================
   BRD 13 — WhatsApp / Call click logging
   scheduledAt in the past → skip dispatch, just log to CRM
   ============================================================ */
export const logWhatsAppClick = async (vehicle, customer = null) => {
    return sendNotification({
        recipientType: customer ? "customer" : "system",
        customerId: customer?._id || null,
        to: customer?.phone || "website_visitor",
        channel: "whatsapp",
        type: "whatsapp_click",
        title: "WhatsApp CTA clicked",
        body: `WhatsApp CTA clicked for ${vehicle.brand} ${vehicle.model} (${vehicle.stockId}).`,
        relatedTo: { vehicle: vehicle._id },
        scheduledAt: new Date(0),  // past → skipped send branch
    });
};

export const logCallClick = async (vehicle, customer = null) => {
    return sendNotification({
        recipientType: customer ? "customer" : "system",
        customerId: customer?._id || null,
        to: customer?.phone || "website_visitor",
        channel: "call",
        type: "call_click",
        title: "Call CTA clicked",
        body: `Call CTA clicked for ${vehicle.brand} ${vehicle.model} (${vehicle.stockId}).`,
        relatedTo: { vehicle: vehicle._id },
        scheduledAt: new Date(0),
    });
};

/* ============================================================
   Socket.io realtime helpers
   ============================================================ */
export const sendToUser = (userId, event, data) => {
    try {
        const io = getIO();
        io.to(`user-${userId}`).emit(event, {
            ...data,
            timestamp: new Date().toISOString(),
            type: "user",
        });
        return true;
    } catch (error) {
        console.error("Error sending notification to user:", error);
        return false;
    }
};

export const sendToRoom = (roomName, event, data) => {
    try {
        const io = getIO();
        io.to(roomName).emit(event, {
            ...data,
            timestamp: new Date().toISOString(),
            type: "room",
        });
        return true;
    } catch (error) {
        console.error("Error sending notification to room:", error);
        return false;
    }
};

export const sendToAll = (event, data) => {
    try {
        const io = getIO();
        io.emit(event, {
            ...data,
            timestamp: new Date().toISOString(),
            type: "broadcast",
        });
        return true;
    } catch (error) {
        console.error("Error broadcasting notification:", error);
        return false;
    }
};

/* ============================================================
   Realtime UI shortcuts
   ============================================================ */
export const sendPaymentSuccessSocket = (userId, paymentData) =>
    sendToUser(userId, "payment-success", {
        title: "Payment Successful",
        message: `Your payment of ₹${paymentData.amount} was successful`,
        paymentId: paymentData.paymentId,
        amount: paymentData.amount,
        status: "success",
    });

export const sendPaymentFailedSocket = (userId, paymentData) =>
    sendToUser(userId, "payment-failed", {
        title: "Payment Failed",
        message: `Your payment of ₹${paymentData.amount} failed.`,
        paymentId: paymentData.paymentId,
        amount: paymentData.amount,
        status: "failed",
        reason: paymentData.reason || "Unknown error",
    });

export const sendGeneralNotification = (userId, notification) =>
    sendToUser(userId, "general-notification", {
        title: notification.title || "Notification",
        message: notification.message,
        data: notification.data || {},
    });

export const sendOrderCreatedNotification = (userId, orderData) =>
    sendToUser(userId, "order-created", {
        title: "Order Created",
        message: `Your order #${orderData.orderId} has been created`,
        orderId: orderData.orderId,
        amount: orderData.amount,
        status: "created",
    });

export const sendOrderShippedNotification = (userId, orderData) =>
    sendToUser(userId, "order-shipped", {
        title: "Order Shipped",
        message: `Your order #${orderData.orderId} has been shipped`,
        orderId: orderData.orderId,
        trackingNumber: orderData.trackingNumber,
        status: "shipped",
    });

export const sendOrderDeliveredNotification = (userId, orderData) =>
    sendToUser(userId, "order-delivered", {
        title: "Order Delivered",
        message: `Your order #${orderData.orderId} has been delivered`,
        orderId: orderData.orderId,
        status: "delivered",
    });

export const sendRefundInitiatedNotification = (userId, refundData) =>
    sendToUser(userId, "refund-initiated", {
        title: "Refund Initiated",
        message: `Your refund of ₹${refundData.amount} for order #${refundData.orderId} has been initiated`,
        refundId: refundData.refundId,
        orderId: refundData.orderId,
        amount: refundData.amount,
        status: "initiated",
    });

export const sendRefundCompletedNotification = (userId, refundData) =>
    sendToUser(userId, "refund-completed", {
        title: "Refund Completed",
        message: `Your refund of ₹${refundData.amount} has been completed`,
        refundId: refundData.refundId,
        orderId: refundData.orderId,
        amount: refundData.amount,
        status: "completed",
    });

export const sendReturnApprovedNotification = (userId, refundData) =>
    sendToUser(userId, "return-approved", {
        title: "Return Approved",
        message: `Your return request of ₹${refundData.amount} for order #${refundData.orderId} has been approved`,
        refundId: refundData.refundId,
        orderId: refundData.orderId,
        amount: refundData.amount,
        status: "approved",
    });

export const sendReturnRejectNotification = (userId, refundData) =>
    sendToUser(userId, "return-reject", {
        title: "Return Rejected",
        message: `Your return request of ₹${refundData.amount} for order #${refundData.orderId} has been rejected`,
        refundId: refundData.refundId,
        orderId: refundData.orderId,
        amount: refundData.amount,
        status: "rejected",
    });

export const sendNewBatchCreatedNotification = (userId, batchData) =>
    sendToUser(userId, "new-batch-created", {
        title: "New Stock Batch Available",
        message: `New batch "${batchData.batchName}" is now available with ${batchData.availableStock} units`,
        batchId: batchData.batchId,
        batchName: batchData.batchName,
        totalStock: batchData.totalStock,
        availableStock: batchData.availableStock,
        startTime: batchData.startTime,
        status: "active",
    });

export const sendLowStockAlertNotification = (userId, batchData) =>
    sendToUser(userId, "low-stock-alert", {
        title: "Low Stock Alert",
        message: `Batch "${batchData.batchName}" is running low! Only ${batchData.availableStock} units left.`,
        batchId: batchData.batchId,
        batchName: batchData.batchName,
        availableStock: batchData.availableStock,
        totalStock: batchData.totalStock,
        soldStock: batchData.soldStock,
        threshold: batchData.threshold || 10,
    });

export const sendBatchCompletedNotification = (userId, batchData) =>
    sendToUser(userId, "batch-completed", {
        title: "Batch Completed",
        message: `Batch "${batchData.batchName}" has been completed. Total sold: ${batchData.soldStock} units`,
        batchId: batchData.batchId,
        batchName: batchData.batchName,
        soldStock: batchData.soldStock,
        totalStock: batchData.totalStock,
        status: "completed",
    });

export const sendBatchUpcomingNotification = (userId, batchData) =>
    sendToUser(userId, "batch-upcoming", {
        title: "Upcoming Batch",
        message: `New batch "${batchData.batchName}" will be available on ${new Date(batchData.startTime).toLocaleDateString()}`,
        batchId: batchData.batchId,
        batchName: batchData.batchName,
        startTime: batchData.startTime,
        totalStock: batchData.totalStock,
    });