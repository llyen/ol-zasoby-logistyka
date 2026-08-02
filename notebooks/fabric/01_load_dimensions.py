# CELL
# 📥 Ładowanie wymiarów i rejestrów logistycznych do Lakehouse Delta

# CELL
from pyspark.sql import functions as F
from pyspark.sql import types as T

base = "Files/datasets"
tables = [
    "dim_voivodeship",
    "dim_powiat",
    "dim_gmina",
    "dim_warehouse",
    "dim_resource_type",
    "dim_shelter",
    "dim_transport_unit",
    "dim_supplier",
    "fact_stock",
    "fact_financial_request",
]

# Typy narzucamy jawnie. Czytanie CSV bez schematu daje same kolumny tekstowe,
# a wtedy Direct Lake widzi lat/lon jako tekst i wizualizacja mapy odmawia dzialania
# ("Something's wrong with one or more fields"). inferSchema bywa niestabilny miedzy
# uruchomieniami, dlatego rzutujemy znane kolumny liczbowe wprost.
numeric_columns = {
    "lat": T.DoubleType(),
    "lon": T.DoubleType(),
    "population": T.LongType(),
    "capacity": T.IntegerType(),
    "area_m2": T.DoubleType(),
    "weight_kg": T.DoubleType(),
    "volume_m3": T.DoubleType(),
    "setup_time_h": T.DoubleType(),
    "requires_operator": T.IntegerType(),
    "has_ramp": T.IntegerType(),
    "available_24_7": T.IntegerType(),
    "has_kitchen": T.IntegerType(),
    "has_medical_room": T.IntegerType(),
    "accessible_disabled": T.IntegerType(),
    "payload_t": T.DoubleType(),
    "avg_speed_kmh": T.DoubleType(),
    "available": T.IntegerType(),
    "lead_time_h": T.DoubleType(),
    "contract_limit": T.LongType(),
    "available_qty": T.IntegerType(),
    "reserved_qty": T.IntegerType(),
    "in_transit_qty": T.IntegerType(),
    "amount_pln": T.LongType(),
}

# CELL
for name in tables:
    df = spark.read.option("header", True).option("encoding", "UTF-8").csv(f"{base}/{name}.csv")
    for column, dtype in numeric_columns.items():
        if column in df.columns:
            df = df.withColumn(column, F.col(column).cast(dtype))
    if "timestamp" in df.columns:
        df = df.withColumn("timestamp", F.to_timestamp("timestamp"))
    if "available_from" in df.columns:
        df = df.withColumn("available_from", F.to_timestamp("available_from"))
    df = df.withColumn("ingested_at", F.current_timestamp())
    df.write.mode("overwrite").option("overwriteSchema", "true").format("delta").saveAsTable(name)
    typy = {c: t for c, t in df.dtypes if c in numeric_columns}
    print(name, df.count(), typy)

# CELL
assert spark.table("dim_voivodeship").count() == 16
assert spark.table("dim_resource_type").count() == 20
assert spark.table("dim_warehouse").count() == 60
print("Wymiary zaladowane i zwalidowane.")
