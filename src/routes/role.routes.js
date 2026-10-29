import express from "express";
import {
    listRoles,
    getRole,
    createRole,
    updateRole,
    deleteRole
} from "../controllers/role.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = express.Router();

// Sabhi role routes protected hain
router.use(verifyJWT);


router.get(
    "/",
    listRoles
);

router.get(
    "/:id",
    getRole
);

router.post(
    "/",
    createRole
);

router.put(
    "/:id",
    updateRole
);

router.delete(
    "/:id",
    deleteRole
);

export default router;