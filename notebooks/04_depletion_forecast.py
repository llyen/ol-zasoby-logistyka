# CELL
from pathlib import Path
import json
import pandas as pd
BASE=Path(__file__).resolve().parents[1]/"datasets"; OUT=BASE/"derived"; OUT.mkdir(exist_ok=True)
stock=pd.read_csv(BASE/"fact_stock.csv"); wh=pd.read_csv(BASE/"dim_warehouse.csv")[["warehouse_id","voivodeship_code"]]
cons=pd.read_json(BASE/"fact_consumption.jsonl", lines=True)
# CELL
stock_v=stock.merge(wh,on="warehouse_id").groupby(["voivodeship_code","resource_type_id"]).available_qty.sum().reset_index()
cons["day"]=pd.to_datetime(cons.timestamp).dt.date
rate=cons.groupby(["voivodeship_code","resource_type_id","day"]).consumed_qty.sum().groupby(level=[0,1]).tail(3).groupby(level=[0,1]).mean().reset_index(name="daily_consumption")
forecast=stock_v.merge(rate,on=["voivodeship_code","resource_type_id"],how="left").fillna({"daily_consumption":0})
forecast["days_of_stock"]=forecast.apply(lambda r: 999 if r.daily_consumption==0 else round(r.available_qty/r.daily_consumption,1), axis=1)
forecast["recommendation"]=forecast.days_of_stock.apply(lambda d: "uruchomic_rezerwy_strategiczne_lub_umowe_ramowa" if d<2 else ("monitorowac_i_przygotowac_ARS" if d<5 else "OK"))
forecast.to_csv(OUT/"depletion_forecast.csv", index=False)
print(forecast.sort_values("days_of_stock").head(10).to_string(index=False))
