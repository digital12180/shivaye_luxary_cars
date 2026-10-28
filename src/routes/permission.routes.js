import express from "express";
import {
    getUserPermissions,
    updateUserPermissions,
    addUserPermission,
    removeUserPermission,
    addMultiplePermissions,
    removeMultiplePermissions,
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

// POST: Add multiple permissions at once
router.post("/bulk-add", canManage, addMultiplePermissions);

// DELETE: Remove multiple permissions at once
router.delete("/bulk-remove", canManage, removeMultiplePermissions);

// DELETE: Clear all permissions
router.delete("/clear", canManage, clearUserPermissions);

export default router;