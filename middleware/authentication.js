// Requiring Modules
const User = require("../models/user");
const jwt = require("jsonwebtoken");
const StatusCodes = require("http-status-codes");
const {UnauthenticatedError} = require("../errors");

const auth = (req,res,next)=>{
    // Getting the authorization token from headers in the API call
    const authHeader = req.headers.authorization;

    // checking id authHeader exists or not and if it starts with Bearer or not(we send it as Bearer token in frontend)
    if(!authHeader || !authHeader.startsWith("Bearer")){
        throw new UnauthenticatedError("Authentication Invalid");
    }

    // Extracting the JWT token
    const token = authHeader.split(' ')[1];

    // Trying to verify it through verify function in User Model
    try {
        // Verifies and stores the user data inside payload
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = { userId : payload.userId, name : payload.name};
        next();
    } catch (error) {
        // Throwing error
        next(new UnauthenticatedError("Authentication Invalid"));
    }
}

module.exports = auth;