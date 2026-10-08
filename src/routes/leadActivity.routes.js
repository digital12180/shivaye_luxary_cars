import { Router } from "express";
import {
    listActivities,
    getActivity,
    getLeadTimeline,
    createActivity,
    updateActivity,
    deleteActivity,
    getActivityStats,
} from "../controllers/leadActivity.Controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

/* ===== STATS ===== */
router.get(
    "/stats/summary",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getActivityStats
);

/* ===== TIMELINE FOR A SINGLE LEAD ===== */
router.get(
    "/lead/:leadId/timeline",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getLeadTimeline
);

/* ===== CRUD ===== */
router.get(
    "/",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    listActivities
);

router.post(
    "/",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    createActivity
);

router.get(
    "/:id",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getActivity
);

router.patch(
    "/:id",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    updateActivity
);

router.delete(
    "/:id",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    deleteActivity
);

export default router;