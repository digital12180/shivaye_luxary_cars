/* ============================================================
   jobs/reservationExpiry.job.js
   Shivaye Luxury Cars — Auto-expire stale reservations
   BRD 8.1 — Reservation validity period
   Runs every 15 minutes (configurable via CRON_RESERVATION_EXPIRY)
   ============================================================ */

import cron from "node-cron";
import Reservation from "../models/Reservation.js";
import Vehicle from "../models/Vehicle.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/leadActivity.js";
import Customer from "../models/Customer.js";
import { sendNotification } from "../services/notification.service.js";

/* ============================================================
   Core job — finds expired reservations, releases vehicles,
   notifies customers, rolls back leads.
   ============================================================ */
export const expireStaleReservations = async () => {
  const now = new Date();
  const batchSize = 50;

  // Find all reservations whose hold window has passed
  // while still unpaid/pending.
  const stale = await Reservation.find({
    status: { $in: ["initiated", "pending"] },
    paymentStatus: { $in: ["pending", "partial"] },
    expiresAt: { $ne: null, $lt: now },
    deletedAt: null,
  }).limit(batchSize);

  if (stale.length === 0) return { expired: 0 };

  let expiredCount = 0;

  for (const reservation of stale) {
    try {
      /* 1. Mark reservation as expired */
      reservation.status = "expired";
      reservation.cancelledAt = now;
      reservation.cancelledBy = "system";
      reservation.cancellationReason = "Hold period expired";
      reservation.cancellationCategory = "expired";
      await reservation.save();

      /* 2. Release the vehicle back to available */
      await Vehicle.findByIdAndUpdate(reservation.vehicle, {
        status: "available",
        reservedAt: null,
      });

      /* 3. Roll lead back to negotiation stage */
      if (reservation.lead) {
        const lead = await Lead.findById(reservation.lead);
        if (lead && lead.status === "reserved") {
          lead.status = "negotiation";
          await lead.save();
        }

        await LeadActivity.create({
          lead: reservation.lead,
          customer: reservation.customer,
          type: "system",
          title: "Reservation expired",
          description: `Hold expired for reservation ${reservation.reservationNumber}`,
          meta: { reservationId: reservation._id, expiresAt: reservation.expiresAt },
        });
      }

      /* 4. Notify customer via WhatsApp */
      const customer = await Customer.findById(reservation.customer);
      if (customer) {
        try {
          await sendNotification({
            recipientType: "customer",
            customerId: customer._id,
            to: customer.phone,
            channel: "whatsapp",
            type: "reservation_expiring",
            title: "Reservation expired",
            body: `Hi ${customer.name}, your reservation ${reservation.reservationNumber} has expired because payment was not completed. The vehicle is now available to other customers. You can reserve again anytime.`,
            template: {
              name: "reservation_expired",
              language: "en",
              variables: {
                name: customer.name,
                reservationNumber: reservation.reservationNumber,
              },
            },
            relatedTo: {
              reservation: reservation._id,
              vehicle: reservation.vehicle,
            },
          });
        } catch (notifyErr) {
          console.error(
            `Notification failed for reservation ${reservation.reservationNumber}:`,
            notifyErr.message
          );
        }
      }

      expiredCount++;
    } catch (err) {
      console.error(
        `Failed to expire reservation ${reservation._id}:`,
        err.message
      );
    }
  }

  if (expiredCount > 0) {
    console.log(
      `[Cron] Expired ${expiredCount} stale reservation(s) at ${now.toISOString()}`
    );
  }

  return { expired: expiredCount };
};

/* ============================================================
   Scheduler — register the cron task
   ============================================================ */
export const startReservationExpiryJob = () => {
  const schedule = process.env.CRON_RESERVATION_EXPIRY || "*/15 * * * *";

  if (process.env.CRON_ENABLED === "false") {
    console.log("[Cron] Reservation expiry job disabled (CRON_ENABLED=false)");
    return;
  }

  cron.schedule(
    schedule,
    async () => {
      try {
        await expireStaleReservations();
      } catch (err) {
        console.error("[Cron] Reservation expiry job crashed:", err.message);
      }
    },
    {
      timezone: process.env.TZ || "Asia/Kolkata",
    }
  );

  console.log(`[Cron] Reservation expiry job scheduled: ${schedule}`);
};