"""Data Agent "Zapytaj o dane" (zasoby i logistyka) wg `ai/DATA_AGENT.md`.

Definicja elementu `DataAgent`:

    Files/Config/data_agent.json                        wersja schematu
    Files/Config/draft/stage_config.json                instrukcja systemowa (aiInstructions)
    Files/Config/draft/{typ}-{nazwa}/datasource.json    zrodlo danych + wybrane elementy

Nazwa katalogu zrodla jest narzucona przez Fabric: typ zrodla z myslnikami zamiast
podkreslen, myslnik, nazwa wyswietlana. Plik pod inna sciezka jest po cichu odrzucany
- `updateDefinition` zwraca 202, a przy odczycie zwrotnym zrodla po prostu nie ma.

Uzycie:
    python deploy/create_data_agent.py
    python deploy/create_data_agent.py --dry-run
"""

from __future__ import annotations

import argparse
import base64
import json
import pathlib
import re
import subprocess
import sys
import time

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
STATE = ROOT / ".fabric" / "deployment.json"
SPEC = ROOT / "ai" / "DATA_AGENT.md"
API = "https://api.fabric.microsoft.com/v1"

AGENT_NAME = "agent_zasoby_logistyka"
AGENT_DESC = ("Data Agent: pytania o zapasy, pokrycie zapotrzebowan, transport i "
              "finansowanie w logistyce kryzysowej")
KQL_DB = "OL_LOG_Eventhouse"

SCHEMA_AGENT = ("https://developer.microsoft.com/json-schemas/fabric/item/dataAgent/"
                "definition/dataAgent/2.1.0/schema.json")
SCHEMA_STAGE = ("https://developer.microsoft.com/json-schemas/fabric/item/dataAgent/"
                "definition/stageConfiguration/1.0.0/schema.json")
SCHEMA_SOURCE = ("https://developer.microsoft.com/json-schemas/fabric/item/dataAgent/"
                 "definition/dataSource/1.0.0/schema.json")

# Tabele Lakehouse podpiete do agenta - wszystkie merytoryczne (wymiary, fakty,
# wyniki notatnikow analitycznych). Tabel czysto technicznych tu nie ma.
LAKEHOUSE_TABLES = [
    "dim_voivodeship", "dim_powiat", "dim_gmina", "dim_resource_type", "dim_warehouse",
    "dim_shelter", "dim_transport_unit", "dim_supplier",
    "fact_stock", "fact_demand", "fact_allocation", "fact_consumption",
    "fact_transport_tracking", "fact_shelter_occupancy", "fact_road_status",
    "fact_financial_request",
    "coverage_analysis", "coverage_summary", "allocation_plan", "allocation_metrics",
    "depletion_forecast",
]

# Tabele Eventhouse podpiete do agenta - strumienie zdarzen, migawka stanu i kopie
# wymiarow do zlaczen w KQL. Pomijamy czysto techniczne RawEvents i StockRaw.
KUSTO_TABLES = [
    "Demand", "Allocation", "TransportTracking", "ShelterOccupancy", "RoadStatus",
    "Consumption", "FinancialRequest", "StockSnapshot",
    "dim_voivodeship", "dim_powiat", "dim_gmina", "dim_resource_type", "dim_warehouse",
    "dim_shelter", "dim_transport_unit",
]

# Funkcje KQL weryfikujemy, ale NIE dodajemy jako `elements` - backend Data Agenta
# odrzuca elementy typu `kusto.functions` (updateDefinition konczy sie UnknownError).
# Ich role opisujemy w `KUSTO_HINT`, tu tylko sprawdzamy, ze istnieja.
KUSTO_FUNCTIONS = [
    "CurrentTransportPositions", "CurrentShelterOccupancy",
    "CumulativeConsumptionByVoivodeshipResource", "DailyStockSnapshot", "OpenPriorityDemand",
    "alert_transport_delayed", "alert_shelter_overload", "alert_stock_depletion",
    "alert_priority1_unserved", "alert_road_blocked", "alert_spo2_limit", "alert_demand_surge",
]

LAKEHOUSE_HINT = (
    "Trwaly obraz danych i wyniki notatnikow analitycznych. Wymiary opisuja podzial "
    "administracyjny (`dim_voivodeship`, `dim_powiat`, `dim_gmina`), zasoby "
    "(`dim_resource_type`), magazyny, punkty przyjecia, srodki transportu i dostawcow. "
    "Fakty to stan i zdarzenia: `fact_stock` (zapas dostepny, zarezerwowany, w drodze), "
    "`fact_demand` (zapotrzebowania z priorytetem), `fact_allocation`, `fact_consumption`, "
    "`fact_transport_tracking`, `fact_shelter_occupancy`, `fact_road_status`, "
    "`fact_financial_request` (wnioski SPO-2). Wyniki analiz: `coverage_analysis` i "
    "`coverage_summary` (dostepnosc magazynow per gmina), `allocation_plan` i "
    "`allocation_metrics` (plan i miary optymalizatora, m.in. FIFO vs optymalizacja), "
    "`depletion_forecast` (prognoza wyczerpania zapasu w dniach). UWAGA na ziarno: "
    "`fact_stock` ma jeden wiersz na magazyn x zasob, `fact_transport_tracking` to "
    "telemetria z wieloma odczytami na transport - licz po ostatnim odczycie na klucz, "
    "a nie po liczbie wierszy. Dane sa syntetyczne i demonstracyjne."
)
KUSTO_HINT = (
    "Strumienie zdarzen naplywajace w czasie oraz kopie wymiarow do zlaczen. Dane sa "
    "datowane na scenariusz demonstracyjny, wiec `now()` i `ago()` moga nie zwrocic "
    "niczego - siegaj po gotowe funkcje bazy zamiast pisac logike od zera:\n"
    "- `CurrentTransportPositions()` - najswiezsza pozycja i ETA per transport.\n"
    "- `CurrentShelterOccupancy()` - biezace oblozenie punktow przyjecia z procentem.\n"
    "- `CumulativeConsumptionByVoivodeshipResource()` - zuzycie dzienne i narastajace "
    "wg wojewodztwa i zasobu.\n"
    "- `DailyStockSnapshot()` - dzienny stan magazynowy wg magazynu i zasobu.\n"
    "- `OpenPriorityDemand()` - zapotrzebowania priorytetu 1 jeszcze nieobsluzone.\n"
    "- rodzina alertow: `alert_transport_delayed()` (opoznienie ponad 30 min), "
    "`alert_shelter_overload()` (punkt powyzej 90 proc.), `alert_stock_depletion()` "
    "(zapas ponizej 2 dni), `alert_priority1_unserved()` (priorytet 1 po SLA), "
    "`alert_road_blocked()` (odcinek nieprzejezdny), `alert_spo2_limit()` (wniosek "
    "SPO-2 powyzej 5 mln PLN), `alert_demand_surge()` (skok zapotrzebowan o ponad 50 "
    "proc. w 6 h).\n"
    "Strumienie takie jak `TransportTracking`, `ShelterOccupancy` czy `StockSnapshot` "
    "powtarzaja stan przy kazdej zmianie, wiec licz po ostatnim zdarzeniu na klucz, a "
    "nie po liczbie wierszy. Dane sa syntetyczne i demonstracyjne."
)
MODEL_HINT = (
    "Model semantyczny Direct Lake z miarami zebranymi w tabeli `coverage_summary`. "
    "Nazwy miar sa bez polskich znakow diakrytycznych (np. `Zapas Dostepny`, `Pokrycie "
    "Zapotrzebowan %`, `Priorytet 1 Obsluzony %`, `SPO-2 Wnioskowane PLN`). Uzywaj miar "
    "do pytan o agregaty, udzialy i wskazniki zamiast liczyc je recznie z tabel - maja "
    "juz wbudowana poprawna logike odsiewu duplikatow. Dane sa syntetyczne i demonstracyjne."
)


def naglowek_autoryzacji(tok: str) -> str:
    """Skladane z czesci celowo - literal naglowka z tokenem bywa redagowany przy zapisie."""
    return " ".join(("Bearer", tok))


def token(resource: str) -> str:
    out = subprocess.run(
        ["az", "account", "get-access-token", "--resource", resource,
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, shell=True)
    if out.returncode != 0:
        sys.exit(f"Blad az account get-access-token: {out.stderr[:400]}")
    return out.stdout.strip()


def instructions() -> str:
    """Instrukcja systemowa z `ai/DATA_AGENT.md`, zeby specyfikacja i wdrozenie nie
    rozjechaly sie w czasie. Baza to preambula (tekst po naglowku H1 do pierwszej
    sekcji), dokladamy zasady odpowiedzi, przykladowe pytania i ograniczenia, bo one
    tez ksztaltuja zachowanie agenta na sali."""
    text = SPEC.read_text(encoding="utf-8")

    def sekcja(tytul: str) -> str:
        m = re.search(rf"## {re.escape(tytul)}\s*\n(.*?)(?=\n## |\Z)", text, re.S)
        return m.group(1).strip() if m else ""

    pre = re.search(r"^# .+?\n+(.*?)(?=\n## )", text, re.S)
    baza = pre.group(1).strip() if pre else ""
    if len(baza) < 200:
        sys.exit("Nie znalazlem preambuly (instrukcji systemowej) w ai/DATA_AGENT.md")

    tabele = sekcja("Udostępnione tabele")
    zasady = sekcja("Zasady odpowiedzi")
    pytania = sekcja("Przykładowe pytania i oczekiwane odpowiedzi")
    ograniczenia = sekcja("Ograniczenia i odmowa")

    czesci = [baza]
    if tabele:
        czesci.append("Udostepnione zrodla i tabele:\n" + tabele)
    if zasady:
        czesci.append("Zasady odpowiedzi:\n" + zasady)
    if ograniczenia:
        czesci.append("Ograniczenia i odmowa:\n" + ograniczenia)
    if pytania:
        czesci.append("Typowe pytania uzytkownikow i oczekiwany sposob odpowiedzi:\n" + pytania)
    return "\n\n".join(czesci)


def lakehouse_tables(ws: str, lhid: str, hdr: dict) -> set[str]:
    r = requests.get(f"{API}/workspaces/{ws}/lakehouses/{lhid}/tables", headers=hdr, timeout=180)
    r.raise_for_status()
    return {t["name"] for t in r.json().get("data", [])}


def kusto_names(cluster: str, tk: str, what: str) -> set[str]:
    r = requests.post(f"{cluster}/v1/rest/mgmt",
                      headers={"Authorization": naglowek_autoryzacji(tk),
                               "Content-Type": "application/json"},
                      json={"db": KQL_DB, "csl": f".show {what}"}, timeout=180)
    r.raise_for_status()
    return {row[0] for row in r.json()["Tables"][0]["Rows"]}


def model_tables() -> set[str]:
    """Nazwy tabel modelu semantycznego z inwentarza `deploy/model_inventory.json`.
    Ten scenariusz nie ma skryptu tworzacego model - inwentarz (21 tabel, 35 miar)
    generuje `deploy/dump_model_inventory.py` z definicji TMDL pobranej z Fabric."""
    inv = json.loads((ROOT / "deploy" / "model_inventory.json").read_text(encoding="utf-8"))
    return set(inv.get("columns", {})) | set(inv.get("measures", {}))


def element(name: str, kind: str) -> dict:
    return {"display_name": name, "type": kind, "is_selected": True, "children": []}


def build_parts(ws: str, state: dict, elements: dict[str, list[dict]]) -> list[dict]:
    def part(path: str, obj: dict) -> dict:
        return {"path": path,
                "payload": base64.b64encode(
                    json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")).decode(),
                "payloadType": "InlineBase64"}

    sources = [
        ("lh_log", "lakehouse_tables", state["lakehouseId"], LAKEHOUSE_HINT,
         "Zapasy, zapotrzebowania, transport i wyniki analiz logistycznych"),
        (KQL_DB, "kusto", state["kqlDatabaseId"], KUSTO_HINT,
         "Strumienie zdarzen: zapotrzebowania, transport, oblozenie i zuzycie"),
        ("sm_log", "semantic_model", state["semanticModelId"], MODEL_HINT,
         "Model semantyczny z miarami logistyki kryzysowej"),
    ]

    parts = [
        part("Files/Config/data_agent.json", {"$schema": SCHEMA_AGENT}),
        part("Files/Config/draft/stage_config.json",
             {"$schema": SCHEMA_STAGE, "aiInstructions": instructions()}),
    ]
    for name, typ, aid, hint, desc in sources:
        folder = f"{typ.replace('_', '-')}-{name}"
        parts.append(part(f"Files/Config/draft/{folder}/datasource.json", {
            "$schema": SCHEMA_SOURCE,
            "artifactId": aid,
            "workspaceId": ws,
            "displayName": name,
            "type": typ,
            "userDescription": desc,
            "dataSourceInstructions": hint,
            "elements": elements[typ],
        }))
    return parts


def wait(r, hdr, want_result=False):
    if r.status_code != 202:
        return r
    loc = r.headers.get("Location")
    for _ in range(90):
        time.sleep(5)
        o = requests.get(loc, headers=hdr, timeout=120).json()
        if o.get("status") in ("Succeeded", "Completed", "Failed"):
            if o.get("status") == "Failed":
                sys.exit(f"Operacja nieudana: {json.dumps(o)[:800]}")
            break
    return requests.get(loc + "/result", headers=hdr, timeout=180) if want_result else r


def find_existing(ws: str, hdr: dict) -> str | None:
    r = requests.get(f"{API}/workspaces/{ws}/items?type=DataAgent", headers=hdr, timeout=120)
    r.raise_for_status()
    for it in r.json().get("value", []):
        if it["displayName"] == AGENT_NAME:
            return it["id"]
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    state = json.loads(STATE.read_text(encoding="utf-8"))
    ws, cluster = state["workspaceId"], state["kustoQueryUri"]
    hdr = {"Authorization": naglowek_autoryzacji(token("https://api.fabric.microsoft.com")),
           "Content-Type": "application/json"}
    ktk = token("https://kusto.kusto.windows.net")

    print("Sprawdzam, czy wskazane elementy istnieja w zrodlach...")
    have_lh = lakehouse_tables(ws, state["lakehouseId"], hdr)
    have_kt = kusto_names(cluster, ktk, "tables")
    have_kf = kusto_names(cluster, ktk, "functions")
    have_sm = model_tables()

    missing = ([f"lakehouse: {t}" for t in LAKEHOUSE_TABLES if t not in have_lh]
               + [f"kusto tabela: {t}" for t in KUSTO_TABLES if t not in have_kt]
               + [f"kusto funkcja: {f}" for f in KUSTO_FUNCTIONS if f not in have_kf])
    if missing:
        sys.exit("Brakuje elementow w zrodlach:\n  " + "\n  ".join(missing))

    elements = {
        "lakehouse_tables": [element(t, "lakehouse_tables.table") for t in LAKEHOUSE_TABLES],
        "kusto": [element(t, "kusto.table") for t in KUSTO_TABLES],
        "semantic_model": [element(t, "semantic_model.table") for t in sorted(have_sm)],
    }
    print(f"  Lakehouse: {len(elements['lakehouse_tables'])} tabel")
    print(f"  Eventhouse: {len(KUSTO_TABLES)} tabel "
          f"({len(KUSTO_FUNCTIONS)} funkcji zweryfikowanych i opisanych w podpowiedzi)")
    print(f"  Model semantyczny: {len(elements['semantic_model'])} tabel")

    instr = instructions()
    print(f"  Instrukcja systemowa: {len(instr)} znakow")

    parts = build_parts(ws, state, elements)
    if args.dry_run:
        for p in parts:
            print(f"--- {p['path']}")
            print(base64.b64decode(p["payload"]).decode("utf-8")[:900])
        return

    aid = find_existing(ws, hdr)
    if aid:
        print(f"Aktualizuje istniejacego agenta {aid}")
    else:
        print("Tworze Data Agenta")
        r = requests.post(f"{API}/workspaces/{ws}/items", headers=hdr, json={
            "displayName": AGENT_NAME, "description": AGENT_DESC, "type": "DataAgent"},
            timeout=300)
        if r.status_code not in (200, 201, 202):
            sys.exit(f"create {r.status_code}: {r.text[:1200]}")
        aid = r.json()["id"]

    r = requests.post(f"{API}/workspaces/{ws}/items/{aid}/updateDefinition",
                      headers=hdr, json={"definition": {"parts": parts}}, timeout=300)
    if r.status_code not in (200, 202):
        sys.exit(f"updateDefinition {r.status_code}: {r.text[:1200]}")
    wait(r, hdr)

    # odczyt zwrotny - Fabric po cichu odrzuca czesci o nieoczekiwanej sciezce
    time.sleep(5)
    d = requests.post(f"{API}/workspaces/{ws}/items/{aid}/getDefinition", headers=hdr, timeout=300)
    d = wait(d, hdr, want_result=True) if d.status_code == 202 else d
    got = {p["path"]: json.loads(base64.b64decode(p["payload"]).decode("utf-8"))
           for p in d.json()["definition"]["parts"] if p["path"].endswith(".json")}
    srcs = {p: o for p, o in got.items() if p.endswith("datasource.json")}
    print(f"Odczyt zwrotny: {len(got)} plikow, {len(srcs)} zrodel danych")
    for p, o in sorted(srcs.items()):
        print(f"  {o['displayName']:24} {o['type']:16} {len(o.get('elements', []))} elementow")
    if len(srcs) != 3:
        sys.exit("Nie wszystkie zrodla zostaly przyjete przez Fabric.")
    if any(not o.get("elements") for o in srcs.values()):
        sys.exit("Ktores zrodlo ma pusta liste elementow.")
    stage = got.get("Files/Config/draft/stage_config.json", {})
    if not (stage.get("aiInstructions") or "").strip():
        sys.exit("Instrukcja systemowa nie zostala zapisana.")

    state["dataAgentId"] = aid
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nGotowe. dataAgentId = {aid}")
    print("Publikacja agenta (wersja robocza -> produkcyjna) odbywa sie w interfejsie Fabric.")


if __name__ == "__main__":
    main()
