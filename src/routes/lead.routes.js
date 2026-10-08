import { Router } from "express";
import {
    publicCreateLead,
    listLeads,
    getLead,
    createLead,
    updateLead,
    updateLeadStatus,
    assignLead,
    scheduleFollowUp,
    updatePriority,
    markWon,
    markLost,
    deleteLead,
    getLeadDashboard,
    getSourcePerformance,
} from "../controllers/lead.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

/* ============ PUBLIC ============ */
router.post("/public", publicCreateLead);

/* ============ CRM STATS ============ */
router.get(
    "/stats/dashboard",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive", "marketing_manager"),
    getLeadDashboard
);

router.get(
    "/stats/source-performance",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    getSourcePerformance
);

/* ============ CRM CRUD ============ */
router.get(
    "/",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive", "marketing_manager"),
    listLeads
);

router.post(
    "/",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    createLead
);

router.get(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getLead
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    updateLead
);

router.patch(
    "/:id/status",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    updateLeadStatus
);

router.patch(
    "/:id/assign",
    verifyJWT,
    restrictTo("super_admin", "sales_manager"),
    assignLead
);

router.patch(
    "/:id/follow-up",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    scheduleFollowUp
);

router.patch(
    "/:id/priority",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    updatePriority
);

router.patch(
    "/:id/won",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    markWon
);

router.patch(
    "/:id/lost",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    markLost
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager"),
    deleteLead
);

export default router;