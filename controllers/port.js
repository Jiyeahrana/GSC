const Port = require("../models/port");
const User = require("../models/user");
const reverseGeocode = require("../utils/reverseGeocode");
const db = require("../config/firebase");


const register = async (req, res) => {
  try {
    const {port_name,email,representative_name,password,location,zones} = req.body;

    // ── 1. Validate required fields ──────────────────────────────────────────

    if (!port_name || !email ||!representative_name ||!password ||!location || !zones) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!location.lat || !location.lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    if (!Array.isArray(zones) || zones.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one zone is required",
      });
    }

    // ── 2. Check if email already exists in either collection ─────────────────

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const existingPort = await Port.findOne({ contact_email: email });
    if (existingPort) {
      return res.status(409).json({
        success: false,
        message: "A port with this email already exists",
      });
    }

    // ── 3. Reverse geocode lat/lng → city + country ───────────────────────────

    const { city, country } = await reverseGeocode(
      location.lat,
      location.lng
    );

    // ── 4. Build zones array (zone_id auto-assigned in pre-save hook) ─────────

    const formattedZones = zones.map((zone) => ({
      name: zone.zone_name,
      max_capacity: zone.max_capacity,
      sensor_ids: [],
    }));

    // ── 5. Create port in MongoDB ─────────────────────────────────────────────

    const port = await Port.create({
      name: port_name,
      contact_email: email,
      location: {
        city,
        country,
        latitude: location.lat,
        longitude: location.lng,
      },
      zones: formattedZones,
    });

    // ── 6. Auto-create Firebase sensor structure for each zone ────────────────

    const firebaseZones = {};

    port.zones.forEach(zone => {
      const zoneKey = `zone_${zone.zone_id.toLowerCase()}`;
      firebaseZones[zoneKey] = {
        container_count: 0,
        last_updated:    Date.now(),
        last_event:      "none",
        max_capacity:    zone.max_capacity,
        zone_name:       zone.name
      };
    });

    await db.ref(`sensor_readings/${port._id}`).set(firebaseZones);

    // ── 7. Create user linked to the new port ─────────────────────────────────

    const user = await User.create({
      name: representative_name,
      email,
      password,
      port_id: port._id,
    });

    // ── 8. Generate JWT token ─────────────────────────────────────────────────

    const token = user.generateToken();

    // ── 9. Send response ──────────────────────────────────────────────────────

    return res.status(201).json({
      success: true,
      message: "Port registered successfully",
      token,
      data: {
        user: {
          id:      user._id,
          name:    user.name,
          email:   user.email,
          port_id: user.port_id,
        },
        port: {
          id:             port._id,
          name:           port.name,
          location:       port.location,
          total_capacity: port.total_capacity,
          zones:          port.zones,
        },
      },
    });

  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: messages.join(", "),
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    console.error("Register error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error, please try again later",
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // ── 1. Validate fields ──────────────────────────────────────────────────

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // ── 2. Find user by email (explicitly select password since select:false) 

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // ── 3. Compare password ─────────────────────────────────────────────────

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // ── 4. Update last_login ────────────────────────────────────────────────

    user.last_login = new Date();
    await user.save();

    // ── 5. Generate token ───────────────────────────────────────────────────

    const token = user.generateToken();

    // ── 6. Send response ────────────────────────────────────────────────────

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        port_id: user.port_id,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error, please try again later",
    });
  }
};

const getPortDetails = async (req, res) => {
    try {
        const port = await Port.findById(req.user.port_id);

        if (!port) {
            return res.status(404).json({
                success: false,
                message: "Port not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: port
        });

    } catch (err) {
        console.error("Get port error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

module.exports = { register, login, getPortDetails };