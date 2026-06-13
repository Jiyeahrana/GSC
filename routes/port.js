// Requiring Modules
const express = require("express");
const router = express.Router(); //Creating router to route incoming requests to appropriate controller functions
const auth    = require("../middleware/authentication");


// Requiring Controller Functions
const {login, register, getPortDetails, getPortZones, getCapacityPrediction,getLabourPrediction,getWorkforce,getEfficiencyScore,updateWorkforce } = require("../controllers/port");

// Defining Routes
router.route("/login").post(login);
router.route("/register").post(register);
router.get("/me", auth, getPortDetails);
router.get("/zones", auth, getPortZones);
router.get("/ports/:portId/capacity-prediction", getCapacityPrediction);
router.get("/labour-prediction", auth, getLabourPrediction);
router.get("/workforce",         auth, getWorkforce);
router.get("/efficiency-score", auth, getEfficiencyScore);
router.put("/workforce", auth, updateWorkforce);

module.exports = router; //Exporting the router to be used in app.js