const admin = require("firebase-admin");

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env var is not set");

let serviceAccount;
try {
    serviceAccount = JSON.parse(raw);
} catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON: " + e.message);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://port-management-gsc-default-rtdb.asia-southeast1.firebasedatabase.app/"
});

const db = admin.database();
module.exports = db;