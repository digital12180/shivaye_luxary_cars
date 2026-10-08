import { Router } from "express";
import {
    getActiveCampaigns,
    getPublicCampaign,
    listCampaigns,
    getCampaign,
    createCampaign,
    updateCampaign,
    updateCampaignStatus,
    updateSelectedVehicles,
    deleteCampaign,
    getCampaignStats,
    getCampaignPerformance,
} from "../controllers/campaign.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

/* ============ PUBLIC ============ */
router.get("/public/active", getActiveCampaigns);
router.get("/public/:slug", getPublicCampaign);

/* ============ CRM STATS ============ */
router.get(
    "/stats/summary",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager", "sales_manager"),
    getCampaignStats
);

router.get(
    "/:id/performance",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager", "sales_manager"),
    getCampaignPerformance
);

/* ============ CRM CRUD ============ */
router.get(
    "/",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager", "sales_manager"),
    listCampaigns
);

router.post(
    "/",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager"),
    createCampaign
);

router.get(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager", "sales_manager"),
    getCampaign
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager"),
    updateCampaign
);

router.patch(
    "/:id/status",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager"),
    updateCampaignStatus
);

router.patch(
    "/:id/vehicles",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager"),
    updateSelectedVehicles
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "marketing_manager"),
    deleteCampaign
);

export default router;