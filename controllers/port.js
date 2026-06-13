const Port = require("../models/port");
const User = require("../models/user");
const reverseGeocode = require("../utils/reverseGeocode");
const db = require("../config/firebase");
const Shipment = require("../models/shipment");


const register = async (req, res) => {
  try {
    const {port_name,email,representative_name,password,location,zones} = req.body;
    console.log("REQ BODY KEYS:", Object.keys(req.body));
    console.log("workforce_roles:", req.body.workforce_roles);
    console.log("workforce_shifts:", req.body.workforce_shifts);

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

    // Validate workforce shifts add up to total roles
    if (req.body.workforce_shifts?.length > 0 && req.body.workforce_roles) {
        const roles   = req.body.workforce_roles;
        const shifts  = req.body.workforce_shifts;
        const roleKeys = ["crane_operators", "truck_operators", "customs_officers", "ground_crew", "docking_staff"];

        for (const key of roleKeys) {
            const total     = roles[key] || 0;
            const shiftSum  = shifts.reduce((sum, s) => sum + (s[key] || 0), 0);
            if (shiftSum > total) {
                return res.status(400).json({
                    success: false,
                    message: `${key.replace(/_/g, " ")} assigned to shifts (${shiftSum}) exceeds total available (${total})`
                });
            }
        }
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

    // ── 5. Extract workforce data from request ────────────────────────────────────

    const workforce_roles = req.body.workforce_roles || {
        crane_operators:  0,
        truck_operators:  0,
        customs_officers: 0,
        ground_crew:      0,
        docking_staff:    0
    };

    const workforce_shifts = req.body.workforce_shifts || [];

    // Format shifts with auto-calculated times
    const totalMinutes = 24 * 60;
    const shiftCount   = workforce_shifts.length;

    const formattedShifts = workforce_shifts.map((shift, i) => {
        const startMinutes = Math.floor((totalMinutes / shiftCount) * i);
        const endMinutes   = Math.floor((totalMinutes / shiftCount) * (i + 1));

        const toTime = (mins) => {
            const h = String(Math.floor(mins / 60)).padStart(2, "0");
            const m = String(mins % 60).padStart(2, "0");
            return `${h}:${m}`;
        };

        return {
            shift_number: i + 1,
            label:        `Shift ${i + 1} (${toTime(startMinutes)}–${toTime(endMinutes === 1440 ? 1440 : endMinutes)})`,
            start_time:   toTime(startMinutes),
            end_time:     toTime(endMinutes >= 1440 ? 0 : endMinutes),
            workers: {
                crane_operators:  shift.crane_operators  || 0,
                truck_operators:  shift.truck_operators  || 0,
                customs_officers: shift.customs_officers || 0,
                ground_crew:      shift.ground_crew      || 0,
                docking_staff:    shift.docking_staff    || 0,
            }
        };
    });

    // ── 6. Create port in MongoDB ─────────────────────────────────────────────────

    const port = await Port.create({
        name: port_name,
        contact_email: email,
        location: {
            city,
            country,
            latitude:  location.lat,
            longitude: location.lng,
        },
        zones: formattedZones,
        workforce: {
            roles:  workforce_roles,
            shifts: formattedShifts
        }
    });

    // ── 7. Auto-create Firebase sensor structure for each zone ────────────────

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

    // ── 8. Create user linked to the new port ─────────────────────────────────

    const user = await User.create({
      name: representative_name,
      email,
      password,
      port_id: port._id,
    });

    // ── 9. Generate JWT token ─────────────────────────────────────────────────

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


const getPortZones = async (req, res) => {
    try {
        const port = await Port.findById(req.user.port_id);

        if (!port) {
            return res.status(404).json({
                success: false,
                message: "Port not found"
            });
        }

        return res.status(200).json({
            success:        true,
            port_name:      port.name,
            total_capacity: port.total_capacity,
            zones:          port.zones
        });

    } catch (err) {
        console.error("Get zones error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// GET /api/v1/public/ports — returns all port names and IDs for dropdown
const getPublicPorts = async (req, res) => {
    try {
        const ports = await Port.find({}, "name location.city location.country");

        return res.status(200).json({
            success: true,
            data: ports.map(p => ({
                id:   p._id,
                name: p.name,
                city: p.location?.city    || "",
                country: p.location?.country || ""
            }))
        });

    } catch (err) {
        console.error("Get public ports error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// GET /api/v1/public/ports/:portId/timeline — public timeline for a port
const getPublicPortTimeline = async (req, res) => {
    try {
        const { portId } = req.params;

        const port = await Port.findById(portId, "name location");
        if (!port) {
            return res.status(404).json({ success: false, message: "Port not found" });
        }

        // Only return safe fields — no sender details, no cargo specifics
        const shipments = await Shipment.find(
            { port_id: portId },
            "vessel.name type status schedule.arrival schedule.departure"
        ).sort({ "schedule.arrival": 1 });

        return res.status(200).json({
            success: true,
            port: {
                name:    port.name,
                city:    port.location?.city    || "",
                country: port.location?.country || ""
            },
            shipments
        });

    } catch (err) {
        console.error("Get public timeline error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// GET /api/v1/public/track/:trackingId — public shipment tracking by ID
const trackShipment = async (req, res) => {
    try {
const shipment = await Shipment.findById(
    req.params.trackingId,
    "vessel.name type status schedule actual gps_device_id weather_snapshots latest_weather checkpoints route_progress"
);

        if (!shipment) {
            return res.status(404).json({ success: false, message: "Shipment not found" });
        }

        return res.status(200).json({
            success: true,
            data: {
                vessel_name:  shipment.vessel.name,
                type:         shipment.type,
                status:       shipment.status,
                schedule:     shipment.schedule,
                actual:       shipment.actual,
                gps_device_id: shipment.gps_device_id,
                latest_weather: shipment.latest_weather
                            || shipment.weather_snapshots?.at(-1)
                            || null,
                checkpoints:    shipment.checkpoints,
                route_progress: shipment.route_progress
            }
        });

    } catch (err) {
        console.error("Track shipment error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

const getCapacityPrediction = async (req, res) => {
    try {
        const { portId } = req.params;
        const currentUsed = parseInt(req.query.current_used) || 0;

        const port = await Port.findById(portId, "zones total_capacity");
        if (!port) return res.status(404).json({ success: false, message: "Port not found" });

        const totalCapacity = port.total_capacity || 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tenDaysLater = new Date(today);
        tenDaysLater.setDate(today.getDate() + 10);

      const shipments = await Shipment.find({
          port_id: portId,
          "schedule.arrival": { $gte: today, $lte: tenDaysLater }
      }, "type vessel.container_count schedule.arrival");

        const days = [];
        let runningCapacity = currentUsed;

        for (let i = 0; i < 10; i++) {
            const day = new Date(today);
            day.setDate(today.getDate() + i);
            const dayEnd = new Date(day);
            dayEnd.setHours(23, 59, 59, 999);

            const dayShipments = shipments.filter(s => {
                const arrival = new Date(s.schedule.arrival);
                return arrival >= day && arrival <= dayEnd;
            });

            dayShipments.forEach(s => {
                if (s.type === "incoming") runningCapacity += (s.vessel?.container_count || 0);
                if (s.type === "outgoing") runningCapacity -= (s.vessel?.container_count || 0);
            });

            runningCapacity = Math.max(0, runningCapacity);

            days.push({
                date: day.toISOString(),
                predicted_used: runningCapacity,
                total_capacity: totalCapacity,
                pct: totalCapacity > 0 ? Math.min(Math.round((runningCapacity / totalCapacity) * 100), 100) : 0
            });
        }

        const peakDay = days.reduce((max, d) => d.pct > max.pct ? d : max, days[0]);

        return res.status(200).json({
            success: true,
            total_capacity: totalCapacity,
            current_used: currentUsed,
            days,
            peak_date: peakDay.date
        });

    } catch (err) {
        console.error("Capacity prediction error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ── Labour demand ratios (hardcoded) ──────────────────────────────────────────

const LABOUR_RATIOS = {
    crane_operators:  { per_containers: 30, per_vessel: 1 },
    truck_operators:  { per_containers: 20, per_vessel: 0 },
    customs_officers: { per_containers: 50, per_vessel: 1 },
    ground_crew:      { per_containers: 15, per_vessel: 2 },
    docking_staff:    { per_containers: 0,  per_vessel: 2 },
};

function calcDemandForShipment(containerCount) {
    const demand = {};
    for (const [role, ratio] of Object.entries(LABOUR_RATIOS)) {
        const fromContainers = ratio.per_containers > 0
            ? Math.ceil(containerCount / ratio.per_containers)
            : 0;
        const fromVessel = ratio.per_vessel || 0;
        demand[role] = fromContainers + fromVessel;
    }
    return demand;
}

function addDemands(a, b) {
    const result = { ...a };
    for (const key of Object.keys(b)) {
        result[key] = (result[key] || 0) + (b[key] || 0);
    }
    return result;
}

function emptyDemand() {
    return {
        crane_operators:  0,
        truck_operators:  0,
        customs_officers: 0,
        ground_crew:      0,
        docking_staff:    0
    };
}

// ── GET /port/workforce ───────────────────────────────────────────────────────

const getWorkforce = async (req, res) => {
    try {
        const port = await Port.findById(
            req.user.port_id,
            "name workforce"
        );
        if (!port) {
            return res.status(404).json({ success: false, message: "Port not found" });
        }

        return res.status(200).json({
            success:   true,
            workforce: port.workforce
        });

    } catch (err) {
        console.error("Get workforce error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ── PUT /port/workforce ────────────────────────────────────────────────────────

const updateWorkforce = async (req, res) => {
    try {
        const { roles, shifts } = req.body;

        if (!roles || !shifts || !Array.isArray(shifts)) {
            return res.status(400).json({
                success: false,
                message: "roles and shifts array are required"
            });
        }

        const port = await Port.findById(req.user.port_id);
        if (!port) {
            return res.status(404).json({ success: false, message: "Port not found" });
        }

        const ROLE_KEYS = [
            "crane_operators",
            "truck_operators",
            "customs_officers",
            "ground_crew",
            "docking_staff"
        ];

        // ── Validate roles ──────────────────────────────────────────────────────
        const cleanRoles = {};
        ROLE_KEYS.forEach(key => {
            const val = parseInt(roles[key]);
            cleanRoles[key] = isNaN(val) || val < 0 ? 0 : val;
        });

        // ── Validate shift count ─────────────────────────────────────────────────
        if (shifts.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one shift is required"
            });
        }

        // ── Compute shift times (divide 00:00–24:00 equally) ─────────────────────
        const totalMins = 1440;
        const shiftCount = shifts.length;
        const perShift   = Math.floor(totalMins / shiftCount);

        const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

        const newShifts = shifts.map((shift, i) => {
            const startMins = perShift * i;
            const endMins   = i === shiftCount - 1 ? totalMins : perShift * (i + 1);
            const start     = toTime(startMins);
            const end       = toTime(endMins >= 1440 ? 0 : endMins);

            const cleanWorkers = {};
            ROLE_KEYS.forEach(key => {
                const val = parseInt(shift.workers?.[key]);
                cleanWorkers[key] = isNaN(val) || val < 0 ? 0 : val;
            });

            const shiftTotal = ROLE_KEYS.reduce((sum, key) => sum + cleanWorkers[key], 0);

            return {
                shift_number: i + 1,
                label:        `Shift ${i + 1} (${start}–${end})`,
                start_time:   start,
                end_time:     end,
                workers:      cleanWorkers,
                shift_total:  shiftTotal
            };
        });

        // ── Validate shift totals don't exceed role totals ───────────────────────
        const errors = [];
        ROLE_KEYS.forEach(key => {
            const total    = cleanRoles[key];
            const shiftSum = newShifts.reduce((sum, s) => sum + s.workers[key], 0);

            if (shiftSum > total) {
                errors.push(`${key.replace(/_/g, " ")}: assigned ${shiftSum} across shifts but total is ${total}`);
            }
        });

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Shift worker assignments exceed total available workers",
                errors
            });
        }

        // ── Update and save ────────────────────────────────────────────────────────
        port.workforce.roles  = cleanRoles;
        port.workforce.shifts = newShifts; // ← replaces entire array, old shifts removed if count decreased

        await port.save(); // pre-save hooks recalculate total_workers and shift_totals

        return res.status(200).json({
            success: true,
            message: "Workforce updated successfully",
            workforce: port.workforce
        });

    } catch (err) {
        console.error("Update workforce error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ── GET /port/labour-prediction ───────────────────────────────────────────────

const getLabourPrediction = async (req, res) => {
    try {
        const portId = req.user.port_id;

        // Fetch port workforce config
        const port = await Port.findById(portId, "workforce");
        if (!port) {
            return res.status(404).json({ success: false, message: "Port not found" });
        }

        const workforce = port.workforce;
        const shifts    = workforce?.shifts    || [];
        const roles     = workforce?.roles     || emptyDemand();
        const shiftCount = shifts.length || 1;

        // Fetch shipments for next 7 days
        const today       = new Date();
        today.setHours(0, 0, 0, 0);
        const sevenDays   = new Date(today);
        sevenDays.setDate(today.getDate() + 7);

        const shipments = await Shipment.find({
            port_id: portId,
            "schedule.arrival": { $gte: today, $lte: sevenDays }
        }, "vessel.container_count schedule.arrival type status");

        // Build 7-day prediction
        const days = [];

        for (let i = 0; i < 7; i++) {
            const day    = new Date(today);
            day.setDate(today.getDate() + i);
            const dayEnd = new Date(day);
            dayEnd.setHours(23, 59, 59, 999);

            // Get shipments arriving on this day
            const dayShipments = shipments.filter(s => {
                const arrival = new Date(s.schedule.arrival);
                return arrival >= day && arrival <= dayEnd;
            });

            // Calculate total demand for the day
            const totalDemand = dayShipments.reduce((acc, s) => {
                const d = calcDemandForShipment(s.vessel?.container_count || 0);
                return addDemands(acc, d);
            }, emptyDemand());

            // Distribute demand across shifts by arrival time
            const shiftDemands = shifts.map((shift, idx) => {
                // Which shipments fall in this shift's time window
                const [startH, startM] = shift.start_time.split(":").map(Number);
                const [endH,   endM]   = shift.end_time.split(":").map(Number);

                const startMins = startH * 60 + startM;
                const endMins   = endH   * 60 + endM || 1440;

                const shiftShipments = dayShipments.filter(s => {
                    const arr    = new Date(s.schedule.arrival);
                    const arrMin = arr.getHours() * 60 + arr.getMinutes();
                    return arrMin >= startMins && arrMin < endMins;
                });

                const shiftDemand = shiftShipments.reduce((acc, s) => {
                    const d = calcDemandForShipment(s.vessel?.container_count || 0);
                    return addDemands(acc, d);
                }, emptyDemand());

                // Compare demand vs available workers in this shift
                const available  = shift.workers || emptyDemand();
                const shortages  = {};
                let   hasShortage = false;

                for (const role of Object.keys(shiftDemand)) {
                    const needed  = shiftDemand[role];
                    const avail   = available[role] || 0;
                    const deficit = needed - avail;
                    shortages[role] = {
                        needed,
                        available: avail,
                        deficit:   Math.max(deficit, 0),
                        surplus:   Math.max(-deficit, 0),
                        ok:        deficit <= 0
                    };
                    if (deficit > 0) hasShortage = true;
                }

                return {
                    shift_number: shift.shift_number,
                    label:        shift.label,
                    start_time:   shift.start_time,
                    end_time:     shift.end_time,
                    shipment_count: shiftShipments.length,
                    demand:       shiftDemand,
                    shortages,
                    has_shortage: hasShortage
                };
            });

            // Day-level shortage — compare total demand vs total roles
            const dayShortages  = {};
            let   dayHasShortage = false;
            for (const role of Object.keys(totalDemand)) {
                const needed  = totalDemand[role];
                const avail   = roles[role] || 0;
                const deficit = needed - avail;
                dayShortages[role] = {
                    needed,
                    available: avail,
                    deficit:   Math.max(deficit, 0),
                    surplus:   Math.max(-deficit, 0),
                    ok:        deficit <= 0
                };
                if (deficit > 0) dayHasShortage = true;
            }

            days.push({
                date:           day.toISOString(),
                shipment_count: dayShipments.length,
                total_demand:   totalDemand,
                shift_demands:  shiftDemands,
                day_shortages:  dayShortages,
                has_shortage:   dayHasShortage
            });
        }

        // Summary stats
        const totalShortage = days.filter(d => d.has_shortage).length;
        const peakDay       = days.reduce((max, d) => {
            const maxTotal = Object.values(d.total_demand).reduce((a, b) => a + b, 0);
            const curTotal = Object.values(max.total_demand).reduce((a, b) => a + b, 0);
            return maxTotal > curTotal ? d : max;
        }, days[0]);

        return res.status(200).json({
            success: true,
            workforce: {
                roles,
                shifts,
                total_workers: workforce?.total_workers || 0
            },
            days,
            summary: {
                days_with_shortage: totalShortage,
                peak_demand_date:   peakDay?.date || null,
                total_shipments:    shipments.length
            }
        });

    } catch (err) {
        console.error("Labour prediction error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ── Constants for efficiency calculation ──────────────────────────────────────

const ON_TIME_TOLERANCE_HOURS   = 2;   // ±2 hours counts as "on time"
const TURNAROUND_BENCHMARK_HOURS = 24; // target turnaround time

// GET /api/v1/port/efficiency-score
const getEfficiencyScore = async (req, res) => {
    try {
        const portId = req.user.port_id;

        const port = await Port.findById(portId, "zones total_capacity");
        if (!port) {
            return res.status(404).json({ success: false, message: "Port not found" });
        }

        const shipments = await Shipment.find(
            { port_id: portId },
            "type status schedule actual checkpoints weather_snapshots"
        );

        // ── 1. On-Time Arrival Rate (35%) ────────────────────────────────────
        const arrivedShipments = shipments.filter(s => s.actual?.arrival);
        let onTimeCount = 0;

        arrivedShipments.forEach(s => {
            const scheduled = new Date(s.schedule.arrival).getTime();
            const actual    = new Date(s.actual.arrival).getTime();
            const diffHours = Math.abs(actual - scheduled) / 3600000;
            if (diffHours <= ON_TIME_TOLERANCE_HOURS) onTimeCount++;
        });

        const onTimeRate = arrivedShipments.length > 0
            ? Math.round((onTimeCount / arrivedShipments.length) * 100)
            : 100; // no data yet — neutral score

        // ── 2. Zone Utilization Efficiency (25%) ─────────────────────────────
        let zoneUtilization = 100;
        let globalOccupancyPct = 0;

        try {
            const snapshot   = await db.ref(`sensor_readings/${portId}`).once("value");
            const sensorData = snapshot.val() || {};

            let totalOccupied = 0;
            let totalCapacity = port.total_capacity || 0;

            Object.values(sensorData).forEach(zone => {
                totalOccupied += zone?.container_count || 0;
            });

            if (totalCapacity > 0) {
                globalOccupancyPct = (totalOccupied / totalCapacity) * 100;

                if (globalOccupancyPct >= 60 && globalOccupancyPct <= 85) {
                    zoneUtilization = 100;
                } else if (globalOccupancyPct < 60) {
                    zoneUtilization = 100 - (60 - globalOccupancyPct) * (100 / 60);
                } else {
                    zoneUtilization = 100 - (globalOccupancyPct - 85) * (100 / 15);
                }

                zoneUtilization = Math.max(0, Math.min(100, Math.round(zoneUtilization)));
            }
        } catch (err) {
            console.error("Zone utilization fetch error:", err.message);
        }

        // ── 3. Turnaround Efficiency (20%) ───────────────────────────────────
        const completedShipments = shipments.filter(s => s.actual?.arrival && s.actual?.departure);
        let turnaroundEfficiency = 100;

        if (completedShipments.length > 0) {
            const totalTurnaroundHours = completedShipments.reduce((sum, s) => {
                const arr = new Date(s.actual.arrival).getTime();
                const dep = new Date(s.actual.departure).getTime();
                return sum + Math.max((dep - arr) / 3600000, 0);
            }, 0);

            const avgTurnaround = totalTurnaroundHours / completedShipments.length;
            turnaroundEfficiency = Math.round(
                Math.min(100, (TURNAROUND_BENCHMARK_HOURS / avgTurnaround) * 100)
            );
        }

        // ── 4. Checkpoint Adherence Rate (10%) ───────────────────────────────
        let reachedTotal = 0;
        let missedTotal  = 0;

        shipments.forEach(s => {
            (s.checkpoints || []).forEach(cp => {
                if (cp.status === "reached") reachedTotal++;
                if (cp.status === "missed")  missedTotal++;
            });
        });

        const checkpointAdherence = (reachedTotal + missedTotal) > 0
            ? Math.round((reachedTotal / (reachedTotal + missedTotal)) * 100)
            : 100;

        // ── 5. Disruption Resilience Score (10%) ─────────────────────────────
        const stormShipments = arrivedShipments.filter(s =>
            s.weather_snapshots?.some(w => w.storm_flag)
        );

        let stormOnTimeCount = 0;
        stormShipments.forEach(s => {
            const scheduled = new Date(s.schedule.arrival).getTime();
            const actual    = new Date(s.actual.arrival).getTime();
            const diffHours = Math.abs(actual - scheduled) / 3600000;
            if (diffHours <= ON_TIME_TOLERANCE_HOURS) stormOnTimeCount++;
        });

        const disruptionResilience = stormShipments.length > 0
            ? Math.round((stormOnTimeCount / stormShipments.length) * 100)
            : 100; // no storms encountered — neutral score

        // ── Weighted Total ────────────────────────────────────────────────────
        const totalScore = Math.round(
            onTimeRate            * 0.35 +
            zoneUtilization       * 0.25 +
            turnaroundEfficiency  * 0.20 +
            checkpointAdherence   * 0.10 +
            disruptionResilience  * 0.10
        );

        const getLabel = (score) => {
            if (score >= 85) return "Excellent";
            if (score >= 70) return "Good";
            if (score >= 50) return "Needs Attention";
            return "Critical";
        };

        return res.status(200).json({
            success: true,
            score:   totalScore,
            label:   getLabel(totalScore),
            breakdown: {
                on_time_arrival_rate:   { score: onTimeRate,           weight: 0.35, sample_size: arrivedShipments.length },
                zone_utilization:       { score: zoneUtilization,      weight: 0.25, current_occupancy_pct: Math.round(globalOccupancyPct) },
                turnaround_efficiency:  { score: turnaroundEfficiency, weight: 0.20, sample_size: completedShipments.length },
                checkpoint_adherence:   { score: checkpointAdherence,  weight: 0.10, reached: reachedTotal, missed: missedTotal },
                disruption_resilience:  { score: disruptionResilience, weight: 0.10, sample_size: stormShipments.length }
            }
        });

    } catch (err) {
        console.error("Efficiency score error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

module.exports = { register, login, getPortDetails, getPortZones, getPublicPorts, getPublicPortTimeline,trackShipment, getCapacityPrediction,getLabourPrediction,getWorkforce,getEfficiencyScore, updateWorkforce  };