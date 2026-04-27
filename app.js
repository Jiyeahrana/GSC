// ================== IMPORTS ==================
const express = require("express");
require("dotenv").config();
const connectDB = require("./db/connect");
const path = require("path");
const cors = require("cors");

// ================== ROUTES ==================
const portRoute = require("./routes/port");
const shipmentRoute = require("./routes/shipment");
const sensorRoutes = require("./routes/sensorRoutes");
const publicRoutes = require("./routes/publicRoutes");
const gpsRoute = require("./routes/gps");

// ================== APP INIT ==================
const app = express();

// ================== MIDDLEWARE ==================

// ✅ Allow all origins (for phone testing)
app.use(cors({
    origin: "*",
    credentials: true
}));

// JSON parser
app.use(express.json({ limit: "50mb" }));

// Serve frontend (your HTML/JS)
app.use(express.static(path.join(__dirname, "public")));

// ================== ROUTES ==================
app.use("/api/v1/port", portRoute);
app.use("/api/v1/shipments", shipmentRoute);
app.use("/api/v1/sensors", sensorRoutes);
app.use("/api/v1/public", publicRoutes);
app.use("/api/v1/gps", gpsRoute);

// ================== SERVER START ==================
const startServer = async () => {
    try {
        // Connect DB
        await connectDB(process.env.MONGO_URI);
        console.log("Database Connected Successfully! ✅");

        const PORT = process.env.PORT || 3000;

        // 🔥 IMPORTANT: allow access from phone
        app.listen(PORT, "0.0.0.0", () => {
            console.log(`🚀 Server running at: http://0.0.0.0:${PORT}`);
        });

    } catch (error) {
        console.log("❌ Error starting server:");
        console.log(error);
        process.exit(1);
    }
};

startServer();