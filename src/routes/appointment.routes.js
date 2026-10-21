import { Router } from "express";
import {
    publicCreateAppointment,
    listAppointments,
    getAppointment,
    createAppointment,
    updateAppointment,
    assignAppointment,
    updateAppointmentStatus,
    rescheduleAppointment,
    submitFeedback,
    deleteAppointment,
    getAppointmentStats,
} from "../controllers/appointment.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();
 
router.post("/public", publicCreateAppointment);

/* ============ CRM STATS ============ */
router.get(
    "/stats/summary",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    getAppointmentStats
);

/* ============ CRM CRUD ============ */
router.get(
    "/",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    listAppointments
);

router.post(
    "/",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    createAppointment
);

router.get(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    getAppointment
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    updateAppointment
);

router.patch(
    "/:id/assign",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    assignAppointment
);

router.patch(
    "/:id/status",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    updateAppointmentStatus
);

router.patch(
    "/:id/reschedule",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    rescheduleAppointment
);

router.patch(
    "/:id/feedback",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    submitFeedback
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    deleteAppointment
);

export default router;