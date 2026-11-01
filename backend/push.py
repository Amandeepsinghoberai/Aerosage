"""Browser push notifications (Level 2 alerts).

How it works
  1. The website asks the browser for permission and gets a "subscription" (a private address for that browser).
  2. POST /api/push/subscribe stores it with the area (nearest monitor) and the alert level the person chose.
  3. A background thread (and POST /api/push/check) compares every subscription with the saved forecast.
     When the air at that monitor is expected to reach the chosen level inside the next 24 h (or already is), one
     notification is sent per episode - never the same one twice.
Files (git-ignored):  data/push/vapid.json (server keys, created on first run) and data/push/subs.json (subscriptions).
Notifications are model forecasts, not live readings, and are only as fresh as the last forecast refresh.
"""
import base64, json, os, threading, time, urllib.parse
from pathlib import Path
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "push"
KEYS, SUBS = DATA / "vapid.json", DATA / "subs.json"
PRIVATE_PEM = DATA / "vapid_private.pem"
LEVELS = {201: "Poor", 301: "Very Poor", 401: "Severe"}
LOOKAHEAD_H, WINDOW_H, MAX_SUBS = 24, 72, 5000
ALLOWED_HOSTS = ("fcm.googleapis.com", "updates.push.services.mozilla.com", "push.apple.com", "notify.windows.com", "push.services.mozilla.com")
LOCK = threading.Lock()


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def vapid_public():
    """Create the server key pair once; return the public key the browser needs."""
    DATA.mkdir(parents=True, exist_ok=True)
    if not (KEYS.exists() and PRIVATE_PEM.exists()):
        from py_vapid import Vapid
        from cryptography.hazmat.primitives import serialization as S
        v = Vapid(); v.generate_keys()
        PRIVATE_PEM.write_bytes(v.private_pem()); os.chmod(PRIVATE_PEM, 0o600)
        pub = v.public_key.public_bytes(S.Encoding.X962, S.PublicFormat.UncompressedPoint)
        KEYS.write_text(json.dumps({"publicKey": _b64(pub)}))
    return json.loads(KEYS.read_text())["publicKey"]


def _load():
    try:
        return json.loads(SUBS.read_text())
    except Exception:
        return []


def _save(subs):
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = SUBS.with_suffix(".tmp"); tmp.write_text(json.dumps(subs)); tmp.replace(SUBS)


def _host_ok(endpoint):
    h = urllib.parse.urlparse(endpoint)
    return h.scheme == "https" and any(h.hostname == x or (h.hostname or "").endswith("." + x) for x in ALLOWED_HOSTS)


class SubIn(BaseModel):
    subscription: dict
    city: str = "delhi"
    lat: float
    lon: float
    level: int = 301


class EndpointIn(BaseModel):
    endpoint: str


def episode(c, station, level, now=None):
    """First stretch inside the next WINDOW_H hours where the forecast AQI at `station` is >= level.
    Returns None or {start, end, peak_time, peak_aqi, active, key}."""
    from common import aqi_info
    p50 = c.fc["stations"][station]["p50"]
    now = now or pd.Timestamp.now(tz="Asia/Kolkata").strftime("%Y-%m-%dT%H")
    start = next((i for i, t in enumerate(c.times) if t >= now), len(c.times))
    end = min(len(c.times) - 1, start + WINDOW_H)
    ep = None
    for i in range(start, end + 1):
        a = aqi_info(p50[i])["aqi"]
        if a >= level:
            if ep is None:
                ep = {"a": i, "b": i, "pk": i, "pka": a}
            ep["b"] = i
            if a > ep["pka"]:
                ep["pk"], ep["pka"] = i, a
        elif ep is not None:
            break
    if ep is None:
        return None
    return {"start": c.times[ep["a"]], "end": c.times[min(ep["b"] + 1, len(c.times) - 1)], "peak_time": c.times[ep["pk"]], "peak_aqi": int(ep["pka"]),
            "active": ep["a"] == start, "hours_until": ep["a"] - start, "key": f"{station}|{level}|{c.times[ep['a']]}"}


def _nice(t):
    d = pd.Timestamp(t + ":00")
    return d.strftime("%a %d %b, ") + d.strftime("%I %p").lstrip("0").lower()


def message(sub, ep):
    lvl = LEVELS.get(sub["level"], "Poor")
    when = "now" if ep["active"] else f"from {_nice(ep['start'])}"
    return {"title": f"{lvl} or worse air expected {when}",
            "body": f"Near {sub['station']}: forecast AQI peaks at {ep['peak_aqi']} around {_nice(ep['peak_time'])}. This is a model forecast, not a live reading.",
            "url": "/#map", "tag": ep["key"]}


def send(sub, payload):
    from pywebpush import webpush, WebPushException
    try:
        webpush(subscription_info=sub["subscription"], data=json.dumps(payload), vapid_private_key=str(PRIVATE_PEM),
                vapid_claims={"sub": "mailto:aerosage@example.com"}, ttl=3600)
        return True, None
    except WebPushException as e:
        code = getattr(getattr(e, "response", None), "status_code", None)
        return False, code
    except Exception:
        return False, None


def check_all(CITIES):
    """Compare every subscription with the forecast; send what is due. Returns a small report."""
    report = {"checked": 0, "sent": 0, "removed": 0}
    with LOCK:
        subs = _load(); keep = []
        for s in subs:
            report["checked"] += 1
            c = CITIES.get(s["city"])
            try:
                ep = episode(c, s["station"], s["level"]) if c else None
            except Exception:
                ep = None
            if ep and (ep["active"] or ep["hours_until"] <= LOOKAHEAD_H) and s.get("last_key") != ep["key"]:
                ok, code = send(s, message(s, ep))
                if ok:
                    s["last_key"] = ep["key"]; report["sent"] += 1
                elif code in (404, 410):
                    report["removed"] += 1; continue
            keep.append(s)
        _save(keep)
    return report


def start_background(CITIES, every_s=600):
    def loop():
        while True:
            time.sleep(every_s)
            try:
                check_all(CITIES)
            except Exception:
                pass
    threading.Thread(target=loop, daemon=True, name="push-check").start()


def make_router(CITIES, nearest_station):
    r = APIRouter(prefix="/api/push", tags=["push"])

    @r.get("/key")
    def key():
        return {"publicKey": vapid_public()}

    @r.post("/subscribe")
    def subscribe(b: SubIn):
        ep = (b.subscription or {}).get("endpoint", "")
        if not _host_ok(ep) or not (b.subscription.get("keys") or {}).get("p256dh"):
            raise HTTPException(400, "not a valid browser push subscription")
        if b.level not in LEVELS:
            raise HTTPException(400, f"level must be one of {sorted(LEVELS)}")
        c = CITIES.get(b.city.lower())
        if not c:
            raise HTTPException(404, "unknown city")
        st = nearest_station(c, b.lat, b.lon)
        with LOCK:
            subs = [s for s in _load() if s["subscription"].get("endpoint") != ep]
            if len(subs) >= MAX_SUBS:
                raise HTTPException(503, "subscription list is full")
            sub = {"subscription": b.subscription, "city": b.city.lower(), "station": st, "level": b.level, "created": int(time.time()), "last_key": None}
            subs.append(sub); _save(subs)
        e = episode(c, st, b.level)
        return {"ok": True, "station": st, "level": LEVELS[b.level], "next_window": e}

    @r.post("/unsubscribe")
    def unsubscribe(b: EndpointIn):
        with LOCK:
            subs = _load(); n = len(subs)
            subs = [s for s in subs if s["subscription"].get("endpoint") != b.endpoint]; _save(subs)
        return {"ok": True, "removed": n - len(subs)}

    @r.post("/test")
    def test(b: EndpointIn):
        s = next((x for x in _load() if x["subscription"].get("endpoint") == b.endpoint), None)
        if not s:
            raise HTTPException(404, "subscribe first")
        ok, code = send(s, {"title": "AeroSage test alert", "body": f"Alerts are on for {s['station']} ({LEVELS[s['level']]} or worse). This is a test.", "url": "/#map", "tag": "test"})
        return {"ok": ok, "status": code}

    @r.post("/check")
    def check():
        return check_all(CITIES)

    return r
