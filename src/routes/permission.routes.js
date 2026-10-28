import express from "express";
import {
    getUserPermissions,
    updateUserPermissions,
    addUserPermission,
    removeUserPermission,
    clearUserPermissions,
} from "../controllers/permission.controller.js";
import { checkPermission } from "../middleware/checkPermission.js";
import { PERMISSIONS } from "../utils/permission.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = express.Router({ mergeParams: true });

router.use(verifyJWT);

// Sabhi permission routes ke liye user permissions manage karne ki access chahiye
const canManage = checkPermission(PERMISSIONS.USERS_UPDATE);

// GET: Current permissions of user
router.get("/", canManage, getUserPermissions);

// PUT: Replace entire permissions array
router.put("/", canManage, updateUserPermissions);

// POST: Add single permission
router.post("/", canManage, addUserPermission);

// DELETE: Remove single permission
router.delete("/", canManage, removeUserPermission);

// DELETE: Clear all permissions
router.delete("/clear", canManage, clearUserPermissions);

export default router;