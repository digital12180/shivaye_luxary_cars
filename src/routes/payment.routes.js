import { Router } from "express";
import express from "express";
import {
  createPaymentOrder,
  verifyPayment,
  reportPaymentFailure,
  razorpayWebhook,
  listPayments,
  getPayment,
  refundPayment,
  retryPayment,
  getPaymentStats,
} from "../controllers/payment.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

/* ============ WEBHOOK — raw body (mount BEFORE json) ============ */
router.post(
  "/webhook/razorpay",
  express.raw({ type: "application/json" }),
  razorpayWebhook
);

/* ============ PUBLIC ============ */
router.post("/public/create-order", createPaymentOrder);
router.post("/public/verify", verifyPayment);
router.post("/public/failed", reportPaymentFailure);

/* ============ CRM STATS ============ */
router.get(
  "/stats/summary",
  verifyJWT,
  restrictTo("admin", "sales_manager", "marketing_manager"),
  getPaymentStats
);

/* ============ CRM CRUD ============ */
router.get(
  "/",
  verifyJWT,
  restrictTo("admin", "sales_manager", "sales_executive"),
  listPayments
);

router.get(
  "/:id",
  verifyJWT,
  restrictTo("admin", "sales_manager", "sales_executive"),
  getPayment
);

router.patch(
  "/:id/refund",
  verifyJWT,
  restrictTo("admin", "sales_manager"),
  refundPayment
);

router.post(
  "/:id/retry",
  verifyJWT,
  restrictTo("admin", "sales_manager", "sales_executive"),
  retryPayment
);

export default router;