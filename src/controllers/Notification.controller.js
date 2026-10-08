import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import { ok, fail } from "../utils/response.js";
import { sendNotification, sendBulkNotifications } from "../services/notification.service.js";

/* ============================================================
   CRM — List all notifications (admin view)
   GET /api/v1/notifications
   ============================================================ */
export const listNotifications = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const {
            channel, type, status, priority, recipientType,
            customer, user, fromDate, toDate, isRead,
        } = req.query;

        const filter = {};
        if (channel) filter.channel = channel;
        if (type) filter.type = type;
        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (recipientType) filter.recipientType = recipientType;
        if (customer) filter.customer = customer;
        if (user) filter.user = user;
        if (isRead !== undefined) filter.isRead = isRead === "true";

        if (fromDate || toDate) {
            filter.createdAt = {};
            if (fromDate) filter.createdAt.$gte = new Date(fromDate);
            if (toDate) filter.createdAt.$lte = new Date(toDate);
        }

        const [data, total] = await Promise.all([
            Notification.find(filter)
                .populate("customer", "name phone email")
                .populate("user", "name email role")
                .sort("-createdAt")
                .skip((page - 1) * limit)
                .limit(limit),
            Notification.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Get single notification
   ============================================================ */
export const getNotification = async (req, res, next) => {
    try {
        const notification = await Notification.findById(req.params.id)
            .populate("customer", "name phone email city")
            .populate("user", "name email role")
            .populate("createdBy", "name");

        if (!notification) return fail(res, "Notification not found", 404);
        return ok(res, notification);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Send a custom notification (manual / ad-hoc)
   POST /api/v1/notifications
   Body: { recipientType, customerId?, userId?, to, channel, type,
           title, body, template?, priority?, relatedTo?, actionUrl? }
   ============================================================ */
export const createNotification = async (req, res, next) => {
    try {
        const {
            recipientType, customerId, userId, to,
            channel, type, title, body,
            template, data, priority,
            relatedTo, actionUrl, actionLabel,
            scheduledAt,
        } = req.body;

        if (!recipientType || !to || !channel || !type || !title || !body)
            return fail(res, "Missing required fields", 400);

        const notification = await sendNotification({
            recipientType,
            customerId,
            userId,
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
            createdBy: req.user._id,
            scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
        });

        return ok(res, notification, "Notification queued/sent", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Bulk send (broadcast)
   POST /api/v1/notifications/bulk
   Body: { items: [ { ...same as single }, ... ] }
   ============================================================ */
export const createBulkNotifications = async (req, res, next) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0)
            return fail(res, "items must be a non-empty array", 400);

        const enriched = items.map((it) => ({
            ...it,
            createdBy: req.user._id,
        }));

        const results = await sendBulkNotifications(enriched);
        return ok(res, { count: results.length, results }, "Bulk notifications processed", 201);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Retry failed notification
   PATCH /api/v1/notifications/:id/retry
   ============================================================ */
export const retryNotification = async (req, res, next) => {
    try {
        const notification = await Notification.findById(req.params.id);
        if (!notification) return fail(res, "Notification not found", 404);
        if (notification.status !== "failed")
            return fail(res, "Only failed notifications can be retried", 400);

        // Resend via helper
        const retried = await sendNotification({
            recipientType: notification.recipientType,
            customerId: notification.customer,
            userId: notification.user,
            to: notification.to,
            channel: notification.channel,
            type: notification.type,
            title: notification.title,
            body: notification.body,
            template: notification.template,
            data: notification.data,
            priority: notification.priority,
            relatedTo: notification.relatedTo,
            actionUrl: notification.actionUrl,
            actionLabel: notification.actionLabel,
            createdBy: req.user._id,
        });

        // Update original record's retryCount
        notification.retryCount = (notification.retryCount || 0) + 1;
        await notification.save();

        return ok(res, retried, "Notification retried");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Cancel queued notification
   PATCH /api/v1/notifications/:id/cancel
   ============================================================ */
export const cancelNotification = async (req, res, next) => {
    try {
        const notification = await Notification.findById(req.params.id);
        if (!notification) return fail(res, "Notification not found", 404);
        if (!["queued", "sending"].includes(notification.status))
            return fail(res, "Only queued notifications can be cancelled", 400);

        notification.status = "cancelled";
        notification.failureReason = "Cancelled by staff";
        await notification.save();

        return ok(res, notification, "Notification cancelled");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Soft delete
   ============================================================ */
export const deleteNotification = async (req, res, next) => {
    try {
        const notification = await Notification.findByIdAndUpdate(
            req.params.id,
            { deletedAt: new Date() },
            { new: true }
        );
        if (!notification) return fail(res, "Notification not found", 404);
        return ok(res, {}, "Notification deleted");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Stats / dashboard (BRD 9.1, 15)
   GET /api/v1/notifications/stats/summary
   ============================================================ */
export const getNotificationStats = async (req, res, next) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const [
            total, queued, sent, delivered, read, failed, cancelled,
            todayCount, byChannel, byType,
        ] = await Promise.all([
            Notification.countDocuments(),
            Notification.countDocuments({ status: "queued" }),
            Notification.countDocuments({ status: "sent" }),
            Notification.countDocuments({ status: "delivered" }),
            Notification.countDocuments({ status: "read" }),
            Notification.countDocuments({ status: "failed" }),
            Notification.countDocuments({ status: "cancelled" }),
            Notification.countDocuments({ createdAt: { $gte: startOfDay } }),
            Notification.aggregate([
                { $group: { _id: "$channel", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            Notification.aggregate([
                { $group: { _id: "$type", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
        ]);

        return ok(res, {
            total, queued, sent, delivered, read, failed, cancelled, todayCount,
            byChannel, byType,
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CUSTOMER PANEL — My notifications (BRD 27.1)
   GET /api/v1/notifications/me
   ============================================================ */
export const getMyNotifications = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { isRead, channel, type } = req.query;

        const filter = { customer: req.customer._id };
        if (isRead !== undefined) filter.isRead = isRead === "true";
        if (channel) filter.channel = channel;
        if (type) filter.type = type;

        const [data, total, unreadCount] = await Promise.all([
            Notification.find(filter)
                .sort("-createdAt")
                .skip((page - 1) * limit)
                .limit(limit),
            Notification.countDocuments(filter),
            Notification.countDocuments({ customer: req.customer._id, isRead: false }),
        ]);

        return ok(res, {
            data,
            unreadCount,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CUSTOMER PANEL — Mark one as read
   PATCH /api/v1/notifications/me/:id/read
   ============================================================ */
export const markMyNotificationRead = async (req, res, next) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, customer: req.customer._id },
            { isRead: true, readAt: new Date() },
            { new: true }
        );
        if (!notification) return fail(res, "Notification not found", 404);
        return ok(res, notification, "Marked as read");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CUSTOMER PANEL — Mark all as read
   PATCH /api/v1/notifications/me/read-all
   ============================================================ */
export const markAllMyNotificationsRead = async (req, res, next) => {
    try {
        const result = await Notification.updateMany(
            { customer: req.customer._id, isRead: false },
            { isRead: true, readAt: new Date() }
        );
        return ok(res, { modified: result.modifiedCount }, "All marked as read");
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — My staff notifications (in-app inbox for sales exec)
   GET /api/v1/notifications/inbox
   ============================================================ */
export const getMyInbox = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { isRead } = req.query;

        const filter = { user: req.user._id };
        if (isRead !== undefined) filter.isRead = isRead === "true";

        const [data, total, unreadCount] = await Promise.all([
            Notification.find(filter)
                .sort("-createdAt")
                .skip((page - 1) * limit)
                .limit(limit),
            Notification.countDocuments(filter),
            Notification.countDocuments({ user: req.user._id, isRead: false }),
        ]);

        return ok(res, {
            data,
            unreadCount,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   CRM — Mark staff notification read
   PATCH /api/v1/notifications/inbox/:id/read
   ============================================================ */
export const markInboxNotificationRead = async (req, res, next) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { isRead: true, readAt: new Date() },
            { new: true }
        );
        if (!notification) return fail(res, "Notification not found", 404);
        return ok(res, notification, "Marked as read");
    } catch (err) {
        next(err);
    }
};