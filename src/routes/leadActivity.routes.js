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
    restrictTo("admin", "sales_manager", "sales_executive"),
    getActivityStats
);

/* ===== TIMELINE FOR A SINGLE LEAD ===== */
router.get(
    "/lead/:leadId/timeline",
    restrictTo("admin", "sales_manager", "sales_executive"),
    getLeadTimeline
);

/* ===== CRUD ===== */
router.get(
    "/",
    restrictTo("admin", "sales_manager", "sales_executive"),
    listActivities
);

router.post(
    "/",
    restrictTo("admin", "sales_manager", "sales_executive"),
    createActivity
);

router.get(
    "/:id",
    restrictTo("admin", "sales_manager", "sales_executive"),
    getActivity
);

router.patch(
    "/:id",
    restrictTo("admin", "sales_manager", "sales_executive"),
    updateActivity
);

router.delete(
    "/:id",
    restrictTo("admin", "sales_manager", "sales_executive"),
    deleteActivity
);

export default router;