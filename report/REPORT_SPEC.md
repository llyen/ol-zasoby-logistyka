# Specyfikacja raportu Power BI

Raport `OL_LOG_Raport` jest produktem decyzyjnym. Ma prowadzić rozmowę od pytania „czym dysponujemy?” do decyzji „co wysłać, gdzie i z jakim finansowaniem?”. Dane są syntetyczne, ale wartości są rzeczywiste dla wygenerowanego zbioru: 960 zapotrzebowań, 16 901 rekordów telemetrii transportów, 4 400 pomiarów obłożenia i 90 wniosków SPO-2.

## Zasady projektowe

Każda strona ma pytanie decyzyjne w tytule. Pierwszy rząd zawiera KPI, środek strony zawiera mapę albo wykres główny, a prawa strona listę działań. Czerwony oznacza przekroczenie progu wymagające działania, żółty ostrzeżenie, zielony stan akceptowalny. Wszystkie techniczne nazwy pól pozostają po angielsku, ale opisy i tytuły są po polsku.

## Strona 1 — Obraz zasobów kraju

**Cel:** pokazać zasoby kraju i natychmiast odpowiedzieć, które kategorie są krytyczne.  
**Odbiorca:** dyrektor RCB, RZZK, ARS.

**Wizualizacje:** mapa Polski według `voivodeship_code`; karta `Available Stock`; karta `Critical Stock Gaps`; stacked bar zasoby według `category`; tabela top magazynów `warehouse_id`, `warehouse_name`, `owner_type`, `available_qty`; karta SPO-2 requested PLN.

**Pola i miary:** `dim_voivodeship`, `dim_warehouse`, `fact_stock`, `dim_resource_type`, `depletion_forecast`; miary `Available Stock`, `Reserved Stock`, `In Transit Stock`, `Critical Stock Gaps`, `SPO-2 Requested PLN`.

**Filtry:** województwo, kategoria, typ zasobu, właściciel magazynu, status zapasu.  
**Interakcje:** klik województwa filtruje magazyny i luki zapasu. Drill-through do szczegółu magazynu.  
**Układ:** mapa po lewej, karty u góry, tabela magazynów po prawej, dolny pasek trendu zapasów.

## Strona 2 — Mapa czasów dostępu

**Cel:** pokazać, ile czasu zajmuje dostarczenie zasobu do gmin dotkniętych.  
**Odbiorca:** wojewoda, WCZK, RCB.

**Wizualizacje:** mapa gmin z `coverage_analysis.access_time_h`; histogram czasów; tabela najbliższych magazynów; karta średni czas 0.97 h; karta P90 1.52 h; karta luki >6h = 0.

**Pola i miary:** `gmina_code`, `gmina_name`, `nearest_warehouse_id`, `access_time_h`, `coverage_gap`; miary średni czas, P90, liczba luk.  
**Filtry:** województwo, powiat, próg czasu, magazyn.  
**Interakcje:** klik gminy pokazuje trzy najbliższe magazyny; drill-through do zapotrzebowań danej gminy.  
**Układ:** mapa pełnej szerokości, panel luki po prawej, histogram na dole.

## Strona 3 — Zapotrzebowania i realizacja

**Cel:** prowadzić rozmowę o priorytetach i o wartości optymalizacji.  
**Odbiorca:** RCB, ARS, wojewoda.

**Wizualizacje:** KPI `Demand Count` = 960; KPI `Priority 1 Demand Count` = 223; karta FIFO 4.27 h; karta optimization 1.70 h; karta oszczędność 2.57 h; waterfall FIFO vs optimizer; tabela `demand_id`, `priority`, `resource_type_id`, `quantity`, `allocated_qty`, `travel_time_h`; donut statusów alokacji.

**Pola i miary:** `fact_demand`, `fact_allocation`, `allocation_plan_optimized`, `allocation_plan_fifo`; miary `Satisfied Demand %`, `Avg Fulfillment Time h`, `Priority 1 SLA %`, `Operation Cost PLN`.

**Filtry:** priority, resource_type_id, day_label, voivodeship_code, status.  
**Interakcje:** klik zasobu filtruje plan; drill-through po `demand_id` pokazuje szczegół wniosku i przydziały.  
**Układ:** KPI u góry, porównanie optimizer w centrum, tabela szczegółów na dole.

## Strona 4 — Punkty przyjęcia

**Cel:** pokazać obłożenie, przepełnienia i potrzeby medyczne.  
**Odbiorca:** wojewoda, WCZK, pomoc społeczna, RCB.

**Wizualizacje:** mapa punktów `dim_shelter`; gauge `Shelter Occupancy %`; tabela punktów >90%; trend obłożenia po czasie; karta `Medical Care Required`; ranking punktów według occupancy.

**Pola i miary:** `shelter_id`, `capacity`, `occupied`, `medical_care_required`, `gmina_code`; miary `Shelter Occupancy %`, `Shelters Over 90 %`, `Medical Care Required`.

**Filtry:** województwo, gmina, shelter_type, dostępność dla niepełnosprawnych, threshold occupancy.  
**Interakcje:** klik punktu pokazuje historię obłożenia i zapotrzebowania w tej gminie.  
**Układ:** mapa po lewej, tabela alertów po prawej, trend i medyczne KPI na dole.

## Strona 5 — Prognoza wyczerpania

**Cel:** odpowiedzieć „czy wystarczy?” i uzasadnić rezerwy strategiczne.  
**Odbiorca:** ARS, RCB, wojewoda.

**Wizualizacje:** matrix `voivodeship_code` x `resource_type_id` z `days_of_stock`; karta krytyczne <2 dni = 23; line chart zużycia; tabela rekomendacji; slicer zasobu; karta najniższego odczytu: 0.2 dnia dla R17 w woj. 02.

**Pola i miary:** `depletion_forecast`, `fact_consumption`, `fact_stock`; miary `Days of Stock`, `Critical Stock Gaps`, `Available Stock`, `Demand Qty`.

**Filtry:** województwo, zasób, kategoria, threshold dni zapasu.  
**Interakcje:** klik czerwonej komórki prowadzi do Ekranu 6 Fabric App; drill-through do magazynów danego zasobu.  
**Układ:** matrix w centrum, rekomendacje po prawej, trend na dole.

## Strona 6 — Finanse SPO-2

**Cel:** pokazać ścieżkę dodatkowych środków finansowych i limity.  
**Odbiorca:** wojewoda, minister, RCB, MF.

**Wizualizacje:** karta suma wniosków 357 769 364 PLN; karta liczba wniosków 90; karta >5 mln = 37; funnel statusów; tabela wniosków z `financial_request_id`, `amount_pln`, `purpose`, `status`, `approval_path`; trend kwot po czasie.

**Pola i miary:** `fact_financial_request`; miary `SPO-2 Requested PLN`, `SPO-2 Over Limit Count`.  
**Filtry:** województwo, status, cel, próg kwoty, applicant.  
**Interakcje:** klik wniosku pokazuje ścieżkę akceptacji i powiązane zapotrzebowania.  
**Układ:** KPI u góry, lejek po lewej, tabela po prawej, trend na dole.

## Drill-through i tooltipy

Drill-through po `demand_id` pokazuje szczegóły wniosku, rekomendację optimizer, status przydziału i transport. Drill-through po `warehouse_id` pokazuje stany, rezerwacje, zasoby w drodze i dystans do gmin. Tooltipy muszą pokazywać źródło tabeli i timestamp ostatniego odświeżenia. W trybie decyzyjnym warto dodać tooltip „Dane syntetyczne — demo”.

## Układ mobilny

Dla telefonu przygotuj trzy widoki: opóźnione transporty, punkty >90% i priorytet 1 bez obsługi. Widok mobilny jest dla dyżurnego, nie do pełnej analizy.
