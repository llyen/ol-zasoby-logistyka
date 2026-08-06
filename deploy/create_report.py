"""Tworzy raport Power BI OL_LOG_Raport (PBIR) na modelu OL_LOG_SemanticModel.

Szesc stron prowadzi rozmowe od pytania "czym dysponujemy" do decyzji "co
wyslac, gdzie i z jakim finansowaniem" - uklad wynika z report/REPORT_SPEC.md.

Wszystkie miary tego modelu sa zadeklarowane w tabeli `coverage_summary`,
dlatego odwolania do nich uzywaja tej wlasnie encji niezaleznie od tego,
z ktorej tabely licza. Paleta jasna, rzadowa, za `_program/CONVENTIONS.md`.
"""
import argparse
import base64
import json
import subprocess
import time
from pathlib import Path

import requests

API = "https://api.fabric.microsoft.com/v1"
BASE = Path(__file__).resolve().parent.parent

_ap = argparse.ArgumentParser(description="Tworzy raport Power BI (PBIR) na modelu semantycznym.")
_ap.add_argument("--deployment", default=str(BASE / ".fabric" / "deployment.json"))
_ap.add_argument("--dataset")
_ap.add_argument("--name", default="OL_LOG_Raport")
ARGS = _ap.parse_args()

CFG = json.load(open(ARGS.deployment, encoding="utf-8"))
WS = CFG["workspaceId"]
DATASET = ARGS.dataset or CFG["semanticModelId"]
NAME = ARGS.name
SCH = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition"

W, H = 1280, 720
PAGE_BG, CARD_BG, BORDER = "#f5f7fa", "#ffffff", "#d8dee6"
INK, MUTED = "#1b1b1b", "#5b6674"
GOV, GOV_DARK, GOV_50 = "#0052a5", "#00417f", "#e8eef7"
RED, GREEN, AMBER, ORANGE = "#d5233f", "#15803d", "#a16207", "#c2410c"

# Wszystkie miary modelu mieszkaja w tej tabeli.
MEA = "coverage_summary"
WOJ, GMI = "dim_voivodeship", "dim_gmina"
MAG, ZAS = "dim_warehouse", "dim_resource_type"
STAN, ZAP = "fact_stock", "fact_demand"
PRZ, PLAN = "fact_allocation", "allocation_plan"
POKR, PROG = "coverage_analysis", "depletion_forecast"
SCHR, OBL = "dim_shelter", "fact_shelter_occupancy"
FIN, TRA = "fact_financial_request", "fact_transport_tracking"
DROGI, MET = "fact_road_status", "allocation_metrics"


def measure(table, name):
    return {"Measure": {"Expression": {"SourceRef": {"Entity": table}}, "Property": name}}


def column(table, name):
    return {"Column": {"Expression": {"SourceRef": {"Entity": table}}, "Property": name}}


def proj(field, table, name):
    return {"field": field, "queryRef": f"{table}.{name}", "nativeQueryRef": name}


def m(name, table=MEA):
    return proj(measure(table, name), table, name)


def c(table, name):
    return proj(column(table, name), table, name)


_seq = [0]


def visual(vtype, x, y, w, h, states, title=None, sort=None):
    _seq[0] += 1
    vid = f"v{_seq[0]:03d}"
    objects = {"title": [{"properties": {
        "text": {"expr": {"Literal": {"Value": f"'{title}'"}}},
        "fontColor": {"solid": {"color": {"expr": {"Literal": {"Value": f"'{INK}'"}}}}},
        "fontSize": {"expr": {"Literal": {"Value": "12D"}}},
        "show": {"expr": {"Literal": {"Value": "true"}}},
    }}]} if title else {}
    v = {
        "$schema": f"{SCH}/visualContainer/1.4.0/schema.json",
        "name": vid,
        "position": {"x": x, "y": y, "z": _seq[0], "width": w, "height": h, "tabOrder": _seq[0]},
        "visual": {
            "visualType": vtype,
            "query": {"queryState": {k: {"projections": p} for k, p in states.items()}},
            "objects": objects,
            "drillFilterOtherVisuals": True,
        },
    }
    if sort:
        v["visual"]["query"]["sortDefinition"] = {"sort": sort}
    return v


def textbox(x, y, w, h, paragraphs):
    _seq[0] += 1
    vid = f"v{_seq[0]:03d}"
    return {
        "$schema": f"{SCH}/visualContainer/1.4.0/schema.json",
        "name": vid,
        "position": {"x": x, "y": y, "z": _seq[0], "width": w, "height": h, "tabOrder": _seq[0]},
        "visual": {"visualType": "textbox", "objects": {"general": [{"properties": {
            "paragraphs": [{"textRuns": [{"value": t, "textStyle": {
                "fontSize": f"{s}pt", "color": col, "fontWeight": "bold" if b else "normal"}}]}
                for t, s, col, b in paragraphs]}}]}},
    }


def sort_m(name, direction="Descending", table=MEA):
    return [{"field": measure(table, name), "direction": direction}]


def sort_c(table, name, direction="Ascending"):
    return [{"field": column(table, name), "direction": direction}]


def naglowek(tytul, podtytul):
    return textbox(16, 12, 1248, 46, [(tytul, 18, INK, True),
                                      ("   " + podtytul, 11, MUTED, False)])


def stopka(jak_czytac):
    return textbox(16, 676, 1248, 34, [
        ("Jak czytac: " + jak_czytac, 10, MUTED, False),
        ("   Dane syntetyczne demo.", 10, MUTED, False)])


PAGES = []


def page(name, display, visuals):
    PAGES.append((name, display, visuals))


# --- 1. Obraz zasobow kraju ---------------------------------------------------
page("s1", "1 | Czym dysponujemy", [
    naglowek("Obraz zasobow kraju", "co mamy, gdzie to lezy i czego zaczyna brakowac"),
    visual("card", 16, 66, 240, 96, {"Values": [m("Zapas Dostepny")]}, "Zapas dostepny"),
    visual("card", 268, 66, 240, 96, {"Values": [m("Zapas Zarezerwowany")]}, "Zarezerwowany"),
    visual("card", 520, 66, 240, 96, {"Values": [m("Zapas w Drodze")]}, "W drodze"),
    visual("card", 772, 66, 240, 96, {"Values": [m("Krytyczne Braki Zapasu")]},
           "Krytyczne braki"),
    visual("card", 1024, 66, 240, 96, {"Values": [m("SPO-2 Wnioskowane PLN")]},
           "Wnioski SPO-2 (PLN)"),
    visual("map", 16, 174, 500, 300,
           {"Category": [c(WOJ, "voivodeship_name")], "Size": [m("Zapas Dostepny")]},
           "Zapas dostepny wg wojewodztwa"),
    visual("barChart", 528, 174, 484, 300,
           {"Category": [c(ZAS, "category")], "Y": [m("Zapas Dostepny")]},
           "Zapas wg kategorii", sort=sort_m("Zapas Dostepny")),
    visual("slicer", 1024, 174, 240, 148, {"Values": [c(ZAS, "category")]}, "Kategoria"),
    visual("slicer", 1024, 330, 240, 144, {"Values": [c(MAG, "owner_type")]}, "Wlasciciel magazynu"),
    visual("tableEx", 16, 486, 1248, 182,
           {"Values": [c(MAG, "warehouse_id"), c(MAG, "warehouse_name"), c(MAG, "owner_type"),
                       c(WOJ, "voivodeship_name"), m("Zapas Dostepny"), m("Zapas Zarezerwowany")]},
           "Magazyny wg dostepnego zapasu", sort=sort_m("Zapas Dostepny")),
    stopka("zapas zarezerwowany jest juz przypisany do zapotrzebowan - realna "
           "swoboda decyzyjna to kolumna zapasu dostepnego."),
])

# --- 2. Mapa czasow dostepu ---------------------------------------------------
page("s2", "2 | Jak szybko dowieziemy", [
    naglowek("Mapa czasow dostepu", "ile godzin dzieli gmine od najblizszego magazynu"),
    visual("card", 16, 66, 240, 96, {"Values": [m("Sredni Czas Dojazdu h")]},
           "Sredni czas dojazdu (h)"),
    visual("card", 268, 66, 240, 96, {"Values": [m("P90 Czas Dojazdu h")]}, "P90 czasu (h)"),
    visual("card", 520, 66, 240, 96, {"Values": [m("Luki Pokrycia Ponad 6h")]},
           "Gminy powyzej 6 h"),
    visual("card", 772, 66, 240, 96, {"Values": [m("Gminy z Zapotrzebowaniem")]},
           "Gminy z zapotrzebowaniem"),
    visual("card", 1024, 66, 240, 96, {"Values": [m("Ludnosc Objeta Zapotrzebowaniem")]},
           "Ludnosc objeta"),
    visual("map", 16, 174, 736, 300,
           {"Category": [c(POKR, "gmina_name")], "Size": [m("Sredni Czas Dojazdu h")]},
           "Czas dostepu wg gminy"),
    visual("columnChart", 764, 174, 500, 300,
           {"Category": [c(WOJ, "voivodeship_name")], "Y": [m("P90 Czas Dojazdu h")]},
           "P90 czasu dojazdu wg wojewodztwa", sort=sort_m("P90 Czas Dojazdu h")),
    visual("tableEx", 16, 486, 1248, 182,
           {"Values": [c(POKR, "gmina_name"), c(POKR, "nearest_warehouse_name"),
                       c(POKR, "distance_km"), c(POKR, "access_time_h"),
                       c(POKR, "second_access_time_h"), c(POKR, "coverage_gap")]},
           "Gminy o najdluzszym dostepie", sort=sort_c(POKR, "access_time_h", "Descending")),
    stopka("drugi czas dostepu pokazuje, co sie stanie, gdy najblizszy magazyn "
           "okaze sie odciety albo pusty."),
])

# --- 3. Zapotrzebowania i realizacja ------------------------------------------
page("s3", "3 | Co wyslac w pierwszej kolejnosci", [
    naglowek("Zapotrzebowania i realizacja",
             "priorytety, pokrycie i wartosc optymalizacji przydzialu"),
    visual("card", 16, 66, 240, 96, {"Values": [m("Zapotrzebowania")]}, "Zapotrzebowan"),
    visual("card", 268, 66, 240, 96, {"Values": [m("Zapotrzebowania Priorytet 1")]},
           "Priorytet 1"),
    visual("card", 520, 66, 240, 96, {"Values": [m("Pokrycie Zapotrzebowan %")]},
           "Pokrycie zapotrzebowan"),
    visual("card", 772, 66, 240, 96, {"Values": [m("Priorytet 1 Obsluzony %")]},
           "Priorytet 1 obsluzony"),
    visual("card", 1024, 66, 240, 96, {"Values": [m("Koszt Operacji PLN")]},
           "Koszt operacji (PLN)"),
    visual("card", 16, 174, 240, 96, {"Values": [m("Sredni Czas FIFO h")]},
           "FIFO - sredni czas (h)"),
    visual("card", 268, 174, 240, 96, {"Values": [m("Sredni Czas Optymalizacja h")]},
           "Optymalizacja (h)"),
    visual("card", 520, 174, 240, 96, {"Values": [m("Czas Zaoszczedzony h")]},
           "Zaoszczedzony czas (h)"),
    visual("clusteredBarChart", 772, 174, 492, 200,
           {"Category": [c(MET, "method")], "Y": [c(MET, "avg_delivery_time_h")]},
           "Sredni czas dostawy wedlug metody przydzialu"),
    visual("donutChart", 16, 282, 380, 200,
           {"Category": [c(PRZ, "status")], "Y": [m("Przydzielona Ilosc")]},
           "Status przydzialow"),
    visual("columnChart", 408, 282, 356, 200,
           {"Category": [c(ZAP, "priority")], "Y": [m("Zapotrzebowana Ilosc")]},
           "Zapotrzebowanie wg priorytetu"),
    visual("slicer", 772, 386, 492, 96, {"Values": [c(ZAP, "day_label")]}, "Doba"),
    visual("tableEx", 16, 494, 1248, 174,
           {"Values": [c(PLAN, "demand_id"), c(PLAN, "priority"), c(PLAN, "resource_type_id"),
                       c(PLAN, "warehouse_id"), c(PLAN, "allocated_qty"),
                       c(PLAN, "travel_time_h"), c(PLAN, "method")]},
           "Plan przydzialu", sort=sort_c(PLAN, "travel_time_h", "Descending")),
    stopka("roznica miedzy FIFO a optymalizacja to godziny, ktore zyskuja "
           "zapotrzebowania priorytetu pierwszego - to jest wartosc tego rozwiazania."),
])

# --- 4. Punkty przyjecia ------------------------------------------------------
page("s4", "4 | Gdzie brakuje miejsca", [
    naglowek("Punkty przyjecia", "oblozenie, przepelnienia i potrzeby medyczne"),
    visual("card", 16, 66, 240, 96, {"Values": [m("Osoby w Punktach Przyjecia")]},
           "Osoby w punktach"),
    visual("card", 268, 66, 240, 96, {"Values": [m("Pojemnosc Punktow")]}, "Pojemnosc"),
    visual("card", 520, 66, 240, 96, {"Values": [m("Oblozenie Punktow %")]}, "Oblozenie"),
    visual("card", 772, 66, 240, 96, {"Values": [m("Punkty Powyzej 90%")]},
           "Punkty powyzej 90%"),
    visual("card", 1024, 66, 240, 96, {"Values": [m("Wymagajacy Opieki Medycznej")]},
           "Wymagajacy opieki"),
    visual("map", 16, 174, 620, 300,
           {"Category": [c(SCHR, "shelter_name")], "Size": [m("Osoby w Punktach Przyjecia")]},
           "Punkty przyjecia na mapie"),
    visual("barChart", 648, 174, 364, 300,
           {"Category": [c(SCHR, "shelter_type")], "Y": [m("Oblozenie Punktow %")]},
           "Oblozenie wg typu punktu", sort=sort_m("Oblozenie Punktow %")),
    visual("slicer", 1024, 174, 240, 148, {"Values": [c(SCHR, "shelter_type")]}, "Typ punktu"),
    visual("slicer", 1024, 330, 240, 144, {"Values": [c(SCHR, "accessible_disabled")]},
           "Dostepnosc dla niepelnosprawnych"),
    visual("tableEx", 16, 486, 1248, 182,
           {"Values": [c(SCHR, "shelter_name"), c(SCHR, "shelter_type"), c(GMI, "gmina_name"),
                       c(SCHR, "capacity"), m("Osoby w Punktach Przyjecia"),
                       m("Oblozenie Punktow %"), m("Wymagajacy Opieki Medycznej")]},
           "Punkty wymagajace odciazenia", sort=sort_m("Oblozenie Punktow %")),
    stopka("punkt powyzej 90 procent nie przyjmie kolejnego autobusu - to prog "
           "decyzji o otwarciu nastepnej lokalizacji, nie ostrzezenie."),
])

# --- 5. Prognoza wyczerpania --------------------------------------------------
page("s5", "5 | Czy wystarczy", [
    naglowek("Prognoza wyczerpania zapasow",
             "ile dni zapasu zostalo przy biezacym zuzyciu"),
    visual("card", 16, 66, 240, 96, {"Values": [m("Krytyczne Braki Zapasu")]},
           "Zasoby ponizej progu"),
    visual("card", 268, 66, 240, 96, {"Values": [m("Minimalne Dni Zapasu")]},
           "Najnizszy zapas (dni)"),
    visual("card", 520, 66, 240, 96, {"Values": [m("Zuzycie Narastajaco")]},
           "Zuzycie narastajaco"),
    visual("card", 772, 66, 240, 96, {"Values": [m("Zapas Dostepny")]}, "Zapas dostepny"),
    visual("slicer", 1024, 66, 240, 200, {"Values": [c(PROG, "alert_level")]}, "Poziom alertu"),
    visual("pivotTable", 16, 174, 996, 300,
           {"Rows": [c(PROG, "resource_name")], "Columns": [c(WOJ, "voivodeship_name")],
            "Values": [c(PROG, "days_of_stock")]},
           "Dni zapasu: zasob x wojewodztwo"),
    visual("slicer", 1024, 274, 240, 200, {"Values": [c(ZAS, "category")]}, "Kategoria zasobu"),
    visual("tableEx", 16, 486, 1248, 182,
           {"Values": [c(PROG, "resource_name"), c(WOJ, "voivodeship_name"),
                       c(PROG, "available_qty"), c(PROG, "daily_consumption"),
                       c(PROG, "days_of_stock"), c(PROG, "alert_level"),
                       c(PROG, "recommendation")]},
           "Rekomendacje uzupelnienia", sort=sort_c(PROG, "days_of_stock")),
    stopka("dni zapasu licza sie przy biezacym tempie zuzycia - wzrost natezenia "
           "zdarzenia skraca je proporcjonalnie."),
])

# --- 6. Finanse SPO-2 ---------------------------------------------------------
page("s6", "6 | Za co to sfinansujemy", [
    naglowek("Finanse - sciezka SPO-2", "wnioski o srodki, limity i status akceptacji"),
    visual("card", 16, 66, 300, 96, {"Values": [m("SPO-2 Wnioskowane PLN")]},
           "Suma wnioskow (PLN)"),
    visual("card", 328, 66, 300, 96, {"Values": [m("SPO-2 Powyzej Limitu")]},
           "Wnioski powyzej limitu"),
    visual("card", 640, 66, 300, 96, {"Values": [m("Koszt Operacji PLN")]},
           "Koszt operacji (PLN)"),
    visual("slicer", 952, 66, 312, 200, {"Values": [c(FIN, "status")]}, "Status wniosku"),
    visual("barChart", 16, 174, 460, 300,
           {"Category": [c(FIN, "status")], "Y": [m("SPO-2 Wnioskowane PLN")]},
           "Kwoty wg statusu", sort=sort_m("SPO-2 Wnioskowane PLN")),
    visual("columnChart", 488, 174, 452, 300,
           {"Category": [c(WOJ, "voivodeship_name")], "Y": [m("SPO-2 Wnioskowane PLN")]},
           "Kwoty wg wojewodztwa", sort=sort_m("SPO-2 Wnioskowane PLN")),
    visual("slicer", 952, 274, 312, 200, {"Values": [c(FIN, "purpose")]}, "Cel wniosku"),
    visual("tableEx", 16, 486, 1248, 182,
           {"Values": [c(FIN, "financial_request_id"), c(FIN, "applicant"),
                       c(WOJ, "voivodeship_name"), c(FIN, "amount_pln"), c(FIN, "purpose"),
                       c(FIN, "status"), c(FIN, "approval_path")]},
           "Wnioski SPO-2", sort=sort_c(FIN, "amount_pln", "Descending")),
    stopka("wnioski powyzej limitu wymagaja sciezki ministerialnej - to one "
           "wyznaczaja termin, w ktorym pieniadze realnie trafia do wojewody."),
])

THEME = {
    "name": "OL_LOG_Gov",
    "dataColors": [GOV, GOV_DARK, GREEN, AMBER, ORANGE, RED, "#7e22ce", "#64748b"],
    "background": PAGE_BG, "foreground": INK, "tableAccent": GOV,
    "good": GREEN, "neutral": AMBER, "bad": RED,
    "visualStyles": {"*": {"*": {
        "background": [{"color": {"solid": {"color": CARD_BG}}, "transparency": 0}],
        "border": [{"show": True, "color": {"solid": {"color": BORDER}}, "radius": 6}],
        "labels": [{"color": {"solid": {"color": INK}}}],
        "title": [{"fontColor": {"solid": {"color": INK}}, "fontSize": 12,
                   "background": {"solid": {"color": GOV_50}}}],
        "outspacePane": [{"backgroundColor": {"solid": {"color": CARD_BG}},
                          "foregroundColor": {"solid": {"color": INK}}}],
    }}},
}


def build_parts():
    parts = {}
    parts["definition.pbir"] = json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/"
                   "definitionProperties/1.0.0/schema.json",
        "version": "4.0",
        "datasetReference": {"byPath": None, "byConnection": {
            "connectionString": None, "pbiServiceModelId": None,
            "pbiModelVirtualServerName": "sobe_wowvirtualserver",
            "pbiModelDatabaseName": DATASET, "name": "EntityDataSource",
            "connectionType": "pbiServiceXmlaStyleLive"}}})
    parts["definition/version.json"] = json.dumps(
        {"$schema": f"{SCH}/versionMetadata/1.0.0/schema.json", "version": "4.0.0"})
    parts["definition/report.json"] = json.dumps({
        "$schema": f"{SCH}/report/1.4.0/schema.json",
        "themeCollection": {"customTheme": {"name": "OL_LOG_Gov", "type": "SharedResources",
                                            "reportVersionAtImport": "5.55"}},
        "layoutOptimization": "None",
        "settings": {"allowChangeFilterTypes": True},
    })
    parts["StaticResources/SharedResources/BaseThemes/OL_LOG_Gov.json"] = json.dumps(THEME)
    parts["definition/pages/pages.json"] = json.dumps({
        "$schema": f"{SCH}/pagesMetadata/1.0.0/schema.json",
        "pageOrder": [p[0] for p in PAGES], "activePageName": PAGES[0][0]})
    for pname, display, visuals in PAGES:
        parts[f"definition/pages/{pname}/page.json"] = json.dumps({
            "$schema": f"{SCH}/page/1.4.0/schema.json",
            "name": pname, "displayName": display, "displayOption": "FitToPage",
            "height": H, "width": W})
        for v in visuals:
            parts[f"definition/pages/{pname}/visuals/{v['name']}/visual.json"] = json.dumps(v)
    return [{"path": p, "payload": base64.b64encode(cnt.encode("utf-8")).decode(),
             "payloadType": "InlineBase64"} for p, cnt in parts.items()]


def naglowek_autoryzacji(tok):
    return " ".join(("Bearer", tok))


def main():
    tok = subprocess.run(["az", "account", "get-access-token", "--resource",
                          "https://api.fabric.microsoft.com", "--query", "accessToken", "-o", "tsv"],
                         capture_output=True, text=True, shell=True).stdout.strip()
    hh = {"Authorization": naglowek_autoryzacji(tok), "Content-Type": "application/json"}
    items = requests.get(f"{API}/workspaces/{WS}/items?type=Report", headers=hh).json()["value"]
    existing = next((i for i in items if i["displayName"] == NAME), None)
    definition = {"parts": build_parts()}
    if existing:
        r = requests.post(f"{API}/workspaces/{WS}/reports/{existing['id']}/updateDefinition",
                          headers=hh, json={"definition": definition})
        print("aktualizacja:", r.status_code, r.text[:1200])
        print("id:", existing["id"])
    else:
        r = requests.post(f"{API}/workspaces/{WS}/reports", headers=hh,
                          json={"displayName": NAME, "definition": definition})
        print("utworzenie:", r.status_code, r.text[:1200])
    if r.status_code == 202:
        loc = r.headers.get("Location")
        for _ in range(60):
            time.sleep(5)
            s = requests.get(loc, headers=hh).json()
            if s.get("status") in ("Succeeded", "Failed"):
                print(json.dumps(s, ensure_ascii=False)[:1500])
                break


if __name__ == "__main__":
    main()
