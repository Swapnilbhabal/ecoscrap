# EcoScrap: Doorstep E-waste Pickup Request Platform

A full-stack website for booking free doorstep e-waste pickups in Mumbai, Thane and Navi Mumbai.
Customers book with a published rate card, watch the collector arrive on a live map, hand over with
a 4-digit code, and get a recycling certificate plus Green Points. Every pickup is assigned to the
nearest e-waste recycler from the Maharashtra Pollution Control Board's authorised list.

Subject: E-waste and Environment Management.

---

## 1. Run it on your laptop

Needs **Python 3.10 or newer**. No internet is needed after installing (fonts, map library and 3D engine are inside the project). Map tiles need internet; without it the map shows a grid and still works.

**Windows (PowerShell)**
```powershell
cd ecoscrap
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

**Mac / Linux**
```bash
cd ecoscrap
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

Open **http://localhost:8000**. On first start the database `ecoscrap.db` is created and filled with 16 demo bookings (marked "demo" everywhere).

### Sign in (one page for everyone: `/login.html`)
The sign-in page first asks **"Who are you?"**: Customer, Collector or Admin. Every password box has a show/hide eye button.

**Customer:** create an account (name, mobile, password), or tap **Use the demo customer account** (mobile `9999900001`, password `demo1234`). After sign-in: **My account** with every pickup, live tracking, certificate PDF downloads, Green Points and profile. Sign out from the name menu in the header or the button on My account.

**Collector:** type your **collector ID**. Your name, vehicle and hub appear so you know the ID is right. Then enter **your own PIN**:

| Collector ID | Name | Hub | Demo PIN |
|---|---|---|---|
| CL-101 | Rahul Pawar | Andheri | 4821 |
| CL-102 | Pooja Kadam | Bandra | 7364 |
| CL-103 | Sameer Shaikh | Ghatkopar | 2590 |
| CL-104 | Imran Qureshi | Thane | 9137 |
| CL-105 | Neha Sawant | Dadar | 6408 |

**Admin:** password `9090` (change it with the `ADMIN_PIN` environment variable).

How sign-in behaves:
- PINs and passwords are stored only as salted PBKDF2 hashes. Five wrong attempts lock sign-in for 5 minutes.
- Sign-in lasts for the browser tab. Closing the tab or browser signs you out, and **restarting the server signs everyone out**.
- Each tab can be a different role, so one laptop can show customer, collector and admin side by side.
- **My account shows only pickups booked while signed in.** Guest bookings are not attached by mobile number, because anyone could type someone else's number.

### Add your team's contact details
Edit `static/js/config.js` and fill in `phone`, `whatsapp` and `email`. Empty values are hidden. When filled, a floating WhatsApp and call button appears on every page.

---

## 2. Pages

| Page | What it does |
|---|---|
| `/` Home | 3D hero, scroll-driven exploded phone showing the materials inside, live stats, rate calculator, kabadiwala comparison, authorised recycler map, Green Points, FAQ, contact form |
| `/book.html` | 4-step booking: items + condition + photos → map pin + address → day and slot → details and review. Live estimate and nearest recycler on the side |
| `/track.html` | Live tracking like a food-delivery app: moving collector, route, ETA ring, handover code, timeline, cancel / reschedule, rating, certificate link |
| `/certificate.html?id=…` | Recycling certificate with QR code that anyone can scan to verify. **Download PDF** gives a one-page A4 portrait PDF generated on the server (`/api/certificates/<id>/pdf`) |
| `/login.html` | One sign-in page: choose Customer, Collector or Admin |
| `/account.html` | Customer's **My account**: all pickups like "Your orders", certificate downloads, Green Points, profile and password |
| `/rewards.html` | Green Points balance, progress to next reward, redeem catalogue, history |
| `/rates.html` | Full published rate card |
| `/learn.html` | Rendered 3D video hero, animated bar chart of India's e-waste, 7 animated hazard illustrations, animated conveyor showing a phone being dismantled, animated EPR money/material loop, live "open burning vs authorised sorting" scenes, animated phone checklist, CO₂ slider, sources |
| `/directory.html` | "Recycle everything else": Indian organisations for plastic, textiles, flowers, dry waste, with filters and search |
| `/collector.html` | Collector's phone app: jobs, call, navigate, start trip (live GPS or demo simulation), weigh, verify OTP, pay, deliver to recycler |
| `/admin.html` | Admin dashboard: KPIs, charts, all requests with filters and search, reassign / reject / mark recycled, live map of trips, contact messages, reset demo data |

---

## 3. The demo flow (rehearse this)

Use two screens: laptop on the projector as the **customer**, a phone (or second browser tab) as the **collector**.

1. **Home page**: scroll slowly through the 3D sections. Point out the rate calculator and the recycler map with MPCB authorisation numbers.
2. **Book a pickup** (`/book.html`): add a phone and a laptop, tap the map, pick a slot, enter a name and a 10-digit mobile. Show the booking ID and handover code.
3. Click **Track live**. The customer page shows the assigned collector and the authorised recycler.
4. On the **collector app**, sign in with the collector ID of the collector named on the track page and their PIN (table above). Tap **Start trip → Demo simulation**.
5. Back on the customer screen, the collector **moves along the route** with distance and ETA. It arrives in about a minute.
6. In the collector app: change one item's condition to show the price change, enter the weight, type the customer's **4-digit code**, confirm. The payout and Green Points appear.
7. Tap **Delivered to [recycler]**. The customer page now shows **View certificate**. Open it, show the QR code, click **Download PDF / print**.
8. Open **Green Points** and claim a reward if the balance allows.
9. Open the **admin dashboard** (PIN `9090`): charts, the new request in the table, the live map.
10. Before the presentation, press **Reset demo data** in the admin sidebar to start clean.

**Live GPS instead of simulation:** browsers allow location only on `https://` or `localhost`. On a deployed site (see below) the collector can choose **Live GPS** and the customer sees the phone's real position.

---

## 4. Put it online (free, gives HTTPS)

1. Push this folder to a GitHub repository.
2. On [render.com](https://render.com) choose **New → Blueprint** and pick the repository. `render.yaml` sets everything up. Or create a **Web Service** by hand:
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
3. Set `COLLECTOR_PIN` and `ADMIN_PIN` in the Render environment settings.

Free-tier notes: the site sleeps after about 15 minutes without visitors (open it 5 minutes before the demo). The database is reset when the server restarts; demo data is loaded again automatically.

### Or deploy on Vercel with a permanent Neon database (recommended)
1. Push this folder to GitHub. On [vercel.com](https://vercel.com) choose **Add New → Project**, import the repository and click **Deploy** (keep every setting at its default; Vercel finds the FastAPI `app` in `app.py`).
2. In the Vercel project open **Storage → Create Database → Neon** (free plan), create it and **Connect** it to the project. Vercel adds the `DATABASE_URL` environment variable.
3. Open **Deployments**, click the three dots on the latest one and choose **Redeploy**.

When `DATABASE_URL` is set, EcoScrap stores everything (accounts, bookings, points, photos, sign-ins) in that Postgres database, so nothing is lost when Vercel restarts. Demo data is added only the first time. Without `DATABASE_URL` it falls back to SQLite (on your laptop: `ecoscrap.db`; on Vercel: `/tmp`, wiped on restart).

---

## 5. How it is built

```
ecoscrap/
├── app.py                 FastAPI routes: customer, collector, admin APIs + serves the website
├── backend/
│   ├── catalog.py         rate card, CO₂ factors, slots, real MPCB recyclers, demo collectors, rewards
│   ├── service.py         business rules: create, assign nearest, trip, OTP handover, points, certificate
│   ├── geo.py             distance (Haversine), nearest partner, road route (OSRM) with offline fallback
│   ├── db.py              tables; SQLite on the laptop, PostgreSQL when DATABASE_URL is set
│   ├── seed.py            demo bookings
│   └── directory.py       "recycle everything else" organisations
├── static/                the website (HTML, CSS, JS) + vendor libraries stored locally
└── requirements.txt
```

**Status flow:** placed → assigned → on the way → arrived → picked up → recycled (or cancelled / rejected).

**Key rules enforced on the server**
- Only known item types, 3 conditions, quantity 1–20, up to 12 lines.
- Price, weight, CO₂ and points are always calculated on the server, never trusted from the browser.
- Indian mobile format, Maharashtra pincode, address length, service area (Mumbai region bounding box).
- Pickup dates: next 7 working days, no Sundays. One open booking per phone per slot.
- Tracking needs **booking ID + phone together**; other customers' data is never returned.
- The collector never sees the OTP; handover fails without the customer's code.
- Weight must be more than 0; payout recalculated from the rate card if the collector changes a condition.

**Formulas**
- Payout = Σ (rate for item and condition × quantity)
- CO₂e avoided = Σ (weight × factor for the item type), scaled to the verified weight. Factors are illustrative and listed on the Learn page.
- Car comparison = CO₂e ÷ 0.17 kg per km
- Green Points = 10 × verified kg + 50 per completed pickup
- ETA = remaining route distance ÷ 20 km/h (average city speed)

---

## 6. Media
All visuals were made for this project, so the site works offline and there are no copyright issues:
- `static/media/heap.webm` / `heap.mp4`: an 8-second looping video of a 3D e-waste heap, rendered frame by frame from a three.js scene (`static/_render/heap.html`) and encoded with ffmpeg.
- Hazard illustrations, the conveyor and the EPR loop are animated SVG. The two "informal vs authorised" scenes are drawn live on a canvas.

## 7. Data sources
- Authorised recyclers: [MPCB list of authorised e-waste dismantlers and recyclers](https://www.mpcb.gov.in/sites/default/files/List%20of%20Authorized%20E-waste%20Dismantlers%20and%20Recyclers%20in%20Maharashtra.pdf) (only entries valid beyond 2026 are used; map positions are approximate area centres).
- India e-waste generation: Lok Sabha unstarred question 3684, 24 March 2025 ([reproduced by Toxics Link](https://toxicslink.org/parliament-q-a/management-of-e-waste/)).
- E-Waste (Management) Rules 2022: [analysis by LKS](https://www.lkslaw.com/insights/articles/e-waste-management-rules-2022-an-analysis).
- Directory organisations: each website was opened and checked on 8-9 Oct 2026.

Collectors, customers in the demo data, and the rate card values are fictional and for demonstration only. EcoScrap is a student project and is not affiliated with any recycler or organisation listed.
