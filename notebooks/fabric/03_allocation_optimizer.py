# CELL
# ⚖️ Optymalizacja przydziału zasobów — porównanie FIFO z planem optymalnym
# Notatnik liczy dwa plany dla tego samego zbioru zapotrzebowań i zapisuje metryki,
# które w raporcie stanowią główny argument decyzyjny („ile czasu zyskujemy”).

# CELL
import math
import pandas as pd
from scipy.optimize import linprog

gminas = spark.table("dim_gmina").toPandas().set_index("gmina_code")
warehouses = spark.table("dim_warehouse").toPandas().set_index("warehouse_id")
stock = spark.table("fact_stock").toPandas()
demand = spark.table("fact_demand").toPandas()
roads = spark.table("fact_road_status").toPandas()

road_factor = (
    roads.groupby("voivodeship_code").status.apply(
        lambda s: 1 + (s.eq("utrudnienia").mean() * 0.35) + (s.eq("nieprzejezdna").mean() * 0.9)
    ).to_dict()
)

# CELL
def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def travel_h(warehouse_id, gmina_code):
    w = warehouses.loc[warehouse_id]
    g = gminas.loc[gmina_code]
    dist = haversine(w.lat, w.lon, g.lat, g.lon)
    f = max(
        road_factor.get(str(w.voivodeship_code).zfill(2), 1.0),
        road_factor.get(str(g.voivodeship_code).zfill(2), 1.0),
    )
    return dist / 52 * f + 0.55

focus = demand[demand.priority.isin([1, 2])].sort_values("timestamp").head(420).copy()
capacity = {(r.warehouse_id, r.resource_type_id): int(r.available_qty) for r in stock.itertuples()}
print("Zapotrzebowania w probie:", len(focus))

# CELL
def allocate_optimized(df):
    """Program liniowy per typ zasobu: minimalizujemy czas dojazdu, premiujac priorytet."""
    rows = []
    for rid, grp in df.groupby("resource_type_id"):
        caps = {wid: qty for (wid, rr), qty in capacity.items() if rr == rid and qty > 0}
        if not caps:
            continue
        demands = list(grp.sort_values(["priority", "timestamp"]).itertuples())
        variables, costs = [], []
        for i, d in enumerate(demands):
            for wid in caps:
                h = travel_h(wid, d.gmina_code)
                priority_bonus = {1: 1000, 2: 700, 3: 350, 4: 100}.get(int(d.priority), 100)
                variables.append((i, wid, h, d))
                costs.append(h - priority_bonus)
        A, b = [], []
        for i, d in enumerate(demands):
            A.append([1.0 if di == i else 0.0 for di, _, _, _ in variables])
            b.append(float(d.quantity))
        for wid, cap in caps.items():
            A.append([1.0 if wj == wid else 0.0 for _, wj, _, _ in variables])
            b.append(float(cap))
        result = linprog(c=costs, A_ub=A, b_ub=b, bounds=(0, None), method="highs")
        if not result.success:
            raise RuntimeError(f"Optymalizacja nie powiodla sie dla {rid}: {result.message}")
        for value, (i, wid, h, d) in zip(result.x, variables):
            if value >= 0.5:
                rows.append({
                    "demand_id": d.demand_id, "priority": int(d.priority),
                    "resource_type_id": rid, "warehouse_id": wid,
                    "gmina_code": d.gmina_code, "voivodeship_code": d.voivodeship_code,
                    "allocated_qty": int(round(value)), "travel_time_h": round(h, 2),
                    "method": "optimized",
                })
    return pd.DataFrame(rows)

def allocate_fifo(df):
    """Odwzorowanie praktyki recznej: pierwszy zglosil, pierwszy dostaje z dowolnego magazynu."""
    caps = capacity.copy()
    rows = []
    for d in df.sort_values("timestamp").itertuples():
        candidates = [(wid, qty) for (wid, rid), qty in caps.items() if rid == d.resource_type_id and qty > 0]
        remaining = int(d.quantity)
        for wid, qty in candidates[:5]:
            if remaining <= 0:
                break
            h = travel_h(wid, d.gmina_code)
            alloc = min(remaining, qty)
            caps[(wid, d.resource_type_id)] -= alloc
            remaining -= alloc
            rows.append({
                "demand_id": d.demand_id, "priority": int(d.priority),
                "resource_type_id": d.resource_type_id, "warehouse_id": wid,
                "gmina_code": d.gmina_code, "voivodeship_code": d.voivodeship_code,
                "allocated_qty": alloc, "travel_time_h": round(h, 2),
                "method": "fifo",
            })
    return pd.DataFrame(rows)

# CELL
opt = allocate_optimized(focus)
fifo = allocate_fifo(focus)
plan = pd.concat([opt, fifo], ignore_index=True)
spark.createDataFrame(plan).write.mode("overwrite").option("overwriteSchema", "true") \
    .format("delta").saveAsTable("allocation_plan")
print("Pozycje planu:", len(opt), "optymalizacja /", len(fifo), "FIFO")

# CELL
def metrics(df, method):
    merged = focus[["demand_id", "quantity", "priority"]].merge(
        df.groupby("demand_id").agg(
            allocated_qty=("allocated_qty", "sum"),
            avg_time=("travel_time_h", "mean"),
        ).reset_index(),
        how="left",
    ).fillna({"allocated_qty": 0, "avg_time": 0})
    merged["satisfied"] = merged.allocated_qty >= merged.quantity
    p1 = merged[merged.priority == 1]
    return {
        "method": method,
        "served_demands": int(merged.satisfied.sum()),
        "served_pct": round(100 * float(merged.satisfied.mean()), 1),
        "priority1_served": int(p1.satisfied.sum()),
        "priority1_served_pct": round(100 * float(p1.satisfied.mean()), 1),
        "avg_delivery_time_h": round(float(merged[merged.allocated_qty > 0].avg_time.mean()), 2),
    }

summary = pd.DataFrame([metrics(opt, "optimized"), metrics(fifo, "fifo")])
saved = float(
    summary.loc[summary.method == "fifo", "avg_delivery_time_h"].iloc[0]
    - summary.loc[summary.method == "optimized", "avg_delivery_time_h"].iloc[0]
)
summary["time_saved_h"] = round(saved, 2)
spark.createDataFrame(summary).write.mode("overwrite").option("overwriteSchema", "true") \
    .format("delta").saveAsTable("allocation_metrics")
print(summary.to_string(index=False))
