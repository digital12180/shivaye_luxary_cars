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
} from "../controllers/vehicle.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

/* ============ PUBLIC ROUTES ============ */
router.get("/", listVehicles);
router.get("/stats/summary", getInventoryStats); // admin-guarded below is skipped for stats? keep admin
router.get("/:slugOrId", getVehicle);
router.get("/:id/similar", getSimilarVehicles);

/* ============ ADMIN ROUTES ============ */
router.get(
    "/admin/all",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "inventory_manager", "marketing_manager"),
    adminListVehicles
);

router.post(
    "/",
    verifyJWT,
    restrictTo("super_admin", "inventory_manager"),
    createVehicle
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "inventory_manager"),
    updateVehicle
);

router.patch(
    "/:id/status",
    verifyJWT,
    restrictTo("super_admin", "inventory_manager", "sales_manager"),
    updateStatus
);

router.patch(
    "/:id/sold",
    verifyJWT,
    restrictTo("super_admin", "sales_manager"),
    markAsSold
);

router.patch(
    "/:id/featured",
    verifyJWT,
    restrictTo("super_admin", "inventory_manager", "marketing_manager"),
    toggleFeatured
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "inventory_manager"),
    deleteVehicle
);
router.get(
    "/:id/sale",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getVehicleSale
);

router.get(
    "/:id/history",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getVehicleHistory
);

export default router;