const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authentication");

const {
    getAllShipments,
    getTodayShipments,
    getShipment,
    createShipment,
    deleteShipment,
    updateShipment,
    getCalendarShipments,
    getShipmentDetail,
    syncShipmentStatuses,
    attachPlannedRoute
} = require("../controllers/shipment");

// ── Collection routes ─────────────────────────────────────────────────────────
router.route("/").get(auth, getAllShipments);
router.post("/",           auth, createShipment);          // create — also calls attachPlannedRoute internally
router.get("/today",       auth, getTodayShipments);
router.get("/calendar",    auth, getCalendarShipments);
router.post("/sync-statuses", auth, syncShipmentStatuses);

// ── Individual shipment routes ────────────────────────────────────────────────
router.get("/:id/detail",  auth, getShipmentDetail);
router.get("/:id",         auth, getShipment);
router.put("/:id",         auth, updateShipment);
router.delete("/:id",      auth, deleteShipment);

// ── Manual planned-route (re-)attachment ─────────────────────────────────────
// POST /api/v1/shipments/:id/attach-route
// Useful for back-filling existing shipments that were created before this feature.
router.post("/:id/attach-route", auth, async (req, res) => {
    try {
        const Shipment = require("../models/shipment");
        const shipment = await Shipment.findOne({
            _id:     req.params.id,
            port_id: req.user.port_id
        });

        if (!shipment) {
            return res.status(404).json({ success: false, message: "Shipment not found" });
        }

        await attachPlannedRoute(shipment);

        // Re-fetch so response includes the freshly saved fields
        const updated = await Shipment.findById(shipment._id);
        return res.status(200).json({
            success: true,
            message: "Planned route attached successfully",
            data: {
                planned_route:  updated.planned_route,
                checkpoints:    updated.checkpoints,
                route_progress: updated.route_progress
            }
        });
    } catch (err) {
        console.error("attach-route error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;