// Requiring Modules
const express = require("express");
const router = express.Router();
const auth = require("../middleware/authentication");

// Requiring Controller Functions
const { getAllShipments, getTodayShipments, getShipment, createShipment  } = require("../controllers/shipment");

// Defining Routes
router.post("/",           auth, createShipment);
router.route("/").get(auth, getAllShipments);
router.route("/today").get(auth, getTodayShipments);
router.route("/:id").get(auth, getShipment);

module.exports = router;