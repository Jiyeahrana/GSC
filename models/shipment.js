const mongoose = require("mongoose");

// ─── Checkpoint Sub-Schema ────────────────────────────────────────────────────
const checkpointSchema = new mongoose.Schema({
  index:            { type: Number, required: true },
  name:             { type: String, required: true },
  position: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  expected_arrival: { type: Date, default: null },
  actual_arrival:   { type: Date, default: null },
  status:           { type: String, enum: ["pending", "reached", "missed"], default: "pending" },
}, { _id: false });

// ─── Shipment Schema ──────────────────────────────────────────────────────────
const shipmentSchema = new mongoose.Schema({
  port_id: { type: mongoose.Schema.Types.ObjectId, ref: "Port", required: true },
  type:    { type: String, enum: ["incoming", "outgoing"], required: true },

  vessel: {
    name:            { type: String, required: true },
    capacity:        { type: Number, required: true },
    container_count: { type: Number, required: true, min: [1, "Container count must be at least 1"] },
  },

  cargo: {
    origin:      { type: String, required: true },
    destination: { type: String, required: true },
  },

  schedule: {
    arrival:   { type: Date, required: true },
    departure: { type: Date, required: true },
  },

  actual: {
    arrival:   { type: Date, default: null },
    departure: { type: Date, default: null },
  },

  status: {
    type:    String,
    enum:    ["registered", "in_transit", "at_port", "departed", "arrived"],
    default: "registered",
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
        storm_flag:     { type: Boolean, default: false },
      },
    ],
    default:  [],
    validate: {
      validator: (arr) => arr.length <= 10,
      message:   "weather_snapshots cannot exceed 10 entries",
    },
  },

  latest_weather: {
    lat:            { type: Number, default: null },
    lng:            { type: Number, default: null },
    wind_speed_kmh: { type: Number, default: null },
    storm_flag:     { type: Boolean, default: false },
  },

  // ── NEW: Planned Route ──────────────────────────────────────────────────────
  // Ordered array of { lat, lng } waypoints forming the planned sea-lane route.
  planned_route: {
    type: [
      {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
      },
    ],
    default: [],
  },

  // ── NEW: Checkpoints ────────────────────────────────────────────────────────
  checkpoints: {
    type:    [checkpointSchema],
    default: [],
  },

  // ── NEW: Route Progress ─────────────────────────────────────────────────────
  route_progress: {
    current_checkpoint_index:   { type: Number, default: 0 },
    checkpoints_reached:        { type: Number, default: 0 },
    total_checkpoints:          { type: Number, default: 0 },
    delay_minutes:              { type: Number, default: 0 },
    on_time:                    { type: Boolean, default: true },
    next_checkpoint_name:       { type: String, default: "Checkpoint 1" },
    eta_to_next_checkpoint_min: { type: Number, default: null },
    last_updated:               { type: Date, default: null },
  },

  sender_name:  { type: String, required: true },
  sender_email: { type: String, required: true },

}, {
  timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
});

const Shipment = mongoose.models.Shipment || mongoose.model("Shipment", shipmentSchema);
module.exports = Shipment;