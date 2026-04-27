const Shipment = require("../models/Shipment");

const updateGPSLocation = async (req, res) => {
    try {
        const { gps_device_id, lat, lng, accuracy, timestamp } = req.body;

        console.log("Received gps_device_id:", gps_device_id, typeof gps_device_id);

        if (!gps_device_id || lat === undefined || lng === undefined) {
            return res.status(400).json({ success: false, message: "gps_device_id, lat and lng are required" });
        }

        const shipment = await Shipment.findOneAndUpdate(
            { gps_device_id },
            { $set: { "latest_weather.lat": lat, "latest_weather.lng": lng } },
            { new: true }
        );

        console.log("Updated shipment latest_weather:", shipment?.latest_weather);

        if (!shipment) {
            return res.status(404).json({ success: false, message: "No shipment found with that GPS device ID" });
        }

        return res.status(200).json({ success: true, message: "Position updated" });

    } catch (error) {
        console.error("GPS update error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

module.exports = { updateGPSLocation };