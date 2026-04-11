const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authentication");
const {
    entryTrigger,
    exitTrigger,
    getPortSensorData
} = require("../controllers/sensorController");

router.post("/entry",    auth, entryTrigger);
router.post("/exit",     auth, exitTrigger);
router.get("/:port_id",  auth, getPortSensorData);

module.exports = router;