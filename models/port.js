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
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

// Auto-assign zone_ids (A, B, C...) and calculate total_capacity before save
portSchema.pre("save", async function () {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  this.zones.forEach((zone, index) => {
    if (!zone.zone_id) {
      zone.zone_id = letters[index] ?? `Z${index}`;
    }
  });

  this.total_capacity = this.zones.reduce(
    (sum, zone) => sum + zone.max_capacity,
    0
  );
});

module.exports = mongoose.model("Port", portSchema);