const { GoogleGenerativeAI } = require("@google/generative-ai");
const Shipment = require("../models/shipment");
const Port     = require("../models/port");
const db = require("../config/firebase"); // adjust path to match your project
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, {
    requestOptions: {
        customHeaders: {
            "x-goog-api-key": process.env.GEMINI_API_KEY
        }
    }
});

// ── Tool definitions ──────────────────────────────────────────────────────────

const PUBLIC_TOOLS = [{
    functionDeclarations: [
        {
            name:        "trackShipment",
            description: "Track a shipment by its tracking ID and return its status, vessel name, ETA and last known location",
            parameters: {
                type: "OBJECT",
                properties: {
                    trackingId: { type: "STRING", description: "The shipment tracking ID" }
                },
                required: ["trackingId"]
            }
        },
        {
            name:        "getPortTimeline",
            description: "Get the next 10 scheduled shipments for a port by port name",
            parameters: {
                type: "OBJECT",
                properties: {
                    portName: { type: "STRING", description: "Name of the port" }
                },
                required: ["portName"]
            }
        },
        {
            name:        "listPorts",
            description: "List all available ports",
            parameters:  { type: "OBJECT", properties: {} }
        }
    ]
}];

const ADMIN_TOOLS = [{
    functionDeclarations: [
        {
            name:        "getTodayShipments",
            description: "Get all shipments arriving or departing today for this port",
            parameters:  { type: "OBJECT", properties: {} }
        },
        {
            name:        "getShipmentById",
            description: "Get full details of a specific shipment by its ID including status, vessel, cargo, weather and delay info",
            parameters: {
                type: "OBJECT",
                properties: {
                    shipmentId: { type: "STRING", description: "The MongoDB shipment ID" }
                },
                required: ["shipmentId"]
            }
        },
        {
            name:        "getShipmentsBetween",
            description: "Get shipments scheduled between two dates",
            parameters: {
                type: "OBJECT",
                properties: {
                    startDate: { type: "STRING", description: "Start date in ISO format e.g. 2026-04-19" },
                    endDate:   { type: "STRING", description: "End date in ISO format e.g. 2026-04-21"   }
                },
                required: ["startDate", "endDate"]
            }
        },
        {
            name:        "getZoneCapacity",
            description: "Get current zone capacity and occupancy stats for this port",
            parameters:  { type: "OBJECT", properties: {} }
        },
        {
            name:        "getPortStats",
            description: "Get overall port statistics: total shipments, incoming, outgoing, delayed, at port counts",
            parameters:  { type: "OBJECT", properties: {} }
        },
        {
            name:        "getDelayedShipments",
            description: "Get all shipments that are currently delayed",
            parameters:  { type: "OBJECT", properties: {} }
        },
        {
            name:        "getShipmentsByStatus",
            description: "Get shipments filtered by a specific status",
            parameters: {
                type: "OBJECT",
                properties: {
                    status: {
                        type: "STRING",
                        description: "One of: registered, in_transit, at_port, delayed, departed, arrived"
                    }
                },
                required: ["status"]
            }
        },
        {
            name:        "getLabourDemand",
            description: "Get workforce/labour demand forecast for upcoming days, including any staffing shortages by role (crane operators, truck operators, customs officers, ground crew, docking staff)",
            parameters: {
                type: "OBJECT",
                properties: {
                    daysAhead: {
                        type: "NUMBER",
                        description: "How many days ahead to forecast, default 7, max 7"
                    }
                }
            }
        }
    ]
}];

// ── Labour demand ratios (same as labour_prediction controller) ──────────────

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
        demand[role] = fromContainers + (ratio.per_vessel || 0);
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
        crane_operators: 0, truck_operators: 0,
        customs_officers: 0, ground_crew: 0, docking_staff: 0
    };
}
// ── Tool executors ────────────────────────────────────────────────────────────

async function executePublicTool(name, args) {
    switch (name) {

        case "trackShipment": {
            const s = await Shipment.findById(args.trackingId,
                "vessel.name type status schedule actual latest_weather cargo gps_device_id"
            );
            if (!s) return { error: "Shipment not found" };
            return {
                vessel:    s.vessel.name,
                type:      s.type,
                status:    s.status,
                eta:       s.schedule.arrival,
                origin:    s.cargo.origin,
                destination: s.cargo.destination,
                lastLat:   s.weather_snapshots?.at(-1)?.lat || null,
                lastLng:   s.weather_snapshots?.at(-1)?.lng || null,
                stormFlag: s.weather_snapshots?.at(-1)?.storm_flag || false
            };
        }

        case "getPortTimeline": {
            const ports = await Port.find({
                name: { $regex: args.portName, $options: "i" }
            }, "name location");

            if (ports.length === 0) return { error: "No port found with that name" };

            const port      = ports[0];
            const shipments = await Shipment.find(
                { port_id: port._id },
                "vessel.name type status schedule.arrival schedule.departure"
            ).sort({ "schedule.arrival": 1 }).limit(10);

            return {
                port:      port.name,
                shipments: shipments.map(s => ({
                    vessel:   s.vessel.name,
                    type:     s.type,
                    status:   s.status,
                    arrival:  s.schedule.arrival,
                    departure: s.schedule.departure
                })),
                suggestions: ports.length > 1 ? ports.slice(1, 4).map(p => p.name) : []
            };
        }

        case "listPorts": {
            const ports = await Port.find({}, "name location.city location.country");
            return { ports: ports.map(p => ({ name: p.name, city: p.location?.city, country: p.location?.country })) };
        }

        default:
            return { error: "Unknown tool" };
    }
}

async function executeAdminTool(name, args, portId) {
    switch (name) {

        case "getTodayShipments": {
            const start = new Date(); start.setHours(0, 0, 0, 0);
            const end   = new Date(); end.setHours(23, 59, 59, 999);
            const ships = await Shipment.find({
                port_id: portId,
                $or: [
                    { "schedule.arrival":   { $gte: start, $lte: end } },
                    { "schedule.departure": { $gte: start, $lte: end } }
                ]
            }, "vessel.name type status schedule cargo sender_name");
            return { count: ships.length, shipments: ships };
        }

        case "getShipmentById": {
            const s = await Shipment.findOne({ _id: args.shipmentId, port_id: portId });
            if (!s) return { error: "Shipment not found" };
            const now      = new Date();
            const isLate   = s.status === "in_transit" && new Date(s.schedule.arrival) < now;
            return {
                id:          s._id,
                vessel:      s.vessel,
                cargo:       s.cargo,
                status:      s.status,
                schedule:    s.schedule,
                actual:      s.actual,
                sender:      s.sender_name,
                isDelayed:   isLate,
                delayHours:  isLate ? Math.round((now - new Date(s.schedule.arrival)) / 3600000) : 0,
                stormAlert:  s.weather_snapshots?.at(-1)?.storm_flag || false,
                lastLocation: s.weather_snapshots?.at(-1)
                    ? { lat: s.weather_snapshots.at(-1).lat, lng: s.weather_snapshots.at(-1).lng }
                    : null
            };
        }

        case "getShipmentsBetween": {
            const start = new Date(args.startDate);
            const end   = new Date(args.endDate);
            end.setHours(23, 59, 59, 999);
            const ships = await Shipment.find({
                port_id: portId,
                "schedule.arrival": { $gte: start, $lte: end }
            }, "vessel.name type status schedule cargo sender_name").sort({ "schedule.arrival": 1 });
            return { count: ships.length, shipments: ships };
        }

        case "getZoneCapacity": {
            const port = await Port.findById(portId, "zones total_capacity");
            if (!port) return { error: "Port not found" };

            const totalCapacity = port.total_capacity || 0;

            // ── Fetch live sensor data from Firebase directly ──────────────────────
            let sensorData = {};
            try {
                const snapshot = await db.ref(`sensor_readings/${portId}`).once("value");
                sensorData = snapshot.val() || {};
            } catch (err) {
                console.error("Firebase fetch error in getZoneCapacity:", err.message);
            }

            let totalOccupied = 0;
            if (sensorData && typeof sensorData === "object") {
                totalOccupied = Object.values(sensorData)
                    .reduce((sum, zone) => sum + (zone?.container_count || 0), 0);
            }

            const zones = port.zones.map(z => {
                const parts   = z.name?.split(" ") || [];
                const letter  = parts[1] || "";
                const zoneKey = `zone_${letter}`;

                const occupied  = sensorData?.[zoneKey]?.container_count || 0;
                const available = Math.max(z.max_capacity - occupied, 0);
                const pct       = z.max_capacity > 0
                    ? Math.round((occupied / z.max_capacity) * 100)
                    : 0;

                return {
                    name:        z.name,
                    firebaseKey: zoneKey,
                    maxCapacity: z.max_capacity,
                    occupied,
                    available,
                    pct,
                    status: pct >= 90 ? "Critical" : pct >= 70 ? "High Load" : pct >= 40 ? "Optimal" : "Low"
                };
            });

            return {
                totalCapacity,
                totalOccupied,
                totalAvailable: Math.max(totalCapacity - totalOccupied, 0),
                globalOccupancyPct: totalCapacity > 0
                    ? Math.round((totalOccupied / totalCapacity) * 100)
                    : 0,
                zones
            };
        }

        case "getPortStats": {
            const all      = await Shipment.find({ port_id: portId }, "type status schedule");
            const now      = new Date();
            const today    = all.filter(s => new Date(s.schedule.arrival).toDateString() === now.toDateString());
            const delayed  = all.filter(s => s.status === "in_transit" && new Date(s.schedule.arrival) < now);
            return {
                total:     all.length,
                today:     today.length,
                incoming:  all.filter(s => s.type === "incoming").length,
                outgoing:  all.filter(s => s.type === "outgoing").length,
                inTransit: all.filter(s => s.status === "in_transit").length,
                atPort:    all.filter(s => s.status === "at_port").length,
                delayed:   delayed.length,
                arrived:   all.filter(s => s.status === "arrived").length,
                departed:  all.filter(s => s.status === "departed").length
            };
        }

        case "getDelayedShipments": {
            const now  = new Date();
            const ships = await Shipment.find({
                port_id: portId,
                status:  "in_transit",
                "schedule.arrival": { $lt: now }
            }, "vessel.name cargo schedule status sender_name");
            return {
                count: ships.length,
                shipments: ships.map(s => ({
                    vessel:     s.vessel.name,
                    origin:     s.cargo.origin,
                    destination: s.cargo.destination,
                    scheduledArrival: s.schedule.arrival,
                    delayHours: Math.round((now - new Date(s.schedule.arrival)) / 3600000),
                    sender:     s.sender_name
                }))
            };
        }

        case "getShipmentsByStatus": {
            const ships = await Shipment.find({
                port_id: portId,
                status:  args.status
            }, "vessel.name type cargo schedule sender_name").sort({ "schedule.arrival": -1 }).limit(20);
            return { count: ships.length, shipments: ships };
        }

        case "getLabourDemand": {
            const port = await Port.findById(portId, "workforce");
            if (!port) return { error: "Port not found" };

            const workforce  = port.workforce;
            const roles      = workforce?.roles  || emptyDemand();
            const shifts     = workforce?.shifts || [];
            const daysAhead  = Math.min(args.daysAhead || 7, 7);

            const today = new Date(); today.setHours(0, 0, 0, 0);
            const endDate = new Date(today);
            endDate.setDate(today.getDate() + daysAhead);

            const shipments = await Shipment.find({
                port_id: portId,
                "schedule.arrival": { $gte: today, $lte: endDate }
            }, "vessel.container_count schedule.arrival type");

            const days = [];
            for (let i = 0; i < daysAhead; i++) {
                const day = new Date(today);
                day.setDate(today.getDate() + i);
                const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);

                const dayShipments = shipments.filter(s => {
                    const arr = new Date(s.schedule.arrival);
                    return arr >= day && arr <= dayEnd;
                });

                const totalDemand = dayShipments.reduce((acc, s) => {
                    return addDemands(acc, calcDemandForShipment(s.vessel?.container_count || 0));
                }, emptyDemand());

                const shortages = {};
                let hasShortage = false;
                for (const role of Object.keys(totalDemand)) {
                    const needed = totalDemand[role];
                    const avail  = roles[role] || 0;
                    const deficit = Math.max(needed - avail, 0);
                    shortages[role] = { needed, available: avail, deficit };
                    if (deficit > 0) hasShortage = true;
                }

                days.push({
                    date: day.toISOString().split("T")[0],
                    shipment_count: dayShipments.length,
                    demand: totalDemand,
                    available: roles,
                    shortages,
                    has_shortage: hasShortage
                });
            }

            return {
                total_workers: workforce?.total_workers || 0,
                roles_available: roles,
                shift_count: shifts.length,
                days
            };
        }

        default:
            return { error: "Unknown tool" };
    }
}

// ── System prompts ────────────────────────────────────────────────────────────

const PUBLIC_SYSTEM_PROMPT = `
You are a helpful assistant for POMS (Port Operations Management System) — a web platform for managing port operations. You assist PUBLIC users who are visiting the platform.

────────────────────────────────────────
WEBSITE STRUCTURE & NAVIGATION
────────────────────────────────────────

The platform has TWO sides:

1. PUBLIC SIDE (no login needed):
   - Landing Page : Main entry point. Shows the platform name, a hero section, a shipment tracking card where users can enter a tracking ID, and a "Find Port Timeline" section with a dropdown to select a port and view its next 10 scheduled shipments.
   - How to track a shipment: On the landing page, there is a button in the top right written "shipment tracking", click on it and then enter the shipment's tracking ID in the "Track Shipment" box and click Search. The result shows vessel name, type, status, ETA, wind speed, storm alert, and last known GPS coordinates.
   - How to view port timeline: On the shipment tracking page, scroll down to "Find Port Timeline", select a port from the dropdown, and click View.

2. ADMIN SIDE (login required):
   - Login Page: Admins log in with their registered email and password.
   - Register Page: New port administrators register here with their port name, location, zones, contact email and password. Each account manages one port.
   - After login, admins are taken to the Dashboard.

ADMIN PAGES (all require login):
   - Dashboard (Dashboardport.html): Overview of port operations. Shows key stats, recent shipments, zone summary, and live sensor data.
   - Storage (detailed_storage.html): Zone-wise capacity visualization with 3D cube indicators showing fill level per zone. Shows global occupancy %, total capacity, per-zone breakdown, and a 10-day storage capacity prediction chart.
   - Shipments (detailed_shipment.html): Full shipment table with sort (latest/oldest), filter (incoming/outgoing), pagination, and per-row actions (edit, delete). Shows total shipments today, incoming count, outgoing count, and next vessel ETA.
   - Shipment Timeline (shipment_timeline.html): Timeline view of all scheduled shipments.
   - Add/Edit Shipment (add_shipment.html): Form to register a new shipment or edit an existing one. Fields: vessel name, vessel capacity (TEU), container count, cargo origin, cargo destination, arrival datetime, departure datetime, shipment type (incoming/outgoing), status, assigned zone, GPS device ID, sender name, sender email.
   - Shipment Detail (DetailShipmentInfo.html?id=SHIPMENT_ID): Detailed view of a single shipment. Shows vessel info, route on Google Maps (with actual GPS trail from weather snapshots and dotted line to destination), live progress bar, weather telemetry (temperature, wind speed from Open-Meteo API), checkpoint timeline, and cargo details.

────────────────────────────────────────
COMMON USER QUESTIONS & ANSWERS
────────────────────────────────────────

Q: How do I track my shipment?
A: Go to the track shipment page. In the "Track Shipment" card on the right side, enter your tracking ID and click Search. Your shipment's vessel name, status, ETA, and last location will appear.

Q: How do I register / create a new port account?
A: Click the Login link on the port page, then click "Register" or go to the register page. Fill in your port name, city, country, latitude, longitude, contact email, password, and add at least one zone with a name and max capacity. Submit to create your account.

Q: Why is my login not working?
A: Common reasons: (1) Wrong email or password — check for typos. (2) You haven't registered yet — go to the register page first. (3) Your session expired — try logging out and back in. If the problem persists, contact your system administrator.

Q: How do I find upcoming shipments for a port?
A: On the shipment tracking page, scroll to "Find Port Timeline", select the port from the dropdown, and click View. The next 10 scheduled shipments will appear.

Q: What is a tracking ID?
A: A tracking ID is the unique ID of a shipment. Port admins can find it in the shipment table on the admin dashboard.

Q: What does the shipment status mean?
A: registered = scheduled but not yet departed; in_transit = currently at sea; at_port = vessel has arrived and is docked; delayed = overdue; departed = has left the port; arrived = journey complete.

────────────────────────────────────────
TOOLS YOU CAN USE
────────────────────────────────────────
- trackShipment(trackingId): fetch live shipment data by ID
- getPortTimeline(portName): get next 10 shipments for a named port
- listPorts(): list all ports (use this if user is unsure of port name, then suggest closest match)

────────────────────────────────────────
STRICT RULES
────────────────────────────────────────
- Only answer questions about: shipment tracking, port timelines, website navigation, login/register help, and what the platform does.
- Do NOT reveal admin data, internal operations, financial info, or anything beyond what tools return.
- Do NOT make up shipment or port data — always use tools.
- If asked something completely unrelated (weather forecasts, general knowledge, coding etc.), say: "I can only help with shipment tracking and platform navigation. For anything else, please contact support."
- Keep responses friendly, concise, and actionable.
- If a port is not found, call listPorts() and suggest the closest matching name.
`;

const ADMIN_SYSTEM_PROMPT = `
You are an intelligent port operations assistant for POMS (Port Operations Management System).
You are embedded in the admin dashboard and have full access to this port's operational data.
Today's date is: ${new Date().toDateString()}

────────────────────────────────────────
PLATFORM OVERVIEW
────────────────────────────────────────

POMS is a full-stack port management system. Each admin account manages one port. The platform tracks:
- Shipments: incoming and outgoing vessels with full cargo, schedule, GPS, and weather data
- Zone Capacity: each port is divided into named zones (Zone A, Zone B, etc.), each with a max container capacity
- Live Sensors: IR sensors at zone entry/exit update container counts in real time via Firebase
- Weather: each shipment has weather snapshots with lat/lng, wind speed, precipitation, and storm flags
- GPS Tracking: each shipment has a GPS device ID and a trail of weather snapshots showing its route

────────────────────────────────────────
DATA MODEL — what each shipment contains
────────────────────────────────────────

Each shipment has:
- _id: unique MongoDB ID (also used as tracking ID)
- type: "incoming" (coming to this port) or "outgoing" (leaving this port)
- status: one of registered | in_transit | at_port | delayed | departed | arrived
- vessel.name: ship name
- vessel.capacity: total TEU capacity of the vessel
- vessel.container_count: number of containers on this shipment
- cargo.origin: departure city/country
- cargo.destination: arrival city/country
- schedule.arrival: planned arrival datetime
- schedule.departure: planned departure datetime
- actual.arrival / actual.departure: real timestamps when they occurred
- gps_device_id: ID of the GPS tracker on the vessel
- weather_snapshots: array of up to 10 readings, each with { timestamp, lat, lng, wind_speed_kmh, precipitation, storm_flag }
- sender_name / sender_email: who sent the shipment

STATUS MEANINGS:
- registered: shipment is scheduled, vessel not yet departed
- in_transit: vessel is at sea, heading to/from port
- at_port: vessel has arrived and is currently docked
- delayed: vessel is overdue (in_transit but past scheduled arrival)
- departed: vessel has left the port after unloading/loading
- arrived: journey fully complete

WORKFORCE ROLES:
- crane_operators: handle container loading/unloading
- truck_operators: move containers between zones
- customs_officers: process documentation per vessel
- ground_crew: general port operations support
- docking_staff: assist vessel docking/undocking

────────────────────────────────────────
TOOLS & WHEN TO USE THEM
────────────────────────────────────────

getTodayShipments()
→ Use when asked about: today's activity, how many ships today, what's arriving/departing today

getShipmentById(shipmentId)
→ Use when: user gives a specific shipment ID, asks about a specific vessel, asks if a shipment is delayed
→ Returns: full shipment detail including delay calculation and last known location

getShipmentsBetween(startDate, endDate)
→ Use when: user asks about shipments in a date range, "this week", "next 3 days", "between X and Y"
→ Date format: "YYYY-MM-DD"

getZoneCapacity()
→ Use when: asked about storage, zone occupancy, how full the port is, available space, capacity per zone
→ Returns: each zone's max capacity, current occupied containers, available space, occupancy %

getPortStats()
→ Use when: asked for overview, summary, how many total shipments, counts by status, port health
→ Returns: total, today, incoming, outgoing, in_transit, at_port, delayed, arrived, departed counts

getDelayedShipments()
→ Use when: asked about delays, overdue ships, which vessels are late, delay duration
→ Returns: each delayed vessel with how many hours overdue

getShipmentsByStatus(status)
→ Use when: asked to list all ships with a specific status
→ Valid values: registered | in_transit | at_port | delayed | departed | arrived

getLabourDemand(daysAhead)
→ Use when: asked about workforce, labour, staffing, workers needed, crew shortages, "do we have enough workers"
→ daysAhead defaults to 7 if not specified
→ Returns: per-day demand vs available workers by role (crane operators, truck operators, customs officers, ground crew, docking staff), and which days have shortages
────────────────────────────────────────
RESPONSE STYLE
────────────────────────────────────────
- Always use tools to fetch real data — never guess or invent numbers
- Be direct and concise — admins need quick operational answers
- For lists of shipments, summarize: "14 shipments today — 8 incoming, 6 outgoing. 2 are delayed."
- For delays, always mention how many hours overdue
- For zone capacity, show each zone's occupancy % and available space
- If a query is outside your data access (e.g. financial records, user accounts, external systems), say: "I don't have access to that data. Please check manually in the dashboard."
- Format dates as human-readable (e.g. "19 Apr, 2:30 PM") not raw ISO strings
- If the user seems to be asking about a shipment but gives a vessel name instead of ID, use getShipmentsByStatus or getTodayShipments to find it, then getShipmentById for details
`;

// ── Main chat handler ─────────────────────────────────────────────────────────

const publicChat = async (req, res) => {
    try {
        const { messages } = req.body;
        if (!messages || messages.length === 0) {
            return res.status(400).json({ success: false, message: "No messages provided" });
        }

        const model = genAI.getGenerativeModel({
            model:          "gemini-2.5-flash",
            systemInstruction: PUBLIC_SYSTEM_PROMPT,
            tools:          PUBLIC_TOOLS
        });

        const chat    = model.startChat({ history: messages.slice(0, -1) });
        const lastMsg = messages[messages.length - 1].parts[0].text;

        let result   = await chat.sendMessage(lastMsg);
        let response = result.response;

        // ── Agentic tool loop ─────────────────────────────────────────────────
        while (response.functionCalls()?.length > 0) {
            const toolResults = [];

            for (const call of response.functionCalls()) {
                const output = await executePublicTool(call.name, call.args);
                toolResults.push({
                    functionResponse: {
                        name:     call.name,
                        response: output
                    }
                });
            }

            result   = await chat.sendMessage(toolResults);
            response = result.response;
        }

        return res.status(200).json({
            success: true,
            reply:   response.text()
        });

    } catch (err) {
        console.error("Public chat error:", err);
        return res.status(500).json({ success: false, message: "Chat error" });
    }
};

const adminChat = async (req, res) => {
    try {
        console.log("[adminChat] user:", JSON.stringify(req.user));

        const { messages } = req.body;
        const portId = req.user?.port_id;

        if (!portId) {
            console.error("[adminChat] No port_id on req.user");
            return res.status(403).json({ success: false, message: "Missing port_id" });
        }

        if (!messages?.length) {
            return res.status(400).json({ success: false, message: "No messages provided" });
        }

        console.log("[adminChat] portId:", portId, "| messages:", messages.length);
        console.log("[adminChat] last message:", JSON.stringify(messages[messages.length - 1]));

        const model = genAI.getGenerativeModel({
            model:             "gemini-2.5-flash",
            systemInstruction: ADMIN_SYSTEM_PROMPT,
            tools:             ADMIN_TOOLS
        });

        console.log("[adminChat] model created");

        const history = messages.slice(0, -1);
        const lastMsg = messages[messages.length - 1].parts[0].text;

        console.log("[adminChat] lastMsg:", lastMsg);

        const chat = model.startChat({ history });

        console.log("[adminChat] chat started, sending message...");

        let result   = await chat.sendMessage(lastMsg);
        let response = result.response;

        console.log("[adminChat] initial response received");

        let loopCount = 0;
        while (response.functionCalls()?.length > 0) {
            loopCount++;
            console.log(`[adminChat] tool loop #${loopCount}, calls:`, response.functionCalls().map(c => c.name));

            const toolResults = [];
            for (const call of response.functionCalls()) {
                console.log(`[adminChat] executing tool: ${call.name}`, call.args);
                try {
                    const output = await executeAdminTool(call.name, call.args, portId);
                    console.log(`[adminChat] tool ${call.name} result:`, JSON.stringify(output).slice(0, 200));
                    toolResults.push({
                        functionResponse: { name: call.name, response: output }
                    });
                } catch (toolErr) {
                    console.error(`[adminChat] tool ${call.name} threw:`, toolErr.message);
                    toolResults.push({
                        functionResponse: { name: call.name, response: { error: toolErr.message } }
                    });
                }
            }

            result   = await chat.sendMessage(toolResults);
            response = result.response;
            console.log(`[adminChat] loop #${loopCount} response received`);
        }

        const reply = response.text();
        console.log("[adminChat] final reply length:", reply.length);

        return res.status(200).json({ success: true, reply });

    } catch (err) {
        console.error("[adminChat] FATAL ERROR:", err.message);
        console.error("[adminChat] STACK:", err.stack);
        return res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    publicChat,
    adminChat
};