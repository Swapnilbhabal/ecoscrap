"""
Storage. Two engines, same tables and same SQL:
  - SQLite (Python's built-in sqlite3) on your laptop. No setup needed.
  - PostgreSQL when the DATABASE_URL environment variable is set (for example a free
    Neon database). Use this when the site is deployed, so data is kept permanently.

Tables
  requests       one row per pickup booking
  request_items  the items in a booking (category, condition, quantity)
  events         timeline of status changes for each booking
  pings          GPS positions sent by the collector during a live trip
  points         Green Points ledger (+ earned, - redeemed) keyed by phone
  redemptions    rewards claimed with Green Points
  messages       questions sent through the contact form
  users          customer accounts (password stored as a salted PBKDF2 hash)
  staff          collector and admin sign-in PINs (salted hashes)
  sessions       sign-in tokens for customers, collectors and admin
  photos         photos attached to bookings (base64 text)
"""
import json
import os
import re
import sqlite3
from decimal import Decimal
from contextlib import contextmanager
from pathlib import Path

# On Vercel only /tmp is writable, so the database lives there (it resets when Vercel restarts the app).
_DEFAULT_DB = Path("/tmp/ecoscrap.db") if os.getenv("VERCEL") else Path(__file__).resolve().parent.parent / "ecoscrap.db"
DB_PATH = Path(os.getenv("ECOSCRAP_DB", _DEFAULT_DB))

# Neon and most hosts give a URL starting with postgres:// or postgresql://
DATABASE_URL = (os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or "").strip()
USE_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS requests (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL,
    email           TEXT,
    address         TEXT NOT NULL,
    landmark        TEXT,
    pincode         TEXT NOT NULL,
    lat             REAL NOT NULL,
    lng             REAL NOT NULL,
    pickup_date     TEXT NOT NULL,
    slot            TEXT NOT NULL,
    wipe            INTEGER DEFAULT 1,
    donate          INTEGER DEFAULT 0,
    notes           TEXT,
    photos          TEXT DEFAULT '[]',
    status          TEXT NOT NULL,
    collector_id    TEXT,
    recycler_id     TEXT,
    otp             TEXT NOT NULL,
    est_payout      INTEGER DEFAULT 0,
    est_kg          REAL DEFAULT 0,
    final_payout    INTEGER,
    verified_kg     REAL,
    co2_kg          REAL,
    points          INTEGER,
    certificate_id  TEXT,
    reason          TEXT,
    rating          INTEGER,
    feedback        TEXT,
    trip_mode       TEXT,
    trip_started_at TEXT,
    trip_seconds    REAL,
    route           TEXT,
    route_m         REAL,
    is_demo         INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS request_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id  TEXT NOT NULL REFERENCES requests(id),
    category    TEXT NOT NULL,
    condition   TEXT NOT NULL,
    qty         INTEGER NOT NULL,
    unit_rate   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id  TEXT NOT NULL REFERENCES requests(id),
    at          TEXT NOT NULL,
    status      TEXT NOT NULL,
    note        TEXT,
    actor       TEXT
);
CREATE TABLE IF NOT EXISTS pings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id  TEXT NOT NULL REFERENCES requests(id),
    at          TEXT NOT NULL,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    accuracy    REAL
);
CREATE TABLE IF NOT EXISTS points (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL,
    at          TEXT NOT NULL,
    delta       INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    request_id  TEXT
);
CREATE TABLE IF NOT EXISTS redemptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL,
    at          TEXT NOT NULL,
    reward_id   TEXT NOT NULL,
    points      INTEGER NOT NULL,
    code        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          TEXT NOT NULL,
    name        TEXT NOT NULL,
    contact     TEXT NOT NULL,
    topic       TEXT NOT NULL,
    message     TEXT NOT NULL,
    handled     INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL UNIQUE,
    email       TEXT,
    pw_salt     TEXT NOT NULL,
    pw_hash     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff (
    id          TEXT PRIMARY KEY,
    role        TEXT NOT NULL,
    pin_salt    TEXT NOT NULL,
    pin_hash    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token        TEXT PRIMARY KEY,
    role         TEXT NOT NULL,
    user_id      INTEGER,
    collector_id TEXT,
    expires      REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
    name        TEXT PRIMARY KEY,
    mime        TEXT NOT NULL,
    data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_phone ON requests(phone);
CREATE INDEX IF NOT EXISTS idx_pings_req ON pings(request_id);
"""


def _pg_schema(sql):
    """Turn the SQLite schema into PostgreSQL: auto ids and 8-byte decimals."""
    sql = sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
    return re.sub(r"\bREAL\b", "DOUBLE PRECISION", sql)


class _PGRow(dict):
    """A row you can read as r["name"] or r[0], like sqlite3.Row."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def _pg_row_factory(cursor):
    names = [d.name for d in (cursor.description or [])]

    def make(values):
        # Postgres returns SUM()/AVG() as Decimal; the app expects int/float like SQLite
        return _PGRow(zip(names, [(int(v) if v == v.to_integral_value() else float(v)) if isinstance(v, Decimal) else v
                                  for v in values]))
    return make


class _PGConn:
    """Small wrapper so the app's SQLite-style SQL ('?' placeholders) runs on PostgreSQL."""
    def __init__(self, raw):
        self.raw = raw

    @staticmethod
    def _sql(sql):
        sql = sql.replace("%", "%%").replace("?", "%s")
        return re.sub(r"\bLIKE\b", "ILIKE", sql)     # SQLite LIKE ignores case; match that

    def execute(self, sql, params=()):
        params = tuple(int(p) if isinstance(p, bool) else p for p in params)
        cur = self.raw.cursor(row_factory=_pg_row_factory)
        cur.execute(self._sql(sql), params)
        return cur

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def close(self):
        self.raw.close()


def connect():
    if USE_PG:
        import psycopg   # installed from requirements.txt; only needed when DATABASE_URL is set
        # prepare_threshold=None: Neon's pooled connection (PgBouncer) works best without prepared statements
        return _PGConn(psycopg.connect(DATABASE_URL, connect_timeout=15, prepare_threshold=None))
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def tx():
    """Open a connection, commit on success, roll back on error."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# columns added after the first release; added automatically to older databases
MIGRATIONS = [("requests", "user_id", "INTEGER"), ("points", "user_id", "INTEGER"), ("redemptions", "user_id", "INTEGER")]


def lock(c):
    """Stop two copies of the app (e.g. two Vercel instances) from setting up the database at the same time."""
    if USE_PG:
        c.execute("SELECT pg_advisory_xact_lock(724100)")


def init():
    with tx() as c:
        if USE_PG:
            lock(c)
            for stmt in _pg_schema(SCHEMA).split(";"):
                if stmt.strip():
                    c.execute(stmt)
            for table, col, kind in MIGRATIONS:
                c.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {kind}")
            return
        c.executescript(SCHEMA)
        for table, col, kind in MIGRATIONS:
            cols = [r["name"] for r in c.execute(f"PRAGMA table_info({table})")]
            if col not in cols:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {kind}")


def row(r):
    """Database row -> plain dict, with JSON columns decoded."""
    if r is None:
        return None
    d = dict(r)
    for key in ("photos", "route"):
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except ValueError:
                d[key] = None
    return d
