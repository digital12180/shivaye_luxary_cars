import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/leadActivity.js";
import Vehicle from "../models/Vehicle.js";
import Sale from "../models/Sale.js";
import Reservation from "../models/Reservation.js";
import Payment from "../models/Payment.js";
import Appointment from "../models/Appointment.js";
import Customer from "../models/Customer.js";
import Campaign from "../models/Campaign.js";
import { ok } from "../utils/response.js";

/* ============================================================
   Helpers
   ============================================================ */
const parseRange = (req) => {
    const { fromDate, toDate } = req.query;
    const range = {};
    if (fromDate || toDate) {
        range.createdAt = {};
        if (fromDate) range.createdAt.$gte = new Date(fromDate);
        if (toDate) range.createdAt.$lte = new Date(toDate);
    }
    return range;
};

const startOfDay = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};
const endOfDay = () => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
};
const startOfMonth = () => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
};

/* ============================================================
   BRD 34.1 — Management Overview KPIs
   GET /api/v1/analytics/overview
   ============================================================ */
export const getOverview = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const [
            totalActiveCars, availableCars, reservedCars, soldCars,
            totalLeads, newLeads, wonLeads, lostLeads,
            openFollowUps, overdueFollowUps,
            reservations, paymentsPaid,
            totalRevenue, avgSaleValue,
            totalCustomers, totalAppointments,
        ] = await Promise.all([
            Vehicle.countDocuments({ status: { $in: ["available", "reserved", "booked"] } }),
            Vehicle.countDocuments({ status: "available" }),
            Vehicle.countDocuments({ status: "reserved" }),
            Vehicle.countDocuments({ status: "sold" }),
            Lead.countDocuments(scopeDate),
            Lead.countDocuments({ ...scopeDate, status: "new" }),
            Lead.countDocuments({ ...scopeDate, status: "won" }),
            Lead.countDocuments({ ...scopeDate, status: "lost" }),
            Lead.countDocuments({
                ...scopeDate,
                status: { $nin: ["won", "lost"] },
                nextFollowUpAt: { $gte: startOfDay(), $lte: endOfDay() },
            }),
            Lead.countDocuments({
                ...scopeDate,
                status: { $nin: ["won", "lost"] },
                nextFollowUpAt: { $lt: new Date() },
            }),
            Reservation.countDocuments({ ...scopeDate, status: "confirmed" }),
            Payment.countDocuments({ ...scopeDate, status: "paid" }),
            Sale.aggregate([
                { $match: scopeDate },
                { $group: { _id: null, sum: { $sum: "$pricing.finalSalePrice" } } },
            ]),
            Sale.aggregate([
                { $match: scopeDate },
                { $group: { _id: null, avg: { $avg: "$pricing.finalSalePrice" } } },
            ]),
            Customer.countDocuments(scopeDate),
            Appointment.countDocuments(scopeDate),
        ]);

        const conversionRate = totalLeads
            ? Number(((wonLeads / totalLeads) * 100).toFixed(2))
            : 0;

        return ok(res, {
            inventory: {
                totalActive: totalActiveCars,
                available: availableCars,
                reserved: reservedCars,
                sold: soldCars,
            },
            leads: {
                total: totalLeads,
                new: newLeads,
                won: wonLeads,
                lost: lostLeads,
                openFollowUps,
                overdueFollowUps,
                conversionRate,
            },
            sales: {
                reservations,
                paymentsPaid,
                totalRevenue: totalRevenue[0]?.sum || 0,
                averageSaleValue: avgSaleValue[0]?.avg
                    ? Number(avgSaleValue[0].avg.toFixed(2))
                    : 0,
            },
            customers: {
                total: totalCustomers,
                totalAppointments,
            },
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 34.2 — Sales Analytics
   GET /api/v1/analytics/sales?year=2025
   ============================================================ */
export const getSalesAnalytics = async (req, res, next) => {
    try {
        const year = Number(req.query.year) || new Date().getFullYear();
        const scopeDate = parseRange(req);

        const [
            byMonth,
            byBrand,
            byModel,
            byPriceBand,
            avgDaysToSell,
            reservedToSold,
        ] = await Promise.all([
            Sale.aggregate([
                {
                    $match: {
                        ...scopeDate,
                        saleDate: {
                            $gte: new Date(`${year}-01-01`),
                            $lt: new Date(`${year + 1}-01-01`),
                        },
                    },
                },
                {
                    $group: {
                        _id: { $month: "$saleDate" },
                        count: { $sum: 1 },
                        revenue: { $sum: "$pricing.finalSalePrice" },
                    },
                },
                { $sort: { _id: 1 } },
            ]),

            Sale.aggregate([
                { $match: scopeDate },
                {
                    $group: {
                        _id: "$vehicleSnapshot.brand",
                        count: { $sum: 1 },
                        revenue: { $sum: "$pricing.finalSalePrice" },
                    },
                },
                { $sort: { count: -1 } },
            ]),

            Sale.aggregate([
                { $match: scopeDate },
                {
                    $group: {
                        _id: "$vehicleSnapshot.model",
                        count: { $sum: 1 },
                        revenue: { $sum: "$pricing.finalSalePrice" },
                    },
                },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),

            Sale.aggregate([
                { $match: scopeDate },
                {
                    $bucket: {
                        groupBy: "$pricing.finalSalePrice",
                        boundaries: [
                            0, 1000000, 2500000, 5000000, 7500000, 10000000, 20000000, 999999999,
                        ],
                        default: "Other",
                        output: { count: { $sum: 1 }, revenue: { $sum: "$pricing.finalSalePrice" } },
                    },
                },
            ]),

            Sale.aggregate([
                { $match: scopeDate },
                {
                    $lookup: {
                        from: "vehicles",
                        localField: "vehicle",
                        foreignField: "_id",
                        as: "v",
                    },
                },
                { $unwind: { path: "$v", preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        days: {
                            $divide: [
                                { $subtract: ["$saleDate", "$v.listedAt"] },
                                1000 * 60 * 60 * 24,
                            ],
                        },
                    },
                },
                { $group: { _id: null, avg: { $avg: "$days" } } },
            ]),

            Reservation.aggregate([
                { $match: { ...scopeDate, status: { $in: ["confirmed", "completed"] } } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        converted: {
                            $sum: { $cond: [{ $ne: ["$convertedToSale", null] }, 1, 0] },
                        },
                    },
                },
            ]),
        ]);

        const conv = reservedToSold[0];
        const reservedToSoldRate = conv?.total
            ? Number(((conv.converted / conv.total) * 100).toFixed(2))
            : 0;

        return ok(res, {
            year,
            byMonth,
            byBrand,
            byModel,
            byPriceBand,
            averageDaysToSell: avgDaysToSell[0]?.avg
                ? Number(avgDaysToSell[0].avg.toFixed(1))
                : 0,
            reservedToSoldRate,
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 34.3 — Customer & Lead Analytics
   GET /api/v1/analytics/leads
   ============================================================ */
export const getLeadAnalytics = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const [bySource, byCity, byBrand, byPriceBand, byStatus, testDrives, reservations, salesBySource] =
            await Promise.all([
                Lead.aggregate([
                    { $match: scopeDate },
                    {
                        $group: {
                            _id: "$source",
                            total: { $sum: 1 },
                            won: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
                            lost: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] } },
                        },
                    },
                    { $sort: { total: -1 } },
                ]),

                Lead.aggregate([
                    { $match: { ...scopeDate, "location.city": { $ne: null } } },
                    { $group: { _id: "$location.city", count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 15 },
                ]),

                Lead.aggregate([
                    { $match: { ...scopeDate, interestedBrand: { $ne: null } } },
                    { $group: { _id: "$interestedBrand", count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 15 },
                ]),

                Lead.aggregate([
                    { $match: scopeDate },
                    {
                        $bucket: {
                            groupBy: "$budget.max",
                            boundaries: [
                                0, 1000000, 2500000, 5000000, 7500000, 10000000, 20000000, 999999999,
                            ],
                            default: "Unknown",
                            output: { count: { $sum: 1 } },
                        },
                    },
                ]),

                Lead.aggregate([
                    { $match: scopeDate },
                    { $group: { _id: "$status", count: { $sum: 1 } } },
                ]),

                Appointment.countDocuments({ ...scopeDate, type: "test_drive" }),
                Reservation.countDocuments(scopeDate),
                Sale.aggregate([
                    { $match: scopeDate },
                    { $group: { _id: "$source", count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                ]),
            ]);

        return ok(res, {
            bySource,
            byCity,
            byBrand,
            byPriceBand,
            byStatus,
            testDrives,
            reservations,
            salesBySource,
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 34.4 + 11.2 — Marketing Source Analytics
   GET /api/v1/analytics/sources
   ============================================================ */
export const getSourceAnalytics = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const [bySource, byUtmCampaign, byUtmMedium, byLandingPage] = await Promise.all([
            Lead.aggregate([
                { $match: scopeDate },
                {
                    $group: {
                        _id: "$source",
                        totalLeads: { $sum: 1 },
                        qualifiedLeads: {
                            $sum: {
                                $cond: [
                                    {
                                        $in: [
                                            "$status",
                                            [
                                                "qualified", "car_shared", "visit_scheduled",
                                                "test_drive", "negotiation", "reserved", "booked", "won",
                                            ],
                                        ],
                                    },
                                    1,
                                    0,
                                ],
                            },
                        },
                        wonLeads: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
                        revenue: { $sum: { $ifNull: ["$dealValue", 0] } },
                    },
                },
                {
                    $addFields: {
                        conversionRate: {
                            $cond: [
                                { $gt: ["$totalLeads", 0] },
                                { $multiply: [{ $divide: ["$wonLeads", "$totalLeads"] }, 100] },
                                0,
                            ],
                        },
                    },
                },
                { $sort: { totalLeads: -1 } },
            ]),

            Lead.aggregate([
                { $match: { ...scopeDate, "attribution.utmCampaign": { $ne: null } } },
                {
                    $group: {
                        _id: "$attribution.utmCampaign",
                        totalLeads: { $sum: 1 },
                        wonLeads: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
                    },
                },
                { $sort: { totalLeads: -1 } },
                { $limit: 20 },
            ]),

            Lead.aggregate([
                { $match: { ...scopeDate, "attribution.utmMedium": { $ne: null } } },
                { $group: { _id: "$attribution.utmMedium", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),

            Lead.aggregate([
                { $match: { ...scopeDate, "attribution.landingPage": { $ne: null } } },
                { $group: { _id: "$attribution.landingPage", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 20 },
            ]),
        ]);

        return ok(res, { bySource, byUtmCampaign, byUtmMedium, byLandingPage });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 12 + 15 — Location demand
   GET /api/v1/analytics/locations
   ============================================================ */
export const getLocationAnalytics = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const [byCity, byState, byCountry, leadCityVsSalesCity] = await Promise.all([
            Lead.aggregate([
                { $match: { ...scopeDate, "location.city": { $ne: null } } },
                {
                    $group: {
                        _id: "$location.city",
                        leads: { $sum: 1 },
                        wonLeads: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
                    },
                },
                { $sort: { leads: -1 } },
                { $limit: 20 },
            ]),

            Lead.aggregate([
                { $match: { ...scopeDate, "location.state": { $ne: null } } },
                { $group: { _id: "$location.state", leads: { $sum: 1 } } },
                { $sort: { leads: -1 } },
            ]),

            Lead.aggregate([
                { $match: { ...scopeDate, "location.country": { $ne: null } } },
                { $group: { _id: "$location.country", leads: { $sum: 1 } } },
                { $sort: { leads: -1 } },
            ]),

            Customer.aggregate([
                { $match: { ...scopeDate, "ipLocation.city": { $ne: null } } },
                { $group: { _id: "$ipLocation.city", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 20 },
            ]),
        ]);

        return ok(res, { byCity, byState, byCountry, byIpCity: leadCityVsSalesCity });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 15 — Inventory analytics
   GET /api/v1/analytics/inventory
   ============================================================ */
export const getInventoryAnalytics = async (req, res, next) => {
    try {
        const [byStatus, byBrand, byCity, ageing, valueByStatus] = await Promise.all([
            Vehicle.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),

            Vehicle.aggregate([
                { $match: { status: { $in: ["available", "reserved", "booked"] } } },
                { $group: { _id: "$brand", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),

            Vehicle.aggregate([
                { $match: { "location.city": { $ne: null } } },
                { $group: { _id: "$location.city", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),

            // Ageing: days in inventory for available cars
            Vehicle.aggregate([
                { $match: { status: "available" } },
                {
                    $project: {
                        daysInStock: {
                            $divide: [{ $subtract: [new Date(), "$listedAt"] }, 1000 * 60 * 60 * 24],
                        },
                    },
                },
                {
                    $bucket: {
                        groupBy: "$daysInStock",
                        boundaries: [0, 15, 30, 60, 90, 180, 9999],
                        default: "Other",
                        output: { count: { $sum: 1 } },
                    },
                },
            ]),

            Vehicle.aggregate([
                {
                    $group: {
                        _id: "$status",
                        totalValue: { $sum: "$price" },
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);

        return ok(res, { byStatus, byBrand, byCity, ageing, valueByStatus });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 15 — Sales Funnel
   GET /api/v1/analytics/funnel
   ============================================================ */
export const getSalesFunnel = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const stages = [
            "new", "contacted", "qualified", "car_shared",
            "visit_scheduled", "test_drive", "negotiation",
            "reserved", "booked", "won",
        ];

        const result = await Lead.aggregate([
            { $match: scopeDate },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                },
            },
        ]);

        const countsByStatus = {};
        result.forEach((r) => (countsByStatus[r._id] = r.count));

        const totalLeads = Object.values(countsByStatus).reduce((a, b) => a + b, 0);

        const funnel = stages.map((stage, idx) => {
            const count = countsByStatus[stage] || 0;
            return {
                stage,
                order: idx + 1,
                count,
                percentOfTotal: totalLeads
                    ? Number(((count / totalLeads) * 100).toFixed(2))
                    : 0,
            };
        });

        return ok(res, { totalLeads, funnel, lost: countsByStatus.lost || 0 });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 15 — KM driven demand bands
   GET /api/v1/analytics/km-bands
   ============================================================ */
export const getKmBandAnalytics = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const [leadDemand, salesDemand] = await Promise.all([
            // Demand via leads linked to vehicles
            Lead.aggregate([
                { $match: { ...scopeDate, vehicle: { $ne: null } } },
                {
                    $lookup: {
                        from: "vehicles",
                        localField: "vehicle",
                        foreignField: "_id",
                        as: "v",
                    },
                },
                { $unwind: "$v" },
                {
                    $bucket: {
                        groupBy: "$v.kilometers",
                        boundaries: [0, 10000, 25000, 50000, 75000, 100000, 999999],
                        default: "Other",
                        output: { count: { $sum: 1 } },
                    },
                },
            ]),

            // Actual sales by KM band
            Sale.aggregate([
                { $match: scopeDate },
                {
                    $bucket: {
                        groupBy: "$vehicleSnapshot.kilometersAtSale",
                        boundaries: [0, 10000, 25000, 50000, 75000, 100000, 999999],
                        default: "Other",
                        output: { count: { $sum: 1 } },
                    },
                },
            ]),
        ]);

        return ok(res, { leadDemand, salesDemand });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 15 — Price band demand (leads)
   GET /api/v1/analytics/price-bands
   ============================================================ */
export const getPriceBandAnalytics = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const boundaries = [
            0, 1000000, 2500000, 5000000, 7500000, 10000000, 20000000, 999999999,
        ];

        const [leadDemand, vehicleDemand, salesDemand] = await Promise.all([
            Lead.aggregate([
                { $match: scopeDate },
                {
                    $bucket: {
                        groupBy: "$budget.max",
                        boundaries,
                        default: "Unknown",
                        output: { count: { $sum: 1 } },
                    },
                },
            ]),

            Vehicle.aggregate([
                { $match: { status: { $in: ["available", "reserved"] } } },
                {
                    $bucket: {
                        groupBy: "$price",
                        boundaries,
                        default: "Other",
                        output: { count: { $sum: 1 } },
                    },
                },
            ]),

            Sale.aggregate([
                { $match: scopeDate },
                {
                    $bucket: {
                        groupBy: "$pricing.finalSalePrice",
                        boundaries,
                        default: "Other",
                        output: { count: { $sum: 1 } },
                    },
                },
            ]),
        ]);

        return ok(res, { leadDemand, vehicleDemand, salesDemand });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 15 — Sales executive performance
   GET /api/v1/analytics/executives
   ============================================================ */
export const getExecutiveAnalytics = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const result = await Lead.aggregate([
            { $match: { ...scopeDate, assignedTo: { $ne: null } } },
            {
                $group: {
                    _id: "$assignedTo",
                    assignedLeads: { $sum: 1 },
                    contacted: { $sum: { $cond: [{ $ne: ["$firstContactedAt", null] }, 1, 0] } },
                    won: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
                    lost: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] } },
                    revenue: { $sum: { $ifNull: ["$dealValue", 0] } },
                },
            },
            {
                $addFields: {
                    conversionRate: {
                        $cond: [
                            { $gt: ["$assignedLeads", 0] },
                            { $multiply: [{ $divide: ["$won", "$assignedLeads"] }, 100] },
                            0,
                        ],
                    },
                },
            },
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "user",
                },
            },
            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    userId: "$_id",
                    name: "$user.name",
                    role: "$user.role",
                    assignedLeads: 1,
                    contacted: 1,
                    won: 1,
                    lost: 1,
                    revenue: 1,
                    conversionRate: { $round: ["$conversionRate", 2] },
                },
            },
            { $sort: { revenue: -1 } },
        ]);

        // Add follow-up activity counts
        const activityCounts = await LeadActivity.aggregate([
            { $match: { ...scopeDate, performedBy: { $ne: null } } },
            { $group: { _id: "$performedBy", activities: { $sum: 1 } } },
        ]);
        const activityMap = {};
        activityCounts.forEach((a) => (activityMap[String(a._id)] = a.activities));

        const enriched = result.map((r) => ({
            ...r,
            activities: activityMap[String(r.userId)] || 0,
        }));

        return ok(res, enriched);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 15 — Reservation + Payment analytics
   GET /api/v1/analytics/payments
   ============================================================ */
export const getPaymentAnalytics = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const [
            reservationByStatus,
            paymentByStatus,
            paymentByGateway,
            paymentByType,
            revenue,
            fees,
            refunds,
            monthlyPayments,
        ] = await Promise.all([
            Reservation.aggregate([
                { $match: scopeDate },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),

            Payment.aggregate([
                { $match: scopeDate },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),

            Payment.aggregate([
                { $match: { ...scopeDate, status: "paid" } },
                {
                    $group: {
                        _id: "$gateway",
                        count: { $sum: 1 },
                        amount: { $sum: "$amount" },
                        net: { $sum: "$netAmount" },
                    },
                },
            ]),

            Payment.aggregate([
                { $match: { ...scopeDate, status: "paid" } },
                {
                    $group: {
                        _id: "$paymentType",
                        count: { $sum: 1 },
                        amount: { $sum: "$amount" },
                    },
                },
            ]),

            Payment.aggregate([
                { $match: { ...scopeDate, status: "paid" } },
                { $group: { _id: null, sum: { $sum: "$amount" }, net: { $sum: "$netAmount" } } },
            ]),

            Payment.aggregate([
                { $match: { ...scopeDate, status: "paid" } },
                { $group: { _id: null, fees: { $sum: "$gatewayFee" } } },
            ]),

            Payment.aggregate([
                { $match: { ...scopeDate, "refund.amount": { $gt: 0 } } },
                {
                    $group: {
                        _id: null,
                        totalRefunds: { $sum: "$refund.amount" },
                        count: { $sum: 1 },
                    },
                },
            ]),

            Payment.aggregate([
                { $match: { ...scopeDate, status: "paid" } },
                {
                    $group: {
                        _id: {
                            year: { $year: "$paidAt" },
                            month: { $month: "$paidAt" },
                        },
                        amount: { $sum: "$amount" },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } },
            ]),
        ]);

        return ok(res, {
            reservationByStatus,
            paymentByStatus,
            paymentByGateway,
            paymentByType,
            totalCollected: revenue[0]?.sum || 0,
            totalNet: revenue[0]?.net || 0,
            totalGatewayFees: fees[0]?.fees || 0,
            totalRefunds: refunds[0]?.totalRefunds || 0,
            refundCount: refunds[0]?.count || 0,
            monthlyPayments,
        });
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 15 — Campaign performance
   GET /api/v1/analytics/campaigns
   ============================================================ */
export const getCampaignAnalytics = async (req, res, next) => {
    try {
        const scopeDate = parseRange(req);

        const campaigns = await Campaign.find(scopeDate)
            .select("name source type status startDate endDate budget spend metrics")
            .sort("-createdAt")
            .lean();

        // Enhance with live lead counts
        const ids = campaigns.map((c) => c._id);
        const liveLeads = await Lead.aggregate([
            { $match: { campaign: { $in: ids } } },
            {
                $group: {
                    _id: "$campaign",
                    totalLeads: { $sum: 1 },
                    wonLeads: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
                },
            },
        ]);
        const liveMap = {};
        liveLeads.forEach((l) => (liveMap[String(l._id)] = l));

        const enriched = campaigns.map((c) => {
            const live = liveMap[String(c._id)] || { totalLeads: 0, wonLeads: 0 };
            const revenue = c.metrics?.revenue || 0;
            const spend = c.spend || 0;
            return {
                ...c,
                liveMetrics: {
                    totalLeads: live.totalLeads,
                    wonLeads: live.wonLeads,
                    cpl: live.totalLeads ? Number((spend / live.totalLeads).toFixed(2)) : 0,
                    roas: spend ? Number((revenue / spend).toFixed(2)) : 0,
                    conversionRate: live.totalLeads
                        ? Number(((live.wonLeads / live.totalLeads) * 100).toFixed(2))
                        : 0,
                },
            };
        });

        return ok(res, enriched);
    } catch (err) {
        next(err);
    }
};

/* ============================================================
   BRD 9.1 — Follow-ups snapshot (today / overdue / upcoming)
   GET /api/v1/analytics/follow-ups
   ============================================================ */
export const getFollowUpAnalytics = async (req, res, next) => {
    try {
        const scopeFilter =
            req.user.role === "sales_executive" ? { assignedTo: req.user._id } : {};

        const now = new Date();
        const todayStart = startOfDay();
        const todayEnd = endOfDay();
        const tomorrowEnd = new Date(todayEnd);
        tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
        const weekEnd = new Date(todayStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const [overdue, today, tomorrow, thisWeek, noFollowUpScheduled] =
            await Promise.all([
                Lead.countDocuments({
                    ...scopeFilter,
                    status: { $nin: ["won", "lost"] },
                    nextFollowUpAt: { $lt: todayStart },
                }),
                Lead.countDocuments({
                    ...scopeFilter,
                    status: { $nin: ["won", "lost"] },
                    nextFollowUpAt: { $gte: todayStart, $lte: todayEnd },
                }),
                Lead.countDocuments({
                    ...scopeFilter,
                    status: { $nin: ["won", "lost"] },
                    nextFollowUpAt: { $gt: todayEnd, $lte: tomorrowEnd },
                }),
                Lead.countDocuments({
                    ...scopeFilter,
                    status: { $nin: ["won", "lost"] },
                    nextFollowUpAt: { $gt: todayEnd, $lte: weekEnd },
                }),
                Lead.countDocuments({
                    ...scopeFilter,
                    status: { $nin: ["won", "lost"] },
                    nextFollowUpAt: null,
                }),
            ]);

        return ok(res, {
            overdue,
            today,
            tomorrow,
            thisWeek,
            noFollowUpScheduled,
            asOf: now,
        });
    } catch (err) {
        next(err);
    }
};