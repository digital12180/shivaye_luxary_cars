import { Router } from "express";
import {
    listCategories,
    getCategory,
    adminListCategories,
    createCategory,
    updateCategory,
    toggleCategoryActive,
    deleteCategory,
} from "../controllers/category.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";

const router = Router();

/* ============ PUBLIC ============ */
router.get("/", listCategories);

/* ============ ADMIN — LIST ============ */
router.get(
    "/admin/all",
    verifyJWT,
    restrictTo("admin", "sales_manager", "marketing_manager"),
    adminListCategories
);

/* ============ PUBLIC — GET SINGLE ============ */
router.get("/:slugOrId", getCategory);

/* ============ ADMIN — CRUD ============ */
router.post(
    "/",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    upload.single("image"),
    createCategory
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    upload.single("image"),
    updateCategory
);

router.patch(
    "/:id/toggle",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    toggleCategoryActive
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("admin", "sales_manager"),
    deleteCategory
);

export default router;