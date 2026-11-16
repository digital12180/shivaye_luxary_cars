import cron from "node-cron";
import FollowUp from "../models/followUp.js";

export const markOverdueFollowUps = async () => {
    try {
        const now = new Date();

        const result = await FollowUp.updateMany(
            {
                status: "Upcoming",
                dueDate: { $lt: now },
                deletedAt: null,
            },
            { $set: { status: "Missed" } }
        );

        if (result.modifiedCount > 0) {
            console.log(`[cron] Marked ${result.modifiedCount} follow-up(s) as Missed`);
        }
    } catch (err) {
        console.error("[cron] markOverdueFollowUps failed:", err);
    }
};

export const startMissedFollowUpJob = () => {
    // Har 15 minute me chalao
    cron.schedule("*/15 * * * *", markOverdueFollowUps);
    console.log("[cron] Missed follow-up job scheduled (every 15 min)");
};