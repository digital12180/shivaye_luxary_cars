import { Router } from "express";
import {
    publicCreateReservation,
    listReservations,
    getReservation,
    updateReservation,
    assignReservation,
    confirmReservation,
    extendReservation,
    cancelReservation,
    completeReservation,
    deleteReservation,
    getReservationStats,
} from "../controllers/reservation.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

/* ============ PUBLIC ============ */
router.post("/public", publicCreateReservation);

/* ============ CRM STATS ============ */
router.get(
    "/stats/summary",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    getReservationStats
);

/* ============ CRM CRUD ============ */
router.get(
    "/",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    listReservations
);

router.get(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    getReservation
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    updateReservation
);

router.patch(
    "/:id/assign",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    assignReservation
);

router.patch(
    "/:id/confirm",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    confirmReservation
);

router.patch(
    "/:id/extend",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    extendReservation
);

router.patch(
    "/:id/cancel",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    cancelReservation
);

router.patch(
    "/:id/complete",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    completeReservation
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    deleteReservation
);

export default router;