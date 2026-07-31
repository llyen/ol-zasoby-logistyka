"""Generator danych syntetycznych dla demo Zasoby i Rezerwy — Logistyka Kryzysowa.
Seed=42, UTF-8, daty ISO-8601 +02:00. Dane nie są operacyjne.
"""
from __future__ import annotations

import csv, json, math, random
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np

SEED = 42
random.seed(SEED)
rng = np.random.default_rng(SEED)
BASE = Path(__file__).parent / "datasets"
DERIVED = BASE / "derived"
TZ = timezone(timedelta(hours=2))
D0 = datetime(2026, 9, 15, 8, 0, tzinfo=TZ)

VOIVODESHIPS = [
    ("02","dolnoslaskie",51.11,17.03),("04","kujawsko-pomorskie",53.12,18.01),
    ("06","lubelskie",51.25,22.57),("08","lubuskie",52.74,15.24),
    ("10","lodzkie",51.77,19.46),("12","malopolskie",50.06,19.94),
    ("14","mazowieckie",52.23,21.01),("16","opolskie",50.67,17.92),
    ("18","podkarpackie",50.04,22.00),("20","podlaskie",53.13,23.16),
    ("22","pomorskie",54.35,18.65),("24","slaskie",50.26,19.02),
    ("26","swietokrzyskie",50.87,20.63),("28","warminsko-mazurskie",53.78,20.49),
    ("30","wielkopolskie",52.41,16.93),("32","zachodniopomorskie",53.43,14.55),
]
POW_COUNTS = {"02":30,"04":23,"06":24,"08":14,"10":24,"12":22,"14":42,"16":12,"18":25,"20":17,"22":20,"24":36,"26":14,"28":21,"30":35,"32":21}
RESOURCE_TYPES = [
    ("R01","agregaty_pradotworcze","kW","energia",850,3.0,1,2.0),
    ("R02","pompy_wysokiej_wydajnosci","szt","powodz",620,2.2,1,1.5),
    ("R03","lozka_polowe","szt","schronienie",18,0.12,0,0.1),
    ("R04","koce","szt","schronienie",2,0.02,0,0.0),
    ("R05","woda_butelkowana","palety","zywnosc",720,1.8,0,0.1),
    ("R06","racje_zywnosciowe","kartony","zywnosc",25,0.08,0,0.0),
    ("R07","namioty_pneumatyczne","szt","schronienie",420,3.5,1,1.0),
    ("R08","nagrzewnice","szt","energia",90,0.45,1,0.3),
    ("R09","worki_przeciwpowodziowe","tys_szt","powodz",950,1.6,0,0.0),
    ("R10","osuszacze","szt","odbudowa",55,0.25,0,0.1),
    ("R11","generatory_medyczne","szt","zdrowie",450,1.8,1,1.0),
    ("R12","karetki","szt","zdrowie",3500,12.0,1,0.2),
    ("R13","smiglowce","szt","transport",5000,30.0,1,0.5),
    ("R14","amfibie","szt","transport",9000,28.0,1,0.7),
    ("R15","mosty_pontonowe","moduly","transport",2200,8.0,1,4.0),
    ("R16","paliwo","l","paliwo",0.84,0.001,0,0.0),
    ("R17","leki_opatrunki","pakiety","zdrowie",6,0.03,0,0.0),
    ("R18","agregaty_uzdatniania_wody","szt","woda",780,2.4,1,1.5),
    ("R19","radiotelefony","szt","lacznosc",1.2,0.01,0,0.0),
    ("R20","terminale_satelitarne","szt","lacznosc",12,0.05,1,0.2),
]
AFFECTED_NAMES = ["Klodzko","Bystrzyca Klodzka","Ladek-Zdroj","Stronie Slaskie","Nysa","Opole","Wroclaw","Lewin Brzeski","Brzeg","Olawa","Bardo","Glucholazy","Paczkow","Krapkowice","Kedzierzyn-Kozle"]


def write_csv(path, rows, fieldnames):
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames); w.writeheader(); w.writerows(rows)

def write_jsonl(path, rows):
    with path.open("w", encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")

def haversine(a,b,c,d):
    R=6371; p1=math.radians(a); p2=math.radians(c); dp=math.radians(c-a); dl=math.radians(d-b)
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

def main():
    BASE.mkdir(parents=True, exist_ok=True); DERIVED.mkdir(exist_ok=True)
    voivs=[{"voivodeship_code":c,"voivodeship_name":n,"lat":lat,"lon":lon} for c,n,lat,lon in VOIVODESHIPS]
    powiats=[]; gminas=[]; gid=0
    for vc,vn,vlat,vlon in VOIVODESHIPS:
        for i in range(POW_COUNTS[vc]):
            pcode=f"{vc}{i+1:02d}"; lat=vlat+rng.normal(0,0.42); lon=vlon+rng.normal(0,0.55)
            if vc=="02" and i<6:
                pname=["klodzki","wroclawski","olawski","zabkowicki","dzierzoniowski","legnicki"][i]
            elif vc=="16" and i<5:
                pname=["nyski","opolski","brzeski","krapkowicki","kedzierzynsko-kozielski"][i]
            else: pname=f"powiat_{vn}_{i+1:02d}"
            powiats.append({"powiat_code":pcode,"powiat_name":pname,"voivodeship_code":vc,"lat":round(lat,5),"lon":round(lon,5)})
            # proportional gmina count; corrected later
            gc=max(3, int(round(2477/380 + rng.normal(0,1.1))))
            for j in range(gc):
                gid += 1
                if gid <= len(AFFECTED_NAMES): gname=AFFECTED_NAMES[gid-1]
                else: gname=f"gmina_{vn}_{i+1:02d}_{j+1:02d}"
                pop=int(rng.integers(1800,68000)); glat=lat+rng.normal(0,0.13); glon=lon+rng.normal(0,0.16)
                gminas.append({"gmina_code":f"{pcode}{j+1:03d}","gmina_name":gname,"powiat_code":pcode,"voivodeship_code":vc,"population":pop,"lat":round(glat,5),"lon":round(glon,5)})
    # force exactly 2477 gminas
    while len(gminas)<2477:
        p=random.choice(powiats); idx=sum(1 for g in gminas if g["powiat_code"]==p["powiat_code"])+1
        gminas.append({"gmina_code":f"{p['powiat_code']}{idx:03d}","gmina_name":f"gmina_extra_{len(gminas)+1}","powiat_code":p["powiat_code"],"voivodeship_code":p["voivodeship_code"],"population":int(rng.integers(2000,50000)),"lat":round(p["lat"]+rng.normal(0,0.12),5),"lon":round(p["lon"]+rng.normal(0,0.12),5)})
    gminas=gminas[:2477]

    res=[{"resource_type_id":r[0],"resource_name":r[1],"unit":r[2],"category":r[3],"weight_kg":r[4],"volume_m3":r[5],"requires_operator":r[6],"setup_time_h":r[7]} for r in RESOURCE_TYPES]
    wh=[]; owners=["ARS","magazyn_wojewodzki_OC","skladnica_PSP","magazyn_WOT"]
    for i in range(60):
        vc,vn,vlat,vlon = VOIVODESHIPS[i%16]
        if i<10: vc,vn,vlat,vlon = random.choice([VOIVODESHIPS[0],VOIVODESHIPS[7],VOIVODESHIPS[11],VOIVODESHIPS[3]])
        wh.append({"warehouse_id":f"WH{i+1:03d}","warehouse_name":f"{owners[i%4]}_{vn}_{i+1:02d}","owner_type":owners[i%4],"voivodeship_code":vc,"lat":round(vlat+rng.normal(0,0.28),5),"lon":round(vlon+rng.normal(0,0.35),5),"area_m2":int(rng.integers(800,12000)),"has_ramp":int(rng.random()>0.12),"available_24_7":int(rng.random()>0.18)})
    shelters=[]
    for i in range(400):
        g=random.choice(gminas[:250] if i<170 else gminas)
        shelters.append({"shelter_id":f"SH{i+1:04d}","shelter_name":f"punkt_przyjecia_{i+1:04d}","shelter_type":random.choice(["szkola","hala","osrodek","internat"]),"gmina_code":g["gmina_code"],"capacity":int(rng.integers(60,650)),"has_kitchen":int(rng.random()>0.35),"has_medical_room":int(rng.random()>0.55),"accessible_disabled":int(rng.random()>0.3),"lat":round(g["lat"]+rng.normal(0,0.02),5),"lon":round(g["lon"]+rng.normal(0,0.02),5)})
    tu=[]
    for i in range(180):
        typ=random.choice(["ciezarowka_12t","ciezarowka_24t","bus","naczepa_niskopodwoziowa","smiglowiec","amfibia"])
        cap={"ciezarowka_12t":12,"ciezarowka_24t":24,"bus":2,"naczepa_niskopodwoziowa":40,"smiglowiec":3,"amfibia":8}[typ]
        sp={"ciezarowka_12t":58,"ciezarowka_24t":52,"bus":70,"naczepa_niskopodwoziowa":45,"smiglowiec":160,"amfibia":25}[typ]
        base=random.choice(wh)
        tu.append({"transport_unit_id":f"TU{i+1:04d}","transport_type":typ,"payload_t":cap,"avg_speed_kmh":sp,"base_warehouse_id":base["warehouse_id"],"available_from":(D0+timedelta(hours=int(rng.integers(0,36)))).isoformat(),"available":int(rng.random()>0.12)})
    suppliers=[]
    for i in range(45):
        rt=random.choice(res); vc=random.choice(VOIVODESHIPS)[0]
        suppliers.append({"supplier_id":f"SUP{i+1:03d}","supplier_name":f"dostawca_ramowy_{i+1:03d}","category":rt["category"],"voivodeship_code":vc,"lead_time_h":int(rng.integers(12,96)),"contract_limit":int(rng.integers(5000,2500000))})

    stocks=[]
    critical={"02":0.55,"16":0.50,"24":0.85,"08":0.9,"30":1.05}
    for w in wh:
        factor=critical.get(w["voivodeship_code"],1.0)
        for r in res:
            base=int(rng.integers(20,350))
            if r["resource_type_id"] in ["R05","R06","R09","R16"]: base*=int(rng.integers(8,30))
            qty=max(0,int(base*factor))
            reserved=int(qty*rng.uniform(0.03,0.18)); transit=int(qty*rng.uniform(0,0.08))
            exp="" if r["resource_type_id"] not in ["R05","R06","R17"] else (D0+timedelta(days=int(rng.integers(30,540)))).date().isoformat()
            stocks.append({"warehouse_id":w["warehouse_id"],"resource_type_id":r["resource_type_id"],"available_qty":qty,"reserved_qty":reserved,"in_transit_qty":transit,"expiry_date":exp})

    affected=[g for g in gminas if g["voivodeship_code"] in ["02","16"]][:190] + [g for g in gminas if g["voivodeship_code"] in ["24","08"]][:40]
    demands=[]; reasons=["ewakuacja_ludnosci","brak_zasilania","zalane_ujecie_wody","przelane_waly","punkt_przyjecia"]
    for day in range(0,11):
        n=55+day*12 if day<6 else 130-day*5
        for k in range(n):
            g=random.choice(affected); rt=random.choice(["R01","R02","R03","R04","R05","R06","R09","R16","R17","R18","R19","R20"])
            mult=1+day/4 if g["voivodeship_code"] in ["02","16"] else 1+day/8
            qty=int(max(1,rng.integers(5,90)*mult));
            if rt in ["R05","R06","R09","R16"]: qty*=int(rng.integers(3,16))
            pr=1 if (day>=2 and rng.random()<0.28) else int(rng.choice([2,3,4], p=[0.45,0.4,0.15]))
            ts=D0+timedelta(days=day,hours=int(rng.integers(0,24)),minutes=int(rng.integers(0,60)))
            demands.append({"demand_id":f"DEM{len(demands)+1:05d}","timestamp":ts.isoformat(),"day_label":f"D+{day}","gmina_code":g["gmina_code"],"powiat_code":g["powiat_code"],"voivodeship_code":g["voivodeship_code"],"resource_type_id":rt,"quantity":qty,"priority":pr,"justification":random.choice(reasons),"reported_by":random.choice(["wojt","burmistrz","starosta","PCZK"])})
    road=[]
    for i in range(260):
        vc=random.choice(["02","16","24","08","30"] if i<150 else [v[0] for v in VOIVODESHIPS])
        status=random.choices(["przejezdna","utrudnienia","nieprzejezdna"], weights=[55,32,13] if vc in ["02","16"] else [82,15,3])[0]
        road.append({"road_segment_id":f"RD{i+1:04d}","voivodeship_code":vc,"road_name":random.choice(["DK8","A4","DK46","DW381","S8","DK94","DW401"]),"status":status,"reason":random.choice(["zalanie","osuwisko","korek_ewakuacyjny","uszkodzony_most","brak"]),"lat":round(dict((v[0],v[2]) for v in VOIVODESHIPS)[vc]+rng.normal(0,0.55),5),"lon":round(dict((v[0],v[3]) for v in VOIVODESHIPS)[vc]+rng.normal(0,0.55),5),"timestamp":(D0+timedelta(hours=int(rng.integers(0,240)))).isoformat()})
    alloc=[]; track=[]
    wh_by={w["warehouse_id"]:w for w in wh}; g_by={g["gmina_code"]:g for g in gminas}
    for d in demands[:520]:
        choices=[s for s in stocks if s["resource_type_id"]==d["resource_type_id"] and s["available_qty"]>0]
        if not choices: continue
        g=g_by[d["gmina_code"]]
        choices.sort(key=lambda s: haversine(wh_by[s["warehouse_id"]]["lat"],wh_by[s["warehouse_id"]]["lon"],g["lat"],g["lon"]))
        s=choices[min(len(choices)-1,int(rng.integers(0,4)))] ; w=wh_by[s["warehouse_id"]]
        qty=min(d["quantity"], max(1, int(s["available_qty"]*0.18)))
        dist=haversine(w["lat"],w["lon"],g["lat"],g["lon"]); eta_h=dist/45*(1.45 if g["voivodeship_code"] in ["02","16"] else 1.0)+rng.uniform(0.2,2.5)
        aid=f"ALC{len(alloc)+1:05d}"; tid=f"TR{len(alloc)+1:05d}"; start=datetime.fromisoformat(d["timestamp"])+timedelta(hours=rng.uniform(0.2,2.0)); eta=start+timedelta(hours=eta_h)
        status=random.choices(["planned","accepted","in_transit","delivered","delayed"], weights=[10,15,35,30,10])[0]
        alloc.append({"allocation_id":aid,"demand_id":d["demand_id"],"warehouse_id":w["warehouse_id"],"allocated_qty":qty,"transport_unit_id":tid,"eta":eta.isoformat(),"status":status,"decision_level":random.choice(["wojewoda","RCB","ARS","RZZK"])})
        steps=range(0, min(24*12, max(3,int(eta_h*12)+1)), 1)
        for step in steps:
            frac=min(1, step/max(1,len(list(steps))-1)); ts=start+timedelta(minutes=5*step)
            delay=max(0,int(rng.normal(18,22))) if status=="delayed" else max(0,int(rng.normal(3,6)))
            track.append({"transport_id":tid,"allocation_id":aid,"timestamp":ts.isoformat(),"lat":round(w["lat"]+(g["lat"]-w["lat"])*frac+rng.normal(0,0.005),5),"lon":round(w["lon"]+(g["lon"]-w["lon"])*frac+rng.normal(0,0.005),5),"speed_kmh":round(max(0,rng.normal(48,14)),1),"eta":(eta+timedelta(minutes=delay)).isoformat(),"status":"delivered" if frac>=1 else ("delayed" if delay>30 else "in_transit"),"delay_min":delay})
    occ=[]
    for sh in shelters:
        base=int(sh["capacity"]*rng.uniform(0.15,0.55)); affected_sh=sh["gmina_code"][:2] in ["02","16"]
        for day in range(0,11):
            wave=day*0.08 if affected_sh else day*0.02; occupied=min(sh["capacity"], int(base+sh["capacity"]*wave+rng.normal(0,18)))
            occ.append({"shelter_id":sh["shelter_id"],"timestamp":(D0+timedelta(days=day,hours=18)).isoformat(),"capacity":sh["capacity"],"occupied":max(0,occupied),"medical_care_required":max(0,int(occupied*rng.uniform(0.03,0.14)))})
    cons=[]
    for sh in random.sample(shelters,260):
        for day in range(0,11):
            for rt in ["R05","R06","R04","R17","R16"]:
                cons.append({"site_id":sh["shelter_id"],"timestamp":(D0+timedelta(days=day,hours=20)).isoformat(),"resource_type_id":rt,"consumed_qty":int(max(1,rng.integers(2,40)*(1+day/7))),"voivodeship_code":sh["gmina_code"][:2]})
    fin=[]
    for i in range(90):
        vc=random.choice(["02","16","24","08","30"]); amount=int(rng.integers(100000,8500000)); status=random.choice(["draft","submitted","wojewoda_approved","minister_review","RZZK_opinion","MF_approved","paid"])
        fin.append({"financial_request_id":f"FIN{i+1:04d}","timestamp":(D0+timedelta(hours=int(rng.integers(0,240)))).isoformat(),"applicant":random.choice(["wojewoda","starosta","minister_wiodacy"]),"voivodeship_code":vc,"amount_pln":amount,"purpose":random.choice(["zakup_paliwa","zakwaterowanie_ewakuowanych","transport_rezerw","zakup_wody_i_zywnosci","odtworzenie_sil_i_srodkow"]),"status":status,"approval_path":"wojewoda>minister_wiodacy>RZZK>MF"})

    write_csv(BASE/"dim_voivodeship.csv", voivs, list(voivs[0].keys()))
    write_csv(BASE/"dim_powiat.csv", powiats, list(powiats[0].keys()))
    write_csv(BASE/"dim_gmina.csv", gminas, list(gminas[0].keys()))
    write_csv(BASE/"dim_resource_type.csv", res, list(res[0].keys()))
    write_csv(BASE/"dim_warehouse.csv", wh, list(wh[0].keys()))
    write_csv(BASE/"dim_shelter.csv", shelters, list(shelters[0].keys()))
    write_csv(BASE/"dim_transport_unit.csv", tu, list(tu[0].keys()))
    write_csv(BASE/"dim_supplier.csv", suppliers, list(suppliers[0].keys()))
    write_csv(BASE/"fact_stock.csv", stocks, list(stocks[0].keys()))
    write_csv(BASE/"fact_financial_request.csv", fin, list(fin[0].keys()))
    write_jsonl(BASE/"fact_demand.jsonl", demands); write_jsonl(BASE/"fact_allocation.jsonl", alloc); write_jsonl(BASE/"fact_transport_tracking.jsonl", track)
    write_jsonl(BASE/"fact_shelter_occupancy.jsonl", occ); write_jsonl(BASE/"fact_consumption.jsonl", cons); write_jsonl(BASE/"fact_road_status.jsonl", road)
    counts={p.name: sum(1 for _ in p.open(encoding="utf-8"))-(1 if p.suffix==".csv" else 0) for p in BASE.glob("*.csv")}
    counts.update({p.name: sum(1 for _ in p.open(encoding="utf-8")) for p in BASE.glob("*.jsonl")})
    with (BASE/"record_counts.json").open("w", encoding="utf-8") as f: json.dump(counts, f, ensure_ascii=False, indent=2)
    print(json.dumps(counts, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
