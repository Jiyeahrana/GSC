// Requiring Libraries
const express = require("express");
require("dotenv").config();
const connectDB = require("./db/connect"); // connectDB function to connect to Database
const path = require('path'); 
const cors = require("cors");

// Creating App
const app = express();

// Middlewares
app.use(cors({
    origin: [
        "http://localhost:3000",  
    ],
    credentials: true
}));
app.use(express.json({ limit : '50mb' })); //to parse body of incoming POST request with increased limit
app.use(express.static(path.join(__dirname, 'public')));

// Requiring Routes
const portRoute = require("./routes/port");
const shipmentRoute = require("./routes/shipment");
const sensorRoutes = require("./routes/sensorRoutes");
const publicRoutes = require("./routes/publicRoutes");


const startServer = async()=>{
        try {
            //connecting to database
            await connectDB(process.env.MONGO_URI);
            console.log("Database Connected Successfully!✅");

            // Routes
            app.use("/api/v1/port", portRoute);
            app.use("/api/v1/shipments",shipmentRoute);
            app.use("/api/v1/sensors", sensorRoutes);
            app.use("/api/v1/public", publicRoutes);
            // Getting PORT
            const PORT = process.env.PORT || 3000;
            app.listen(PORT,()=>{
                console.log(`Listening to port ${PORT}`)
            })
        } catch (error) {
        // Error message 
            console.log("An Error Occured!❌");
            console.log("Error: ",error);
            process.exit(1);
        }
}

startServer(); //Starting the server