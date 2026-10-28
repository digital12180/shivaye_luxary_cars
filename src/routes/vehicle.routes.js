import { Router } from "express";
import {
    listVehicles,
    getVehicle,
    getSimilarVehicles,
    createVehicle,
    updateVehicle,
    updateStatus,
    markAsSold,
    toggleFeatured,
    deleteVehicle,
    adminListVehicles,
    getInventoryStats,
    getVehicleSale,
    getVehicleHistory,
    getVehicleCTA,
    updateRcCheckStatus,
    listFeaturedVehicles,
    toggleVehicleFeatured
} from "../controllers/vehicle.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";

const router = Router();

/* ============ PUBLIC ============ */
router.get("/", listVehicles);
router.get("/:slugOrId", getVehicle);
router.get("/:id/similar", getSimilarVehicles);
router.get("/:id/cta", getVehicleCTA);

/* ============ CRM STATS ============ */
router.get(
    "/stats/summary",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive", "marketing_manager"),
    getInventoryStats
);

/* ============ CRM CRUD ============ */
router.get(
    "/admin/all",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    adminListVehicles
);

router.post(
    "/",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    upload.fields([
        { name: "images", maxCount: 10 },
        { name: "video", maxCount: 1 },
    ]),
    createVehicle
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    upload.fields([
        { name: "images", maxCount: 10 },
        { name: "video", maxCount: 1 },
    ]),
    updateVehicle
);

router.patch("/:id/status", verifyJWT, restrictTo("admin", "sales_manager", "sales_executive"), updateStatus);
router.patch("/:id/sold", verifyJWT, restrictTo("admin", "sales_manager", "sales_executive"), markAsSold);
router.patch("/:id/featured", verifyJWT, restrictTo("admin", "sales_manager"), toggleFeatured);

router.delete("/:id", verifyJWT, restrictTo("admin", "sales_manager"), deleteVehicle);

/* ============ CRM HISTORY & SALE ============ */
router.get("/:id/sale", verifyJWT, restrictTo("admin", "sales_manager", "sales_executive"), getVehicleSale);
router.get("/:id/history", verifyJWT, restrictTo("admin", "sales_manager", "sales_executive"), getVehicleHistory);


router.patch(
    "/:id/rc-check",
    verifyJWT,
    restrictTo("admin", "sales_manager", "sales_executive"),
    updateRcCheckStatus
);
// ✅ NEW — only featured vehicles (public / read)
router.get("/featured", listFeaturedVehicles);

// ✅ NEW — toggle featured (protected, admin/manager ideally)
router.patch(
    "/:id/featured",
    verifyJWT,
    restrictTo("admin"),
    toggleVehicleFeatured
);

export default router;