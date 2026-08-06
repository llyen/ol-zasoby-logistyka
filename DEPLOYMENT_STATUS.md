# 🚀 Stan wdrożenia scenariusza logistycznego na Microsoft Fabric

Dokument opisuje **rzeczywisty, zweryfikowany** stan środowiska demonstracyjnego oraz kolejność
kroków, którymi zostało ono zbudowane. Służy do odtworzenia wdrożenia i do rozliczenia prac.

## 1. Środowisko

| Element | Wartość |
|---|---|
| Workspace | `OL-ZK-Demo-Zasoby` |
| Workspace ID | `aebf1df2-3be8-4f89-9d8d-647ae519d50b` |
| Pojemność | `fcdemo` (F8) |
| Cluster URI Eventhouse | `https://trd-1mgsz6pz0kcbxjcnjw.z9.kusto.fabric.microsoft.com` |

> Pojemność `fcdemo` sama przechodzi w stan `Paused` po okresie bezczynności. Przed każdym
> dłuższym wdrożeniem uruchom `deploy\ensure_capacity.ps1`, inaczej wywołania Fabric API
> kończą się błędem `CapacityNotActive`.

## 2. Utworzone elementy

| Element | Typ | ID |
|---|---|---|
| `OL_LOG_Lakehouse` | Lakehouse | `dad1feb6-3eba-431d-8e9f-b00aba44344d` |
| `OL_LOG_Eventhouse` | Eventhouse | `895d7b28-e5a4-4bbf-a61d-78d6e542c369` |
| `OL_LOG_Eventhouse` | KQL Database | `c9c80774-af15-4c59-b856-d9d659506820` |
| `OL_LOG_SemanticModel` | Semantic model (Direct Lake) | `82d61aa6-1ea3-42f5-a9e9-4c5ae4508944` |
| `OL_LOG_Raport` | Raport Power BI | `517879e5-0c27-44cc-9f9b-d2bfa9fe257a` |
| `OL_LOG_Dashboard` | Real-Time Dashboard | `8b865c96-4fa9-49b0-8313-a71c175fc23c` |
| `OL_LOG_Activator` | Activator (Reflex) | `b07883fa-b389-48da-8f3a-d3b0267c0de1` |
| `agent_zasoby_logistyka` | Data Agent (Zapytaj o dane) | `498ed2ee-8099-4c95-8b3d-62accc4fab7b` |
| `01_load_dimensions` … `05_schema_dump` | Notebook (6) | zob. workspace |

## 3. Kolejność wdrożenia

```powershell
# 0. Upewnienie się, że pojemność działa
.\deploy\ensure_capacity.ps1

# 1. Workspace, Lakehouse, Eventhouse
.\deploy\deploy_fabric.ps1 -Step items

# 2. Tabele KQL, mapowania ingestii, widoki zmaterializowane, funkcje curated
.\deploy\deploy_fabric.ps1 -Step kql

# 3. Wysyłka danych do OneLake (CSV -> Files/datasets, JSONL -> Files/streams)
.\deploy\deploy_fabric.ps1 -Step upload

# 4. Ingestia strumieni, wymiarów, stanów magazynowych i wniosków SPO-2
.\deploy\deploy_fabric.ps1 -Step ingest
.\deploy\deploy_fabric.ps1 -Step verify

# 5. Notatniki Spark: wymiary, strumienie, pokrycie, optymalizacja, prognoza
.\deploy\import_notebooks.ps1
.\deploy\run_notebooks.ps1

# 6. Model semantyczny Direct Lake (21 tabel, 20 relacji, 35 miar)
.\deploy\create_semantic_model.ps1

# 7. Real-Time Dashboard (5 stron, 20 kafelków)
.\deploy\create_dashboard.ps1

# 8. Reguły alertowe jako funkcje KQL + element Activator
.\deploy\create_activator.ps1

# 9. Symulacja czasu rzeczywistego (tryb ciągły, w tle)
.\scenario\run_scenario.ps1 -Preset ciagly -Background
```

## 4. Zweryfikowane liczności w Eventhouse

Stan po pełnym załadowaniu danych źródłowych (`-Step verify`):

| Tabela | Wiersze |
|---|---|
| `TransportTracking` | 16 901 |
| `Consumption` | 14 300 |
| `ShelterOccupancy` | 4 400 |
| `dim_gmina` | 2 477 |
| `StockSnapshot` | 1 200 |
| `Demand` | 960 |
| `Allocation` | 520 |
| `dim_shelter` | 400 |
| `RoadStatus` | 260 |
| `dim_powiat` | 380 |
| `FinancialRequest` | 90 |
| `dim_warehouse` | 60 |
| `dim_voivodeship` | 16 |

Zakres czasu danych źródłowych: `2026-09-15` … `2026-09-26`.

> W trybie ciągłego odtwarzania tabele strumieniowe zawierają wyłącznie okno prezentacji
> (tło + faza live przesunięte na bieżący zegar), więc ich liczności są mniejsze.
> Pełne liczności wracają po `deploy_fabric.ps1 -Step ingest`.

## 5. Tabele Delta w Lakehouse (21)

Wymiary (notatnik `01`): `dim_voivodeship`, `dim_powiat`, `dim_gmina`, `dim_warehouse`,
`dim_resource_type`, `dim_shelter`, `dim_transport_unit`, `dim_supplier`.

Strumienie i fakty (notatnik `01b`): `fact_demand`, `fact_allocation`, `fact_transport_tracking`,
`fact_shelter_occupancy`, `fact_consumption`, `fact_road_status`, `fact_stock`,
`fact_financial_request`.

Wyniki modeli (notatniki `02`–`04`): `coverage_analysis`, `coverage_summary`, `allocation_plan`,
`allocation_metrics`, `depletion_forecast`.

## 6. Ścieżka real-time

```
scenario/replay.py  ──►  streaming ingestion Eventhouse  ──►  Real-Time Dashboard (okno 15 min)
```

Silnik odtwarzania kompresuje dobę scenariusza do 24 minut zegara (`--speed 60`) i **przypina
oś czasu do chwili uruchomienia**, dlatego dashboard pokazuje świeże dane niezależnie od pory
demonstracji. Tło (15–19.09) ładowane jest wsadowo z OneLake i przesuwane jednym poleceniem
`.set-or-replace`, a okno live (19–20.09, szczyt operacji transportowych) idzie strumieniowo.

| Wariant | Tempo | Okno live | Czas cyklu |
|---|---|---|---|
| `demo` | 60x | 24 h | ~24 min |
| `szybki` | 300x | 24 h | ~5 min (smoke-test) |
| `kulminacja` | 30x | 12 h od 20.09 | ~24 min |
| `wolny` | 15x | 12 h | ~48 min |
| `ciagly` | 60x | 24 h, zapętlone | bez końca |

```powershell
.\scenario\run_scenario.ps1 -Preset ciagly -Background   # start w tle
.\scenario\run_scenario.ps1 -Stop                        # zatrzymanie
.\scenario\run_scenario.ps1 -ResetOnly                   # wyczyszczenie tabel
```

Postęp: `scenario\_ciagly.log`. Okno dashboardu (15 min) jest krótsze niż cykl (24 min),
dzięki czemu w kadrze widać przyrost, a nie całą scenę naraz.

## 7. Napotkane problemy i rozwiązania

| Problem | Rozwiązanie |
|---|---|
| `lookback` w widoku zmaterializowanym `DailyConsumption_mv` → `BadRequest` bez czytelnego komunikatu | `lookback` działa wyłącznie dla widoków deduplikujących (`arg_max`, `take_any`), nie dla agregacji `sum()` — usunięty |
| Direct Lake: `We cannot access the source Delta table` po `updateDefinition` | Lakehouse utworzony przez REST API **nie ma schematów** — w definicji modelu należy użyć ścieżki OneLake bez `schemaName`, nie SQL endpointu z `dbo` |
| `TokenExpired` w środku łańcucha notatników | `run_notebooks.ps1` odświeża token co 15 minut; `az account get-access-token` potrafi oddać token z własnego cache z krótkim czasem ważności |
| `CapacityNotActive` w trakcie wdrożenia | Pojemność sama się wstrzymuje — `deploy\ensure_capacity.ps1` wznawia ją przed pracą |
| Odtwarzanie przerywane przez `HTTP 520 Internal service error` | 520 jest przejściowy — pętla ponawiania obejmuje teraz wszystkie kody 5xx, nie tylko 500/502/503/504 |
| `TableSetOrReplace` w stanie `Throttled` przy przesuwaniu osi czasu | F8 z aktywnymi widokami zmaterializowanymi dławi operację; przesunięcie ponawiane jest do 4 razy z rosnącym odstępem |
| Reguła „transport opóźniony” bez trafień | Status `delayed` nigdy nie jest ostatnim stanem transportu (po dostawie wraca `delivered`) — alert liczony jest z odczytów w oknie, a nie ze stanu końcowego |
| Reguła „priorytet 1 bez obsługi > 2 h” bez trafień | Scena biegnie w tempie 60x, więc 2 h akcji to 2 minuty zegara — próg demonstracyjny przeliczony na oś demo |

## 8. Fabric App — „Pulpit zasobów”

Aplikacja decyzyjna wdrożona przez Rayfin. Pełny opis: `fabric-app\pulpit-zasobow\README.md`.

| Element | Wartość |
|---|---|
| Adres | https://trim-cove-aca76ba030-westeurope.webapp.fabricapps.net |
| Rayfin Item ID | `2bc222c5-2486-4bc1-9330-8dcc3c6822e0` |
| Wdrożenie | `deploy-20260805072033-f25cbed1` |
| Ekrany | Sytuacja zasobowa, Kolejka wniosków, Plan przydziału, Transporty, Środki SPO-2 |
| Encje zapisu | 6 (`DemandRequest`, `ApprovalDecision`, `AllocationDecision`, `DeliveryConfirmation`, `FinancialRequestStep`, `SupplyAction`) — schemat zaaplikowany przez `rayfin up db apply --force` |
| Testy | 46 zielonych, w tym regresja KPI względem `allocation_summary.json` |

Odczyt idzie ze statycznej sceny `public/data/scene.json` (1,03 MB) budowanej przez
`tools\build_scene.py`; zapis — do encji Rayfin. Rozdzielenie warstw sprawia, że demonstracja
jest deterministyczna i działa nawet przy wstrzymanej pojemności.

**Naprawiony błąd agregacji.** Pierwsza wersja budowy sceny indeksowała plany przydziału
słownikiem po `demand_id`, przez co przy dostawach dzielonych między magazyny (167 z 420
wniosków) zostawał tylko ostatni wiersz. Scena podawała 4,31 → 1,78 h zamiast prawidłowych
**4,27 → 1,70 h**. Notatnik `03_allocation_optimizer.py` grupuje poprawnie i to on jest
źródłem prawdy; dokumentacja scenariusza była poprawna od początku. Agregacja została
powtórzona w `build_scene.py`, a dwa testy pilnują zgodności na stałe.

## 9. Kroki pozostające do wykonania

1. **Raport Power BI** — `report\REPORT_SPEC.md`; model semantyczny jest gotowy i zweryfikowany
   (35 miar zwraca wartości zgodne z `datasets\README.md`).
2. **Data Agent** — wdrożony (`agent_zasoby_logistyka`, `498ed2ee-8099-4c95-8b3d-62accc4fab7b`)
   skryptem `deploy\create_data_agent.py` z 3 źródłami (Lakehouse 21 tabel, Eventhouse 15 tabel,
   model semantyczny 21 tabel); instrukcja systemowa budowana z `ai\DATA_AGENT.md`. Publikację
   wersji roboczej do produkcyjnej wykonuje się w portalu Fabric.
3. **Powiadomienia Activatora** — reguły KQL działają; kanały powiadomień dokonfigurować w UI
   wg `activator\RULES.md`.
4. **Przeklikanie aplikacji w portalu Fabric** — potwierdzić logowanie i faktyczny zapis do
   bazy z poziomu użytkownika.
