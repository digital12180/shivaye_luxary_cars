import mongoose from "mongoose";
import FollowUp from "../models/followUp.js";
import Lead from "../models/Lead.js";
import { ok, fail } from "../utils/response.js";

export const listFollowUps = async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { status, leadId, assignedTo, dueDate } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (leadId) filter.lead = leadId;
        if (assignedTo) filter.assignedTo = assignedTo;
        
        if (dueDate) {
            const start = new Date(dueDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(dueDate);
            end.setHours(23, 59, 59, 999);
            filter.dueDate = { $gte: start, $lte: end };
        }

        const [data, total] = await Promise.all([
            FollowUp.find(filter)
                .populate("lead", "leadNumber interestedVehicle status")
                .populate("customer", "name phone")
                .populate("vehicle", "brand model")
                .populate("assignedTo", "name")
                .sort("dueDate")
                .skip((page - 1) * limit)
                .limit(limit),
            FollowUp.countDocuments(filter),
        ]);

        return ok(res, {
            data,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

export const createFollowUp = async (req, res, next) => {
    try {
        const { lead: leadId, dueDate, time, status, nextAction, assignedTo } = req.body;

        const lead = await Lead.findById(leadId);
        if (!lead) return fail(res, "Lead not found", 404);

        const followUp = await FollowUp.create({
            lead: lead._id,
            customer: lead.customer,
            vehicle: lead.vehicle,
            assignedTo: assignedTo || lead.assignedTo || req.user._id,
            dueDate: new Date(dueDate),
            time,
            status: status || "Upcoming",
            nextAction,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });

        // Sync with Lead's nextFollowUpAt
        if (status === "Upcoming") {
            lead.nextFollowUpAt = new Date(dueDate);
            await lead.save();
        }

        return ok(res, followUp, "Follow-up scheduled", 201);
    } catch (err) {
        next(err);
    }
};

export const updateFollowUp = async (req, res, next) => {
    try {
        const { dueDate, time, status, nextAction, assignedTo } = req.body;

        const followUp = await FollowUp.findById(req.params.id);
        if (!followUp) return fail(res, "Follow-up not found", 404);

        if (dueDate) followUp.dueDate = new Date(dueDate);
        if (time) followUp.time = time;
        if (status) followUp.status = status;
        if (nextAction) followUp.nextAction = nextAction;
        if (assignedTo) followUp.assignedTo = assignedTo;
        
        followUp.updatedBy = req.user._id;
        await followUp.save();

        // Sync with Lead's nextFollowUpAt
        const lead = await Lead.findById(followUp.lead);
        if (lead && status === "Upcoming") {
            lead.nextFollowUpAt = followUp.dueDate;
            await lead.save();
        }

        return ok(res, followUp, "Follow-up updated");
    } catch (err) {
        next(err);
    }
};

export const deleteFollowUp = async (req, res, next) => {
    try {
        const followUp = await FollowUp.findById(req.params.id);
        if (!followUp) return fail(res, "Follow-up not found", 404);

        followUp.deletedAt = new Date();
        followUp.updatedBy = req.user._id;
        await followUp.save();

        return ok(res, {}, "Follow-up deleted");
    } catch (err) {
        next(err);
    }
};