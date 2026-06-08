const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const Shipment = require("../models/shipment");

const PORT_ID = "69d21d54bb155deab61fd6f4";

const vessels = [
    { name: "MSC Anna",         capacity: 180 },
    { name: "Evergreen Marine", capacity: 220 },
    { name: "COSCO Shipping",   capacity: 150 },
    { name: "Maersk Emerald",   capacity: 200 },
    { name: "HMM Algeciras",    capacity: 170 },
    { name: "ONE Stork",        capacity: 130 },
    { name: "Yang Ming Wish",   capacity: 160 },
    { name: "PIL Pacific",      capacity: 140 },
    { name: "ZIM Kingston",     capacity: 190 },
    { name: "CMA CGM Titan",    capacity: 210 },
];

const routes = [
    { origin: "Mumbai, India",     destination: "Chennai, India"   },
    { origin: "Mumbai, India",     destination: "Kochi, India"     },
    { origin: "Mumbai, India",     destination: "Kolkata, India"   },
    { origin: "Mumbai, India",     destination: "Vizag, India"     },
    { origin: "Mumbai, India",     destination: "Kandla, India"    },
    { origin: "Chennai, India",    destination: "Mumbai, India"    },
    { origin: "Kochi, India",      destination: "Mumbai, India"    },
    { origin: "Kolkata, India",    destination: "Mumbai, India"    },
    { origin: "Vizag, India",      destination: "Mumbai, India"    },
    { origin: "Mundra, India",     destination: "Mumbai, India"    },
];

const senders = [
    { name: "Reliance Exports",      email: "logistics@reliance.com"      },
    { name: "Tata Steel Ltd",        email: "shipping@tatasteel.com"       },
    { name: "Adani Ports",           email: "ops@adaniports.com"           },
    { name: "Mahindra Logistics",    email: "freight@mahindra.com"         },
    { name: "Infosys Supply Chain",  email: "supply@infosys.com"           },
    { name: "Bajaj Auto Exports",    email: "export@bajaj.com"             },
    { name: "Wipro Logistics",       email: "logistics@wipro.com"          },
    { name: "JSW Steel",             email: "shipping@jsw.com"             },
    { name: "Larsen & Toubro",       email: "freight@lnt.com"              },
    { name: "ONGC Exports",          email: "exports@ongc.com"             },
];

const statuses = ["registered", "in_transit", "at_port", "departed", "arrived"];

const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFrom    = (arr) => arr[Math.floor(Math.random() * arr.length)];

const getStatusForDate = (arrival) => {
    const now    = new Date();
    const diff   = (arrival - now) / (1000 * 60 * 60 * 24); // days difference
    if (diff > 5)  return "registered";
    if (diff > 2)  return "in_transit";
    if (diff > 0)  return "in_transit";
    if (diff > -2) return "at_port";
    if (diff > -4) return "departed";
    return "arrived";
};

const generateShipments = () => {
    const shipments = [];
    const startDate = new Date("2026-06-01");
    const endDate   = new Date("2026-08-01");

    // ~2 shipments per day = ~60 total, well within 3600 total capacity
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        const dailyCount = randomBetween(1, 3);

        for (let i = 0; i < dailyCount; i++) {
            const arrival       = new Date(currentDate);
            arrival.setHours(randomBetween(0, 23), randomBetween(0, 59), 0, 0);

            const departure     = new Date(arrival);
            departure.setHours(arrival.getHours() + randomBetween(24, 72));

            const status        = getStatusForDate(arrival);
            const route         = randomFrom(routes);
            const vessel        = randomFrom(vessels);
            const sender        = randomFrom(senders);
            const type = Math.random() > 0.5 ? "incoming" : "outgoing";

            const actualArrival   = ["at_port", "departed", "arrived"].includes(status) ? arrival   : null;
            const actualDeparture = ["departed", "arrived"].includes(status)             ? departure : null;

            shipments.push({
                port_id:      PORT_ID,
                type,
                vessel: { 
                    name:            vessel.name, 
                    capacity:        vessel.capacity,
                    container_count: randomBetween(20, vessel.capacity)  // realistic — never more than vessel capacity
                },
                cargo:        { origin: route.origin, destination: route.destination },
                schedule:     { arrival, departure },
                actual:       { arrival: actualArrival, departure: actualDeparture },
                status,
                gps_device_id: 69420,
                weather_snapshots: [],
                sender_name:  sender.name,
                sender_email: sender.email,
            });
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return shipments;
};

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Database Connected");

        await Shipment.deleteMany({ port_id: PORT_ID });
        console.log("🗑️  Cleared existing shipments for this port");

        const shipments = generateShipments();
        await Shipment.insertMany(shipments);

        console.log(`✅ Inserted ${shipments.length} shipments from 08-Apr-2026 to 08-May-2026`);
        process.exit(0);
    } catch (error) {
        console.error("❌ Seed failed:", error.message);
        process.exit(1);
    }
};

seed();