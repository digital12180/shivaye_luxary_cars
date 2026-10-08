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
} from "../controller/reservation.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

/* ============ PUBLIC ============ */
router.post("/public", publicCreateReservation);

/* ============ CRM STATS ============ */
router.get(
    "/stats/summary",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getReservationStats
);

/* ============ CRM CRUD ============ */
router.get(
    "/",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    listReservations
);

router.get(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getReservation
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    updateReservation
);

router.patch(
    "/:id/assign",
    verifyJWT,
    restrictTo("super_admin", "sales_manager"),
    assignReservation
);

router.patch(
    "/:id/confirm",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    confirmReservation
);

router.patch(
    "/:id/extend",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    extendReservation
);

router.patch(
    "/:id/cancel",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    cancelReservation
);

router.patch(
    "/:id/complete",
    verifyJWT,
    restrictTo("super_admin", "sales_manager"),
    completeReservation
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager"),
    deleteReservation
);

export default router;