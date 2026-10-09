"""
EcoScrap: Doorstep E-waste Pickup Request Platform (FastAPI backend)

Run locally:   uvicorn app:app --reload --port 8000
Then open:     http://localhost:8000

Three kinds of users (one sign-in page: /login.html)
  customer  : signs up with mobile + password (or books as a guest), tracks pickups live,
              sees all past pickups and downloads certificates from "My account"
  collector : sees assigned jobs, runs the trip, verifies OTP, weighs items
  admin     : sees every request, reassigns, rejects, views charts
"""
import base64
import json
import os
import re
import secrets
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from backend import accounts, catalog, db, pdfcert, service
from backend.directory import DIRECTORY, MATERIALS
from backend.seed import ensure_demo_user, seed
from backend.service import RuleError

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
UPLOADS = STATIC / "uploads"   # older bookings only; new photos are saved in the database

ADMIN_PIN = os.getenv("ADMIN_PIN", "9090")   # collectors each have their own PIN (see catalog.py / README)
SEED_DEMO = os.getenv("SEED_DEMO", "1") == "1"

app = FastAPI(title="EcoScrap API", version="3.0")


# ======================================================================
# Start-up: create tables and load demo data if the database is empty
# ======================================================================
@app.on_event("startup")
def startup():
    db.init()
    with db.tx() as c:
        db.lock(c)
        empty = c.execute("SELECT COUNT(*) AS n FROM requests").fetchone()["n"] == 0
        if empty and SEED_DEMO:
            seed(c)
        if SEED_DEMO:
            ensure_demo_user(c)
        accounts.ensure_staff(c, catalog.COLLECTORS, ADMIN_PIN)
        if db.USE_PG:
            # online database: the cloud starts new copies of the app at any time, so keep
            # valid sign-ins and only clear expired ones
            c.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        else:
            # laptop: every restart signs everyone out, so nobody stays logged in by accident
            c.execute("DELETE FROM sessions")


# ======================================================================
# Errors: always answer {"error": "<plain sentence>"}
# ======================================================================
@app.exception_handler(RuleError)
def rule_error(_, exc: RuleError):
    return JSONResponse({"error": str(exc)}, status_code=exc.code)


@app.exception_handler(RequestValidationError)
def validation_error(_, exc: RequestValidationError):
    first = exc.errors()[0]
    field = ".".join(str(p) for p in first.get("loc", [])[1:])
    msg = str(first.get("msg", "Invalid input"))
    if msg.startswith("Value error, "):          # our own messages from validators
        msg = msg.removeprefix("Value error, ")
    else:                                          # pydantic's generic ones -> plain words
        last = field.split(".")[-1] if field else ""
        msg = FRIENDLY.get(last, f"Check the {last or 'form'} field.")
    return JSONResponse({"error": msg, "field": field}, status_code=422)


FRIENDLY = {
    "password": "Password must be at least 6 characters.",
    "new": "New password must be at least 6 characters.",
    "contact": "Enter a phone number or email so we can reply.",
    "message": "Write a short message (at least 5 characters).",
    "topic": "Choose what your message is about.",
    "qty": "Quantity must be between 1 and 20.",
    "items": "Add at least one item (up to 12 lines).",
    "name": "Enter your full name (2 to 60 letters).",
    "address": "Enter your full address (at least 8 characters).",
    "landmark": "Keep the landmark under 80 characters.",
    "verified_kg": "Enter the weighed amount in kg (more than 0).",
    "otp": "The handover code has 4 digits.",
    "stars": "Rating must be 1 to 5 stars.",
    "reason": "Give a short reason (3 to 160 characters).",
    "photos": "You can attach up to 3 photos.",
    "lat": "Drop the pin on the map at your address.",
    "lng": "Drop the pin on the map at your address.",
    "mode": "Trip mode must be live GPS or demo simulation.",
}


# ======================================================================
# Input models (validation happens here, before any business logic)
# ======================================================================
def check_name(v):
    v = " ".join(v.split())
    if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,59}", v):
        raise ValueError("Enter your name using letters only.")
    return v


def check_phone(v):
    v = re.sub(r"\D", "", v)[-10:]
    if not re.fullmatch(r"[6-9]\d{9}", v):
        raise ValueError("Enter a 10-digit Indian mobile number.")
    return v


def check_email(v):
    if v and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", v):
        raise ValueError("Enter a valid email or leave it empty.")
    return v or None


class Item(BaseModel):
    category: str
    condition: str
    qty: int = Field(ge=1, le=20)

    @field_validator("category")
    @classmethod
    def known_category(cls, v):
        if v not in catalog.CATEGORIES:
            raise ValueError("Unknown item type.")
        return v

    @field_validator("condition")
    @classmethod
    def known_condition(cls, v):
        if v not in catalog.CONDITIONS:
            raise ValueError("Condition must be working, not working or broken.")
        return v


class Estimate(BaseModel):
    items: List[Item] = Field(min_length=1, max_length=12)


class Booking(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    phone: str
    email: Optional[str] = None
    address: str = Field(min_length=8, max_length=200)
    landmark: Optional[str] = Field(default=None, max_length=80)
    pincode: str
    lat: float
    lng: float
    pickup_date: str
    slot: str
    wipe: bool = True
    donate: bool = False
    notes: Optional[str] = Field(default=None, max_length=300)
    photos: List[str] = Field(default_factory=list, max_length=3)
    items: List[Item] = Field(min_length=1, max_length=12)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v):
        v = " ".join(v.split())
        if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,59}", v):
            raise ValueError("Enter your name using letters only.")
        return v

    @field_validator("phone")
    @classmethod
    def indian_mobile(cls, v):
        v = re.sub(r"\D", "", v)[-10:]
        if not re.fullmatch(r"[6-9]\d{9}", v):
            raise ValueError("Enter a 10-digit Indian mobile number.")
        return v

    @field_validator("email")
    @classmethod
    def ok_email(cls, v):
        if v and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", v):
            raise ValueError("Enter a valid email or leave it empty.")
        return v or None

    @field_validator("pincode")
    @classmethod
    def mmr_pincode(cls, v):
        if not re.fullmatch(r"4\d{5}", v):
            raise ValueError("Enter a 6-digit Maharashtra pincode (starts with 4).")
        return v

    @field_validator("slot")
    @classmethod
    def ok_slot(cls, v):
        if v not in catalog.SLOTS:
            raise ValueError("Choose one of the listed time slots.")
        return v


class PhoneCheck(BaseModel):
    phone: str


class Reschedule(PhoneCheck):
    pickup_date: str
    slot: str


class Cancel(PhoneCheck):
    reason: str = Field(default="Changed my mind", max_length=120)


class Rating(PhoneCheck):
    stars: int = Field(ge=1, le=5)
    feedback: Optional[str] = Field(default=None, max_length=300)


class Redeem(PhoneCheck):
    booking_id: str
    reward_id: str


class Login(BaseModel):
    pin: str
    collector_id: Optional[str] = None


class Signup(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    phone: str
    email: Optional[str] = None
    password: str = Field(min_length=6, max_length=72)

    @field_validator("name")
    @classmethod
    def v_name(cls, v):
        return check_name(v)

    @field_validator("phone")
    @classmethod
    def v_phone(cls, v):
        return check_phone(v)

    @field_validator("email")
    @classmethod
    def v_email(cls, v):
        return check_email(v)


class UserLogin(BaseModel):
    phone: str
    password: str

    @field_validator("phone")
    @classmethod
    def v_phone(cls, v):
        return check_phone(v)


class ProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    email: Optional[str] = None

    @field_validator("name")
    @classmethod
    def v_name(cls, v):
        return check_name(v)

    @field_validator("email")
    @classmethod
    def v_email(cls, v):
        return check_email(v)


class PasswordChange(BaseModel):
    old: str
    new: str = Field(min_length=6, max_length=72)


class MeRedeem(BaseModel):
    reward_id: str


class StartTrip(BaseModel):
    mode: str = Field(pattern="^(sim|gps)$")
    lat: Optional[float] = None
    lng: Optional[float] = None


class Ping(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: Optional[float] = None


class Handover(BaseModel):
    otp: str = Field(pattern=r"^\d{4}$")
    verified_kg: float = Field(gt=0, le=500)
    items: Optional[List[Item]] = None


class Assign(BaseModel):
    collector_id: str


class Contact(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    contact: str = Field(min_length=5, max_length=80)
    topic: str = Field(pattern="^(pickup|business|partner|other)$")
    message: str = Field(min_length=5, max_length=1000)


class Reject(BaseModel):
    reason: str = Field(min_length=3, max_length=160)


# ======================================================================
# Sign-in for all three roles. Tokens are stored in the sessions table.
# ======================================================================
FAILS = defaultdict(list)     # client ip -> timestamps of wrong PINs / passwords
LOCK_AFTER, LOCK_SECONDS = 5, 300


def check_lock(ip):
    FAILS[ip] = [t for t in FAILS[ip] if time.time() - t < LOCK_SECONDS]
    if len(FAILS[ip]) >= LOCK_AFTER:
        raise RuleError("Too many wrong PINs. Try again in 5 minutes.", 429)


def issue(role, collector_id=None, user_id=None):
    with db.tx() as c:
        return accounts.new_session(c, role, user_id=user_id, collector_id=collector_id)


def token_of(authorization):
    return (authorization or "").removeprefix("Bearer ").strip()


def optional_session(authorization: Optional[str] = Header(default=None)):
    with db.tx() as c:
        return accounts.get_session(c, token_of(authorization))


def session(s=Depends(optional_session)):
    if not s:
        raise RuleError("Please sign in again.", 401)
    return s


def customer_only(s=Depends(session)):
    if s["role"] != "customer":
        raise RuleError("Customer sign-in required.", 403)
    return s


def admin_only(s=Depends(session)):
    if s["role"] != "admin":
        raise RuleError("Admin sign-in required.", 403)
    return s


def collector_only(s=Depends(session)):
    if s["role"] != "collector":
        raise RuleError("Collector sign-in required.", 403)
    return s


# ======================================================================
# Helpers
# ======================================================================
def owned(c, rid, phone):
    """Fetch a booking only if the phone number matches (privacy)."""
    phone = re.sub(r"\D", "", phone or "")[-10:]
    r = c.execute("SELECT * FROM requests WHERE id = ? AND phone = ?", (rid.strip().upper(), phone)).fetchone()
    if not r:
        raise RuleError("No booking matches that booking ID and mobile number.", 404)
    return db.row(r)


def save_photos(c, rid, photos):
    """Photos arrive as data URLs; store them in the database (max 1.5 MB each)."""
    saved = []
    for i, p in enumerate(photos[:3]):
        m = re.match(r"^data:image/(jpeg|png|webp);base64,(.+)$", p)
        if not m:
            raise RuleError("Photos must be JPG, PNG or WEBP images.")
        raw = base64.b64decode(m.group(2))
        if len(raw) > 1_500_000:
            raise RuleError("Each photo must be under 1.5 MB.")
        name = f"{rid}-{i + 1}.{m.group(1).replace('jpeg', 'jpg')}"
        c.execute("INSERT INTO photos (name, mime, data) VALUES (?,?,?)",
                  (name, f"image/{m.group(1)}", m.group(2)))
        saved.append(f"/uploads/{name}")
    return saved


# ======================================================================
# Public: catalogue, stats, directory
# ======================================================================
@app.get("/api/health")
def health():
    return {"status": "ok", "version": app.version}


@app.get("/api/catalog")
def get_catalog():
    return {
        "categories": catalog.CATEGORIES, "conditions": catalog.CONDITIONS, "slots": catalog.SLOTS,
        "dates": service.bookable_dates(), "rewards": catalog.REWARDS,
        "points": {"per_kg": catalog.POINTS_PER_KG, "per_pickup": catalog.POINTS_PER_PICKUP},
        "car_kg_co2_per_km": catalog.CAR_KG_CO2_PER_KM, "service_bbox": catalog.SERVICE_BBOX,
    }


@app.get("/api/recyclers")
def get_recyclers():
    return {"recyclers": catalog.RECYCLERS, "source": catalog.MPCB_SOURCE}


@app.get("/api/directory")
def get_directory():
    return {"materials": MATERIALS, "entries": DIRECTORY}


@app.get("/api/stats")
def stats():
    with db.tx() as c:
        done = c.execute("SELECT COUNT(*) n, COALESCE(SUM(verified_kg),0) kg, COALESCE(SUM(co2_kg),0) co2, "
                         "COALESCE(SUM(final_payout),0) paid, COALESCE(SUM(points),0) pts, "
                         "COALESCE(SUM(is_demo),0) demo FROM requests WHERE status IN ('picked_up','recycled')"
                         ).fetchone()
        total = c.execute("SELECT COUNT(*) n FROM requests").fetchone()["n"]
        rating = c.execute("SELECT AVG(rating) r FROM requests WHERE rating IS NOT NULL").fetchone()["r"]
    return {"pickups_done": done["n"], "kg": round(done["kg"], 1), "co2_kg": round(done["co2"], 1),
            "paid": done["paid"], "points": done["pts"], "requests": total,
            "car_km": round(done["co2"] / catalog.CAR_KG_CO2_PER_KM),
            "avg_rating": round(rating, 1) if rating else None,
            "recyclers": len(catalog.RECYCLERS), "includes_demo": done["demo"] > 0}


@app.post("/api/estimate")
def estimate(body: Estimate):
    items = [i.model_dump() for i in body.items]
    lines, payout, kg = service.price(items)
    co2 = service.co2_for(items)
    return {"lines": lines, "payout": payout, "kg": kg, "co2_kg": co2,
            "points": service.points_for(kg), "car_km": round(co2 / catalog.CAR_KG_CO2_PER_KM)}


# ======================================================================
# Customer: book, track, change, rate
# ======================================================================
@app.post("/api/requests", status_code=201)
def create_request(body: Booking, s=Depends(optional_session)):
    data = body.model_dump()
    if s and s["role"] == "customer":  # signed in: the booking always belongs to the account's number
        with db.tx() as c:
            data["phone"] = accounts.user(c, s["user_id"])["phone"]
    data["items"] = [i.model_dump() for i in body.items]
    photos = data.pop("photos")
    with db.tx() as c:
        uid = s["user_id"] if s and s["role"] == "customer" else None
        rid = service.create(c, {**data, "photos": []}, user_id=uid)
        if photos:
            c.execute("UPDATE requests SET photos = ? WHERE id = ?",
                      (json.dumps(save_photos(c, rid, photos)), rid))
        return service.public_view(c, service.get(c, rid))


@app.get("/api/requests/{rid}")
def get_request(rid: str, phone: str):
    with db.tx() as c:
        return service.public_view(c, owned(c, rid, phone))


@app.get("/api/requests/{rid}/live")
def get_live(rid: str, phone: str):
    with db.tx() as c:
        r = owned(c, rid, phone)
        return service.live(c, r["id"])


@app.post("/api/requests/{rid}/cancel")
def cancel_request(rid: str, body: Cancel):
    with db.tx() as c:
        r = owned(c, rid, body.phone)
        service.cancel(c, r["id"], body.reason)
        return service.public_view(c, service.get(c, r["id"]))


@app.post("/api/requests/{rid}/reschedule")
def reschedule_request(rid: str, body: Reschedule):
    if body.slot not in catalog.SLOTS:
        raise RuleError("Choose one of the listed time slots.")
    with db.tx() as c:
        r = owned(c, rid, body.phone)
        service.reschedule(c, r["id"], body.pickup_date, body.slot)
        return service.public_view(c, service.get(c, r["id"]))


@app.post("/api/requests/{rid}/rate")
def rate_request(rid: str, body: Rating):
    with db.tx() as c:
        r = owned(c, rid, body.phone)
        service.rate(c, r["id"], body.stars, body.feedback)
        return {"ok": True}


def certificate_data(c, cert_id):
    r = db.row(c.execute("SELECT * FROM requests WHERE certificate_id = ?", (cert_id.upper(),)).fetchone())
    if not r:
        raise RuleError("No certificate with that ID exists.", 404)
    view = service.public_view(c, r)
    recycled_at = next((e["at"] for e in view["events"] if e["status"] == "recycled"), None)
    parts = r["name"].split()
    name = parts[0] + (f" {parts[-1][0]}." if len(parts) > 1 else "")
    return {"certificate_id": r["certificate_id"], "booking_id": r["id"], "name": name,
            "items": view["items"], "verified_kg": r["verified_kg"], "co2_kg": r["co2_kg"],
            "car_km": view["car_km"], "points": r["points"], "recycler": view["recycler"],
            "collector": view["collector"], "recycled_at": recycled_at, "wipe": bool(r["wipe"]),
            "pincode": r["pincode"], "is_demo": bool(r["is_demo"])}


@app.get("/api/certificates/{cert_id}")
def certificate(cert_id: str):
    """Public certificate check: anyone with the certificate ID (or QR) can verify it."""
    with db.tx() as c:
        return certificate_data(c, cert_id)


@app.get("/api/certificates/{cert_id}/pdf")
def certificate_pdf(cert_id: str, request: Request):
    """The certificate as a one-page A4 portrait PDF download."""
    with db.tx() as c:
        data = certificate_data(c, cert_id)
    verify = str(request.base_url).rstrip("/") + f"/certificate.html?id={data['certificate_id']}"
    pdf = pdfcert.build(data, verify)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="EcoScrap-{data["certificate_id"]}.pdf"'})


# ======================================================================
# Customer accounts: sign up, sign in, my profile, my pickups, my points
# ======================================================================
def me_payload(c, uid):
    u = accounts.user(c, uid)
    done = c.execute("SELECT COUNT(*) n, COALESCE(SUM(verified_kg),0) kg, COALESCE(SUM(co2_kg),0) co2, "
                     "COALESCE(SUM(final_payout),0) paid FROM requests WHERE user_id = ? "
                     "AND status IN ('picked_up','recycled')", (uid,)).fetchone()
    total = c.execute("SELECT COUNT(*) n FROM requests WHERE user_id = ?", (uid,)).fetchone()["n"]
    return {**u, "balance": service.balance(c, user_id=uid), "pickups": total, "completed": done["n"],
            "kg": round(done["kg"], 1), "co2_kg": round(done["co2"], 1), "paid": done["paid"]}


@app.post("/api/auth/signup", status_code=201)
def signup(body: Signup):
    with db.tx() as c:
        uid = accounts.create_user(c, body.name, body.phone, body.password, body.email)
        token = accounts.new_session(c, "customer", user_id=uid)
        return {"token": token, "role": "customer", "user": me_payload(c, uid)}


@app.post("/api/auth/login")
def login(body: UserLogin, request: Request):
    ip = request.client.host if request.client else "?"
    check_lock(ip)
    with db.tx() as c:
        u = accounts.authenticate(c, body.phone, body.password)
        if not u:
            FAILS[ip].append(time.time())
            raise RuleError("Mobile number or password is wrong.", 401)
        token = accounts.new_session(c, "customer", user_id=u["id"])
        return {"token": token, "role": "customer", "user": me_payload(c, u["id"])}


@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(default=None)):
    with db.tx() as c:
        accounts.end_session(c, token_of(authorization))
    return {"ok": True}


@app.get("/api/me")
def me(s=Depends(customer_only)):
    with db.tx() as c:
        return me_payload(c, s["user_id"])


@app.patch("/api/me")
def update_me(body: ProfileUpdate, s=Depends(customer_only)):
    with db.tx() as c:
        c.execute("UPDATE users SET name = ?, email = ? WHERE id = ?", (body.name, body.email, s["user_id"]))
        return me_payload(c, s["user_id"])


@app.post("/api/me/password")
def change_password(body: PasswordChange, s=Depends(customer_only)):
    with db.tx() as c:
        u = dict(c.execute("SELECT * FROM users WHERE id = ?", (s["user_id"],)).fetchone())
        if not accounts.check_password(body.old, u["pw_salt"], u["pw_hash"]):
            raise RuleError("Your current password is wrong.")
        salt, digest = accounts.hash_password(body.new)
        c.execute("UPDATE users SET pw_salt = ?, pw_hash = ? WHERE id = ?", (salt, digest, s["user_id"]))
    return {"ok": True}


@app.get("/api/me/requests")
def my_requests(s=Depends(customer_only)):
    """All pickups booked while signed in to this account, newest first (like 'Your orders').
    Guest bookings are not attached automatically, because a mobile number alone does not prove ownership."""
    with db.tx() as c:
        phone = accounts.user(c, s["user_id"])["phone"]
        rows = c.execute("SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC", (s["user_id"],)).fetchall()
        return {"phone": phone, "requests": [service.public_view(c, db.row(r)) for r in rows]}


@app.get("/api/me/rewards")
def my_rewards_signed_in(s=Depends(customer_only)):
    with db.tx() as c:
        u = accounts.user(c, s["user_id"])
        return rewards_payload(c, u["phone"], u["name"], user_id=u["id"])


@app.post("/api/me/redeem")
def my_redeem(body: MeRedeem, s=Depends(customer_only)):
    with db.tx() as c:
        return do_redeem(c, accounts.user(c, s["user_id"])["phone"], body.reward_id, user_id=s["user_id"])


@app.post("/api/contact", status_code=201)
def contact(body: Contact):
    with db.tx() as c:
        c.execute("INSERT INTO messages (at, name, contact, topic, message) VALUES (?,?,?,?,?)",
                  (service.iso(), body.name.strip(), body.contact.strip(), body.topic, body.message.strip()))
    return {"ok": True}


# ======================================================================
# Green Points
# ======================================================================
def rewards_payload(c, phone, name, user_id=None):
    who, arg = ("user_id = ?", user_id) if user_id is not None else ("phone = ? AND user_id IS NULL", phone)
    history = [dict(x) for x in c.execute(f"SELECT at, delta, reason FROM points WHERE {who} ORDER BY id DESC", (arg,))]
    claimed = [dict(x) for x in c.execute(
        f"SELECT at, reward_id, points, code FROM redemptions WHERE {who} ORDER BY id DESC", (arg,))]
    for cl in claimed:
        cl["name"] = next((w["name"] for w in catalog.REWARDS if w["id"] == cl["reward_id"]), cl["reward_id"])
    return {"name": name.split()[0], "balance": service.balance(c, phone, user_id),
            "history": history, "claimed": claimed, "catalog": catalog.REWARDS}


def do_redeem(c, phone, reward_id, user_id=None):
    reward = next((w for w in catalog.REWARDS if w["id"] == reward_id), None)
    if not reward:
        raise RuleError("That reward does not exist.")
    bal = service.balance(c, phone, user_id)
    if bal < reward["points"]:
        raise RuleError(f"You need {reward['points'] - bal} more Green Points for this reward.")
    code = "GP-" + secrets.token_hex(3).upper()
    at = service.iso()
    c.execute("INSERT INTO points (phone, at, delta, reason, user_id) VALUES (?,?,?,?,?)",
              (phone, at, -reward["points"], f"Redeemed: {reward['name']}", user_id))
    c.execute("INSERT INTO redemptions (phone, at, reward_id, points, code, user_id) VALUES (?,?,?,?,?,?)",
              (phone, at, reward["id"], reward["points"], code, user_id))
    return {"code": code, "balance": bal - reward["points"], "reward": reward}


@app.get("/api/rewards")
def my_rewards(phone: str, booking_id: str):
    with db.tx() as c:
        r = owned(c, booking_id, phone)
        if r.get("user_id"):
            raise RuleError("This booking belongs to an account. Sign in to see its Green Points.", 403)
        return rewards_payload(c, r["phone"], r["name"])


@app.post("/api/rewards/redeem")
def redeem(body: Redeem):
    with db.tx() as c:
        r = owned(c, body.booking_id, body.phone)
        if r.get("user_id"):
            raise RuleError("This booking belongs to an account. Sign in to redeem points.", 403)
        return do_redeem(c, r["phone"], body.reward_id)


# ======================================================================
# Collector app
# ======================================================================
@app.get("/api/collectors/{cid}/card")
def collector_card(cid: str):
    """Shown on the sign-in page after a collector types their ID (no PIN, no phone)."""
    col = service.collector(cid.strip().upper())
    if not col:
        raise RuleError("No collector has this ID. Check the ID on your EcoScrap partner card.", 404)
    return {k: col[k] for k in ("id", "name", "hub", "vehicle", "rating")}


@app.post("/api/collector/login")
def collector_login(body: Login, request: Request):
    ip = request.client.host if request.client else "?"
    check_lock(ip)
    cid = (body.collector_id or "").strip().upper()
    with db.tx() as c:
        ok = accounts.check_staff(c, cid, "collector", body.pin)
        if not ok:
            FAILS[ip].append(time.time())
            raise RuleError("Collector ID or PIN is wrong.", 401)
        token = accounts.new_session(c, "collector", collector_id=cid)
    return {"token": token, "collector": service.public_collector(service.collector(cid))}


@app.get("/api/collector/jobs")
def collector_jobs(s=Depends(collector_only)):
    with db.tx() as c:
        rows = c.execute("SELECT * FROM requests WHERE collector_id = ? AND status IN "
                         "('assigned','on_the_way','arrived','picked_up') ORDER BY pickup_date, slot",
                         (s["collector_id"],)).fetchall()
        jobs = []
        for r in rows:
            r = db.row(r)
            v = service.public_view(c, r)
            v["phone"] = r["phone"]  # the collector needs to call the customer
            v.pop("otp", None)       # but never sees the OTP
            jobs.append(v)
        done = c.execute("SELECT COUNT(*) n, COALESCE(SUM(verified_kg),0) kg FROM requests "
                         "WHERE collector_id = ? AND status IN ('picked_up','recycled')",
                         (s["collector_id"],)).fetchone()
        return {"collector": service.public_collector(service.collector(s["collector_id"])), "jobs": jobs,
                "done": done["n"], "kg": round(done["kg"], 1)}


def my_job(c, rid, s):
    r = service.get(c, rid)
    if r["collector_id"] != s["collector_id"]:
        raise RuleError("This job is assigned to another collector.", 403)
    return r


@app.post("/api/collector/jobs/{rid}/start")
def start(rid: str, body: StartTrip, s=Depends(collector_only)):
    with db.tx() as c:
        my_job(c, rid, s)
        service.start_trip(c, rid, body.mode, body.lat, body.lng)
        return service.live(c, rid)


@app.post("/api/collector/jobs/{rid}/ping")
def collector_ping(rid: str, body: Ping, s=Depends(collector_only)):
    with db.tx() as c:
        my_job(c, rid, s)
        service.ping(c, rid, body.lat, body.lng, body.accuracy)
        return service.live(c, rid)


@app.post("/api/collector/jobs/{rid}/arrived")
def arrived(rid: str, s=Depends(collector_only)):
    with db.tx() as c:
        r = my_job(c, rid, s)
        if r["status"] != "on_the_way":
            raise RuleError("Start the trip first.")
        service.set_status(c, rid, "arrived", "Collector marked arrival", "collector")
        return {"ok": True}


@app.post("/api/collector/jobs/{rid}/handover")
def do_handover(rid: str, body: Handover, s=Depends(collector_only)):
    with db.tx() as c:
        my_job(c, rid, s)
        items = [i.model_dump() for i in body.items] if body.items else None
        service.handover(c, rid, body.otp, round(body.verified_kg, 2), items)
        return service.public_view(c, service.get(c, rid))


@app.post("/api/collector/jobs/{rid}/recycled")
def collector_recycled(rid: str, s=Depends(collector_only)):
    with db.tx() as c:
        my_job(c, rid, s)
        service.mark_recycled(c, rid)
        return service.public_view(c, service.get(c, rid))


# ======================================================================
# Admin dashboard
# ======================================================================
@app.post("/api/admin/login")
def admin_login(body: Login, request: Request):
    ip = request.client.host if request.client else "?"
    check_lock(ip)
    with db.tx() as c:
        if not accounts.check_staff(c, "ADMIN", "admin", body.pin):
            FAILS[ip].append(time.time())
            raise RuleError("Wrong admin password.", 401)
        return {"token": accounts.new_session(c, "admin")}


@app.get("/api/admin/summary")
def admin_summary(s=Depends(admin_only)):
    with db.tx() as c:
        rows = [db.row(r) for r in c.execute("SELECT * FROM requests")]
        items = c.execute("SELECT r.status, i.category, i.qty FROM request_items i "
                          "JOIN requests r ON r.id = i.request_id").fetchall()
    today = datetime.now(timezone.utc).date()
    days = [(today - timedelta(days=d)).isoformat() for d in range(13, -1, -1)]
    per_day = Counter(r["created_at"][:10] for r in rows)
    done = [r for r in rows if r["status"] in ("picked_up", "recycled")]
    kg_by_cat = defaultdict(float)
    for it in items:
        if it["status"] in ("picked_up", "recycled"):
            kg_by_cat[it["category"]] += catalog.CATEGORIES[it["category"]]["kg"] * it["qty"]
    by_recycler = Counter(r["recycler_id"] for r in done)
    return {
        "kpi": {"requests": len(rows), "active": sum(r["status"] in ("placed", "assigned", "on_the_way", "arrived")
                                                     for r in rows),
                "done": len(done), "kg": round(sum(r["verified_kg"] or 0 for r in done), 1),
                "co2": round(sum(r["co2_kg"] or 0 for r in done), 1),
                "paid": sum(r["final_payout"] or 0 for r in done),
                "cancel_rate": round(100 * sum(r["status"] in ("cancelled", "rejected") for r in rows) / max(1, len(rows))),
                "rating": round(sum(r["rating"] for r in rows if r["rating"]) /
                                max(1, sum(1 for r in rows if r["rating"])), 1),
                "demo": sum(r["is_demo"] for r in rows)},
        "per_day": [{"date": d, "count": per_day.get(d, 0)} for d in days],
        "status": Counter(r["status"] for r in rows),
        "kg_by_category": sorted([{"category": k, "name": catalog.CATEGORIES[k]["name"], "kg": round(v, 1)}
                                  for k, v in kg_by_cat.items()], key=lambda x: -x["kg"]),
        "by_recycler": [{"id": k, "name": service.recycler(k)["name"], "count": v}
                        for k, v in by_recycler.most_common()],
        "collectors": [service.public_collector(col) for col in catalog.COLLECTORS],
    }


@app.get("/api/admin/requests")
def admin_requests(status: Optional[str] = None, q: Optional[str] = None, s=Depends(admin_only)):
    sql, args = "SELECT * FROM requests WHERE 1=1", []
    if status and status != "all":
        if status == "active":
            sql += " AND status IN ('placed','assigned','on_the_way','arrived')"
        else:
            sql += " AND status = ?"
            args.append(status)
    if q:
        sql += " AND (id LIKE ? OR name LIKE ? OR phone LIKE ? OR pincode LIKE ?)"
        args += [f"%{q}%"] * 4
    sql += " ORDER BY created_at DESC LIMIT 200"
    with db.tx() as c:
        out = []
        for r in c.execute(sql, args).fetchall():
            r = db.row(r)
            v = service.public_view(c, r)
            v["phone"] = r["phone"]
            out.append(v)
        return out


@app.get("/api/admin/live")
def admin_live(s=Depends(admin_only)):
    """Positions of every collector currently on a trip (for the ops map)."""
    with db.tx() as c:
        rows = c.execute("SELECT id FROM requests WHERE status IN ('on_the_way','arrived')").fetchall()
        out = []
        for r in rows:
            lv = service.live(c, r["id"])
            req = service.get(c, r["id"])
            out.append({"id": r["id"], "collector_name": service.collector(req["collector_id"])["name"], **lv})
        return out


@app.post("/api/admin/requests/{rid}/assign")
def admin_assign(rid: str, body: Assign, s=Depends(admin_only)):
    with db.tx() as c:
        r = service.get(c, rid)
        if r["status"] not in ("placed", "assigned"):
            raise RuleError("Only bookings that have not started can be reassigned.")
        service.assign(c, rid, body.collector_id, actor="admin")
        return {"ok": True}


@app.post("/api/admin/requests/{rid}/reject")
def admin_reject(rid: str, body: Reject, s=Depends(admin_only)):
    with db.tx() as c:
        service.reject(c, rid, body.reason)
        return {"ok": True}


@app.post("/api/admin/requests/{rid}/recycled")
def admin_recycled(rid: str, s=Depends(admin_only)):
    with db.tx() as c:
        service.mark_recycled(c, rid, actor="admin")
        return {"ok": True}


@app.get("/api/admin/messages")
def admin_messages(s=Depends(admin_only)):
    with db.tx() as c:
        return [dict(m) for m in c.execute("SELECT * FROM messages ORDER BY id DESC LIMIT 100")]


@app.post("/api/admin/messages/{mid}/handled")
def admin_message_done(mid: int, s=Depends(admin_only)):
    with db.tx() as c:
        c.execute("UPDATE messages SET handled = 1 WHERE id = ?", (mid,))
    return {"ok": True}


@app.post("/api/admin/reset-demo")
def reset_demo(s=Depends(admin_only)):
    """Wipe everything and reload the demo data (handy before a presentation)."""
    with db.tx() as c:
        db.lock(c)
        for t in ("pings", "events", "request_items", "points", "redemptions", "requests", "messages", "users", "photos"):
            c.execute(f"DELETE FROM {t}")
        seed(c)
        ensure_demo_user(c)
        c.execute("DELETE FROM sessions WHERE role = 'customer'")
        accounts.ensure_staff(c, catalog.COLLECTORS, ADMIN_PIN)
    return {"ok": True}


@app.get("/uploads/{name}", include_in_schema=False)
def uploaded_photo(name: str):
    if re.fullmatch(r"[A-Z0-9-]+-[1-3]\.(jpg|png|webp)", name):
        with db.tx() as c:
            p = c.execute("SELECT mime, data FROM photos WHERE name = ?", (name,)).fetchone()
        if p:
            return Response(base64.b64decode(p["data"]), media_type=p["mime"],
                            headers={"Cache-Control": "public, max-age=86400"})
        if (UPLOADS / name).is_file():
            return FileResponse(UPLOADS / name)
    return JSONResponse({"error": "Photo not found."}, status_code=404)


# ======================================================================
# Website (static files). Mounted last so /api routes win.
# ======================================================================
app.mount("/", StaticFiles(directory=STATIC, html=True), name="site")
