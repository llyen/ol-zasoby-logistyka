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

g=pd.read_csv(BASE/"dim_gmina.csv").set_index("gmina_code")
w=pd.read_csv(BASE/"dim_warehouse.csv").set_index("warehouse_id")
stock=pd.read_csv(BASE/"fact_stock.csv")
demand=pd.read_json(BASE/"fact_demand.jsonl", lines=True)
roads=pd.read_json(BASE/"fact_road_status.jsonl", lines=True)
road_factor=roads.groupby("voivodeship_code").status.apply(lambda s: 1 + (s.eq("utrudnienia").mean()*0.35) + (s.eq("nieprzejezdna").mean()*0.9)).to_dict()
# CELL
focus=demand[demand.priority.isin([1,2])].head(420).copy()
# Aggregate capacity in mutable dict
capacity={(r.warehouse_id, r.resource_type_id): int(r.available_qty) for r in stock.itertuples()}

def travel_h(warehouse_id, gmina_code):
    ww=w.loc[warehouse_id]; gg=g.loc[gmina_code]
    dist=haversine(ww.lat, ww.lon, gg.lat, gg.lon)
    f=max(road_factor.get(str(ww.voivodeship_code).zfill(2),1.0), road_factor.get(str(gg.voivodeship_code).zfill(2),1.0))
    return dist/52*f + 0.55

def allocate_optimized(df):
    from scipy.optimize import linprog
    rows=[]
    for rid, grp in df.groupby("resource_type_id"):
        caps={wid: qty for (wid, rr), qty in capacity.items() if rr == rid and qty > 0}
        if not caps:
            continue
        demands=list(grp.sort_values(["priority","timestamp"]).itertuples())
        vars=[]; costs=[]
        for i,d in enumerate(demands):
            for wid, cap in caps.items():
                h=travel_h(wid, d.gmina_code)
                priority_bonus={1:1000,2:700,3:350,4:100}.get(int(d.priority),100)
                vars.append((i, wid, h, d))
                costs.append(h - priority_bonus)
        A=[]; b=[]
        # Demand upper bounds: do not allocate more than requested
        for i,d in enumerate(demands):
            row=[0.0]*len(vars)
            for j,(di,_,_,_) in enumerate(vars):
                if di==i: row[j]=1.0
            A.append(row); b.append(float(d.quantity))
        # Warehouse capacity bounds for the resource
        for wid, cap in caps.items():
            row=[0.0]*len(vars)
            for j,(_,wj,_,_) in enumerate(vars):
                if wj==wid: row[j]=1.0
            A.append(row); b.append(float(cap))
        result=linprog(c=costs, A_ub=A, b_ub=b, bounds=(0, None), method="highs")
        if not result.success:
            raise RuntimeError(f"Optimization failed for {rid}: {result.message}")
        for value,(i,wid,h,d) in zip(result.x, vars):
            if value >= 0.5:
                rows.append({"demand_id":d.demand_id,"priority":int(d.priority),"resource_type_id":rid,"warehouse_id":wid,"allocated_qty":int(round(value)),"travel_time_h":round(h,2),"method":"optimized"})
    return pd.DataFrame(rows)

def allocate_fifo(df):
    caps=capacity.copy(); rows=[]
    for d in df.sort_values("timestamp").itertuples():
        candidates=[(wid, qty) for (wid,rid),qty in caps.items() if rid==d.resource_type_id and qty>0]
        remaining=int(d.quantity)
        for wid,qty in candidates[:5]:
            if remaining<=0: break
            h=travel_h(wid, d.gmina_code); alloc=min(remaining, qty)
            caps[(wid,d.resource_type_id)]-=alloc; remaining-=alloc
            rows.append({"demand_id":d.demand_id,"priority":int(d.priority),"resource_type_id":d.resource_type_id,"warehouse_id":wid,"allocated_qty":alloc,"travel_time_h":round(h,2),"method":"fifo"})
    return pd.DataFrame(rows)
# CELL
opt=allocate_optimized(focus); fifo=allocate_fifo(focus)
plan=opt.copy(); plan.to_csv(OUT/"allocation_plan_optimized.csv", index=False)
fifo.to_csv(OUT/"allocation_plan_fifo.csv", index=False)
def metrics(df):
    merged=focus[["demand_id","quantity","priority"]].merge(df.groupby("demand_id").agg(allocated_qty=("allocated_qty","sum"), avg_time=("travel_time_h","mean")).reset_index(), how="left").fillna({"allocated_qty":0,"avg_time":0})
    merged["satisfied"] = merged.allocated_qty >= merged.quantity
    p1=merged[merged.priority==1]
    return {"served_demands": int(merged.satisfied.sum()), "served_pct": round(100*float(merged.satisfied.mean()),1), "priority1_served": int(p1.satisfied.sum()), "priority1_served_pct": round(100*float(p1.satisfied.mean()),1), "avg_delivery_time_h": round(float(merged[merged.allocated_qty>0].avg_time.mean()),2)}
summary={"optimized": metrics(opt), "fifo": metrics(fifo)}
summary["improvement"]={"avg_time_saved_h": round(summary["fifo"]["avg_delivery_time_h"]-summary["optimized"]["avg_delivery_time_h"],2), "priority1_extra_served": summary["optimized"]["priority1_served"]-summary["fifo"]["priority1_served"], "served_demands_extra": summary["optimized"]["served_demands"]-summary["fifo"]["served_demands"]}
(OUT/"allocation_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
