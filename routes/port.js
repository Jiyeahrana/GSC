// Requiring Modules
const express = require("express");
const router = express.Router(); //Creating router to route incoming requests to appropriate controller functions

// Requiring Controller Functions
const {login, register} = require("../controllers/port");

// Defining Routes
router.route("/login").post(login);
router.route("/register").post(register);

module.exports = router; //Exporting the router to be used in app.js