"""
Customer accounts and sign-in sessions for all three roles.

Passwords are never stored. We keep a random salt and a PBKDF2-SHA256 hash
(200,000 rounds), the same family of method used by Django.
Sessions are stored in the database so a server restart does not sign people out.
"""
import hashlib
import hmac
import secrets
import time

from .service import RuleError, iso

SESSION_HOURS = 24 * 7
ROUNDS = 200_000


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ROUNDS).hex()
    return salt, digest


def check_password(password, salt, digest):
    return hmac.compare_digest(hash_password(password, salt)[1], digest)


def create_user(c, name, phone, password, email=None):
    if c.execute("SELECT 1 FROM users WHERE phone = ?", (phone,)).fetchone():
        raise RuleError("An account with this mobile number already exists. Sign in instead.", 409)
    salt, digest = hash_password(password)
    cur = c.execute("INSERT INTO users (created_at, name, phone, email, pw_salt, pw_hash) VALUES (?,?,?,?,?,?) RETURNING id",
                    (iso(), name, phone, email, salt, digest))
    return cur.fetchone()["id"]


def authenticate(c, phone, password):
    u = c.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()
    if not u or not check_password(password, u["pw_salt"], u["pw_hash"]):
        return None
    return dict(u)


def user(c, uid):
    u = c.execute("SELECT id, created_at, name, phone, email FROM users WHERE id = ?", (uid,)).fetchone()
    return dict(u) if u else None


def new_session(c, role, user_id=None, collector_id=None):
    token = secrets.token_urlsafe(32)
    c.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
    c.execute("INSERT INTO sessions (token, role, user_id, collector_id, expires) VALUES (?,?,?,?,?)",
              (token, role, user_id, collector_id, time.time() + SESSION_HOURS * 3600))
    return token


def get_session(c, token):
    if not token:
        return None
    s = c.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
    if not s or s["expires"] < time.time():
        return None
    return dict(s)


def end_session(c, token):
    c.execute("DELETE FROM sessions WHERE token = ?", (token,))


# ---------------------------------------------------------------- staff (collectors + admin)
def ensure_staff(c, collectors, admin_pin):
    """Create a hashed PIN for every collector and for the admin if missing."""
    for col in collectors:
        if not c.execute("SELECT 1 FROM staff WHERE id = ?", (col["id"],)).fetchone():
            salt, digest = hash_password(col["demo_pin"])
            c.execute("INSERT INTO staff (id, role, pin_salt, pin_hash) VALUES (?,?,?,?)", (col["id"], "collector", salt, digest))
    salt, digest = hash_password(admin_pin)
    c.execute("INSERT INTO staff (id, role, pin_salt, pin_hash) VALUES ('ADMIN','admin',?,?) "
              "ON CONFLICT(id) DO UPDATE SET pin_salt = excluded.pin_salt, pin_hash = excluded.pin_hash", (salt, digest))


def check_staff(c, staff_id, role, pin):
    s = c.execute("SELECT * FROM staff WHERE id = ? AND role = ?", (staff_id, role)).fetchone()
    return bool(s) and check_password(pin, s["pin_salt"], s["pin_hash"])
