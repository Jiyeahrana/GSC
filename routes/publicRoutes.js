const express = require("express");
const router  = express.Router();
const {
    getPublicPorts,
    getPublicPortTimeline,
    trackShipment
} = require("../controllers/port");

router.get("/ports",                    getPublicPorts);
router.get("/ports/:portId/timeline",   getPublicPortTimeline);
router.get("/track/:trackingId",        trackShipment);

module.exports = router;