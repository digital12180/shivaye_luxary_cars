import WhatsAppMessage from "../models/Whatsapp.js";

// Kisi ek number ke saath poori chat history
export const getChatHistory = (phone) =>
  WhatsAppMessage.find({ phone })
    .sort({ createdAt: 1 })
    .lean();

// Kisi lead se juda saara WhatsApp communication
export const getMessagesForLead = (leadId) =>
  WhatsAppMessage.find({ "relatedTo.model": "Lead", "relatedTo.id": leadId })
    .sort({ createdAt: 1 })
    .lean();