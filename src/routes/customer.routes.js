import { Router } from "express";
import {
    publicCreateCustomer,
    getMyProfile,
    updateMyProfile,
    saveCar,
    removeSavedCar,
    listCustomers,
    getCustomer,
    createCustomer,
    updateCustomer,
    toggleCustomerStatus,
    deleteCustomer,
    getCustomerStats,
} from "../controllers/customer.controller.js";
import { verifyJWT, restrictTo } from "../middleware/auth.middleware.js";
import { verifyCustomerJWT } from "../middleware/customerAuth.middleware.js";

const router = Router();

/* ============ PUBLIC ============ */
router.post("/public", publicCreateCustomer);

/* ============ CUSTOMER PANEL ============ */
router.get("/me", verifyCustomerJWT, getMyProfile);
router.patch("/me", verifyCustomerJWT, updateMyProfile);
router.post("/me/saved-cars/:vehicleId", verifyCustomerJWT, saveCar);
router.delete("/me/saved-cars/:vehicleId", verifyCustomerJWT, removeSavedCar);

/* ============ CRM / ADMIN ============ */
router.get(
    "/stats/summary",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "marketing_manager"),
    getCustomerStats
);

router.get(
    "/",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive", "marketing_manager"),
    listCustomers
);

router.post(
    "/",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    createCustomer
);

router.get(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    getCustomer
);

router.patch(
    "/:id",
    verifyJWT,
    restrictTo("super_admin", "sales_manager", "sales_executive"),
    updateCustomer
);

router.patch(
    "/:id/status",
    verifyJWT,
    restrictTo("super_admin", "sales_manager"),
    toggleCustomerStatus
);

router.delete(
    "/:id",
    verifyJWT,
    restrictTo("super_admin"),
    deleteCustomer
);

export default router;