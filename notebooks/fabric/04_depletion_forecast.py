# CELL
# 📉 Prognoza wyczerpania zapasów — ile dni zapasu zostało per województwo i zasób

# CELL
import pandas as pd

stock = spark.table("fact_stock").toPandas()
warehouses = spark.table("dim_warehouse").toPandas()[["warehouse_id", "voivodeship_code"]]
consumption = spark.table("fact_consumption").toPandas()
resources = spark.table("dim_resource_type").toPandas()[["resource_type_id", "resource_name", "unit"]]

# CELL
stock_v = (
    stock.merge(warehouses, on="warehouse_id")
    .groupby(["voivodeship_code", "resource_type_id"]).available_qty.sum().reset_index()
)

# Tempo zuzycia liczymy z trzech ostatnich dob, bo poczatek sceny jest jeszcze spokojny
# i srednia z calego okresu zanizalaby zapotrzebowanie w szczycie.
consumption["day"] = pd.to_datetime(consumption.timestamp).dt.date
rate = (
    consumption.groupby(["voivodeship_code", "resource_type_id", "day"]).consumed_qty.sum()
    .groupby(level=[0, 1]).tail(3)
    .groupby(level=[0, 1]).mean()
    .reset_index(name="daily_consumption")
)

forecast = stock_v.merge(rate, on=["voivodeship_code", "resource_type_id"], how="left") \
    .fillna({"daily_consumption": 0})
forecast["days_of_stock"] = forecast.apply(
    lambda r: 999.0 if r.daily_consumption == 0 else round(r.available_qty / r.daily_consumption, 1),
    axis=1,
)
forecast["recommendation"] = forecast.days_of_stock.apply(
    lambda d: "uruchomic_rezerwy_strategiczne_lub_umowe_ramowa" if d < 2
    else ("monitorowac_i_przygotowac_ARS" if d < 5 else "OK")
)
forecast["alert_level"] = forecast.days_of_stock.apply(
    lambda d: 3 if d < 2 else (2 if d < 5 else 1)
)
forecast = forecast.merge(resources, on="resource_type_id", how="left")

spark.createDataFrame(forecast).write.mode("overwrite").option("overwriteSchema", "true") \
    .format("delta").saveAsTable("depletion_forecast")

# CELL
krytyczne = forecast[forecast.days_of_stock < 2]
print(f"Kombinacje ponizej 2 dni zapasu: {len(krytyczne)}")
print(forecast.sort_values("days_of_stock").head(10).to_string(index=False))
