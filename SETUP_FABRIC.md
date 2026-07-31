# Setup Fabric — Rezerwy i Zasoby

Ten przewodnik prowadzi przez konfigurację kompletnego demo w Microsoft Fabric. Używa konkretnych nazw elementów, aby środowisko można było odtworzyć i pokazać decydentowi bez dodatkowych ustaleń. Dane są syntetyczne, ale przepływ odpowiada docelowemu wdrożeniu: Lakehouse dla danych wsadowych, Eventstream i Eventhouse dla zdarzeń, Notebooki dla analiz, Power BI dla warstwy decyzyjnej, Activator dla alertów, Data Agent dla pytań naturalnych i Fabric App dla write-back.

## Nazwy elementów Fabric

| Element | Nazwa |
|---|---|
| Workspace | `OL_Logistics_Demo_WS` |
| Lakehouse | `OL_Logistics_Lakehouse` |
| Eventhouse | `OL_Logistics_Eventhouse` |
| KQL Database | `OL_Logistics_KQL` |
| Eventstream | `OL_Logistics_Eventstream` |
| Semantic model | `OL_Logistics_SemanticModel` |
| Report | `OL_Logistics_Command_Report` |
| Real-Time Dashboard | `OL_Logistics_RTD` |
| Activator | `OL_Logistics_Activator` |
| Data Agent | `OL_Logistics_Data_Agent` |
| Fabric App | `Rezerwy i Zasoby — Wniosek i Przydział` |

## 1. Utworzenie workspace

**Cel:** przygotować wspólne miejsce pracy dla wszystkich elementów Fabric.

**Czynności:** w portalu Fabric wybierz Workspaces → New workspace. Nazwij workspace `OL_Logistics_Demo_WS`. Przypisz capacity F2 lub wyższą. Dodaj grupy lub użytkowników demonstracyjnych: administrator, operator aplikacji, viewer raportu, operator KQL. Włącz ustawienia pozwalające na tworzenie Lakehouse, Eventhouse, Data Activator i Fabric Apps.

**Oczekiwany rezultat:** workspace jest widoczny w lewym panelu Fabric, a prezenter ma rolę Admin albo Member. Warto przygotować skrót do workspace przed wejściem na salę.

## 2. Utworzenie Lakehouse

**Cel:** przechowywać wymiary, stany, finanse SPO-2 i wyniki notebooków.

**Czynności:** w workspace utwórz Lakehouse `OL_Logistics_Lakehouse`. Wgraj pliki z katalogu `datasets\`: CSV i JSONL. Wgraj też `datasets\derived\`: `coverage_analysis.csv`, `allocation_plan_optimized.csv`, `allocation_plan_fifo.csv`, `depletion_forecast.csv`, `whatif_scenarios.csv`. Jeśli pokazujesz docelową architekturę, skonwertuj pliki CSV do Delta tables o nazwach bez rozszerzeń.

**Oczekiwany rezultat:** w Lakehouse Files widać pliki, a w Tables można utworzyć tabele `dim_*`, `fact_*` i `derived_*`. W modelu danych mamy 2 477 gmin, 380 powiatów, 60 magazynów, 400 punktów przyjęcia i 1 200 rekordów stanów magazynowych.

## 3. Utworzenie Eventhouse i KQL Database

**Cel:** zbudować warstwę zapytań czasu rzeczywistego.

**Czynności:** w workspace utwórz Eventhouse `OL_Logistics_Eventhouse`, a w nim bazę KQL `OL_Logistics_KQL`. Otwórz Queryset. Uruchom najpierw `kql\01_create_tables.kql`, potem `kql\02_update_policies.kql`.

**Oczekiwany rezultat:** istnieją tabele `TransportTracking`, `ShelterOccupancy`, `Demand`, `Allocation`, `RoadStatus`, `Consumption` i `RawEvents`. Istnieją funkcje `CurrentTransportPositions()`, `CurrentShelterOccupancy()` oraz `OpenPriorityDemand()`.

## 4. Konfiguracja Eventstream z custom endpoint

**Cel:** przyjmować strumienie transportów, obłożenia punktów i zapotrzebowań.

**Czynności:** utwórz Eventstream `OL_Logistics_Eventstream`. Dodaj źródło Custom App albo Azure Event Hub. Skopiuj connection string do bezpiecznego miejsca poza repo. Skonfiguruj wyjście do KQL Database `OL_Logistics_KQL` i mapowanie do tabel. Dla demo lokalnego nie używaj poświadczeń — uruchom `python simulate_realtime.py --dry-run`.

**Oczekiwany rezultat:** Eventstream ma aktywne wejście i wyjście. Tryb dry-run tworzy `datasets\derived\dry_run_events_preview.jsonl` i wybiera 22 261 zdarzeń strumieniowych z transportów, obłożenia i zapotrzebowań.

## 5. Import notebooków

**Cel:** uruchomić analizy wsadowe w tym samym workspace.

**Czynności:** importuj pliki z katalogu `notebooks\` jako Fabric Notebooks: `01_load_dimensions.py`, `02_coverage_analysis.py`, `03_allocation_optimizer.py`, `04_depletion_forecast.py`, `05_whatif_simulation.py`. Ustaw default Lakehouse na `OL_Logistics_Lakehouse`. Jeżeli notebooki uruchamiasz lokalnie, pracuj z katalogu `C:\repos\OchronaLudnosci\ol-zasoby-logistyka`.

**Oczekiwany rezultat:** notebooki widzą pliki i zapisują wyniki w `datasets\derived`. Coverage daje 226 gmin, średni czas 0.97 h, P90 1.52 h. Optimizer daje 4.27 h → 1.70 h.

## 6. Uruchomienie notebooka coverage

**Cel:** przygotować mapę czasów dostępu i luki pokrycia.

**Czynności:** uruchom `02_coverage_analysis.py`. Sprawdź pliki `coverage_analysis.csv` i `coverage_summary.json`.

**Oczekiwany rezultat:** `coverage_summary.json` pokazuje `affected_gminas = 226`, `avg_access_time_h = 0.97`, `p90_access_time_h = 1.52`, `coverage_gaps_gt_6h = 0`. Te liczby wpisz do narracji demo.

## 7. Uruchomienie optimizer

**Cel:** policzyć plan przydziału i porównać go z FIFO.

**Czynności:** uruchom `03_allocation_optimizer.py`. Sprawdź `allocation_plan_optimized.csv`, `allocation_plan_fifo.csv` i `allocation_summary.json`.

**Oczekiwany rezultat:** `allocation_summary.json` pokazuje FIFO 4.27 h, optymalizację 1.70 h, oszczędność 2.57 h i priorytet 1 obsłużony w 100.0%. To główny argument biznesowy demo.

## 8. Uruchomienie forecast i what-if

**Cel:** przygotować decyzję o rezerwach strategicznych, dostawcach ramowych i SPO-2.

**Czynności:** uruchom `04_depletion_forecast.py` oraz `05_whatif_simulation.py`. Wgraj wyniki do Lakehouse jako `depletion_forecast` i `whatif_scenarios`.

**Oczekiwany rezultat:** prognoza pokazuje 23 kombinacje zasób/województwo poniżej 2 dni zapasu. Najniższy odczyt to 0.2 dnia dla R17 w województwie 02.

## 9. Model semantyczny

**Cel:** stworzyć warstwę miar i relacji dla raportu Power BI.

**Czynności:** utwórz semantic model `OL_Logistics_SemanticModel`. Dodaj relacje opisane w `semantic-model\MODEL.md`. Wklej miary z `semantic-model\MEASURES.md`. Sprawdź formaty: procenty, godziny, PLN i liczby całkowite.

**Oczekiwany rezultat:** model ma miary `Satisfied Demand %`, `Avg Fulfillment Time h`, `Priority 1 SLA %`, `Days of Stock`, `Shelter Occupancy %`, `Operation Cost PLN`, `SPO-2 Requested PLN` i inne.

## 10. Raport Power BI

**Cel:** przygotować warstwę decyzyjną dla prezentacji.

**Czynności:** utwórz raport `OL_Logistics_Command_Report` według `report\REPORT_SPEC.md`. Zbuduj strony: Obraz zasobów kraju, Mapa czasów dostępu, Zapotrzebowania i realizacja, Punkty przyjęcia, Prognoza wyczerpania, Finanse SPO-2.

**Oczekiwany rezultat:** raport prowadzi narrację od sytuacji kraju do konkretnej decyzji. Strona optimizer pokazuje 4.27 h → 1.70 h.

## 11. Real-Time Dashboard

**Cel:** dać dyżurnemu WCZK/RCB obraz „co wymaga reakcji teraz”.

**Czynności:** utwórz dashboard `OL_Logistics_RTD`. Dodaj kafelki z `kql\03_dashboard_queries.kql`: opóźnienia transportów, pozycje transportów, punkty >90%, trend obłożenia, kolejka P1, wolumen zapotrzebowań, status dróg, zużycie, funnel przydziałów, SPO-2 pipeline.

**Oczekiwany rezultat:** dashboard ma minimum 10 kafelków i potrafi zasilić opowieść o alertach.

## 12. Data Activator

**Cel:** zamieniać progi w powiadomienia i działania.

**Czynności:** utwórz Activator `OL_Logistics_Activator`. Skonfiguruj reguły z `activator\RULES.md` i zapytania z `kql\04_alerts.kql`. Odbiorcy: WCZK, RCB, ARS, kierowca, MF zależnie od reguły.

**Oczekiwany rezultat:** alerty obejmują transport >30 min, punkt >90%, zapas <2 dni, P1 >2h bez obsługi, drogę nieprzejezdną, limit finansowy i wzrost zapotrzebowań.

## 13. Data Agent

**Cel:** umożliwić pytania naturalne po polsku.

**Czynności:** utwórz Data Agent `OL_Logistics_Data_Agent`. Wklej instrukcje z `ai\DATA_AGENT.md`. Udostępnij tabele Lakehouse i Eventhouse. Przetestuj pytania: „Ile agregatów mamy w dolnośląskim?”, „Które punkty są przepełnione?”, „Jaki jest efekt optymalizatora?”.

**Oczekiwany rezultat:** agent odpowiada krótką liczbą, podaje źródło danych i przypomina, że dane są syntetyczne.

## 14. Fabric App / Rayfin

**Cel:** utworzyć aplikację operatorską z write-back.

**Czynności:** użyj `fabric-app\RAYFIN_PROMPT.md`. Zweryfikuj wygenerowaną aplikację z `fabric-app\APP_SPEC.md`. Połącz źródła Lakehouse i Eventhouse. Utwórz write-back tables: `demand_requests`, `approval_decisions`, `allocation_decisions`, `delivery_confirmations`, `financial_requests_writeback`, `audit_log`.

**Oczekiwany rezultat:** można przejść pełny scenariusz: wójt składa wniosek, wojewoda eskaluje, RCB/ARS akceptuje rekomendację, transport jest na mapie, alert działa, SPO-2 zapisuje wniosek.

## Lista kontrolna „czy działa”

- [ ] Workspace `OL_Logistics_Demo_WS` ma aktywną capacity.
- [ ] Lakehouse zawiera wszystkie pliki CSV/JSONL i derived.
- [ ] `dim_gmina` ma 2 477 rekordów.
- [ ] KQL Database ma tabele po `01_create_tables.kql`.
- [ ] Funkcja `CurrentTransportPositions()` zwraca dane po zasileniu.
- [ ] `simulate_realtime.py --dry-run` działa bez poświadczeń.
- [ ] `coverage_summary.json` pokazuje 226 gmin i średnio 0.97 h.
- [ ] `allocation_summary.json` pokazuje 4.27 h → 1.70 h.
- [ ] `depletion_forecast.csv` zawiera rekordy z `days_of_stock < 2`.
- [ ] Raport ma 6 stron i filtry województwo/powiat/zasób/czas.
- [ ] Dashboard ma minimum 10 kafelków KQL.
- [ ] Activator ma minimum 6 reguł i odbiorców.
- [ ] Data Agent odpowiada na pytanie o agregaty w dolnośląskim.
- [ ] Fabric App zapisuje rekord write-back.
- [ ] Role ograniczają widoczność danych.
- [ ] Plan B działa bez sieci.

## Rozwiązywanie problemów

### 1. Brak danych w KQL
Sprawdź mapping JSON i nazwę tabeli docelowej w Eventstream. Najpierw uruchom `--dry-run`, potem małą paczkę zdarzeń. Zweryfikuj, czy timestamp jest parsowany jako datetime.

### 2. Notebook nie widzi plików
Ustaw default Lakehouse albo popraw ścieżkę. Lokalnie uruchamiaj z katalogu repo. Nie przenoś plików do katalogów tymczasowych.

### 3. Miary DAX zwracają puste wartości
Sprawdź relacje i typy dat. `fact_demand[timestamp]` i `fact_allocation[eta]` muszą być DateTime. Kody TERYT powinny być tekstem, nie liczbą tracącą zera wiodące.

### 4. Dashboard działa wolno
Używaj funkcji `arg_max` dla bieżącego stanu, filtrów czasu i preagregacji. Nie rób joinów na całej historii bez ograniczenia.

### 5. Activator wysyła za dużo powiadomień
Dodaj suppress window, grupowanie po `transport_id` albo `shelter_id` i warunek utrzymania progu przez kilka minut.

### 6. Aplikacja nie zapisuje decyzji
Sprawdź uprawnienia write do Lakehouse, schemat tabel write-back, wymagane pola i blokady RLS. W trybie offline sprawdź kolejkę `pending_sync`.

### 7. Brak poświadczeń Event Hub
To poprawne w lokalnym demo. Użyj `--dry-run`. Poświadczenia trzymaj poza repo, np. w `.env`, które jest ignorowane przez git.

### 8. Liczby w raporcie nie zgadzają się z README
Odśwież semantic model po uruchomieniu generatora i notebooków. README używa aktualnych wyników z `datasets/derived`.
