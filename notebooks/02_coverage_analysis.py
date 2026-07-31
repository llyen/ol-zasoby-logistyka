# CELL
from pathlib import Path
import json, math
import pandas as pd
BASE = Path(__file__).resolve().parents[1] / "datasets"
OUT = BASE / "derived"; OUT.mkdir(exist_ok=True)
# CELL
def haversine(lat1, lon1, lat2, lon2):
    R=6371; p1=math.radians(lat1); p2=math.radians(lat2); dp=math.radians(lat2-lat1); dl=math.radians(lon2-lon1)
    a=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

gminas=pd.read_csv(BASE/"dim_gmina.csv"); wh=pd.read_csv(BASE/"dim_warehouse.csv"); roads=pd.read_json(BASE/"fact_road_status.jsonl", lines=True)
demands=pd.read_json(BASE/"fact_demand.jsonl", lines=True)
affected=gminas[gminas.gmina_code.isin(demands.gmina_code.unique())].copy()
road_factor=roads.groupby("voivodeship_code").status.apply(lambda s: 1 + (s.eq("utrudnienia").mean()*0.35) + (s.eq("nieprzejezdna").mean()*0.9)).to_dict()
# CELL
rows=[]
for _,g in affected.iterrows():
    candidates=[]
    for _,w in wh.iterrows():
        km=haversine(g.lat,g.lon,w.lat,w.lon)
        factor=max(road_factor.get(str(g.voivodeship_code).zfill(2),1.0), road_factor.get(str(w.voivodeship_code).zfill(2),1.0))
        hours=km/52*factor + 0.45
        candidates.append((hours, km, w.warehouse_id, w.warehouse_name))
    candidates=sorted(candidates)[:3]
    rows.append({"gmina_code":g.gmina_code,"gmina_name":g.gmina_name,"voivodeship_code":str(g.voivodeship_code).zfill(2),"nearest_warehouse_id":candidates[0][2],"nearest_warehouse_name":candidates[0][3],"access_time_h":round(candidates[0][0],2),"second_access_time_h":round(candidates[1][0],2),"third_access_time_h":round(candidates[2][0],2),"coverage_gap":candidates[0][0] > 6.0})
coverage=pd.DataFrame(rows)
coverage.to_csv(OUT/"coverage_analysis.csv", index=False)
summary={"affected_gminas": int(len(coverage)), "avg_access_time_h": round(float(coverage.access_time_h.mean()),2), "p90_access_time_h": round(float(coverage.access_time_h.quantile(.9)),2), "coverage_gaps_gt_6h": int(coverage.coverage_gap.sum())}
(OUT/"coverage_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(summary)
