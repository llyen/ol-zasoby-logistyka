"""Buduje statyczna scene demo (public/data/scene.json) z datasets/ repozytorium ol-zasoby-logistyka.

Dlaczego z plikow, a nie z Eventhouse:
- Eventhouse przechowuje wylacznie okno ostatniego odtwarzania (simulate_realtime.py
  czysci tabele i pisze biezacym czasem), wiec nie zawiera pelnej sceny 12 dob.
- datasets/ to deterministyczne zrodlo, z ktorego zasilany jest Lakehouse i Eventstream,
  wiec liczby w aplikacji zgadzaja sie z dashboardem i notatnikami.

Aplikacja pokazuje proces decyzyjny (wniosek -> akceptacja -> przydzial -> transport
-> odbior -> finansowanie), a nie strumien. Scena jest powtarzalna, zeby demo dalo sie
prowadzic wielokrotnie z identycznym przebiegiem.

Uruchomienie:  python tools/build_scene.py
"""

from __future__ import annotations

import collections
import csv
import datetime
import json
import math
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]
DATA = ROOT / "datasets"
DERIVED = DATA / "derived"
OUT = APP / "public" / "data" / "scene.json"

DAYS = [(datetime.date(2026, 9, 15) + datetime.timedelta(days=i)).isoformat() for i in range(12)]
D0 = "2026-09-15"

# Prog, ponizej ktorego zapas uznajemy za krytyczny (doby).
CRITICAL_DAYS_OF_STOCK = 2.0
# Opoznienie transportu, ktore wymaga reakcji dyspozytora (minuty).
DELAY_ALERT_MIN = 30


def read_csv(name: str) -> list[dict]:
    with open(DATA / name, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_derived(name: str) -> list[dict]:
    with open(DERIVED / name, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def stream(name: str):
    with open(DATA / f"{name}.jsonl", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def r1(x: float) -> float:
    return round(x, 1)


def r2(x: float) -> float:
    return round(x, 2)


def r3(x: float) -> float:
    """Wspolrzedne: trzy miejsca to ok. 100 m. Dwa miejsca (ok. 1 km) potrafily
    przesunac punkt lezacy przy granicy na jej druga strone."""
    return round(x, 3)


def day_of(ts: str) -> str:
    return ts[:10]


# ---------------------------------------------------------------------------
# Korekta wspolrzednych
# ---------------------------------------------------------------------------
#
# `generate_datasets.py` rozrzuca gminy, magazyny i punkty przyjecia losowym
# odchyleniem wokol srodka wojewodztwa, bez sprawdzania granic. Dopoki mapa
# w aplikacji rysowala sama siatke, nie bylo tego widac. Po naniesieniu
# prawdziwych granic wojewodztw czesc punktow ladowala na Baltyku albo za
# wschodnia granica, a okolo jednej trzeciej gmin - w sasiednim wojewodztwie.
#
# Poprawiamy to **wylacznie w warstwie prezentacji**, przy budowie sceny.
# Zbiory zrodlowe i pliki `derived/` zostaja nietkniete, wiec wskazniki
# (4,27 -> 1,70 h), notatniki, Eventhouse i model semantyczny nadal zgadzaja
# sie co do liczby. Przesuniecia sa niewielkie - mediana ok. 24 km dla gmin
# i 9 km dla magazynow, przy czym dotycza gmin fikcyjnych, a nie tych 15
# nazwanych z prawdziwymi wspolrzednymi.

RINGS_FILE = Path(__file__).resolve().parent / "poland_rings.json"

# Ile drogi w strone srodka wielokata pokonuje punkt po przyciagnieciu na
# granice - bez tego siadalby dokladnie na kresce i mogl zniknac pod obrysem.
INWARD = 0.06


def _fold(text: str) -> str:
    """Nazwy wojewodztw w zbiorach sa bez znakow diakrytycznych, w granicach - z."""
    import unicodedata

    text = text.replace("\u0142", "l").replace("\u0141", "L")
    stripped = unicodedata.normalize("NFD", text)
    return "".join(c for c in stripped if unicodedata.category(c) != "Mn").lower()


def load_regions() -> dict[str, list[list[list[float]]]]:
    if not RINGS_FILE.exists():
        raise SystemExit(
            f"brak {RINGS_FILE.name} - uruchom najpierw: python tools/build_poland_geo.py"
        )
    with open(RINGS_FILE, encoding="utf-8") as f:
        return {_fold(k): v for k, v in json.load(f).items()}


def in_region(lon: float, lat: float, rings: list[list[list[float]]]) -> bool:
    """Test parzystosci przeciec promienia poziomego."""
    inside = False
    for ring in rings:
        n = len(ring)
        for i in range(n):
            x1, y1 = ring[i]
            x2, y2 = ring[(i + 1) % n]
            if (y1 > lat) != (y2 > lat):
                if lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
                    inside = not inside
    return inside


def _km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Przyblizenie plaskie - dla odleglosci w skali wojewodztwa wystarcza."""
    return math.hypot((lon2 - lon1) * 68.5, (lat2 - lat1) * 111.2)


def snap_into(lon: float, lat: float, rings: list[list[list[float]]]) -> tuple[float, float]:
    """Najblizszy wierzcholek granicy, przesuniety w strone srodka wielokata.

    Przy wklesnych ksztaltach - a takie sa Lubuskie czy Pomorskie - pojedyncze
    zanurzenie potrafi nie wystarczyc, wiec zwiekszamy je, az punkt faktycznie
    znajdzie sie w srodku. Wynik jest od razu zaokraglany do trzech miejsc,
    bo dokladnie taka wartosc trafi do sceny; sprawdzanie na pelnej precyzji
    przepuszczaloby punkty, ktore po zaokragleniu ladowaly tuz za granica.
    """
    best_vertex = None
    best_centroid = (lon, lat)
    best_d = float("inf")
    for ring in rings:
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        for x, y in ring:
            d = _km(lon, lat, x, y)
            if d < best_d:
                best_d = d
                best_vertex = (x, y)
                best_centroid = (cx, cy)
    if best_vertex is None:
        return lon, lat

    vx, vy = best_vertex
    cx, cy = best_centroid
    for inward in (INWARD, 0.12, 0.25, 0.5):
        nx = round(vx + (cx - vx) * inward, 3)
        ny = round(vy + (cy - vy) * inward, 3)
        if in_region(nx, ny, rings):
            return nx, ny
    return round(cx, 3), round(cy, 3)


def correct_coordinates(
    gminas: dict[str, dict],
    warehouses: dict[str, dict],
    shelters: dict[str, dict],
    voivs: dict[str, dict],
) -> dict[str, tuple[float, float]]:
    """Przesuwa punkty do wlasnych wojewodztw. Zwraca mape przesuniec gmin,
    zeby punkty przyjecia i trasy transportow poszly za swoja gmina."""
    regions = load_regions()
    voiv_name = {code: _fold(row["voivodeship_name"]) for code, row in voivs.items()}
    shifts: dict[str, tuple[float, float]] = {}
    moved = {"gminy": 0, "magazyny": 0, "punkty przyjecia": 0}

    def fix(row: dict, voiv_code: str) -> tuple[float, float] | None:
        rings = regions.get(voiv_name.get(voiv_code, ""))
        if not rings:
            return None
        # Sprawdzamy wartosc juz zaokraglona, bo taka trafi na mape. Roznica
        # miedzy pelna precyzja a trzema miejscami to ok. 100 m - przy punkcie
        # lezacym na samej granicy to decyduje o tym, po ktorej stronie wypadnie.
        lon, lat = round(float(row["lon"]), 3), round(float(row["lat"]), 3)
        if in_region(lon, lat, rings):
            row["lon"], row["lat"] = f"{lon:.3f}", f"{lat:.3f}"
            return None
        new_lon, new_lat = snap_into(lon, lat, rings)
        row["lon"], row["lat"] = f"{new_lon:.3f}", f"{new_lat:.3f}"
        return new_lon - lon, new_lat - lat

    for code, row in gminas.items():
        shift = fix(row, row["voivodeship_code"])
        if shift:
            shifts[code] = shift
            moved["gminy"] += 1

    for row in warehouses.values():
        if fix(row, row["voivodeship_code"]):
            moved["magazyny"] += 1

    # Punkt przyjecia nie ma wlasnego wojewodztwa - jest opisany gmina, wiec
    # przesuwamy go dokladnie o tyle, o ile przesunela sie jego gmina. Dzieki
    # temu zachowuje polozenie wzgledem niej. Jesli mimo to wypadnie poza kraj
    # (nadmorskie gminy plus wlasne odchylenie), przyciagamy go do gminy.
    any_rings = list(regions.values())
    for row in shelters.values():
        gmina_code = row.get("gmina_code", "")
        shift = shifts.get(gmina_code)
        lon, lat = round(float(row["lon"]), 3), round(float(row["lat"]), 3)
        if shift:
            lon = round(lon + shift[0], 3)
            lat = round(lat + shift[1], 3)
            moved["punkty przyjecia"] += 1
        if not any(in_region(lon, lat, r) for r in any_rings):
            parent = gminas.get(gmina_code)
            if parent:
                lon, lat = round(float(parent["lon"]), 3), round(float(parent["lat"]), 3)
                moved["punkty przyjecia"] += 0 if shift else 1
        row["lon"], row["lat"] = f"{lon:.3f}", f"{lat:.3f}"

    summary = ", ".join(f"{k} {v}" for k, v in moved.items())
    print(f"korekta wspolrzednych: {summary}")
    return shifts


def main() -> None:
    gminas = {r["gmina_code"]: r for r in read_csv("dim_gmina.csv")}
    powiats = {r["powiat_code"]: r for r in read_csv("dim_powiat.csv")}
    voivs = {r["voivodeship_code"]: r for r in read_csv("dim_voivodeship.csv")}
    restypes = {r["resource_type_id"]: r for r in read_csv("dim_resource_type.csv")}
    warehouses = {r["warehouse_id"]: r for r in read_csv("dim_warehouse.csv")}
    shelters = {r["shelter_id"]: r for r in read_csv("dim_shelter.csv")}
    suppliers = read_csv("dim_supplier.csv")
    units = {r["transport_unit_id"]: r for r in read_csv("dim_transport_unit.csv")}
    stock = read_csv("fact_stock.csv")
    finance = read_csv("fact_financial_request.csv")

    correct_coordinates(gminas, warehouses, shelters, voivs)

    # --- wnioski -------------------------------------------------------------
    demands: dict[str, dict] = {}
    for e in stream("fact_demand"):
        demands[e["demand_id"]] = e

    # --- przydzialy ----------------------------------------------------------
    allocs: dict[str, dict] = {}
    alloc_by_demand: dict[str, str] = {}
    for e in stream("fact_allocation"):
        allocs[e["allocation_id"]] = e
        alloc_by_demand[e["demand_id"]] = e["allocation_id"]

    # --- transporty: trasa uproszczona do max 6 punktow ----------------------
    track: dict[str, list[dict]] = collections.defaultdict(list)
    for e in stream("fact_transport_tracking"):
        track[e["transport_id"]].append(e)

    transports: list[dict] = []
    for tid, pts in track.items():
        pts.sort(key=lambda p: p["timestamp"])
        last = pts[-1]
        step = max(1, len(pts) // 6)
        sample = pts[::step][:6]
        if sample[-1] is not last:
            sample.append(last)
        aid = last["allocation_id"]
        a = allocs.get(aid, {})
        d = demands.get(a.get("demand_id", ""), {})

        # Trasa w zbiorze zrodlowym jest interpolacja miedzy magazynem a gmina.
        # Skoro obie koncowki mogly zostac przesuniete przy korekcie granic,
        # odtwarzamy przebieg z poprawionych koncowek, zachowujac postep
        # kazdego odczytu. Inaczej linia rozjechalaby sie ze znacznikami.
        wh_row = warehouses.get(a.get("warehouse_id", ""))
        g_row = gminas.get(d.get("gmina_code", ""))
        origin = (float(pts[0]["lat"]), float(pts[0]["lon"]))
        target = (float(last["lat"]), float(last["lon"]))
        span = math.dist(origin, target)
        if wh_row and g_row and span > 1e-9:
            w_lat, w_lon = float(wh_row["lat"]), float(wh_row["lon"])
            g_lat, g_lon = float(g_row["lat"]), float(g_row["lon"])
            path = []
            for p in sample:
                frac = min(1.0, math.dist((float(p["lat"]), float(p["lon"])), origin) / span)
                path.append([r3(w_lat + (g_lat - w_lat) * frac), r3(w_lon + (g_lon - w_lon) * frac)])
            here_lat, here_lon = path[-1][0], path[-1][1]
        else:
            path = [[r3(p["lat"]), r3(p["lon"])] for p in sample]
            here_lat, here_lon = r3(last["lat"]), r3(last["lon"])
        transports.append(
            {
                "id": tid,
                "alloc": aid,
                "demand": a.get("demand_id"),
                "wh": a.get("warehouse_id"),
                "gmina": d.get("gmina_code"),
                "res": d.get("resource_type_id"),
                "qty": a.get("allocated_qty", 0),
                "prio": d.get("priority", 4),
                "status": last["status"],
                "delay": last["delay_min"],
                "maxDelay": max(p["delay_min"] for p in pts),
                "start": pts[0]["timestamp"],
                "end": last["timestamp"],
                "eta": last["eta"],
                "path": path,
                "lat": here_lat,
                "lon": here_lon,
            }
        )
    transports.sort(key=lambda t: t["start"])
    tr_by_day: dict[str, list[dict]] = collections.defaultdict(list)
    for t in transports:
        for day in DAYS:
            if day_of(t["start"]) <= day <= day_of(t["end"]):
                tr_by_day[day].append(t)

    # --- drogi ---------------------------------------------------------------
    roads_day: dict[str, dict[str, dict]] = collections.defaultdict(dict)
    for e in stream("fact_road_status"):
        roads_day[day_of(e["timestamp"])][e["road_segment_id"]] = {
            "id": e["road_segment_id"],
            "v": e["voivodeship_code"],
            "name": e["road_name"],
            "status": e["status"],
            "reason": e["reason"],
            "lat": r3(e["lat"]),
            "lon": r3(e["lon"]),
        }

    # --- miejsca zakwaterowania ---------------------------------------------
    shel_day: dict[str, dict[str, dict]] = collections.defaultdict(dict)
    for e in stream("fact_shelter_occupancy"):
        d = day_of(e["timestamp"])
        cur = shel_day[d].get(e["shelter_id"])
        if cur is None or e["occupied"] > cur["occ"]:
            shel_day[d][e["shelter_id"]] = {
                "occ": e["occupied"],
                "cap": e["capacity"],
                "med": e["medical_care_required"],
            }

    # --- zuzycie -------------------------------------------------------------
    cons_day: dict[tuple[str, str, str], int] = collections.Counter()
    for e in stream("fact_consumption"):
        cons_day[(day_of(e["timestamp"]), e["voivodeship_code"], e["resource_type_id"])] += e["consumed_qty"]

    # --- stany magazynowe wg wojewodztwa i zasobu ----------------------------
    stock_vr: dict[tuple[str, str], dict] = collections.defaultdict(lambda: {"avail": 0, "res": 0, "transit": 0})
    for s in stock:
        wh = warehouses.get(s["warehouse_id"])
        if not wh:
            continue
        k = (wh["voivodeship_code"], s["resource_type_id"])
        stock_vr[k]["avail"] += int(s["available_qty"])
        stock_vr[k]["res"] += int(s["reserved_qty"])
        stock_vr[k]["transit"] += int(s["in_transit_qty"])

    # --- plany przydzialu: FIFO vs optimizer ---------------------------------
    # Wniosek moze miec kilka wierszy przydzialu (dostawa dzielona miedzy magazyny),
    # dlatego najpierw agregujemy po demand_id: ilosc sumujemy, czas dojazdu
    # usredniamy. Ta sama metoda co w notatniku 03, inaczej KPI sceny rozjezdza sie
    # z allocation_summary.json. Magazyn reprezentatywny = ten z najwieksza porcja.
    def group_plan(rows: list[dict]) -> dict[str, dict]:
        acc: dict[str, dict] = {}
        for r in rows:
            did = r["demand_id"]
            qty = int(r["allocated_qty"])
            h = float(r["travel_time_h"])
            cur = acc.get(did)
            if cur is None:
                acc[did] = {
                    "row": r,
                    "qty": qty,
                    "hours": [h],
                    "topWh": r["warehouse_id"],
                    "topQty": qty,
                }
                continue
            cur["qty"] += qty
            cur["hours"].append(h)
            if qty > cur["topQty"]:
                cur["topWh"] = r["warehouse_id"]
                cur["topQty"] = qty
        for v in acc.values():
            v["avgH"] = round(sum(v["hours"]) / len(v["hours"]), 2)
            v["parts"] = len(v["hours"])
        return acc

    plan_fifo = group_plan(read_derived("allocation_plan_fifo.csv"))
    plan_opt = group_plan(read_derived("allocation_plan_optimized.csv"))
    plans: list[dict] = []
    for did, o in plan_opt.items():
        f = plan_fifo.get(did)
        d = demands.get(did, {})
        plans.append(
            {
                "demand": did,
                "prio": int(o["row"]["priority"]),
                "res": o["row"]["resource_type_id"],
                "gmina": d.get("gmina_code"),
                "v": d.get("voivodeship_code"),
                "qty": o["qty"],
                "parts": o["parts"],
                "optWh": o["topWh"],
                "optH": o["avgH"],
                "fifoWh": f["topWh"] if f else None,
                "fifoH": f["avgH"] if f else None,
                "day": day_of(d.get("timestamp", D0)),
            }
        )
    plans.sort(key=lambda p: (p["prio"], -((p["fifoH"] or 0) - p["optH"])))

    # --- pokrycie ------------------------------------------------------------
    coverage = [
        {
            "gmina": r["gmina_code"],
            "name": r["gmina_name"],
            "v": r["voivodeship_code"],
            "wh": r["nearest_warehouse_id"],
            "h": float(r["access_time_h"]),
            "h2": float(r["second_access_time_h"]),
            "gap": r["coverage_gap"] == "True",
        }
        for r in read_derived("coverage_analysis.csv")
    ]

    whatif = read_derived("whatif_scenarios.csv")

    # --- scena dobowa --------------------------------------------------------
    country: list[dict] = []
    voiv_daily: list[dict] = []
    depletion: list[dict] = []

    cum_cons: dict[tuple[str, str], int] = collections.Counter()

    for day in DAYS:
        day_demands = [d for d in demands.values() if day_of(d["timestamp"]) <= day]
        new_demands = [d for d in demands.values() if day_of(d["timestamp"]) == day]
        served = [d for d in day_demands if d["demand_id"] in alloc_by_demand]
        open_d = [d for d in day_demands if d["demand_id"] not in alloc_by_demand]
        p1_open = [d for d in open_d if d["priority"] == 1]

        trs = tr_by_day.get(day, [])
        in_transit = [t for t in trs if t["status"] == "in_transit"]
        delayed = [t for t in trs if t["maxDelay"] >= DELAY_ALERT_MIN]
        delivered = [t for t in transports if day_of(t["end"]) <= day and t["status"] == "delivered"]

        sh = shel_day.get(day, {})
        cap = sum(s["cap"] for s in sh.values())
        occ = sum(s["occ"] for s in sh.values())
        full = sum(1 for s in sh.values() if s["cap"] and s["occ"] / s["cap"] >= 0.9)
        med = sum(s["med"] for s in sh.values())

        rd = roads_day.get(day, {})
        blocked = sum(1 for r in rd.values() if r["status"] == "nieprzejezdna")
        hindered = sum(1 for r in rd.values() if r["status"] == "utrudnienia")

        # zapas: stan poczatkowy minus skumulowane zuzycie, tempo z ostatniej doby
        crit = 0
        for (v, rid), s in stock_vr.items():
            today = cons_day.get((day, v, rid), 0)
            if today:
                cum_cons[(v, rid)] += today
            left = max(0, s["avail"] - cum_cons[(v, rid)])
            dos = 999.0 if today == 0 else r1(left / today)
            if today and dos < CRITICAL_DAYS_OF_STOCK:
                crit += 1
            if today:
                depletion.append(
                    {
                        "d": day,
                        "v": v,
                        "res": rid,
                        "left": left,
                        "rate": today,
                        "dos": dos,
                    }
                )

        country.append(
            {
                "d": day,
                "demands": len(day_demands),
                "newDemands": len(new_demands),
                "open": len(open_d),
                "p1Open": len(p1_open),
                "served": len(served),
                "inTransit": len(in_transit),
                "delayed": len(delayed),
                "delivered": len(delivered),
                "shelterCap": cap,
                "shelterOcc": occ,
                "sheltersFull": full,
                "medical": med,
                "roadsBlocked": blocked,
                "roadsHindered": hindered,
                "criticalStock": crit,
            }
        )

        byv: dict[str, dict] = collections.defaultdict(
            lambda: {"demands": 0, "open": 0, "p1Open": 0, "qty": 0, "delayed": 0, "crit": 0}
        )
        for d in day_demands:
            v = d["voivodeship_code"]
            byv[v]["demands"] += 1
            byv[v]["qty"] += d["quantity"]
            if d["demand_id"] not in alloc_by_demand:
                byv[v]["open"] += 1
                if d["priority"] == 1:
                    byv[v]["p1Open"] += 1
        for t in trs:
            g = gminas.get(t["gmina"] or "")
            if g and t["maxDelay"] >= DELAY_ALERT_MIN:
                byv[g["voivodeship_code"]]["delayed"] += 1
        for (v, rid), s in stock_vr.items():
            today = cons_day.get((day, v, rid), 0)
            if today:
                left = max(0, s["avail"] - cum_cons[(v, rid)])
                if left / today < CRITICAL_DAYS_OF_STOCK:
                    byv[v]["crit"] += 1
        for v, m in byv.items():
            voiv_daily.append({"d": day, "v": v, **m})

    # --- podsumowanie planow -------------------------------------------------
    # Uczciwe porownanie tylko na wnioskach obecnych w obu planach: zbiory roznia sie
    # (optimizer obsluguje inny zestaw niz FIFO), wiec srednie po calych plikach
    # porownywalyby jablka z gruszkami.
    pairs = [p for p in plans if p["fifoH"] is not None]
    opt_h = [p["optH"] for p in pairs]
    fifo_h = [p["fifoH"] for p in pairs]
    p1 = [p for p in pairs if p["prio"] == 1]
    only_opt = [p for p in plans if p["fifoH"] is None]
    plan_kpi = {
        "count": len(plans),
        "comparable": len(pairs),
        "onlyOptimizer": len(only_opt),
        "optAvgH": r2(sum(opt_h) / len(opt_h)) if opt_h else 0,
        "fifoAvgH": r2(sum(fifo_h) / len(fifo_h)) if fifo_h else 0,
        "savedH": r2((sum(fifo_h) / len(fifo_h)) - (sum(opt_h) / len(opt_h))) if opt_h else 0,
        "p1Count": len(p1),
        "p1OptAvgH": r2(sum(p["optH"] for p in p1) / len(p1)) if p1 else 0,
        "p1FifoAvgH": r2(sum(p["fifoH"] for p in p1) / len(p1)) if p1 else 0,
        "improved": sum(1 for p in pairs if p["optH"] < p["fifoH"]),
        "worse": sum(1 for p in pairs if p["optH"] > p["fifoH"]),
        "totalSavedH": r1(sum(p["fifoH"] - p["optH"] for p in pairs)),
    }

    scene = {
        "meta": {
            "days": DAYS,
            "d0": D0,
            "generated": datetime.datetime.now().isoformat(timespec="seconds"),
            "criticalDaysOfStock": CRITICAL_DAYS_OF_STOCK,
            "delayAlertMin": DELAY_ALERT_MIN,
            "decisionLevels": ["gmina", "powiat", "wojewoda", "minister wiodący", "RZZK"],
        },
        "voivodeships": [
            {"v": k, "name": r["voivodeship_name"]} for k, r in sorted(voivs.items())
        ],
        "resourceTypes": [
            {
                "id": k,
                "name": r["resource_name"].replace("_", " "),
                "unit": r["unit"],
                "cat": r["category"],
                "setupH": float(r["setup_time_h"]),
                "operator": r["requires_operator"] == "1",
            }
            for k, r in sorted(restypes.items())
        ],
        "warehouses": [
            {
                "id": k,
                "name": r["warehouse_name"].replace("_", " "),
                "owner": r["owner_type"],
                "v": r["voivodeship_code"],
                "lat": r3(float(r["lat"])),
                "lon": r3(float(r["lon"])),
                "ramp": r["has_ramp"] == "1",
                "h24": r["available_24_7"] == "1",
            }
            for k, r in sorted(warehouses.items())
        ],
        "gminas": [
            {
                "g": k,
                "name": r["gmina_name"],
                "p": r["powiat_code"],
                "v": r["voivodeship_code"],
                "pop": int(r["population"]),
                "lat": r3(float(r["lat"])),
                "lon": r3(float(r["lon"])),
            }
            for k, r in gminas.items()
            if k in {d["gmina_code"] for d in demands.values()} or k in {c["gmina"] for c in coverage}
        ],
        "powiats": [{"p": k, "name": r["powiat_name"], "v": r["voivodeship_code"]} for k, r in powiats.items()],
        "demands": [
            {
                "id": d["demand_id"],
                "d": day_of(d["timestamp"]),
                "ts": d["timestamp"][11:16],
                "g": d["gmina_code"],
                "v": d["voivodeship_code"],
                "res": d["resource_type_id"],
                "qty": d["quantity"],
                "prio": d["priority"],
                "why": d["justification"],
                "by": d["reported_by"],
                "alloc": alloc_by_demand.get(d["demand_id"]),
            }
            for d in sorted(demands.values(), key=lambda x: x["timestamp"])
        ],
        "allocations": [
            {
                "id": a["allocation_id"],
                "demand": a["demand_id"],
                "wh": a["warehouse_id"],
                "qty": a["allocated_qty"],
                "unit": a["transport_unit_id"],
                "eta": a["eta"][:16],
                "status": a["status"],
                "level": a["decision_level"],
            }
            for a in allocs.values()
        ],
        "transports": transports,
        "plans": plans,
        "planKpi": plan_kpi,
        "coverage": coverage,
        "depletion": depletion,
        "country": country,
        "voivDaily": voiv_daily,
        "roads": {d: list(v.values()) for d, v in roads_day.items()},
        "shelters": [
            {
                "id": k,
                "name": r["shelter_name"].replace("_", " "),
                "g": r["gmina_code"],
                "type": r["shelter_type"],
                "cap": int(r["capacity"]),
                "med": r["has_medical_room"] == "1",
                "acc": r["accessible_disabled"] == "1",
                "lat": r3(float(r["lat"])),
                "lon": r3(float(r["lon"])),
            }
            for k, r in shelters.items()
        ],
        "shelterDaily": [
            {"d": d, "id": sid, "occ": s["occ"], "cap": s["cap"], "med": s["med"]}
            for d, m in shel_day.items()
            for sid, s in m.items()
        ],
        "suppliers": [
            {
                "id": r["supplier_id"],
                "name": r["supplier_name"].replace("_", " "),
                "cat": r["category"],
                "v": r["voivodeship_code"],
                "leadH": int(r["lead_time_h"]),
                "limit": int(r["contract_limit"]),
            }
            for r in suppliers
        ],
        "transportUnits": [
            {
                "id": k,
                "type": r["transport_type"],
                "payload": float(r["payload_t"]),
                "speed": float(r["avg_speed_kmh"]),
                "base": r["base_warehouse_id"],
            }
            for k, r in units.items()
        ],
        "finance": [
            {
                "id": r["financial_request_id"],
                "d": day_of(r["timestamp"]),
                "by": r["applicant"],
                "v": r["voivodeship_code"],
                "amount": int(r["amount_pln"]),
                "purpose": r["purpose"].replace("_", " "),
                "status": r["status"],
                "path": r["approval_path"].split(">"),
            }
            for r in finance
        ],
        "whatif": [
            {"name": r["scenario"].replace("_", " "), "effect": r["expected_effect"], "fix": r["mitigation"]}
            for r in whatif
        ],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(scene, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    size = OUT.stat().st_size / 1024
    peak = max(country, key=lambda c: c["open"])
    print(f"scene.json: {size:.1f} KB")
    print(f"wnioski: {len(scene['demands'])}, przydzialy: {len(scene['allocations'])}, transporty: {len(transports)}")
    print(f"gminy w scenie: {len(scene['gminas'])}, pokrycie: {len(coverage)}")
    print(f"szczyt otwartych wnioskow: {peak['d']} = {peak['open']} (P1: {peak['p1Open']})")
    print(f"plan: FIFO {plan_kpi['fifoAvgH']} h -> optimizer {plan_kpi['optAvgH']} h "
          f"(oszczednosc {plan_kpi['savedH']} h/dostawe, lacznie {plan_kpi['totalSavedH']} h "
          f"na {plan_kpi['comparable']} porownywalnych, {plan_kpi['improved']} szybszych, "
          f"{plan_kpi['worse']} wolniejszych)")
    print(f"wiersze zapasu ponizej progu: {sum(1 for r in depletion if r['dos'] < CRITICAL_DAYS_OF_STOCK)}")
    print(f"transporty opoznione >= {DELAY_ALERT_MIN} min: {sum(1 for t in transports if t['maxDelay'] >= DELAY_ALERT_MIN)}")


if __name__ == "__main__":
    main()
