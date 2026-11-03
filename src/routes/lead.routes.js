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
import { checkPermission } from "../middleware/checkPermission.js"

const router = Router();

/* ============ PUBLIC ============ */
router.post("/public", publicCreateLead);

/* ============ CRM STATS ============ */
router.get(
    "/stats/dashboard",
    verifyJWT,
    checkPermission('Leads_read'),
    getLeadDashboard
);

router.get(
    "/stats/source-performance",
    verifyJWT,
    checkPermission('Leads_read'),
    getSourcePerformance
);

/* ============ CRM CRUD ============ */
router.get(
    "/",
    verifyJWT,
    checkPermission('Leads_read'),
    listLeads
);

router.post(
    "/",
    verifyJWT,
    checkPermission('Leads_create'),
    createLead
);

router.get(
    "/:id",
    verifyJWT,
    checkPermission('Leads_read'),
    getLead
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    updateLead
);

router.patch(
    "/:id/status",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    updateLeadStatus
);

router.patch(
    "/:id/assign",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    assignLead
);

router.patch(
    "/:id/follow-up",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    scheduleFollowUp
);

router.patch(
    "/:id/priority",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    updatePriority
);

router.patch(
    "/:id/won",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    markWon
);

router.patch(
    "/:id/lost",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    markLost
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    deleteLead
);

export default router;