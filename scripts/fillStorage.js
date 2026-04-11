const axios = require("axios");

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL   = "http://localhost:3000/api/v1/sensors/entry";
const TOKEN      = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5ZDIxZDU0YmIxNTVkZWFiNjFmZDZmOCIsInBvcnRfaWQiOiI2OWQyMWQ1NGJiMTU1ZGVhYjYxZmQ2ZjQiLCJpYXQiOjE3NzU4ODg4MzIsImV4cCI6MTc3ODQ4MDgzMn0.F8WILi_LaWP2qcY10n5ciNIlV24hhlZoqdC3-3Y_brU";        // ← paste your token
const PORT_ID    = "69d21d54bb155deab61fd6f4";          // ← paste your MongoDB port _id
const ZONE_ID    = "zone_B";                     // ← change if needed
const TARGET_PCT = 70;                           // fill up to 40%
const CAPACITY   = 1200;                         // ← your zone's max_capacity

// ── Calculate how many entries needed ────────────────────────────────────────

const targetContainers = Math.floor((TARGET_PCT / 100) * CAPACITY);

console.log(`Target: ${TARGET_PCT}% of ${CAPACITY} = ${targetContainers} containers`);
console.log(`Making ${targetContainers} entry calls...\n`);

// ── Fire entry calls one by one ───────────────────────────────────────────────

async function fillStorage() {
    let success = 0;
    let failed  = 0;

    for (let i = 1; i <= targetContainers; i++) {
        try {
            await axios.post(
                BASE_URL,
                { port_id: PORT_ID, zone_id: ZONE_ID },
                { headers: { Authorization: `Bearer ${TOKEN}` } }
            );

            success++;

            // Log progress every 50 entries
            if (i % 50 === 0 || i === targetContainers) {
                const pct = Math.round((i / CAPACITY) * 100);
                console.log(`Progress: ${i}/${targetContainers} containers (${pct}%)`);
            }

            // Small delay to avoid overwhelming the server
            await new Promise(r => setTimeout(r, 50));

        } catch (err) {
            failed++;
            console.error(`Call ${i} failed:`, err.message);
        }
    }

    console.log(`\nDone! ${success} successful, ${failed} failed`);
    console.log(`Storage should now be at ~${TARGET_PCT}%`);
}

fillStorage();