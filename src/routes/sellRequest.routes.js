import express from "express";
import {
    createSellRequest,
    getAllSellRequests,
    getSellRequestById,
    updateSellRequest,
    deleteSellRequest,
} from "../controllers/sellRequest.controller.js";

const router = express.Router();

router.post("/", createSellRequest);

router.get("/", getAllSellRequests);
router.get("/:id", getSellRequestById);
router.put("/:id", updateSellRequest);
router.delete("/:id", deleteSellRequest);

export default router;