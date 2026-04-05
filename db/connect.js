const mongoose = require("mongoose");

const connectDB = (url) => {
    return mongoose.connect(url, {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
    });
}

module.exports = connectDB;