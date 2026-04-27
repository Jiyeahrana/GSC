/**
 * NAUTICAL.OS — Maritime Route Planner
 * Generates realistic sea-lane routes between Indian ports
 * and auto-generates evenly spaced checkpoints with ETA logic.
 *
 * Strategy: A manually-curated graph of sea-lane waypoints for
 * Indian coastal shipping. No external API dependency.
 */

// ─── Known Indian Port Coordinates ───────────────────────────────────────────
const PORT_COORDS = {
  // West Coast (Arabian Sea)
  "Mumbai, India":        { lat: 18.9322,  lng: 72.8375  },
  "JNPT, India":          { lat: 18.9480,  lng: 72.9500  },
  "Nhava Sheva, India":   { lat: 18.9480,  lng: 72.9500  },
  "Goa, India":           { lat: 15.4909,  lng: 73.8278  },
  "Mormugao, India":      { lat: 15.4139,  lng: 73.7993  },
  "Mangalore, India":     { lat: 12.8703,  lng: 74.8423  },
  "New Mangalore, India": { lat: 12.9250,  lng: 74.8130  },
  "Kochi, India":         { lat: 9.9312,   lng: 76.2673  },
  "Cochin, India":        { lat: 9.9312,   lng: 76.2673  },
  "Kozhikode, India":     { lat: 11.2588,  lng: 75.7804  },
  "Calicut, India":       { lat: 11.2588,  lng: 75.7804  },
  "Beypore, India":       { lat: 11.1725,  lng: 75.8128  },
  "Tuticorin, India":     { lat: 8.7642,   lng: 78.1348  },
  "Thoothukudi, India":   { lat: 8.7642,   lng: 78.1348  },
  "Kandla, India":        { lat: 23.0333,  lng: 70.2167  },
  "Deendayal, India":     { lat: 23.0333,  lng: 70.2167  },
  "Mundra, India":        { lat: 22.8390,  lng: 69.7183  },
  "Pipavav, India":       { lat: 20.9167,  lng: 71.5167  },
  "Hazira, India":        { lat: 21.1167,  lng: 72.6500  },
  // East Coast (Bay of Bengal)
  "Chennai, India":       { lat: 13.0827,  lng: 80.2707  },
  "Madras, India":        { lat: 13.0827,  lng: 80.2707  },
  "Ennore, India":        { lat: 13.2827,  lng: 80.3311  },
  "Kamarajar, India":     { lat: 13.2827,  lng: 80.3311  },
  "Vizag, India":         { lat: 17.6868,  lng: 83.2185  },
  "Visakhapatnam, India": { lat: 17.6868,  lng: 83.2185  },
  "Paradip, India":       { lat: 20.3167,  lng: 86.6167  },
  "Kolkata, India":       { lat: 22.5726,  lng: 88.3639  },
  "Haldia, India":        { lat: 22.0667,  lng: 88.0833  },
  "Gangavaram, India":    { lat: 17.6258,  lng: 83.2723  },
  "Krishnapatnam, India": { lat: 14.2487,  lng: 80.1258  },
  "Karaikal, India":      { lat: 10.9254,  lng: 79.8380  },
};

// ─── Sea Lane Waypoint Nodes ──────────────────────────────────────────────────
// Open-water nodes that vessels use to avoid land masses.
const SEA_NODES = {
  AS_NW:    { lat: 23.5,   lng: 65.5   }, // NW Arabian Sea (Gujarat departure)
  AS_NORTH: { lat: 22.0,   lng: 67.5   }, // N Arabian Sea
  AS_MID_W: { lat: 19.5,   lng: 68.5   }, // Mid Arabian Sea West
  AS_MID:   { lat: 17.0,   lng: 69.5   }, // Mid Arabian Sea
  AS_MID_E: { lat: 15.0,   lng: 71.5   }, // Mid Arabian Sea East (Goa approach)
  AS_SOUTH: { lat: 10.5,   lng: 72.5   }, // S Arabian Sea
  CAPE_W:   { lat: 7.8,    lng: 76.5   }, // West of Cape Comorin
  CAPE_TIP: { lat: 7.5,    lng: 77.5   }, // Cape Comorin tip (offshore)
  CAPE_E:   { lat: 7.8,    lng: 78.5   }, // East of Cape Comorin
  MANNAR_W: { lat: 8.8,    lng: 77.5   }, // Gulf of Mannar west
  MANNAR_E: { lat: 8.9,    lng: 79.5   }, // Gulf of Mannar east
  BOB_SW:   { lat: 10.5,   lng: 81.5   }, // SW Bay of Bengal
  BOB_WEST: { lat: 13.0,   lng: 81.5   }, // W Bay of Bengal (Chennai approach)
  BOB_MID:  { lat: 15.5,   lng: 82.0   }, // Mid W Bay of Bengal
  BOB_N:    { lat: 18.5,   lng: 83.5   }, // N Bay (Vizag approach)
  BOB_NE:   { lat: 20.5,   lng: 85.5   }, // NE Bay (Paradip approach)
  BOB_FAR_N:{ lat: 21.5,   lng: 87.5   }, // Far N Bay (Haldia/Kolkata approach)
};

// ─── Haversine Distance (km) ──────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Coast Classifier ─────────────────────────────────────────────────────────
function getCoast(portName) {
  const westPorts = [
    "Mumbai", "JNPT", "Nhava Sheva", "Goa", "Mormugao",
    "Mangalore", "New Mangalore", "Kochi", "Cochin",
    "Kozhikode", "Calicut", "Beypore", "Tuticorin",
    "Thoothukudi", "Kandla", "Deendayal", "Mundra", "Pipavav", "Hazira"
  ];
  return westPorts.some(w => portName.includes(w)) ? "west" : "east";
}

// ─── Resolve Port Coordinates ─────────────────────────────────────────────────
function resolvePortCoords(portName) {
  if (PORT_COORDS[portName]) return PORT_COORDS[portName];
  for (const [key, coords] of Object.entries(PORT_COORDS)) {
    const keyCity  = key.split(",")[0].trim().toLowerCase();
    const nameCity = portName.split(",")[0].trim().toLowerCase();
    if (keyCity === nameCity || keyCity.includes(nameCity) || nameCity.includes(keyCity)) {
      return coords;
    }
  }
  return null;
}

// ─── Build Sea Lane Route ─────────────────────────────────────────────────────
function buildSeaLaneRoute(originName, destName) {
  const originCoords = resolvePortCoords(originName);
  const destCoords   = resolvePortCoords(destName);
  if (!originCoords || !destCoords) return null;

  const originCoast = getCoast(originName);
  const destCoast   = getCoast(destName);
  const wps         = [originCoords];

  if (originCoast === destCoast) {
    // Same coast — coastal corridor
    if (originCoast === "west") {
      if (originCoords.lat > destCoords.lat) {
        // Southbound e.g. Mumbai → Kochi
        wps.push(SEA_NODES.AS_MID_W, SEA_NODES.AS_MID_E, SEA_NODES.AS_SOUTH);
      } else {
        // Northbound e.g. Kochi → Mumbai
        wps.push(SEA_NODES.AS_SOUTH, SEA_NODES.AS_MID_E, SEA_NODES.AS_MID_W);
      }
    } else {
      if (originCoords.lat > destCoords.lat) {
        // Southbound e.g. Kolkata → Chennai
        wps.push(SEA_NODES.BOB_FAR_N, SEA_NODES.BOB_NE, SEA_NODES.BOB_N, SEA_NODES.BOB_MID, SEA_NODES.BOB_WEST);
      } else {
        // Northbound e.g. Chennai → Kolkata
        wps.push(SEA_NODES.BOB_WEST, SEA_NODES.BOB_MID, SEA_NODES.BOB_N, SEA_NODES.BOB_NE, SEA_NODES.BOB_FAR_N);
      }
    }
  } else {
    // Cross coast — must round Cape Comorin
    if (originCoast === "west") {
      // West → East
      wps.push(SEA_NODES.AS_SOUTH, SEA_NODES.CAPE_W, SEA_NODES.CAPE_TIP, SEA_NODES.CAPE_E, SEA_NODES.MANNAR_E, SEA_NODES.BOB_SW, SEA_NODES.BOB_WEST);
      if (destCoords.lat > 14) wps.push(SEA_NODES.BOB_MID);
      if (destCoords.lat > 18) wps.push(SEA_NODES.BOB_N);
      if (destCoords.lat > 20) wps.push(SEA_NODES.BOB_NE, SEA_NODES.BOB_FAR_N);
    } else {
      // East → West
      wps.push(SEA_NODES.BOB_SW, SEA_NODES.CAPE_E, SEA_NODES.CAPE_TIP, SEA_NODES.CAPE_W, SEA_NODES.AS_SOUTH);
      if (destCoords.lat > 12) wps.push(SEA_NODES.AS_MID_E);
      if (destCoords.lat > 17) wps.push(SEA_NODES.AS_MID_W);
      if (destCoords.lat > 21) wps.push(SEA_NODES.AS_NORTH, SEA_NODES.AS_NW);
    }
  }

  wps.push(destCoords);

  // Prune absurdly off-route waypoints for short hops
  const directDist = haversine(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng);
  if (directDist < 300) return [originCoords, destCoords];

  return wps.filter((wp, i) => {
    if (i === 0 || i === wps.length - 1) return true;
    const dO = haversine(originCoords.lat, originCoords.lng, wp.lat, wp.lng);
    const dD = haversine(destCoords.lat,   destCoords.lng,   wp.lat, wp.lng);
    return dO + dD < directDist * 3.0;
  });
}

// ─── Interpolate N Points Along Polyline ─────────────────────────────────────
function interpolateAlongRoute(points, n) {
  if (points.length < 2) return [];
  const cumDist = [0];
  for (let i = 1; i < points.length; i++) {
    cumDist.push(cumDist[i - 1] + haversine(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng));
  }
  const totalDist = cumDist[cumDist.length - 1];
  const result    = [];
  for (let k = 1; k <= n; k++) {
    const target = (k / (n + 1)) * totalDist;
    let seg = 0;
    while (seg < cumDist.length - 2 && cumDist[seg + 1] < target) seg++;
    const segLen = cumDist[seg + 1] - cumDist[seg];
    const t      = segLen === 0 ? 0 : (target - cumDist[seg]) / segLen;
    result.push({
      lat: points[seg].lat + t * (points[seg + 1].lat - points[seg].lat),
      lng: points[seg].lng + t * (points[seg + 1].lng - points[seg].lng),
    });
  }
  return result;
}

// ─── Main Export: generatePlannedRoute ───────────────────────────────────────
/**
 * @param {string} originName     - e.g. "Kochi, India"
 * @param {string} destName       - e.g. "Mumbai, India"
 * @param {Date}   departureTime  - schedule.departure
 * @param {Date}   arrivalTime    - schedule.arrival
 * @param {number} numCheckpoints - default 5
 * @returns {{ planned_route: Array, checkpoints: Array }}
 */
function generatePlannedRoute(originName, destName, departureTime, arrivalTime, numCheckpoints = 5) {
  const waypoints = buildSeaLaneRoute(originName, destName);
  const routePoints = waypoints || [
    resolvePortCoords(originName) || { lat: 10, lng: 75 },
    resolvePortCoords(destName)   || { lat: 19, lng: 73 },
  ];

  const journeyMs   = new Date(arrivalTime) - new Date(departureTime);
  const cpPositions = interpolateAlongRoute(routePoints, numCheckpoints);

  const checkpoints = cpPositions.map((pos, i) => {
    const fraction = (i + 1) / (numCheckpoints + 1);
    return {
      index:            i,
      name:             `Checkpoint ${i + 1}`,
      position:         { lat: pos.lat, lng: pos.lng },
      expected_arrival: new Date(new Date(departureTime).getTime() + fraction * journeyMs),
      actual_arrival:   null,
      status:           "pending",
    };
  });

  return {
    planned_route: routePoints.map(p => ({ lat: p.lat, lng: p.lng })),
    checkpoints,
  };
}

// ─── Checkpoint Proximity Check ───────────────────────────────────────────────
function isNearCheckpoint(vesselLat, vesselLng, checkpoint, thresholdKm = 50) {
  return haversine(vesselLat, vesselLng, checkpoint.position.lat, checkpoint.position.lng) <= thresholdKm;
}

// ─── Route Progress Calculator ────────────────────────────────────────────────
function calculateRouteProgress(checkpoints) {
  const now          = new Date();
  let currentIndex   = 0;
  let delayMinutes   = 0;
  let reachedCount   = 0;
  let nextCheckpoint = null;

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    if (cp.status === "reached") {
      reachedCount++;
      currentIndex = i;
      if (cp.actual_arrival && cp.expected_arrival) {
        const diff = (new Date(cp.actual_arrival) - new Date(cp.expected_arrival)) / 60000;
        delayMinutes = Math.round(diff);
      }
    }
    if (cp.status === "pending" && !nextCheckpoint) {
      nextCheckpoint = cp;
    }
  }

  const etaToNextMin = nextCheckpoint
    ? Math.max(0, Math.round((new Date(nextCheckpoint.expected_arrival) - now) / 60000))
    : null;

  return {
    current_checkpoint_index:   currentIndex,
    checkpoints_reached:        reachedCount,
    total_checkpoints:          checkpoints.length,
    delay_minutes:              delayMinutes,
    on_time:                    delayMinutes <= 15,
    next_checkpoint_name:       nextCheckpoint?.name || "Destination",
    eta_to_next_checkpoint_min: etaToNextMin,
    last_updated:               now,
  };
}

module.exports = {
  generatePlannedRoute,
  isNearCheckpoint,
  calculateRouteProgress,
  haversine,
  resolvePortCoords,
};