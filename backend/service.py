"""
Business rules for a pickup request, kept separate from the HTTP routes so
they are easy to read and explain.

Status flow
  placed -> assigned -> on_the_way -> arrived -> picked_up -> recycled
  (cancelled by the customer, or rejected by the admin, at the early stages)
"""
import json
import random
import string
from datetime import date, datetime, timedelta, timezone

from . import catalog, geo
from .db import row

STATUSES = ["placed", "assigned", "on_the_way", "arrived", "picked_up", "recycled"]
STATUS_LABEL = {
    "placed": "Request placed",
    "assigned": "Collector assigned",
    "on_the_way": "Collector on the way",
    "arrived": "Collector has arrived",
    "picked_up": "Picked up and weighed",
    "recycled": "Recycled, certificate issued",
    "cancelled": "Cancelled",
    "rejected": "Rejected",
}
CAN_CHANGE = {"placed", "assigned"}  # customer may cancel or reschedule here

AVG_CITY_SPEED = 20 / 3.6  # 20 km/h in metres per second, used for ETA
ARRIVE_RADIUS_M = 150


class RuleError(Exception):
    """A business rule was broken; the message is shown to the user."""

    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- helpers
def now():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now()).isoformat(timespec="seconds")


def new_request_id():
    return "ES-" + "".join(random.choices(string.ascii_uppercase.replace("O", "") + "23456789", k=6))


def recycler(rid):
    return next((r for r in catalog.RECYCLERS if r["id"] == rid), None)


def collector(cid):
    return next((c for c in catalog.COLLECTORS if c["id"] == cid), None)


def public_collector(col):
    """Collector details that are safe to show (never the PIN)."""
    return {k: v for k, v in col.items() if k != "demo_pin"} if col else None


def in_service_area(lat, lng):
    b = catalog.SERVICE_BBOX
    return b["lat_min"] <= lat <= b["lat_max"] and b["lng_min"] <= lng <= b["lng_max"]


def bookable_dates(today=None, days=10):
    """Next `days` calendar days excluding Sundays (we work Mon-Sat)."""
    today = today or date.today()
    out = []
    d = today + timedelta(days=1)
    while len(out) < 7 and (d - today).days <= days:
        if d.weekday() != 6:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def price(items):
    """Price a list of {category, condition, qty} with the published rate card."""
    lines, payout, kg = [], 0, 0.0
    for it in items:
        cat = catalog.CATEGORIES[it["category"]]
        rate = cat["rates"][it["condition"]]
        lines.append({**it, "unit_rate": rate})
        payout += rate * it["qty"]
        kg += cat["kg"] * it["qty"]
    return lines, payout, round(kg, 2)


def co2_for(items, verified_kg=None):
    """
    CO2e avoided (kg) = sum(weight of each category x its factor).
    If a verified total weight is known, the estimated weights are scaled to it.
    """
    est = [(catalog.CATEGORIES[i["category"]]["kg"] * i["qty"], catalog.CATEGORIES[i["category"]]["co2_factor"])
           for i in items]
    est_total = sum(w for w, _ in est) or 1
    scale = (verified_kg / est_total) if verified_kg else 1
    return round(sum(w * scale * f for w, f in est), 2)


def points_for(kg):
    return int(round(kg * catalog.POINTS_PER_KG)) + catalog.POINTS_PER_PICKUP


def add_event(c, rid, status, note="", actor="system", at=None):
    c.execute("INSERT INTO events (request_id, at, status, note, actor) VALUES (?,?,?,?,?)",
              (rid, at or iso(), status, note, actor))


def set_status(c, rid, status, note="", actor="system", at=None, **fields):
    fields["status"] = status
    fields["updated_at"] = at or iso()
    cols = ", ".join(f"{k} = ?" for k in fields)
    c.execute(f"UPDATE requests SET {cols} WHERE id = ?", (*fields.values(), rid))
    add_event(c, rid, status, note, actor, at)


def get(c, rid):
    r = row(c.execute("SELECT * FROM requests WHERE id = ?", (rid,)).fetchone())
    if not r:
        raise RuleError("We couldn't find that booking ID.", 404)
    return r


def items_of(c, rid):
    return [dict(x) for x in c.execute(
        "SELECT category, condition, qty, unit_rate FROM request_items WHERE request_id = ? ORDER BY id", (rid,))]


# ---------------------------------------------------------------- create
def create(c, data, actor="customer", is_demo=False, created_at=None, user_id=None):
    """Validate business rules, price the items, store the booking, auto-assign."""
    if not in_service_area(data["lat"], data["lng"]):
        raise RuleError("We currently pick up only within the Mumbai Metropolitan Region. "
                        "Move the pin on the map to your address.")
    if not is_demo:
        if data["pickup_date"] not in bookable_dates():
            raise RuleError("Choose a pickup date in the next 7 working days (Monday to Saturday).")
        clash = c.execute(
            "SELECT id FROM requests WHERE phone = ? AND pickup_date = ? AND slot = ? "
            "AND status IN ('placed','assigned','on_the_way','arrived')",
            (data["phone"], data["pickup_date"], data["slot"])).fetchone()
        if clash:
            raise RuleError(f"You already have booking {clash['id']} in this slot. "
                            "Track or reschedule it instead.", 409)

    lines, payout, kg = price(data["items"])
    rid = new_request_id()
    while c.execute("SELECT 1 FROM requests WHERE id = ?", (rid,)).fetchone():
        rid = new_request_id()
    at = created_at or iso()
    c.execute(
        """INSERT INTO requests (id, created_at, updated_at, name, phone, email, address, landmark, pincode,
           lat, lng, pickup_date, slot, wipe, donate, notes, photos, status, otp, est_payout, est_kg, is_demo, user_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (rid, at, at, data["name"], data["phone"], data.get("email"), data["address"], data.get("landmark"),
         data["pincode"], data["lat"], data["lng"], data["pickup_date"], data["slot"],
         int(data.get("wipe", True)), int(data.get("donate", False)), data.get("notes"),
         json.dumps(data.get("photos", [])), "placed", f"{random.randint(1000, 9999)}", payout, kg, int(is_demo), user_id))
    for ln in lines:
        c.execute("INSERT INTO request_items (request_id, category, condition, qty, unit_rate) VALUES (?,?,?,?,?)",
                  (rid, ln["category"], ln["condition"], ln["qty"], ln["unit_rate"]))
    add_event(c, rid, "placed", "Booking received", actor, at)
    assign(c, rid, at=at)
    return rid


def assign(c, rid, collector_id=None, actor="system", at=None):
    """Assign the nearest collector and the nearest authorised recycler."""
    r = get(c, rid)
    col = collector(collector_id) if collector_id else geo.nearest(catalog.COLLECTORS, r["lat"], r["lng"])
    if not col:
        raise RuleError("Unknown collector.")
    rec = geo.nearest(catalog.RECYCLERS, r["lat"], r["lng"])
    km = geo.haversine(r["lat"], r["lng"], rec["lat"], rec["lng"]) / 1000
    note = f"{col['name']} ({col['hub']} hub). Goes to {rec['name']}, {km:.1f} km away."
    set_status(c, rid, "assigned", note, actor, at, collector_id=col["id"], recycler_id=rec["id"])


# ---------------------------------------------------------------- customer changes
def cancel(c, rid, reason="Cancelled by customer"):
    r = get(c, rid)
    if r["status"] not in CAN_CHANGE:
        raise RuleError("This pickup can no longer be cancelled because the collector is already on the way.")
    set_status(c, rid, "cancelled", reason, "customer", reason=reason)


def reschedule(c, rid, pickup_date, slot):
    r = get(c, rid)
    if r["status"] not in CAN_CHANGE:
        raise RuleError("This pickup can no longer be rescheduled because the collector is already on the way.")
    if pickup_date not in bookable_dates():
        raise RuleError("Choose a date in the next 7 working days (Monday to Saturday).")
    c.execute("UPDATE requests SET pickup_date = ?, slot = ?, updated_at = ? WHERE id = ?",
              (pickup_date, slot, iso(), rid))
    add_event(c, rid, r["status"], f"Rescheduled to {pickup_date}, {slot}", "customer")


def rate(c, rid, stars, feedback):
    r = get(c, rid)
    if r["status"] not in ("picked_up", "recycled"):
        raise RuleError("You can rate the pickup after the collector has picked up your items.")
    c.execute("UPDATE requests SET rating = ?, feedback = ? WHERE id = ?", (stars, feedback, rid))


# ---------------------------------------------------------------- live trip
def start_trip(c, rid, mode, lat=None, lng=None, actor="collector", at=None):
    """
    mode 'sim' : the server moves the collector along a road route for the demo.
    mode 'gps' : the collector's phone sends real positions to /ping.
    """
    r = get(c, rid)
    if r["status"] not in ("assigned", "on_the_way"):
        raise RuleError("A trip can only start for an assigned pickup.")
    col = collector(r["collector_id"])
    if mode == "gps" and lat is not None:
        start = (lat, lng)
    else:
        # demo: start about 2.5 km from the customer, on the side of the collector's hub
        start = geo.move_towards(r["lat"], r["lng"], col["lat"], col["lng"], 2500)
    path, source = geo.road_route(start, (r["lat"], r["lng"]))
    metres = geo.path_length(path)
    seconds = max(45.0, min(110.0, metres / 30))  # sped-up demo trip
    note = "Live GPS trip started" if mode == "gps" else "Trip started (demo simulation)"
    set_status(c, rid, "on_the_way", note, actor, at,
               trip_mode=mode, trip_started_at=at or iso(), trip_seconds=seconds,
               route=json.dumps({"path": path, "source": source}), route_m=round(metres))


def ping(c, rid, lat, lng, accuracy=None):
    r = get(c, rid)
    if r["status"] not in ("on_the_way", "arrived"):
        raise RuleError("Start the trip before sharing live location.")
    c.execute("INSERT INTO pings (request_id, at, lat, lng, accuracy) VALUES (?,?,?,?,?)",
              (rid, iso(), lat, lng, accuracy))
    if r["status"] == "on_the_way" and geo.haversine(lat, lng, r["lat"], r["lng"]) <= ARRIVE_RADIUS_M:
        set_status(c, rid, "arrived", "Collector reached your location (GPS)", "system")


def live(c, rid):
    """Where is the collector right now? Used by the customer track page."""
    r = get(c, rid)
    dest = {"lat": r["lat"], "lng": r["lng"]}
    route = r.get("route") or {}
    path = route.get("path") or []
    out = {"status": r["status"], "label": STATUS_LABEL[r["status"]], "customer": dest,
           "mode": r["trip_mode"], "route_source": route.get("source"), "collector": None,
           "remaining_path": [], "distance_m": None, "eta_min": None, "progress": None}
    if r["status"] not in ("on_the_way", "arrived") or not path:
        if r["status"] in ("picked_up", "recycled"):
            out["progress"] = 1
        return out

    if r["trip_mode"] == "sim":
        started = datetime.fromisoformat(r["trip_started_at"])
        progress = min(1.0, (now() - started).total_seconds() / (r["trip_seconds"] or 60))
        pos = geo.point_along(path, progress)
        remaining = (1 - progress) * (r["route_m"] or 0)
        if progress >= 1 and r["status"] == "on_the_way":
            set_status(c, rid, "arrived", "Collector reached your location", "system")
            out["status"], out["label"] = "arrived", STATUS_LABEL["arrived"]
        out.update(collector=pos, remaining_path=geo.remaining_path(path, progress), progress=round(progress, 3))
    else:
        p = c.execute("SELECT lat, lng, accuracy, at FROM pings WHERE request_id = ? ORDER BY id DESC LIMIT 1",
                      (rid,)).fetchone()
        if p:
            pos = {"lat": p["lat"], "lng": p["lng"], "heading": 0, "accuracy": p["accuracy"], "at": p["at"]}
        else:
            pos = {"lat": path[0][0], "lng": path[0][1], "heading": 0}
        remaining = geo.haversine(pos["lat"], pos["lng"], r["lat"], r["lng"]) * 1.3  # road factor
        out.update(collector=pos, remaining_path=[[pos["lat"], pos["lng"]], [r["lat"], r["lng"]]],
                   progress=None)
    out["distance_m"] = round(remaining)
    out["eta_min"] = 0 if out["status"] == "arrived" else max(1, round(remaining / AVG_CITY_SPEED / 60))
    return out


# ---------------------------------------------------------------- handover
def handover(c, rid, otp, verified_kg, items=None, actor="collector"):
    """Collector enters the customer's OTP and the weighed items; payout and points are fixed here."""
    r = get(c, rid)
    if r["status"] not in ("arrived", "on_the_way"):
        raise RuleError("Handover is possible only when the collector is at the pickup address.")
    if otp != r["otp"]:
        raise RuleError("That handover code is wrong. Ask the customer for the 4-digit code on their track page.")
    if items:  # collector corrected the conditions/quantities after checking
        lines, _, _ = price(items)
        c.execute("DELETE FROM request_items WHERE request_id = ?", (rid,))
        for ln in lines:
            c.execute("INSERT INTO request_items (request_id, category, condition, qty, unit_rate) "
                      "VALUES (?,?,?,?,?)", (rid, ln["category"], ln["condition"], ln["qty"], ln["unit_rate"]))
    current = items_of(c, rid)
    final = sum(i["unit_rate"] * i["qty"] for i in current)
    co2 = co2_for(current, verified_kg)
    pts = points_for(verified_kg)
    note = f"Verified {verified_kg} kg. Payout ₹{final}" + (" donated" if r["donate"] else " paid") + f". {pts} Green Points."
    set_status(c, rid, "picked_up", note, actor,
               final_payout=final, verified_kg=verified_kg, co2_kg=co2, points=pts)
    c.execute("INSERT INTO points (phone, at, delta, reason, request_id, user_id) VALUES (?,?,?,?,?,?)",
              (r["phone"], iso(), pts, f"Pickup {rid} ({verified_kg} kg)", rid, r.get("user_id")))


def mark_recycled(c, rid, actor="collector", at=None):
    r = get(c, rid)
    if r["status"] != "picked_up":
        raise RuleError("Items must be picked up before they are handed to the recycler.")
    rec = recycler(r["recycler_id"])
    cert = "CERT-" + rid[3:] + "-" + (at or iso())[2:10].replace("-", "")
    set_status(c, rid, "recycled", f"Received by {rec['name']} ({rec['auth']})", actor, at, certificate_id=cert)


def reject(c, rid, reason, actor="admin"):
    r = get(c, rid)
    if r["status"] not in CAN_CHANGE:
        raise RuleError("Only bookings that have not started can be rejected.")
    set_status(c, rid, "rejected", reason, actor, reason=reason)


# ---------------------------------------------------------------- views
def balance(c, phone=None, user_id=None):
    """Guests: points are counted by phone. Account holders: by their account only."""
    if user_id is not None:
        v = c.execute("SELECT COALESCE(SUM(delta),0) AS b FROM points WHERE user_id = ?", (user_id,)).fetchone()
    else:
        v = c.execute("SELECT COALESCE(SUM(delta),0) AS b FROM points WHERE phone = ? AND user_id IS NULL", (phone,)).fetchone()
    return v["b"]


def public_view(c, r):
    """What the customer sees on the track page (no other customers' data)."""
    col, rec = collector(r["collector_id"]), recycler(r["recycler_id"])
    items = items_of(c, r["id"])
    for it in items:
        it["name"] = catalog.CATEGORIES[it["category"]]["name"]
        it["icon"] = catalog.CATEGORIES[it["category"]]["icon"]
        it["condition_label"] = catalog.CONDITIONS[it["condition"]]
    events = [dict(e) for e in c.execute(
        "SELECT at, status, note FROM events WHERE request_id = ? ORDER BY id", (r["id"],))]
    keep = ["id", "created_at", "name", "address", "landmark", "pincode", "lat", "lng", "pickup_date", "slot",
            "wipe", "donate", "status", "est_payout", "est_kg", "final_payout", "verified_kg", "co2_kg", "points",
            "certificate_id", "reason", "rating", "feedback", "is_demo", "photos"]
    out = {k: r[k] for k in keep}
    out.update(
        status_label=STATUS_LABEL[r["status"]],
        otp=r["otp"] if r["status"] in ("placed", "assigned", "on_the_way", "arrived") else None,
        phone_masked=r["phone"][:2] + "••••" + r["phone"][-4:],
        items=items, events=events,
        collector={k: col[k] for k in ("id", "name", "vehicle", "rating", "hub")} if col else None,
        recycler=rec, can_change=r["status"] in CAN_CHANGE,
        car_km=round((r["co2_kg"] or 0) / catalog.CAR_KG_CO2_PER_KM),
    )
    return out
