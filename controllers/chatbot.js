const { GoogleGenerativeAI } = require("@google/generative-ai");
const Shipment = require("../models/shipment");
const Port     = require("../models/port");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
        }
    ]
}];

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
            return {
                totalCapacity: port.total_capacity,
                zones: port.zones.map(z => ({
                    name:        z.name,
                    maxCapacity: z.max_capacity,
                    sensors:     z.sensor_ids?.length || 0
                }))
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

        default:
            return { error: "Unknown tool" };
    }
}

// ── System prompts ────────────────────────────────────────────────────────────

const PUBLIC_SYSTEM_PROMPT = `
You are a helpful assistant for a port management platform called POMS (Port Operations Management System).
You help PUBLIC users — people who want to track shipments or find port information.

STRICT RULES:
- Only answer questions related to: shipment tracking, port timelines, how to use the website, login/register help
- Do NOT reveal internal port operations, admin data, financial info, or any data beyond what tools return
- Do NOT make up shipment data — always use tools to fetch real data
- If asked something outside your scope, say: "I'm not able to help with that, but I can help you track a shipment or find port information."
- Keep responses concise and friendly
- If a port name is not found, suggest similar ones from listPorts

You can help with:
- Tracking a shipment (user gives tracking ID)
- Showing next 10 shipments for a port
- Explaining how to navigate the website
- Helping with login/register issues (explain steps, you cannot fix backend issues)
- Suggesting correct port names
`;

const ADMIN_SYSTEM_PROMPT = `
You are an intelligent operations assistant for a port admin using POMS (Port Operations Management System).
You have full access to this port's data and can answer any operational query.

CAPABILITIES:
- Fetch and summarize today's shipments
- Look up any shipment by ID with full detail
- Show shipments between any two dates
- Report on delayed shipments with delay duration
- Show zone capacity and occupancy
- Give port-wide statistics
- Filter shipments by status

BEHAVIOR:
- Always use tools to fetch real data — never guess or make up numbers
- Be concise but complete — admins need facts fast
- If a query needs data you cannot fetch, say: "I don't have access to that data. You can check it manually in the dashboard."
- Format numbers clearly (e.g. "14 shipments, 3 delayed")
- When showing multiple shipments, summarize neatly
- Today's date is: ${new Date().toDateString()}
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
        const { messages } = req.body;
        const portId       = req.user.port_id;

        if (!messages || messages.length === 0) {
            return res.status(400).json({ success: false, message: "No messages provided" });
        }

        const model = genAI.getGenerativeModel({
            model:             "gemini-2.5-flash",
            systemInstruction: ADMIN_SYSTEM_PROMPT,
            tools:             ADMIN_TOOLS
        });

        const chat    = model.startChat({ history: messages.slice(0, -1) });
        const lastMsg = messages[messages.length - 1].parts[0].text;

        let result   = await chat.sendMessage(lastMsg);
        let response = result.response;

        // ── Agentic tool loop ─────────────────────────────────────────────────
        while (response.functionCalls()?.length > 0) {
            const toolResults = [];

            for (const call of response.functionCalls()) {
                const output = await executeAdminTool(call.name, call.args, portId);
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
        console.error("Admin chat error:", err);
        return res.status(500).json({ success: false, message: "Chat error" });
    }
};

module.exports = { publicChat, adminChat };