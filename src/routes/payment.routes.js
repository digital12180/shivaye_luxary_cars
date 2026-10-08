import { Router } from "express";
import express from "express";
import {
    createPaymentOrder,
    verifyPayment,
    webhookHandler,
    listPayments,
    getPayment,
    refundPayment,
    getPaymentStats,
} from "../controllers/payment.controller.js";
import { verifyJWT, restrictTo } from "../middlewares/auth.middleware.js";

const router = Router();

/* ============ WEBHOOK (raw body — must come before express.json) ============ */
router.post(
    "/webhook/:gateway",
    express.raw({ type: "application/json" }),
    webhookHandler
);

/* ============ PUBLIC ============ */
router.post("/public/create-order", createPaymentOrder);
router.post("/public/verify", verifyPayment);

/* ============ CRM STATS ============ */
router.get(
    "/stats/summary",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    getPaymentStats
);

/* ============ CRM ============ */
router.get(
    "/",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    listPayments
);

router.get(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getPayment
);

router.patch(
    "/:id/refund",
    verifyJWT,
    restrictTo("super_admin", "sales_manager"),
    refundPayment
);

export default router;