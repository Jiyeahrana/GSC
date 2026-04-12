const mongoose = require("mongoose");

const shipmentSchema = new mongoose.Schema({
    port_id:  { type: mongoose.Schema.Types.ObjectId, ref: "Port", required: true },
    type:     { type: String, enum: ["incoming", "outgoing"], required: true },

    vessel: {
        name:     { type: String, required: true },
        capacity: { type: Number, required: true },
        container_count: { type: Number, required: true, min: [1, "Container count must be at least 1"] }
    },

    cargo: {
        origin:      { type: String, required: true },
        destination: { type: String, required: true }
    },

    schedule: {
        arrival:   { type: Date, required: true },
        departure: { type: Date, required: true }
    },

    actual: {
        arrival:   { type: Date, default: null },
        departure: { type: Date, default: null }
    },

    status: {
        type:    String,
        enum:    ["registered", "in_transit", "at_port", "departed", "arrived"],
        default: "registered"
    },

    gps_device_id: { type: String, required: true },

    weather_snapshots: {
        type: [
            {
                timestamp:      { type: Date, default: Date.now },
                lat:            { type: Number, required: true },
                lng:            { type: Number, required: true },
                wind_speed_kmh: { type: Number, required: true },
                precipitation:  { type: Number, required: true },
                storm_flag:     { type: Boolean, default: false }
            }
        ],
        default: [],
        validate: {
            validator: (arr) => arr.length <= 10,
            message:   "weather_snapshots cannot exceed 10 entries"
        }
    },

    sender_name:  { type: String, required: true },
    sender_email: { type: String, required: true }

}, {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
});

module.exports = mongoose.model("Shipment", shipmentSchema);