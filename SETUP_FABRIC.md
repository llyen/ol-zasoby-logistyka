# Setup Fabric — Rezerwy i Zasoby

Przewodnik odtworzenia kompletnego demo w Microsoft Fabric. Opisuje środowisko, które **jest
wdrożone i zweryfikowane** — nazwy elementów, identyfikatory i zaobserwowane liczby znajdziesz
w `DEPLOYMENT_STATUS.md`. Ten dokument mówi, *jak* je zbudować i *co* powinno wyjść.

Wdrożenie jest zautomatyzowane skryptami z katalogu `deploy\`. Ręcznej pracy w portalu wymagają
tylko trzy rzeczy, których Fabric API nie udostępnia: publikacja Data Agenta, kanały powiadomień
Activatora i wygenerowanie aplikacji Rayfin. Każdy krok jest oznaczony **[skrypt]** albo
**[portal]**.

Przepływ odpowiada docelowej architekturze: Lakehouse dla danych wsadowych, Eventstream
i Eventhouse dla zdarzeń, notatniki dla analiz, Power BI dla warstwy decyzyjnej, Activator dla
alertów, Data Agent dla pytań naturalnych i Fabric App dla write-back.

## Nazwy elementów Fabric

| Element | Nazwa |
|---|---|
| Workspace | `OL-ZK-Demo-Zasoby` |
| Lakehouse | `OL_LOG_Lakehouse` |
| Eventhouse | `OL_LOG_Eventhouse` |
| KQL Database | `OL_LOG_Eventhouse` (baza nosi nazwę Eventhouse'u) |
| Eventstream | `es_log_transport` |
| Semantic model | `OL_LOG_SemanticModel` |
| Report | `OL_LOG_Raport` |
| Real-Time Dashboard | `OL_LOG_Dashboard` |
| Activator | `OL_LOG_Activator` |
| Data Agent | `agent_zasoby_logistyka` |
| Fabric App | `pulpit-zasobow` |

## 0. Wymagania wstępne

**Cel:** przygotować stację roboczą i pojemność.

**Czynności [skrypt]:** zainstaluj Azure CLI i zaloguj się (`az login`). Uruchom
`python generate_datasets.py`, żeby mieć komplet danych źródłowych. Uruchom
`deploy\ensure_capacity.ps1` — pojemność `fcdemo` (F8) sama przechodzi w stan `Paused`
po okresie bezczynności.

**Oczekiwany rezultat:** `az account show` zwraca właściwą dzierżawę, katalog `datasets\`
zawiera CSV i JSONL, a pojemność jest w stanie `Active`. Bez tego wywołania Fabric API kończą
się błędem `CapacityNotActive`.

> **Uwaga o kodowaniu.** W PowerShell ustawiaj `$env:PYTHONIOENCODING='utf-8'` przed
> uruchamianiem skryptów Pythona, inaczej polskie znaki w komunikatach psują wyjście.

## 1. Workspace, Lakehouse i Eventhouse

**Cel:** przygotować wspólne miejsce pracy i dwie warstwy przechowywania.

**Czynności [skrypt]:** `deploy\deploy_fabric.ps1 -Step items`. Skrypt tworzy workspace
`OL-ZK-Demo-Zasoby`, przypina pojemność, zakłada Lakehouse `OL_LOG_Lakehouse` i Eventhouse
`OL_LOG_Eventhouse`, a identyfikatory zapisuje do `.fabric\deployment.json`.

**Oczekiwany rezultat:** workspace widoczny w lewym panelu Fabric, prezenter ma rolę Admin
lub Member, a `.fabric\deployment.json` zawiera `workspaceId`, `lakehouseId`, `eventhouseId`
i `kqlDatabaseId`. Przed demonstracją warto przygotować skrót do workspace.

**W portalu:** dodaj użytkowników demonstracyjnych w rolach administrator, operator aplikacji,
viewer raportu i operator KQL — role pokazują, że dostęp jest rozdzielony.

## 2. Struktury KQL

**Cel:** zbudować warstwę zapytań czasu rzeczywistego.

**Czynności [skrypt]:** `deploy\deploy_fabric.ps1 -Step kql`. Wykonuje `kql\01_create_tables.kql`
(tabele i mapowania ingestii) oraz `kql\02_update_policies.kql` (funkcje bieżącego stanu
i widoki zmaterializowane).

**Oczekiwany rezultat:** istnieją tabele `TransportTracking`, `ShelterOccupancy`, `Demand`,
`Allocation`, `RoadStatus`, `Consumption`, `StockSnapshot`, `FinancialRequest` i bufor
`RawEvents`, a także funkcje `CurrentTransportPositions()`, `CurrentShelterOccupancy()`
i `OpenPriorityDemand()`.

## 3. Załadowanie danych źródłowych

**Cel:** wypełnić obie warstwy kompletem danych scenariusza.

**Czynności [skrypt]:**

```powershell
.\deploy\deploy_fabric.ps1 -Step upload   # CSV -> Files/datasets, JSONL -> Files/streams
.\deploy\deploy_fabric.ps1 -Step ingest   # ingestia do tabel KQL
.\deploy\deploy_fabric.ps1 -Step verify   # kontrola liczności
```

**Oczekiwany rezultat:** `-Step verify` raportuje liczności zgodne z tabelą w
`DEPLOYMENT_STATUS.md`, m.in. `TransportTracking` 16 901, `Consumption` 14 300,
`ShelterOccupancy` 4 400, `dim_gmina` 2 477, `StockSnapshot` 1 200. Zakres czasu danych:
`2026-09-15` … `2026-09-26`.

## 4. Notatniki Spark

**Cel:** uruchomić analizy wsadowe w tym samym workspace.

**Czynności [skrypt]:** `deploy\import_notebooks.ps1`, a następnie `deploy\run_notebooks.ps1`.
Importowane są notatniki z `notebooks\fabric\`: `01_load_dimensions`, `01b_load_streams`,
`02_coverage_analysis`, `03_allocation_optimizer`, `04_depletion_forecast`, `05_schema_dump`.
Domyślny Lakehouse ustawiany jest automatycznie.

**Oczekiwany rezultat:** w Lakehouse pojawia się 21 tabel Delta — 8 wymiarów, 8 faktów i 5 tabel
wynikowych (`coverage_analysis`, `coverage_summary`, `allocation_plan`, `allocation_metrics`,
`depletion_forecast`). Coverage daje **226** gmin, średnio **0.97 h**, P90 **1.52 h**, zero luk
powyżej 6 h. Optimizer daje **4.27 h → 1.70 h**.

> `run_notebooks.ps1` odświeża token co 15 minut. Bez tego długi łańcuch przerywa się na
> `TokenExpired`, bo `az account get-access-token` potrafi oddać token z krótkim czasem ważności.

**Analiza what-if** działa wyłącznie lokalnie (`python notebooks\05_whatif_simulation.py` →
`datasets\derived\whatif_scenarios.csv`). Nie ma odpowiednika na Fabric, bo służy przygotowaniu
wariantów do narracji, a nie zasilaniu raportu. Miejsce `05` w workspace zajmuje `05_schema_dump`,
który zrzuca schematy tabel na potrzeby modelu semantycznego i Data Agenta.

## 5. Model semantyczny

**Cel:** zbudować warstwę miar i relacji dla raportu Power BI.

**Czynności [skrypt]:** `deploy\create_semantic_model.ps1`. Powstaje model Direct Lake
`OL_LOG_SemanticModel` — 21 tabel, 20 relacji, 35 miar, zgodnie z `semantic-model\MODEL.md`
i `semantic-model\MEASURES.md`.

**Oczekiwany rezultat:** model zawiera miary `Satisfied Demand %`, `Avg Fulfillment Time h`,
`Priority 1 SLA %`, `Days of Stock`, `Shelter Occupancy %`, `Operation Cost PLN`,
`SPO-2 Requested PLN` i pozostałe, z poprawnymi formatami (procenty, godziny, PLN, liczby
całkowite). Wartości miar zgadzają się z `datasets\README.md`.

> Direct Lake nad Lakehouse'em utworzonym przez REST API wymaga ścieżki OneLake **bez**
> `schemaName`. Użycie SQL endpointu z `dbo` kończy się błędem
> `We cannot access the source Delta table`.

## 6. Raport Power BI

**Cel:** przygotować warstwę decyzyjną dla prezentacji.

**Czynności [skrypt]:** `python deploy\create_report.py`, potem `python deploy\verify_report.py`.
Raport `OL_LOG_Raport` budowany jest wg `report\REPORT_SPEC.md`: Obraz zasobów kraju, Mapa czasów
dostępu, Zapotrzebowania i realizacja, Punkty przyjęcia, Prognoza wyczerpania, Finanse SPO-2.

**Oczekiwany rezultat:** raport ma 6 stron i filtry województwo/powiat/zasób/czas, a strona
optimizer pokazuje **4.27 h → 1.70 h**. `verify_report.py` odpytuje model i porównuje wyniki
z plikami w `datasets\derived`.

## 7. Real-Time Dashboard

**Cel:** dać dyżurnemu WCZK/RCB obraz „co wymaga reakcji teraz”.

**Czynności [skrypt]:** `deploy\create_dashboard.ps1`. Dashboard `OL_LOG_Dashboard` dostaje
5 stron i 20 kafelków z `kql\03_dashboard_queries.kql`: opóźnienia transportów, pozycje
transportów, punkty >90%, trend obłożenia, kolejka P1, wolumen zapotrzebowań, status dróg,
zużycie, funnel przydziałów, pipeline SPO-2.

**Oczekiwany rezultat:** kafelki zwracają dane po zasileniu; okno czasu ustawione jest na
15 minut, czyli krócej niż cykl odtwarzania, żeby w kadrze widać było przyrost.

## 8. Data Activator

**Cel:** zamieniać progi w powiadomienia i działania.

**Czynności [skrypt]:** `deploy\create_activator.ps1`. Tworzy funkcje KQL z `kql\04_alerts.kql`
i element `OL_LOG_Activator`.

**Czynności [portal]:** kanały powiadomień (Teams, e-mail) i odbiorców — WCZK, RCB, ARS,
kierowca, MF — konfiguruje się w UI wg `activator\RULES.md`.

**Oczekiwany rezultat:** alerty obejmują transport opóźniony >30 min, punkt przyjęcia >90%,
zapas <2 dni, priorytet 1 bez obsługi, drogę nieprzejezdną, limit finansowy i wzrost
zapotrzebowań.

> Dwie reguły wymagały przeliczenia na oś demo. „Transport opóźniony” liczy się z odczytów
> w oknie, a nie ze stanu końcowego — `delayed` nigdy nie jest ostatnim statusem, bo po dostawie
> wraca `delivered`. „Priorytet 1 bez obsługi > 2 h” ma próg przeliczony, bo scena biegnie
> w tempie 60x i 2 h akcji to 2 minuty zegara.

## 9. Data Agent

**Cel:** umożliwić pytania naturalne po polsku.

**Czynności [skrypt]:** `python deploy\create_data_agent.py`. Powstaje `agent_zasoby_logistyka`
z trzema źródłami — Lakehouse (21 tabel), Eventhouse (15 tabel), model semantyczny (21 tabel).
Instrukcja systemowa budowana jest z `ai\DATA_AGENT.md`.

**Czynności [portal]:** publikacja wersji roboczej do produkcyjnej. Fabric API nie udostępnia
tego kroku — trzeba wejść w agenta i kliknąć **Publish**.

**Oczekiwany rezultat:** agent odpowiada krótką liczbą, podaje źródło danych i przypomina,
że dane są syntetyczne. Pytania kontrolne: „Ile agregatów mamy w dolnośląskim?”, „Które punkty
przyjęcia są przepełnione?”, „Jaki jest efekt optymalizatora?”.

## 10. Eventstream

**Cel:** pokazać docelową drogę przyjmowania zdarzeń z systemów zewnętrznych.

**Czynności [skrypt]:**

```powershell
python deploy\create_eventstream.py          # topologia
python deploy\verify_eventstream.py          # test dymny end-to-end
python deploy\create_eventstream.py --keys   # connection string do zmiennych środowiskowych
```

Powstaje `es_log_transport`: jedno wejście typu custom endpoint, trzy filtry po polu `stream`
i trzy destynacje Eventhouse — `TransportTracking`, `ShelterOccupancy`, `Demand`.

**Oczekiwany rezultat:** `verify_eventstream.py` melduje 5/5 zdarzeń w każdej z trzech tabel
i zero przecieków między filtrami, po czym sprząta po sobie. Bez tego testu błędny filtr nie
daje żadnego błędu wdrożenia — po prostu po cichu gubi zdarzenia.

Symulator zasila strumień:

```powershell
$env:EVENTHUB_CONNECTION_STRING = "<z --keys>"
$env:EVENTHUB_NAME = "<z --keys>"
python simulate_realtime.py --speed 120
python simulate_realtime.py --dry-run        # bez poświadczeń, tylko podgląd
```

Tryb `--dry-run` tworzy `datasets\derived\dry_run_events_preview.jsonl` i wybiera **22 261**
zdarzeń strumieniowych z transportów, obłożenia punktów i zapotrzebowań.

## 11. Silnik demonstracji

**Cel:** pokazać ruch na dashboardzie niezależnie od pory prezentacji.

**Czynności [skrypt]:**

```powershell
.\scenario\run_scenario.ps1 -Preset ciagly -Background   # start w tle
.\scenario\run_scenario.ps1 -Stop                        # zatrzymanie
.\scenario\run_scenario.ps1 -ResetOnly                   # wyczyszczenie tabel
```

**Oczekiwany rezultat:** `scenario\replay.py` kompresuje dobę scenariusza do 24 minut zegara
i przypina oś czasu do chwili uruchomienia, więc dashboard zawsze pokazuje świeże dane.
Postęp w `scenario\_ciagly.log`. Warianty tempa opisuje `DEPLOYMENT_STATUS.md`.

> Silnik pisze wprost do Eventhouse'u, bo musi sterować osią czasu — to inna droga niż
> Eventstream z kroku 10 i warto to rozróżniać podczas demonstracji.

## 12. Fabric App / Rayfin

**Cel:** dać operatorowi aplikację z write-back.

**Czynności [portal + Rayfin]:** aplikację generuje się promptem z `fabric-app\RAYFIN_PROMPT.md`
i weryfikuje wobec `fabric-app\APP_SPEC.md`. Scenę danych buduje `tools\build_scene.py`,
a schemat encji zapisu aplikuje `rayfin up db apply --force`.

**Oczekiwany rezultat:** aplikacja `pulpit-zasobow` z pięcioma ekranami — Sytuacja zasobowa,
Kolejka wniosków, Plan przydziału, Transporty, Środki SPO-2 — i sześcioma encjami zapisu
(`DemandRequest`, `ApprovalDecision`, `AllocationDecision`, `DeliveryConfirmation`,
`FinancialRequestStep`, `SupplyAction`). Adres i identyfikatory: `DEPLOYMENT_STATUS.md`,
sekcja 8. Pełny opis: `fabric-app\pulpit-zasobow\README.md`.

Można przejść pełny scenariusz: wójt składa wniosek, wojewoda eskaluje, optimizer proponuje
plan, RCB/ARS akceptuje, transport jest na mapie, alert działa, SPO-2 zapisuje wniosek.

## Lista kontrolna „czy działa”

- [ ] Workspace `OL-ZK-Demo-Zasoby` ma pojemność w stanie `Active`.
- [ ] `.fabric\deployment.json` zawiera komplet identyfikatorów.
- [ ] `deploy_fabric.ps1 -Step verify` zwraca liczności zgodne z `DEPLOYMENT_STATUS.md`.
- [ ] `dim_gmina` ma 2 477 rekordów.
- [ ] Funkcja `CurrentTransportPositions()` zwraca dane po zasileniu.
- [ ] Lakehouse ma 21 tabel Delta.
- [ ] `coverage_summary.json` pokazuje 226 gmin i średnio 0.97 h.
- [ ] `allocation_summary.json` pokazuje 4.27 h → 1.70 h.
- [ ] `depletion_forecast.csv` zawiera rekordy z `days_of_stock < 2`.
- [ ] `verify_report.py` przechodzi bez rozbieżności.
- [ ] Raport ma 6 stron i filtry województwo/powiat/zasób/czas.
- [ ] Dashboard ma 20 kafelków KQL.
- [ ] Activator ma minimum 6 reguł i przypisanych odbiorców.
- [ ] Data Agent jest opublikowany i odpowiada na pytanie o agregaty w dolnośląskim.
- [ ] `verify_eventstream.py` melduje 5/5 zdarzeń w trzech tabelach.
- [ ] `simulate_realtime.py --dry-run` działa bez poświadczeń.
- [ ] Fabric App zapisuje rekord write-back.
- [ ] Role ograniczają widoczność danych.
- [ ] Plan B działa bez sieci (scena statyczna `public\data\scene.json`).

## Rozwiązywanie problemów

### 1. `CapacityNotActive` w trakcie wdrożenia
Pojemność `fcdemo` sama się wstrzymuje. Uruchom `deploy\ensure_capacity.ps1` i powtórz krok.

### 2. Brak danych w KQL po Eventstreamie
Sprawdź trzy rzeczy w tej kolejności. `dataType` w warunku filtra to **indeks enuma**, nie nazwa
typu (0=BigInt, 1=Float, 2=Nvarchar(max), 3=DateTime) — dla porównania tekstowego musi być `2`.
`itemId` destynacji to identyfikator **bazy KQL**, nie Eventhouse'u. Tryb `ProcessedIngestion`
mapuje pola JSON na kolumny po nazwach, więc destynację kieruje się na tabelę typowaną, nie na
bufor `RawEvents`. Uruchom `verify_eventstream.py` — pokaże, na którym odcinku ginie zdarzenie.

### 3. Pierwsze zdarzenia przepadają
Destynacja musi osiągnąć stan `Running`, zanim ruszy wysyłka. `create_eventstream.py --keys`
czeka na ten stan; przy własnym kodzie trzeba to sprawdzić samodzielnie.

### 4. Model semantyczny nie widzi tabel Delta
Direct Lake nad Lakehouse'em z REST API wymaga ścieżki OneLake bez `schemaName`. Odśwież model
po ponownym uruchomieniu notatników.

### 5. Notatnik nie widzi plików
Ustaw domyślny Lakehouse albo popraw ścieżkę. Lokalnie uruchamiaj z katalogu repo, nie
przenoś plików do katalogów tymczasowych.

### 6. Miary DAX zwracają puste wartości
Sprawdź relacje i typy dat. `fact_demand[timestamp]` i `fact_allocation[eta]` muszą być
DateTime. Kody TERYT mają być tekstem, nie liczbą tracącą zera wiodące.

### 7. Dashboard działa wolno
Używaj `arg_max` dla bieżącego stanu, filtrów czasu i preagregacji. Nie łącz całej historii
bez ograniczenia okna.

### 8. Activator wysyła za dużo powiadomień
Dodaj okno wyciszenia, grupowanie po `transport_id` albo `shelter_id` i warunek utrzymania
progu przez kilka minut.

### 9. Aplikacja nie zapisuje decyzji
Sprawdź uprawnienia zapisu, schemat encji Rayfin, pola wymagane i RLS. W trybie offline
sprawdź kolejkę `pending_sync`.

### 10. Brak poświadczeń Event Hub
To poprawne w demie lokalnym — użyj `--dry-run`. Poświadczenia trzymaj poza repo, w `.env`,
które jest ignorowane przez git.

### 11. Liczby w raporcie nie zgadzają się z README
Odśwież model semantyczny po uruchomieniu generatora i notatników. README używa aktualnych
wyników z `datasets\derived`.

### 12. Odtwarzanie przerywa się na `HTTP 520` albo `Throttled`
Oba błędy są przejściowe na F8 z aktywnymi widokami zmaterializowanymi. Pętla ponawiania
w `replay.py` obejmuje wszystkie kody 5xx, a przesunięcie osi czasu ponawiane jest do 4 razy
z rosnącym odstępem.
