import { Router } from "express";
import {
    listBrands,
    getBrand,
    adminListBrands,
    createBrand,
    updateBrand,
    toggleBrandActive,
    deleteBrand,
} from "../controllers/brand.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";

const router = Router();

/* ============ PUBLIC ============ */
router.get("/", listBrands);

/* ============ ADMIN — LIST ============ */
router.get(
    "/admin/all",
    verifyJWT,
    restrictTo("admin", "sales_manager", "marketing_manager"),
    adminListBrands
);

/* ============ PUBLIC — GET SINGLE (must come after /admin/all) ============ */
router.get("/:slugOrId", getBrand);

/* ============ ADMIN — CRUD ============ */
router.post(
    "/",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    upload.single("logo"),
    createBrand
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    upload.single("logo"),
    updateBrand
);

router.patch(
    "/:id/toggle",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    toggleBrandActive
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    deleteBrand
);

export default router;