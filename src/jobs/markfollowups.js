import cron from "node-cron";
import FollowUp from "../models/followUp.js";

export const markOverdueFollowUps = async () => {
    try {
        // Aaj ka start (00:00:00.000)
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        // Sirf woh Missed karo jinki dueDate aaj se pehle ki hai
        // (aaj wale abhi "Upcoming" rahenge, kal subah se Missed honge)
        const result = await FollowUp.updateMany(
            {
                status: "Upcoming",
                dueDate: { $lt: startOfToday },   // <-- kal se pehle wale
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