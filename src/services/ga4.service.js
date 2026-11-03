// Lead create hone ke baad, response bhejne se pehle:
const sendGA4Event = async (leadData) => {
    try {
        const measurementId = process.env.GA4_MEASUREMENT_ID;
        const apiSecret = process.env.GA4_API_SECRET; // Isko Vercel mein add karna hoga

        if (!apiSecret) return;

        await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`, {
            method: 'POST',
            body: JSON.stringify({
                client_id: leadData.phone, // Unique ID (Phone number use kar sakte hain)
                events: [{
                    name: 'generate_lead', // Standard GA4 event name
                    params: {
                        currency: 'INR',
                        value: leadData.budget || 0,
                        source: leadData.source,
                        vehicle: leadData.interestedVehicle
                    }
                }]
            })
        });
        console.log("GA4 Backend Event Sent");
    } catch (error) {
        console.error("GA4 Error:", error);
    }
};

// Usko call karein:
await sendGA4Event(lead);