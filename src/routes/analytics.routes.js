import { Router } from "express";
import {
    getOverview,
    getSalesAnalytics,
    getLeadAnalytics,
    getSourceAnalytics,
    getLocationAnalytics,
    getInventoryAnalytics,
    getSalesFunnel,
    getKmBandAnalytics,
    getPriceBandAnalytics,
    getExecutiveAnalytics,
    getPaymentAnalytics,
    getCampaignAnalytics,
    getFollowUpAnalytics,
} from "../controllers/analytics.controller.js";
import { verifyJWT, restrictTo } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

/* Everyone in CRM can see overview */
router.get(
    "/overview",
    restrictTo("super_admin", "sales_manager", "sales_executive", "marketing_manager", "inventory_manager"),
    getOverview
);

router.get(
    "/follow-ups",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getFollowUpAnalytics
);

/* Sales exec + above */
router.get(
    "/sales",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getSalesAnalytics
);

router.get(
    "/funnel",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getSalesFunnel
);

router.get(
    "/executives",
    restrictTo("super_admin", "sales_manager"),
    getExecutiveAnalytics
);

/* Marketing + admin */
router.get(
    "/leads",
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    getLeadAnalytics
);

router.get(
    "/sources",
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    getSourceAnalytics
);

router.get(
    "/locations",
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    getLocationAnalytics
);

router.get(
    "/price-bands",
    restrictTo("super_admin", "sales_manager", "marketing_manager", "inventory_manager"),
    getPriceBandAnalytics
);

router.get(
    "/km-bands",
    restrictTo("super_admin", "sales_manager", "marketing_manager", "inventory_manager"),
    getKmBandAnalytics
);

/* Inventory */
router.get(
    "/inventory",
    restrictTo("super_admin", "sales_manager", "inventory_manager", "marketing_manager"),
    getInventoryAnalytics
);

/* Finance/admin */
router.get(
    "/payments",
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    getPaymentAnalytics
);

/* Campaign */
router.get(
    "/campaigns",
    restrictTo("super_admin", "marketing_manager", "sales_manager"),
    getCampaignAnalytics
);

export default router;