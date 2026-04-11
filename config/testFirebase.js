const db = require("./firebase");

async function test() {
  try {
    await db.ref("sensor_readings/port_test/zone_A").update({
      container_count: 0,
      last_updated:    Date.now(),
      last_event:      "connection_test"
    });
    console.log("Firebase connected successfully");
    process.exit(0);
  } catch (err) {
    console.error("Firebase connection failed:", err);
    process.exit(1);
  }
}

test();