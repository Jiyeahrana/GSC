const mongoose = require("mongoose");

const portSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Port name is required"],
      trim: true,
    },
    location: {
      city: {
        type: String,
        required: [true, "City is required"],
        trim: true,
      },
      country: {
        type: String,
        required: [true, "Country is required"],
        trim: true,
      },
      latitude: {
        type: Number,
        required: [true, "Latitude is required"],
        min: -90,
        max: 90,
      },
      longitude: {
        type: Number,
        required: [true, "Longitude is required"],
        min: -180,
        max: 180,
      },
    },
    contact_email: {
      type: String,
      required: [true, "Contact email is required"],
      unique: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    total_capacity: {
        type: Number,
        default: 0,
    },
    zones: {
      type: [
        {
          zone_id: {          // ← ADD THIS
            type: String,
            default: ""
          },
          name: {
            type: String,
            required: true,
            trim: true,
          },
          max_capacity: {
            type: Number,
            required: true,
            min: [1, "Zone capacity must be greater than 0"],
          },
          sensor_ids: {
            type: [String],
            default: [],
          },
        },
      ],
      validate: {
        validator: (zones) => zones.length > 0,
        message: "At least one zone is required",
      },
    },
    workforce: {
        roles: {
            crane_operators:  { type: Number, default: 0, min: 0 },
            truck_operators:  { type: Number, default: 0, min: 0 },
            customs_officers: { type: Number, default: 0, min: 0 },
            ground_crew:      { type: Number, default: 0, min: 0 },
            docking_staff:    { type: Number, default: 0, min: 0 },
        },
        total_workers: { type: Number, default: 0 },
        shifts: {
            type: [
                {
                    shift_number: { type: Number, required: true },
                    label:        { type: String, required: true },  // e.g. "Shift 1 (00:00–08:00)"
                    start_time:   { type: String, required: true },  // "00:00"
                    end_time:     { type: String, required: true },  // "08:00"
                    workers: {
                        crane_operators:  { type: Number, default: 0 },
                        truck_operators:  { type: Number, default: 0 },
                        customs_officers: { type: Number, default: 0 },
                        ground_crew:      { type: Number, default: 0 },
                        docking_staff:    { type: Number, default: 0 },
                    },
                    shift_total: { type: Number, default: 0 }
                }
            ],
            default: []
        }
    }
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

// Hook 1: Zones and Capacity
portSchema.pre("save", async function () {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    if (this.zones && this.zones.length > 0) {
        this.zones.forEach((zone, index) => {
            if (!zone.zone_id) {
                zone.zone_id = letters[index] ?? `Z${index}`;
            }
        });
        this.total_capacity = this.zones.reduce(
            (sum, zone) => sum + (zone.max_capacity || 0), 0
        );
    }
});

// Hook 2: Workforce and Shifts
portSchema.pre("save", async function () {
    if (this.workforce?.roles) {
        const r = this.workforce.roles;
        this.workforce.total_workers =
            (r.crane_operators  || 0) +
            (r.truck_operators  || 0) +
            (r.customs_officers || 0) +
            (r.ground_crew      || 0) +
            (r.docking_staff    || 0);
    }

    if (this.workforce?.shifts) {
        this.workforce.shifts.forEach((shift) => {
            const w = shift.workers;
            if (w) {
                shift.shift_total =
                    (w.crane_operators  || 0) +
                    (w.truck_operators  || 0) +
                    (w.customs_officers || 0) +
                    (w.ground_crew      || 0) +
                    (w.docking_staff    || 0);
            }
        });
    }
});

module.exports = mongoose.model("Port", portSchema);