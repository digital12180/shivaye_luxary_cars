import { Router } from "express";
import {
    listNotifications,
    getNotification,
    createNotification,
    createBulkNotifications,
    retryNotification,
    cancelNotification,
    deleteNotification,
    getNotificationStats,
    getMyNotifications,
    markMyNotificationRead,
    markAllMyNotificationsRead,
    getMyInbox,
    markInboxNotificationRead,
} from "../controllers/Notification.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";
import { verifyCustomerJWT } from "../middleware/customerAuth.middleware.js";

const router = Router();

/* ============ CUSTOMER PANEL ============ */
router.get("/me", verifyCustomerJWT, getMyNotifications);
router.patch("/me/read-all", verifyCustomerJWT, markAllMyNotificationsRead);
router.patch("/me/:id/read", verifyCustomerJWT, markMyNotificationRead);

/* ============ CRM — STATS ============ */
router.get(
    "/stats/summary",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager", "sales_manager"),
    getNotificationStats
);

/* ============ CRM — STAFF INBOX ============ */
router.get(
    "/inbox",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive", "marketing_manager"),
    getMyInbox
);

router.patch(
    "/inbox/:id/read",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive", "marketing_manager"),
    markInboxNotificationRead
);

/* ============ CRM — CRUD ============ */
router.get(
    "/",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    listNotifications
);

router.post(
    "/",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    createNotification
);

router.post(
    "/bulk",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager"),
    createBulkNotifications
);

router.get(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    getNotification
);

router.patch(
    "/:id/retry",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    retryNotification
);

router.patch(
    "/:id/cancel",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    cancelNotification
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("super_admin"),
    deleteNotification
);

export default router;