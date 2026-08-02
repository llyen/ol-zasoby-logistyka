# CELL
# 📥 Ładowanie strumieni logistycznych (JSONL) do Lakehouse Delta

# CELL
from pyspark.sql import functions as F
from pyspark.sql import types as T

base = "Files/streams"
streams = [
    "fact_demand",
    "fact_allocation",
    "fact_transport_tracking",
    "fact_shelter_occupancy",
    "fact_road_status",
    "fact_consumption",
]

# Te same powody co przy wymiarach: bez jawnego rzutowania Direct Lake dostaje tekst
# i miary liczbowe albo mapy przestaja dzialac.
numeric_columns = {
    "lat": T.DoubleType(),
    "lon": T.DoubleType(),
    "speed_kmh": T.DoubleType(),
    "delay_min": T.IntegerType(),
    "capacity": T.IntegerType(),
    "occupied": T.IntegerType(),
    "medical_care_required": T.IntegerType(),
    "quantity": T.IntegerType(),
    "priority": T.IntegerType(),
    "allocated_qty": T.IntegerType(),
    "consumed_qty": T.IntegerType(),
}
timestamp_columns = ["timestamp", "eta"]

# CELL
for name in streams:
    df = spark.read.json(f"{base}/{name}.jsonl")
    for column, dtype in numeric_columns.items():
        if column in df.columns:
            df = df.withColumn(column, F.col(column).cast(dtype))
    for column in timestamp_columns:
        if column in df.columns:
            df = df.withColumn(column, F.to_timestamp(column))
    df = df.withColumn("ingested_at", F.current_timestamp())
    df.write.mode("overwrite").option("overwriteSchema", "true").format("delta").saveAsTable(name)
    print(name, df.count(), len(df.columns))

# CELL
# Kontrola zakresu czasu sceny - dashboard i raport zakladaja os D-0 ... D+10.
zakres = spark.sql("""
    SELECT min(timestamp) AS od, max(timestamp) AS do_, count(*) AS rekordy
    FROM fact_demand
""").collect()[0]
print("fact_demand:", zakres["od"], "->", zakres["do_"], f"({zakres['rekordy']} rekordow)")
assert spark.table("fact_transport_tracking").count() > 0
print("Strumienie zaladowane.")
