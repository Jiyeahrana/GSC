![POMS Banner](https://img.shields.io/badge/POMS-Port%20Operations%20Management%20System-fb6b00?style=for-the-badge)
![Google Solution Challenge](https://img.shields.io/badge/Google%20Solution%20Challenge-2026-4285F4?style=for-the-badge&logo=google)
![Top 106](https://img.shields.io/badge/Top%20106-Selected-success?style=for-the-badge)

**A real-time port management platform powered by IoT sensors, GPS tracking, and AI — predicting delays, optimizing routes, forecasting storage and labour needs, and scoring overall port efficiency, with public shipment tracking and an AI assistant built in.**

[Live Demo](https://gsc-app-630083017128.us-central1.run.app) · [Problem Track](#problem-statement) · [Features](#features) · [Tech Stack](#tech-stack) · [Setup](#getting-started)

</div>

---

## Table of Contents

- [Problem Statement](#problem-statement)
- [Solution Overview](#solution-overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Intelligence Engine](#intelligence-engine)
- [Hardware Layer](#hardware-layer)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Future Development](#future-development)
- [Team](#team)

---

## Problem Statement

**Track:** Smart Supply Chains — Resilient Logistics and Dynamic Supply Chain Optimization

Modern global supply chains manage millions of concurrent shipments across highly complex and inherently volatile transportation networks. Critical transit disruptions ranging from sudden weather events to hidden operational bottlenecks are chronically identified only **after** delivery timelines are already compromised.

**Objective:** Design a scalable system capable of continuously analyzing multifaceted transit data to preemptively detect and flag potential supply chain disruptions. Formulate dynamic mechanisms that instantly execute or recommend highly optimized route adjustments before localized bottlenecks cascade into broader delays.

---

## Solution Overview

POMS is a full-stack, real-time port management platform that directly addresses the problem statement's two core demands:

**Preemptive disruption detection** — live GPS tracking combined with weather data streams continuously evaluates every active shipment. When vessel speed drops below expected thresholds or storm conditions are detected along the route, the system flags the disruption and recalculates ETA *before* the delay materializes.

**Dynamic route optimization** — a domain-encoded maritime intelligence engine evaluates 8 compounding delay factors (storm trajectory, congestion compounding, coast-crossing physics, carrier reliability, tidal windows, cargo sensitivity, customs inspection, berth slot miss) and produces 3 ranked route recommendations with confidence scores, time saved, and fuel cost comparisons — automatically recommending ON TRACK, REROUTE, or SHIFT PORT.

The platform serves two distinct user groups:

- **Port Authorities** — a full operations dashboard with live zone monitoring, shipment management, AI forecasting, labour planning, and efficiency scoring
- **Cargo Senders & Logistics Operators** — a public portal for live shipment tracking via unique IDs and port availability browsing, requiring zero login

---

## Features

### Port Authority Features (Admin — Login Required)

| Feature | Description |
|---|---|
| **Live Zone-Wise Storage Monitoring** | 2D LiDAR sensors at zone gates push container counts to Firebase in real time. Dashboard shows occupancy per zone with 3D isometric visualization |
| **AI Capacity Forecasting** | Facebook Prophet generates 5–10 day storage capacity predictions from shipment schedules and live sensor data |
| **Shipment Registration & Management** | Full CRUD for shipments. Each shipment auto-generates a UUID tracking ID sent to the cargo sender |
| **Delay Prediction Engine** | Monitors GPS speed and weather conditions continuously. Flags at-risk shipments and recalculates ETA before delays occur |
| **Route Optimization Engine** | Python/Flask reasoning engine evaluates 3 route options (direct, via waypoint, port shift) across 4 dimensions and recommends the optimal path |
| **Port Efficiency Score** | Single 0–100 score computed from 5 weighted components: on-time arrivals (35%), zone utilization (25%), turnaround efficiency (20%), checkpoint adherence (10%), disruption resilience (10%) |
| **Labour Demand Forecast** | 7-day workforce prediction per role based on incoming container counts. Detects staffing shortages before they happen |
| **Shipment Timeline Calendar** | Month/week/day views of all port activity with color-coded status indicators |
| **Shipment Detail Map** | Leaflet.js map with planned route (blue dashed), traveled path (orange solid), checkpoint markers, and weather overlay |
| **Active Alerts** | Auto-generated alerts for delays, high zone capacity, storm flags. Linked directly to shipment detail |
| **Edit Workforce** | Update role totals and shift configurations after registration. Shift times recalculate automatically server-side |
| **Admin AI Chatbot** | Gemini-powered assistant with full backend data access via function calling — answers queries about shipments, delays, zone capacity, labour demand |

### Public Features (No Login Required)

| Feature | Description |
|---|---|
| **Shipment Tracking** | Enter UUID tracking ID to see live GPS position, route progress, weather conditions, ETA, storm alerts |
| **Port Timeline Browser** | Browse any registered port's upcoming shipment schedule |
| **Route Progress Panel** | Checkpoint pills showing reached/missed/pending status with ETA to next checkpoint |
| **Public AI Chatbot** | Guardrailed Gemini assistant for navigation help, tracking ID lookup, and port schedule queries |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         HARDWARE LAYER                          │
│  ESP32 + 2D LiDAR (zone sensing) │ Neo-6M GPS + SIM800L GSM   │
└────────────────────┬────────────────────────┬───────────────────┘
                     │                        │
                     ▼                        ▼
┌──────────────────────────┐    ┌─────────────────────────────────┐
│  Firebase Realtime DB    │    │         MongoDB Atlas           │
│  sensor_readings/{port}  │    │  Ports, Users, Shipments,       │
│  gps_stream/{device}     │    │  Workforce, Checkpoints         │
└───────────┬──────────────┘    └──────────────┬──────────────────┘
            │                                  │
            └──────────────┬───────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NODE.JS / EXPRESS BACKEND                     │
│  JWT Auth · Shipment CRUD · Sensor Controllers · Chat API       │
│  Efficiency Score · Labour Prediction · Route Attachment        │
└────────────────────┬────────────────────────┬───────────────────┘
                     │                        │
          ┌──────────┘                        └──────────┐
          ▼                                              ▼
┌─────────────────────┐                    ┌────────────────────────┐
│  PYTHON / FLASK     │                    │    GEMINI AI API       │
│  Reasoning Engine   │                    │  Admin + Public Chat   │
│  Route Optimization │                    │  Function Calling      │
│  Delay Prediction   │                    └────────────────────────┘
└─────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
│  HTML/CSS/JS + Tailwind · Leaflet Maps · Firebase SDK           │
│  Port Dashboard · Public Tracking Portal · Admin Pages          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Hardware
- **ESP32** — microcontroller handling WiFi/cellular communication
- **2D LiDAR** — deployed at zone entry/exit gates for container detection
- **Neo-6M GPS Module** — mounted on cargo vessels for live location streaming
- **SIM800L GSM Module** — cellular connectivity for GPS when WiFi unavailable

### Frontend
- HTML5, CSS3, **Tailwind CSS**
- Vanilla JavaScript (ES6+)
- **Leaflet.js** — interactive shipment tracking maps
- **Alpine.js** — lightweight UI state management
- **Material Symbols** (Google Fonts)

### Backend
- **Node.js** + **Express.js**
- **JWT** authentication + **bcryptjs** password hashing
- **Mongoose** ODM

### Databases
- **MongoDB Atlas** — ports, users, shipments, workforce configuration
- **Firebase Realtime Database** — live sensor readings and GPS streams (WebSocket push)

### AI / Intelligence
- **Google Gemini 2.5 Flash Lite** — admin and public AI chatbots with function calling
- **Facebook Prophet** — time-series storage capacity forecasting
- **Deterministic Reasoning Engine v4** (Python/Flask) — route optimization and delay prediction with 8-factor analysis

### External APIs
- **Open-Meteo** — live weather at vessel GPS coordinates
- **Nominatim / OpenStreetMap** — reverse geocoding on port registration
- **Firebase Admin SDK** — server-side sensor data access

### Cloud / Deployment
- **Google Cloud Run** — serverless backend deployment (horizontal scaling)
- **Firebase Hosting** — frontend static files
- **MongoDB Atlas** — managed cloud database

### Security
- JWT Bearer tokens on all admin routes
- bcrypt password hashing
- Environment variables for all secrets and API keys
- Firebase Rules for database access control
- Role-based access (port_admin, port_staff)

---

## Intelligence Engine

### Route Optimization & Delay Prediction (Python/Flask)

The reasoning engine (`ml_service.py`) is a domain-encoded maritime intelligence system that models 8 compounding delay factors and produces ranked route recommendations with full narrative reasoning chains.

**Delay Factors:**

| Factor | Description |
|---|---|
| Storm Trajectory | Temporal storm/voyage window intersection — checks if ship can outrun the storm or if overlap actually occurs |
| Congestion Compounding | Progressive berth wait curve, storm-induced berth slot miss, tidal window constraints |
| Coast Crossing | West↔East routes add 310nm for Cape Comorin rounding + Palk Strait navigation penalty |
| Carrier Reliability | Probabilistic delay from mechanical breakdown and schedule adherence history |
| Origin Congestion | Departure clearance delay from origin port backlog |
| Tidal Windows | Tide-sensitive port arrival constraints |
| Customs Inspection | Port + cargo type customs delay modelling |
| Berth Slot Miss | Storm-induced arrival shift vs berth schedule |

**Route Options Generated:**
- **Route A** — Direct origin → destination
- **Route B** — Via intermediate waypoint port (avoids storm zone / reduces congestion)
- **Route C** — Port shift to alternative destination with lowest congestion on same coast

**Route Scoring (4 dimensions):**
```
score = 0.40 × delay_score + 0.30 × cost_score + 0.20 × congestion_score + 0.10 × safety_score
```

**Output:**
```json
{
  "risk_score": 67,
  "risk_tier": "HIGH",
  "best_route": "B",
  "route_confidence_pct": 48.2,
  "recommendation_action": "REROUTE",
  "time_saved_hours": 4.2,
  "predicted_delay_hours": 8.5,
  "situation": "Storm window detected...",
  "recommended_action": "Initiate reroute assessment...",
  "delay_breakdown": { "storm_weather": 3.2, "destination_cong": 4.1, ... },
  "routes": { "A": {...}, "B": {...}, "C": {...} }
}
```

**Port Registry:** 10 Indian ports (JNPT, Mundra, Kandla, Mormugao, Kochi, Chennai, Vizag, Paradip, Kolkata, Ennore) each with base congestion, berth slots, tide sensitivity, coast classification, and customs delay averages.

**Cargo Profiles:** Containers, Crude Oil, Coal, Iron Ore, Electronics, Automobiles, Fertilizers, Food Grains, Textiles, Chemicals — each with risk multiplier, weather sensitivity, customs risk, perishability, hazmat level.

**Vessel Profiles:** Container Ship, Bulk Carrier, Tanker, RoRo Vessel, General Cargo — each with speed (knots), weather wave limit, storm speed factor, maneuverability.

### Port Efficiency Score

```
Score = 0.35 × on_time_arrival_rate
      + 0.25 × zone_utilization_efficiency
      + 0.20 × turnaround_efficiency
      + 0.10 × checkpoint_adherence_rate
      + 0.10 × disruption_resilience_score
```

- **On-Time Arrival Rate** — shipments arriving within ±2 hours of schedule
- **Zone Utilization Efficiency** — optimal range 60–85%; penalizes both under-use and over-use
- **Turnaround Efficiency** — actual vs 24-hour benchmark (configurable)
- **Checkpoint Adherence** — reached vs missed checkpoints ratio
- **Disruption Resilience** — storm-flagged shipments that still arrived on time

Labels: Excellent (85+) · Good (70–84) · Needs Attention (50–69) · Critical (<50)

### Labour Demand Forecasting

7-day workforce prediction per role using:

```
crane_operators  = ceil(container_count / 30) + 1 per vessel
truck_operators  = ceil(container_count / 20)
customs_officers = ceil(container_count / 50) + 1 per vessel
ground_crew      = ceil(container_count / 15) + 2 per vessel
docking_staff    = 2 per vessel
```

Detects per-shift shortages and generates daily breakdown with surplus/deficit per role.

---

## Hardware Layer

### Zone Storage Monitoring
- **ESP32** reads 2D LiDAR sensor at zone entry/exit gates
- Entry trigger → Firebase `container_count + 1`
- Exit trigger → Firebase `container_count - 1`
- Dashboard reflects ground reality in real time — no manual counts, no estimation

### GPS Vessel Tracking
- **Neo-6M GPS** module streams coordinates every 30 seconds
- **SIM800L GSM** provides cellular fallback when WiFi unavailable
- GPS pushes to `/api/v1/sensors/gps` → updates `latest_weather` and `weather_snapshots` on shipment
- Live position renders on Leaflet map with traveled path trail

---

## Getting Started

### Prerequisites
- Node.js v18+
- Python 3.9+
- MongoDB Atlas account
- Firebase project
- Google Gemini API key

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/POMS-poms.git
cd POMS-poms
```

### 2. Install Node.js Dependencies

```bash
npm install
```

### 3. Install Python Dependencies

```bash
cd ml_service
pip install flask flask-cors
python ml_service.py
```

### 4. Configure Environment Variables

Create a `.env` file in the root directory:

```env
MONGO_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_jwt_secret_key
JWT_LIFETIME=30d
GEMINI_API_KEY=your_gemini_api_key
```

### 5. Configure Firebase

Create `config/serviceAccountKey.json` with your Firebase Admin SDK credentials (download from Firebase Console → Project Settings → Service Accounts).

Create `firebaseClient.js` in the frontend directory with your Firebase web config:

```javascript
const firebaseConfig = {
    apiKey: "your_api_key",
    authDomain: "your-project.firebaseapp.com",
    databaseURL: "https://your-project-default-rtdb.region.firebasedatabase.app",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "your_sender_id",
    appId: "your_app_id"
};

firebase.initializeApp(firebaseConfig);
const firebaseDB = firebase.database();
```

### 6. Seed the Database

```bash
node scripts/seed.js
```

After seeding, attach planned routes to all shipments:

```bash
# POST to /api/v1/shipments/reattach-routes with admin JWT token
```

### 7. Start the Server

```bash
npm start
# or
node server.js
```

The backend runs on `http://localhost:3000`
The ML service runs on `http://localhost:5001`

---

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `MONGO_URI` | MongoDB Atlas connection string | ✅ |
| `JWT_SECRET` | JWT signing secret | ✅ |
| `JWT_LIFETIME` | JWT expiry (e.g. `30d`) | ✅ |
| `GEMINI_API_KEY` | Google Gemini API key | ✅ |

Firebase config is embedded in `firebaseClient.js` (web config is public-facing by design — security is enforced via Firebase Rules).

---

## API Reference

### Authentication
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/v1/port/register` | Register new port + admin user | None |
| POST | `/api/v1/auth/login` | Login and receive JWT | None |

### Port
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/v1/port/me` | Get current port details | JWT |
| GET | `/api/v1/port/zones` | Get port zones | JWT |
| GET | `/api/v1/port/workforce` | Get workforce configuration | JWT |
| PUT | `/api/v1/port/workforce` | Update workforce configuration | JWT |
| GET | `/api/v1/port/efficiency-score` | Compute port efficiency score | JWT |
| GET | `/api/v1/port/labour-prediction` | Get 7-day labour forecast | JWT |

### Shipments
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/v1/shipments` | Get all shipments | JWT |
| POST | `/api/v1/shipments` | Create shipment | JWT |
| GET | `/api/v1/shipments/today` | Get today's shipments | JWT |
| GET | `/api/v1/shipments/calendar` | Get shipments grouped by date | JWT |
| POST | `/api/v1/shipments/sync-statuses` | Sync GPS-based statuses | JWT |
| POST | `/api/v1/shipments/reattach-routes` | Re-attach routes to all shipments | JWT |
| GET | `/api/v1/shipments/:id` | Get shipment by ID | JWT |
| GET | `/api/v1/shipments/:id/detail` | Get full shipment detail with checkpoints | JWT |
| PUT | `/api/v1/shipments/:id` | Update shipment | JWT |
| DELETE | `/api/v1/shipments/:id` | Delete shipment | JWT |

### Sensors
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/v1/sensors/entry` | Container entry trigger (+1) | JWT |
| POST | `/api/v1/sensors/exit` | Container exit trigger (-1) | JWT |
| GET | `/api/v1/sensors/:port_id` | Get sensor data | JWT |
| POST | `/api/v1/sensors/gps` | Push GPS location from device | JWT |

### Public (No Auth)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/public/ports` | List all registered ports |
| GET | `/api/v1/public/ports/:portId/timeline` | Get port's upcoming shipments |
| GET | `/api/v1/public/track/:trackingId` | Track shipment by UUID |

### Chat
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/v1/chat/admin` | Admin AI chatbot (full data access) | JWT |
| POST | `/api/v1/chat/public` | Public AI chatbot (guardrailed) | None |

### ML Service (Python — Port 5001)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/predict` | Route optimization + delay prediction |
| GET | `/health` | Service health check |
| GET | `/model-info` | Factor weights + port registry |

---

## Project Structure

```
POMS-poms/
├── config/
│   ├── db.js                    # MongoDB connection
│   ├── firebaseAdmin.js         # Firebase Admin SDK setup
│   └── serviceAccountKey.json   # Firebase credentials (gitignored)
│
├── controllers/
│   ├── portController.js        # Port CRUD, efficiency score, labour prediction
│   ├── shipmentController.js    # Shipment CRUD, calendar, sync, detail
│   ├── sensorController.js      # Entry/exit triggers, GPS push
│   └── chatController.js        # Gemini admin + public chatbots
│
├── middleware/
│   └── authentication.js        # JWT verification middleware
│
├── models/
│   ├── port.js                  # Port schema (zones, workforce, shifts)
│   ├── user.js                  # User schema (bcrypt, JWT methods)
│   └── shipment.js              # Shipment schema (GPS, checkpoints, weather)
│
├── routes/
│   ├── portRoutes.js
│   ├── shipmentRoutes.js
│   ├── sensorRoutes.js
│   ├── publicRoutes.js
│   └── chatRoutes.js
│
├── utils/
│   └── routePlanner.js          # Planned route generation + checkpoint creation
│
├── scripts/
│   └── seed.js                  # Database seeder (June–August 2026 shipments)
│
├── ml_service/
│   └── ml_service.py            # Deterministic reasoning engine v4 (Flask)
│
├── frontend/
│   ├── landingPage.html         # Public landing page
│   ├── index.html               # Login / Register
│   ├── Dashboardport.html       # Port operations dashboard
│   ├── detailed_storage.html    # Zone capacity visualization
│   ├── detailed_shipment.html   # All shipments list
│   ├── DetailShipmentInfo.html  # Per-shipment map + detail
│   ├── add_shipment.html        # Shipment registration form
│   ├── shipment_timeline.html   # Calendar view
│   ├── labour_prediction.html   # Labour demand forecast
│   ├── edit_workforce.html      # Edit workforce configuration
│   ├── user_tracking.html       # Public tracking portal
│   └── gps-transmitter.html     # GPS emulator (development tool)
│
├── firebaseClient.js            # Firebase web SDK init
├── server.js                    # Express app entry point
├── .env                         # Environment variables (gitignored)
└── package.json
```

---

## Firebase Realtime Database Structure

```
sensor_readings/
  {port_id}/
    zone_A/
      container_count: 847
      max_capacity: 1500
      zone_name: "Zone A"
      last_updated: "2026-06-15T..."
      last_event: "entry"
    zone_B/
      ...

gps_stream/
  {device_id}/
    lat: 13.0055
    lng: 77.6029
    timestamp: "2026-06-15T..."
```

---

## Future Development

1. **Upgrade from 2D LiDAR to 3D LiDAR** — enables volumetric container measurement per zone, detecting stacking height for far more accurate occupancy calculation
2. **Retrain AI forecast model on real port data** — current model runs on synthetic data; onboarding real ports replaces it with historically accurate predictions
3. **Scale hardware from single-zone prototype to full port deployment** — production deploys networked sensor units across every zone simultaneously
4. **Automated SMS/email delay alerts** — delay detection currently visible on dashboard only; next step pushes instant notifications directly to cargo senders via Twilio and SendGrid
5. **Live AIS feed integration** — replaces manual shipment entry by pulling incoming vessel schedules directly from AIS networks
6. **GPS update frequency from 30 seconds to real-time streaming** — production hardware with optimized cellular compression
7. **National multi-port intelligence network** — architecture is already multi-port ready; onboarding multiple ports creates a shared congestion and forecasting layer that improves accuracy for every connected port

---

## Team

Built for **Google Solution Challenge 2026** — Smart Supply Chains track.

**Top 106** selected from global submissions.

---

## License

This project was built for Google Solution Challenge 2026 and is intended for educational and competition purposes.
