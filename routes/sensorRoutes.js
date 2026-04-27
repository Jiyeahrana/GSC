const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authentication");
const {
    entryTrigger,
    exitTrigger,
    getPortSensorData,
    gpsPush
} = require("../controllers/sensorController");

router.post("/entry",    auth, entryTrigger);
router.post("/exit",     auth, exitTrigger);
router.post("/gps",      gpsPush);          // no auth — device endpoint
router.get("/:port_id",  auth, getPortSensorData);

module.exports = router;