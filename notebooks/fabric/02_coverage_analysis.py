# CELL
# 🗺️ Analiza pokrycia — czas dojazdu z najbliższych magazynów do gmin z zapotrzebowaniem

# CELL
import math
import pandas as pd
from pyspark.sql import functions as F

# Dane sa male (2477 gmin, 60 magazynow), wiec liczymy na driverze w pandas.
# Spark posluzylby tu tylko do rozproszenia iloczynu kartezjanskiego bez realnego zysku.
gminas = spark.table("dim_gmina").toPandas()
warehouses = spark.table("dim_warehouse").toPandas()
roads = spark.table("fact_road_status").toPandas()
demands = spark.table("fact_demand").toPandas()

# CELL
def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

# Przejezdnosc drog podnosi czas dojazdu: utrudnienia +35%, odcinek nieprzejezdny +90%.
road_factor = (
    roads.groupby("voivodeship_code").status.apply(
        lambda s: 1 + (s.eq("utrudnienia").mean() * 0.35) + (s.eq("nieprzejezdna").mean() * 0.9)
    ).to_dict()
)

affected = gminas[gminas.gmina_code.isin(demands.gmina_code.unique())].copy()
print("Gminy z zapotrzebowaniem:", len(affected))

# CELL
rows = []
for _, g in affected.iterrows():
    candidates = []
    for _, w in warehouses.iterrows():
        km = haversine(g.lat, g.lon, w.lat, w.lon)
        factor = max(
            road_factor.get(str(g.voivodeship_code).zfill(2), 1.0),
            road_factor.get(str(w.voivodeship_code).zfill(2), 1.0),
        )
        candidates.append((km / 52 * factor + 0.45, km, w.warehouse_id, w.warehouse_name))
    candidates = sorted(candidates)[:3]
    rows.append({
        "gmina_code": g.gmina_code,
        "gmina_name": g.gmina_name,
        "voivodeship_code": str(g.voivodeship_code).zfill(2),
        "lat": float(g.lat),
        "lon": float(g.lon),
        "nearest_warehouse_id": candidates[0][2],
        "nearest_warehouse_name": candidates[0][3],
        "distance_km": round(candidates[0][1], 1),
        "access_time_h": round(candidates[0][0], 2),
        "second_access_time_h": round(candidates[1][0], 2),
        "third_access_time_h": round(candidates[2][0], 2),
        "coverage_gap": bool(candidates[0][0] > 6.0),
    })

coverage = pd.DataFrame(rows)
spark.createDataFrame(coverage).write.mode("overwrite").option("overwriteSchema", "true") \
    .format("delta").saveAsTable("coverage_analysis")

# CELL
summary = pd.DataFrame([{
    "affected_gminas": int(len(coverage)),
    "avg_access_time_h": round(float(coverage.access_time_h.mean()), 2),
    "p90_access_time_h": round(float(coverage.access_time_h.quantile(0.9)), 2),
    "max_access_time_h": round(float(coverage.access_time_h.max()), 2),
    "coverage_gaps_gt_6h": int(coverage.coverage_gap.sum()),
}])
spark.createDataFrame(summary).write.mode("overwrite").option("overwriteSchema", "true") \
    .format("delta").saveAsTable("coverage_summary")
print(summary.to_string(index=False))
