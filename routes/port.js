// Requiring Modules
const express = require("express");
const router = express.Router(); //Creating router to route incoming requests to appropriate controller functions
const auth    = require("../middleware/authentication");


// Requiring Controller Functions
const {login, register, getPortDetails, getPortZones, getCapacityPrediction } = require("../controllers/port");

// Defining Routes
router.route("/login").post(login);
router.route("/register").post(register);
router.get("/me", auth, getPortDetails);
router.get("/zones", auth, getPortZones);
router.get("/ports/:portId/capacity-prediction", getCapacityPrediction);

module.exports = router; //Exporting the router to be used in app.js