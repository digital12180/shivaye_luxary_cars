import express from "express";
import {
    listRoles,
    getRole,
    createRole,
    updateRole,
    deleteRole
} from "../controllers/roleController.js";
import { protect } from "../middlewares/authMiddleware.js"; // Assuming aapke paas auth hai
import { requirePermission } from "../middlewares/roleMiddleware.js";

const router = express.Router();

// Sabhi role routes protected hain
router.use(protect);

// Note: Yahan module ka naam 'settings' ya 'roles' rakh sakte hain. 
// Agar aap chahte hain ki role management sirf Admin kar sake, toh 
// aap DB me 'settings' module ke liye Read/Create permission assign kar sakte hain.

router.get(
    "/",
    requirePermission("settings"),
    listRoles
);

router.get(
    "/:id",
    requirePermission("settings"),
    getRole
);

router.post(
    "/",
    requirePermission("settings"),
    createRole
);

router.put(
    "/:id",
    requirePermission("settings"),
    updateRole
);

router.delete(
    "/:id",
    requirePermission("settings"),
    deleteRole
);

export default router;