import { Router } from "express";
import {
    createSale,
    listSales,
    getSale,
    updateSale,
    updatePayment,
    updateDelivery,
    addDocument,
    removeDocument,
    deleteSale,
    getSalesDashboard,
    getMonthlySalesTrend,
} from "../controllers/sale.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

/* ============ STATS ============ */
router.get(
    "/stats/dashboard",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getSalesDashboard
);

router.get(
    "/stats/monthly",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getMonthlySalesTrend
);

/* ============ CRUD ============ */
router.get(
    "/",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    listSales
);

router.post(
    "/",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    createSale
);

router.get(
    "/:id",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getSale
);

router.patch(
    "/:id",
    restrictTo("super_admin", "sales_manager"),
    updateSale
);

/* ============ PAYMENT ============ */
router.patch(
    "/:id/payment",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    updatePayment
);

/* ============ DELIVERY ============ */
router.patch(
    "/:id/delivery",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    updateDelivery
);

/* ============ DOCUMENTS ============ */
router.post(
    "/:id/documents",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    addDocument
);

router.delete(
    "/:id/documents/:docId",
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    removeDocument
);

/* ============ DELETE (admin only — restores vehicle) ============ */
router.delete(
    "/:id",
    restrictTo("super_admin"),
    deleteSale
);

export default router;