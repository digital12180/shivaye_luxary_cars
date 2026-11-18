import { XMLParser } from "fast-xml-parser";

// Yahan humne senior ka diya hua JSON response hardcode kar diya hai
const mockApiResponse = {
    "success": true,
    "message": "Success",
    "data": {
        "response": [{
            "response": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VehicleDetails>
    <stautsMessage>OK</stautsMessage>
    <rc_regn_no>UK07DT7522</rc_regn_no>
    <rc_regn_dt>24-Aug-2020</rc_regn_dt>
    <rc_owner_sr>1</rc_owner_sr>
    <rc_owner_name>A***R T***Q</rc_owner_name>
    <rc_chasi_no>MAKDF558GL42*****</rc_chasi_no>
    <rc_eng_no>L12B472*****</rc_eng_no>
    <rc_maker_desc>HONDA CARS INDIA LTD</rc_maker_desc>
    <rc_maker_model>AMAZE 1.2 VX MT (I-VTEC)</rc_maker_model>
    <rc_fuel_desc>PETROL</rc_fuel_desc>
    <rc_color>PLATINUM WHITE P.</rc_color>
    <rc_insurance_comp>Navi General Insurance Limited</rc_insurance_comp>
    <rc_insurance_upto>20-Aug-2027</rc_insurance_upto>
    <rc_status>ACTIVE</rc_status>
</VehicleDetails>`
        }]
    }
};

export const verifyVehicleRC = async (registrationNumber) => {
    try {
        // 1. Yahan actual API call aayegi baad mein. Abhi ke liye mock use kar rahe hain.
        const apiResponse = mockApiResponse; 
        
        // 2. XML string extract karein
        const xmlString = apiResponse.data.response[0].response;

        // 3. XML ko JSON mein parse karein
        const parser = new XMLParser();
        const jsonObj = parser.parse(xmlString);

        // 4. Data extract karein
        const vehicleDetails = jsonObj.VehicleDetails;

        // 5. Check karein ki registration number match kar raha hai ya nahi
        if (vehicleDetails.rc_regn_no !== registrationNumber) {
            throw new Error("Registration number does not match");
        }

        // 6. Clean data return karein
        return {
            success: true,
            rcDetails: {
                registrationNumber: vehicleDetails.rc_regn_no,
                ownerName: vehicleDetails.rc_owner_name,
                chassisNumber: vehicleDetails.rc_chasi_no,
                engineNumber: vehicleDetails.rc_eng_no,
                maker: vehicleDetails.rc_maker_desc,
                model: vehicleDetails.rc_maker_model,
                fuelType: vehicleDetails.rc_fuel_desc,
                color: vehicleDetails.rc_color,
                insuranceCompany: vehicleDetails.rc_insurance_comp,
                insuranceUpto: vehicleDetails.rc_insurance_upto,
                status: vehicleDetails.rc_status,
            }
        };

    } catch (error) {
        console.error("RC Verification Error:", error);
        return { success: false, message: error.message };
    }
};