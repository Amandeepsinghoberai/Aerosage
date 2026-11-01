"""Shape / sanity tests for every endpoint.  Run:  python -m pytest -q tests"""
import sys, time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.main import app  # noqa: E402

c = TestClient(app)
CITIES = ["delhi", "patiala"]


def test_health_and_cities():
    h = c.get("/api/health").json()
    assert h["status"] == "ok" and set(h["cities"]) >= set(CITIES) and "IST" in h["forecast_issued_at"]
    cs = {x["key"]: x for x in c.get("/api/cities").json()}
    assert cs["delhi"]["stations"] == 39 and cs["patiala"]["has_ground_stations"] is False


@pytest.mark.parametrize("city", CITIES)
def test_meta(city):
    m = c.get(f"/api/{city}/meta").json()
    assert len(m["times"]) == 360 and m["times"][0] == "2026-11-01T00" and m["times"][-1] == "2026-11-15T23"
    assert set(m["importance"]) == set(m["cause_names"]) and 99 < sum(m["importance"].values()) < 101
    assert m["backtest"]["metrics"]


def test_map_delhi():
    t0 = time.time()
    m = c.get("/api/delhi/map?hour=2026-11-08T21").json()
    assert 600 <= len(m["cells"]) <= 1200 and len(m["stations"]) == 39 and m["neighbourhood_detail"] is True
    assert all(len(r) == 6 and r[3] in (0, 1, 2) and r[4] <= r[2] <= r[5] for r in m["cells"])
    assert {"aqi", "category", "p10", "p90"} <= set(m["stations"][0]) and m["cache"]["state"] == "cached"
    assert time.time() - t0 < 1.0


def test_map_patiala():
    m = c.get("/api/patiala/map?hour=2026-11-08T21").json()
    assert 50 <= len(m["cells"]) <= 120 and len(m["stations"]) == 1 and m["neighbourhood_detail"] is False


@pytest.mark.parametrize("city,st", [("delhi", "Anand Vihar"), ("patiala", "Patiala (city estimate)")])
def test_forecast_explain(city, st):
    f = c.get(f"/api/{city}/forecast", params={"station": st}).json()
    assert len(f["p50"]) == 360 and all(a <= b <= d for a, b, d in zip(f["p10"], f["p50"], f["p90"]))
    e = c.get(f"/api/{city}/explain", params={"station": st, "hour": "2026-11-08T22"}).json()
    assert len(e["causes"]) == 5 and e["note"] and e["causes"][0]["ug_m3"] >= e["causes"][-1]["ug_m3"]


def test_simulate_monotone():
    base = c.get("/api/delhi/simulate?hour=2026-11-08T22").json()
    cut = c.get("/api/delhi/simulate?hour=2026-11-08T22&crackers=1&traffic=0.3&fires=0.5").json()
    assert base["before_city"]["pm25"] == base["after_city"]["pm25"]
    assert cut["after_city"]["pm25"] < cut["before_city"]["pm25"]
    half = c.get("/api/delhi/simulate?hour=2026-11-08T22&crackers=0.5").json()["after_city"]["pm25"]
    full = c.get("/api/delhi/simulate?hour=2026-11-08T22&crackers=1").json()["after_city"]["pm25"]
    assert full <= half <= base["before_city"]["pm25"]
    s = cut["stations"]; assert [r["before"]["pm25"] for r in s] == sorted([r["before"]["pm25"] for r in s], reverse=True)


@pytest.mark.parametrize("city", CITIES)
def test_diwali(city):
    d = c.get(f"/api/{city}/diwali").json()
    assert set(d["forecast_2026"]) == {str(o) for o in range(-7, 8)} and d["backtest"]["metrics"] and "issued_at" in d


def test_delhi_proof_and_shortterm():
    d = c.get("/api/delhi/diwali").json()
    assert "AirWard model" in d["backtest"]["metrics"] and set(d["short_term"]) == {"1h", "3h", "6h", "24h"} and len(d["past"]) == 9
    r = c.get("/api/delhi/replay", params={"station": "Anand Vihar", "hour": "2025-10-20T21"}).json()
    assert set(r["horizons"]) == {"1h", "3h", "6h", "24h"}


def test_nowcast_and_rank_nearest():
    body = {"station": "Anand Vihar", "now": "2026-11-08T18", "readings": [180 + i for i in range(30)]}
    r = c.post("/api/delhi/nowcast", json=body).json()
    assert set(r["horizons"]) == {"1h", "3h", "6h", "24h"} and r["horizons"]["1h"]["pm25"] > 0
    assert len(c.get("/api/delhi/rank?hour=2026-11-08T22&top=5").json()["ranking"]) == 5
    assert c.get("/api/delhi/nearest?lat=28.65&lon=77.2").json()["station"]


def test_errors():
    assert c.get("/api/nowhere/meta").status_code == 404
    assert c.get("/api/delhi/map?hour=2030-01-01T00").status_code == 404
    assert c.get("/api/delhi/forecast?station=Nope").status_code == 404
    assert "detail" in c.get("/api/delhi/explain?station=Nope&hour=2026-11-08T22").json()


def test_map_all_speed():
    t0 = time.time()
    m = c.get("/api/delhi/map/all").json()
    assert len(m["pm25_p50"]) == 360 and len(m["pm25_p50"][0]) == len(m["cells"])


def test_scorecard():
    r = c.get("/api/delhi/scorecard").json()
    assert len(r["rows"]) == 5 and all(x["actual_city_avg_pm25"] is None for x in r["rows"])
    s = c.post("/api/delhi/scorecard", json={"actuals": {"2026-11-08": 270, "2026-11-09": 300}}).json()
    assert s["summary"]["days_scored"] == 2 and s["rows"][1]["actual_city_avg_pm25"] == 270
    assert c.post("/api/delhi/scorecard", json={"actuals": {"2026-12-25": 1}}).status_code == 422


def test_reload_guarded(monkeypatch):
    monkeypatch.delenv("AIRWARD_ADMIN_TOKEN", raising=False)
    assert c.post("/api/reload").status_code == 403
    monkeypatch.setenv("AIRWARD_ADMIN_TOKEN", "t0k")
    assert c.post("/api/reload", headers={"x-admin-token": "wrong"}).status_code == 401
    assert c.post("/api/reload", headers={"x-admin-token": "t0k"}).json()["reloaded"]
    assert c.get("/api/delhi/map?hour=2026-11-08T21").status_code == 200
