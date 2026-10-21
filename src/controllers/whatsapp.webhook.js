// controllers/whatsapp.webhook.js
import { parseWhatsAppWebhook } from "../services/whatsapp.service.js";

export const handleWebhook = async (req, res) => {
  // Meta ko turant 200 bhej dein (warna retry karta rahega)
  res.sendStatus(200);

  try {
    const parsed = await parseWhatsAppWebhook(req.body);
    if (parsed) {
        
      console.log("WA webhook parsed:", parsed.kind, parsed.dbId);
      // Yahan aap apne business logic chala sakti hain
      // e.g. agar inbound hai aur text "price" hai → auto-reply
    }
  } catch (err) {
    console.error("Webhook handling failed:", err.message);
  }
};

