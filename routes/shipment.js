// Requiring Modules
const express = require("express");
const router = express.Router();
const auth = require("../middleware/authentication");

// Requiring Controller Functions
const { getAllShipments, getTodayShipments, getShipment, createShipment,deleteShipment, updateShipment, getCalendarShipments,getShipmentDetail  } = require("../controllers/shipment");

// Defining Routes
router.post("/",           auth, createShipment);
router.route("/").get(auth, getAllShipments);
router.route("/today").get(auth, getTodayShipments);
router.get("/calendar", auth, getCalendarShipments);
router.route("/:id/detail").get(auth, getShipmentDetail);
router.route("/:id").get(auth, getShipment);
router.route("/:id").delete(auth, deleteShipment);
router.route("/:id").put(auth, updateShipment);

module.exports = router;