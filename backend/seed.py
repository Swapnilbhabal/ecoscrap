"""
Demo data so the dashboard, stats and charts are not empty on day one.
Every seeded booking has is_demo = 1 and the UI labels it as demo data.
The people below are fictional.
"""
import random
from datetime import datetime, timedelta, timezone

from . import accounts, service

# Demo customer account (fictional) used to show "My account" with real history
DEMO_USER = {"name": "Aarav Mehta", "phone": "9999900001", "password": "demo1234"}
DEMO_BOOKINGS = {0, 4, 13}   # seeded bookings that belong to the demo customer

# (name, area address, pincode, lat, lng)
PLACES = [
    ("Ananya Iyer", "B-1204, Lodha Aria, Kanjurmarg East", "400042", 19.1289, 72.9323),
    ("Rohit Deshmukh", "14, Shivaji Park Road No. 3, Dadar West", "400028", 19.0270, 72.8383),
    ("Fatima Sayed", "A-7, Hill Road, Bandra West", "400050", 19.0544, 72.8302),
    ("Karan Mehta", "302, Raheja Vihar, Powai", "400072", 19.1197, 72.9050),
    ("Sneha Kulkarni", "Flat 9, Gokul Dham, Goregaon East", "400063", 19.1663, 72.8640),
    ("Arjun Nair", "C-501, Hiranandani Estate, Thane West", "400607", 19.2570, 72.9710),
    ("Meera Joshi", "22, Tilak Nagar, Chembur", "400089", 19.0670, 72.8960),
    ("Vikram Singh", "1101, Oberoi Splendor, Jogeshwari East", "400060", 19.1352, 72.8697),
    ("Priya Rao", "B-3, Sector 17, Vashi, Navi Mumbai", "400703", 19.0745, 72.9978),
    ("Aditya Patil", "45, Ram Maruti Road, Thane West", "400602", 19.1950, 72.9720),
    ("Zoya Khan", "8, Carter Road, Bandra West", "400050", 19.0650, 72.8225),
    ("Siddharth Menon", "604, Kalpataru Towers, Kandivali East", "400101", 19.2045, 72.8687),
    ("Nikita Shah", "12, Malabar Hill Road", "400006", 18.9548, 72.7985),
    ("Omkar Jadhav", "Room 3, Bhandup Village Road, Bhandup West", "400078", 19.1440, 72.9370),
    ("Riya Fernandes", "201, Orlem, Malad West", "400064", 19.1872, 72.8436),
    ("Harsh Gupta", "D-9, Sector 21, Kharghar, Navi Mumbai", "410210", 19.0330, 73.0700),
]

BASKETS = [
    [("phone", "not_working", 2), ("cables", "working", 1)],
    [("laptop", "not_working", 1), ("accessory", "broken", 2)],
    [("display", "broken", 1)],
    [("phone", "broken", 3), ("battery", "not_working", 2)],
    [("tablet", "working", 1), ("cables", "working", 2)],
    [("printer", "not_working", 1), ("accessory", "not_working", 3)],
    [("appliance", "broken", 2), ("cables", "broken", 1)],
    [("large", "not_working", 1)],
    [("laptop", "broken", 2), ("phone", "not_working", 1)],
    [("phone", "working", 1), ("battery", "working", 1), ("cables", "working", 1)],
]


def _phone(i):
    return f"9{(810000000 + i * 7919) % 1000000000:09d}"


def seed(c, rng=None):
    rng = rng or random.Random(42)
    demo_uid = ensure_demo_user(c)
    now = datetime.now(timezone.utc)
    plan = (["recycled"] * 11) + ["picked_up", "cancelled", "assigned", "assigned", "assigned"]
    for i, (name, addr, pin, lat, lng) in enumerate(PLACES):
        status = plan[i]
        days_ago = 13 - i * 0.8 if status in ("recycled", "picked_up", "cancelled") else 0.2
        created = now - timedelta(days=max(0.15, days_ago), hours=rng.randint(0, 6))
        pickup = created + timedelta(days=1)
        if pickup.weekday() == 6:  # no pickups on Sunday
            pickup += timedelta(days=1)
        if status == "assigned":
            pickup = now + timedelta(days=1 + (i % 2))
            if pickup.weekday() == 6:
                pickup += timedelta(days=1)
        basket = BASKETS[i % len(BASKETS)]
        if i in DEMO_BOOKINGS:
            name = DEMO_USER["name"]
        data = {
            "name": name, "phone": DEMO_USER["phone"] if i in DEMO_BOOKINGS else _phone(i), "email": None, "address": addr, "landmark": None,
            "pincode": pin, "lat": lat, "lng": lng, "pickup_date": pickup.date().isoformat(),
            "slot": ["09:00-12:00", "12:00-15:00", "15:00-18:00"][i % 3], "wipe": True,
            "donate": i % 5 == 0, "notes": None, "photos": [],
            "items": [{"category": cat, "condition": cond, "qty": q} for cat, cond, q in basket],
        }
        rid = service.create(c, data, actor="customer", is_demo=True, created_at=service.iso(created),
                             user_id=demo_uid if i in DEMO_BOOKINGS else None)
        t = created + timedelta(minutes=3)

        def stamp(status_name, when):
            c.execute("UPDATE events SET at = ? WHERE request_id = ? AND status = ? AND id = "
                      "(SELECT MAX(id) FROM events WHERE request_id = ? AND status = ?)",
                      (service.iso(when), rid, status_name, rid, status_name))

        if status == "cancelled":
            service.cancel(c, rid, "Sold it to a relative")
            stamp("cancelled", t + timedelta(hours=2))
            continue
        if status in ("picked_up", "recycled"):
            r = service.get(c, rid)
            service.set_status(c, rid, "on_the_way", "Trip started", "collector", service.iso(t + timedelta(hours=20)),
                               trip_mode="sim")
            service.set_status(c, rid, "arrived", "Collector reached your location", "system",
                               service.iso(t + timedelta(hours=20, minutes=18)))
            est = r["est_kg"]
            kg = round(est * rng.uniform(0.85, 1.2), 2)
            service.handover(c, rid, r["otp"], kg)
            stamp("picked_up", t + timedelta(hours=20, minutes=31))
            c.execute("UPDATE points SET at = ? WHERE request_id = ?", (service.iso(t + timedelta(hours=20, minutes=31)), rid))
            c.execute("UPDATE requests SET rating = ?, feedback = ? WHERE id = ?",
                      (rng.choice([5, 5, 5, 4, 4]), rng.choice([
                          "Collector was on time and weighed everything in front of me.",
                          "Got the certificate the same evening. Smooth.",
                          "Liked seeing the bike on the map.",
                          "Paid exactly the rate card amount.", None]), rid))
            if status == "recycled":
                service.mark_recycled(c, rid, at=service.iso(t + timedelta(hours=27)))
                stamp("recycled", t + timedelta(hours=27))
            last = t + timedelta(hours=27 if status == "recycled" else 21)
            c.execute("UPDATE requests SET updated_at = ? WHERE id = ?", (service.iso(last), rid))


def ensure_demo_user(c):
    """Create the demo customer account if it does not exist yet."""
    row = c.execute("SELECT id FROM users WHERE phone = ?", (DEMO_USER["phone"],)).fetchone()
    if row:
        return row["id"]
    return accounts.create_user(c, DEMO_USER["name"], DEMO_USER["phone"], DEMO_USER["password"])
