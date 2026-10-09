"""
Map maths: distances, nearest partner, road routes and the simulated trip.

Routes come from the public OSRM road-routing service when the server is
online. If it is unreachable (no internet in the classroom), we fall back to a
smooth curved path so the live-tracking demo still works.
"""
import json
import math
import urllib.request

EARTH_R = 6371000.0  # metres


def haversine(lat1, lng1, lat2, lng2):
    """Great-circle distance between two points in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def nearest(items, lat, lng):
    """Return the item (dict with lat/lng) closest to the given point."""
    return min(items, key=lambda it: haversine(lat, lng, it["lat"], it["lng"]))


def move_towards(lat, lng, to_lat, to_lng, metres):
    """Point exactly `metres` away from (lat, lng), heading towards (to_lat, to_lng)."""
    total = haversine(lat, lng, to_lat, to_lng)
    if total < 1:  # same point: just head north
        return lat + metres / 111_000, lng
    f = metres / total
    return lat + (to_lat - lat) * f, lng + (to_lng - lng) * f


def path_length(path):
    return sum(haversine(*path[i], *path[i + 1]) for i in range(len(path) - 1))


def _curved_path(a, b, n=48):
    """Fallback route: a gentle curve from a to b (quadratic Bezier)."""
    (lat1, lng1), (lat2, lng2) = a, b
    mid_lat, mid_lng = (lat1 + lat2) / 2, (lng1 + lng2) / 2
    # push the control point sideways so the path is not a straight line
    ctrl = (mid_lat + (lng2 - lng1) * 0.25, mid_lng - (lat2 - lat1) * 0.25)
    pts = []
    for i in range(n + 1):
        t = i / n
        la = (1 - t) ** 2 * lat1 + 2 * (1 - t) * t * ctrl[0] + t * t * lat2
        ln = (1 - t) ** 2 * lng1 + 2 * (1 - t) * t * ctrl[1] + t * t * lng2
        pts.append([round(la, 6), round(ln, 6)])
    return pts


def road_route(a, b, timeout=4):
    """
    Ask OSRM for a driving route between a=(lat,lng) and b=(lat,lng).
    Returns (path as [[lat,lng],...], source) where source is 'road' or 'approx'.
    """
    url = ("https://router.project-osrm.org/route/v1/driving/"
           f"{a[1]},{a[0]};{b[1]},{b[0]}?overview=full&geometries=geojson")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "EcoScrap-student-project"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.load(resp)
        coords = data["routes"][0]["geometry"]["coordinates"]  # [lng, lat]
        path = [[round(c[1], 6), round(c[0], 6)] for c in coords]
        if len(path) >= 2:
            return path, "road"
    except Exception:
        pass
    return _curved_path(a, b), "approx"


def point_along(path, fraction):
    """Position and heading (degrees) at `fraction` (0..1) of the path length."""
    if not path:
        return None
    fraction = max(0.0, min(1.0, fraction))
    seg_lengths = [haversine(*path[i], *path[i + 1]) for i in range(len(path) - 1)]
    total = sum(seg_lengths)
    if total == 0:
        return {"lat": path[-1][0], "lng": path[-1][1], "heading": 0}
    target = total * fraction
    walked = 0.0
    for i, seg in enumerate(seg_lengths):
        if walked + seg >= target or i == len(seg_lengths) - 1:
            f = 0 if seg == 0 else (target - walked) / seg
            f = max(0.0, min(1.0, f))
            (la1, ln1), (la2, ln2) = path[i], path[i + 1]
            heading = math.degrees(math.atan2(ln2 - ln1, la2 - la1)) % 360
            return {"lat": la1 + (la2 - la1) * f, "lng": ln1 + (ln2 - ln1) * f, "heading": round(heading)}
        walked += seg
    return {"lat": path[-1][0], "lng": path[-1][1], "heading": 0}


def remaining_path(path, fraction):
    """The part of the path still ahead of the collector (for drawing)."""
    if not path:
        return []
    here = point_along(path, fraction)
    seg_lengths = [haversine(*path[i], *path[i + 1]) for i in range(len(path) - 1)]
    target = sum(seg_lengths) * max(0.0, min(1.0, fraction))
    walked = 0.0
    for i, seg in enumerate(seg_lengths):
        if walked + seg >= target:
            return [[here["lat"], here["lng"]]] + path[i + 1:]
        walked += seg
    return [path[-1]]
