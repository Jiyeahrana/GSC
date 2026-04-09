// Requiring Modules
const express = require("express");
const router = express.Router();
const auth = require("../middleware/authentication");

// Requiring Controller Functions
const { getAllShipments, getTodayShipments, getShipment } = require("../controllers/shipment");

// Defining Routes
router.route("/").get(auth, getAllShipments);
router.route("/today").get(auth, getTodayShipments);
router.route("/:id").get(auth, getShipment);

module.exports = router;