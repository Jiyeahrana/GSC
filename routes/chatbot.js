const express    = require("express");
const router     = express.Router();
const auth       = require("../middleware/authentication");
const { publicChat, adminChat } = require("../controllers/chatbot");

router.post("/public",  publicChat);
router.post("/admin",   auth, adminChat);

module.exports = router;