# Model semantyczny — Rezerwy i Zasoby

Model `OL_Logistics_SemanticModel` jest klasycznym modelem gwiazdy z kilkoma faktami współdzielącymi wymiary administracyjne, zasobowe i czasowe. Celem modelu jest obsługa raportu Power BI, pytań Data Agent oraz ekranów decyzyjnych Fabric App. Dane są syntetyczne, ale struktura odpowiada docelowemu modelowi dla RCB/WCZK/ARS.

## Tabele wymiarów

| Tabela | Ziarno | Główne kolumny | Uwagi |
|---|---|---|---|
| `dim_voivodeship` | województwo | `voivodeship_code`, `voivodeship_name` | najwyższy poziom geografii. |
| `dim_powiat` | powiat | `powiat_code`, `powiat_name`, `voivodeship_code` | filtruje gminy i fakty powiatowe. |
| `dim_gmina` | gmina | `gmina_code`, `gmina_name`, `powiat_code`, `voivodeship_code`, `population` | najniższy poziom geografii zapotrzebowań. |
| `dim_resource_type` | typ zasobu | `resource_type_id`, `resource_name`, `category`, `unit`, `weight_kg`, `volume_m3` | katalog zasobów i hierarchia kategorii. |
| `dim_warehouse` | magazyn | `warehouse_id`, `warehouse_name`, `owner_type`, `voivodeship_code` | magazyny ARS/OC/PSP/WOT. |
| `dim_shelter` | punkt przyjęcia | `shelter_id`, `gmina_code`, `capacity`, `shelter_type` | punkty przyjęcia ewakuowanych. |
| `dim_transport_unit` | środek transportu | `transport_unit_id`, `transport_type`, `payload_t`, `base_warehouse_id` | flota transportowa. |
| `dim_supplier` | dostawca | `supplier_id`, `category`, `voivodeship_code`, `lead_time_h` | dostawcy ramowi. |
| `dim_date` | dzień/godzina | `date`, `datetime_hour`, `day_label`, `is_demo_day` | tabela dat utworzona w Power BI lub Lakehouse. |

## Tabele faktów

| Tabela | Ziarno | Miary podstawowe |
|---|---|---|
| `fact_stock` | magazyn × typ zasobu | `available_qty`, `reserved_qty`, `in_transit_qty` |
| `fact_demand` | pojedyncze zapotrzebowanie | `quantity`, `priority` |
| `fact_allocation` | przydział do zapotrzebowania | `allocated_qty`, `eta`, `status` |
| `fact_transport_tracking` | odczyt transportu co 5 min | `speed_kmh`, `delay_min`, `lat`, `lon` |
| `fact_shelter_occupancy` | pomiar obłożenia punktu | `occupied`, `capacity`, `medical_care_required` |
| `fact_consumption` | zużycie zasobu w punkcie i czasie | `consumed_qty` |
| `fact_road_status` | status odcinka drogi w czasie | status drogi i lokalizacja |
| `fact_financial_request` | wniosek SPO-2 | `amount_pln`, `status` |
| `coverage_analysis` | gmina dotknięta × najbliższy magazyn | `access_time_h`, `coverage_gap` |
| `allocation_plan_optimized` | rekomendowany przydział | `allocated_qty`, `travel_time_h` |
| `depletion_forecast` | województwo × zasób | `days_of_stock`, `daily_consumption` |

## Relacje i kierunki filtrowania

- `dim_voivodeship[voivodeship_code]` 1:* `dim_powiat[voivodeship_code]`, filtr jednokierunkowy.
- `dim_powiat[powiat_code]` 1:* `dim_gmina[powiat_code]`, filtr jednokierunkowy.
- `dim_gmina[gmina_code]` 1:* `fact_demand[gmina_code]`, filtr jednokierunkowy.
- `dim_resource_type[resource_type_id]` 1:* `fact_demand`, `fact_stock`, `fact_consumption`, `allocation_plan_optimized`, `depletion_forecast`.
- `dim_warehouse[warehouse_id]` 1:* `fact_stock`, `fact_allocation`, `allocation_plan_optimized`.
- `fact_demand[demand_id]` 1:* `fact_allocation[demand_id]` i 1:* `allocation_plan_optimized[demand_id]`.
- `dim_shelter[shelter_id]` 1:* `fact_shelter_occupancy[shelter_id]`.
- `dim_transport_unit[transport_unit_id]` 1:* `fact_allocation[transport_unit_id]`, jeśli transport jest zmaterializowany jako flota.
- `dim_date[datetime_hour]` 1:* tabele faktów po kolumnach czasowych zaokrąglonych do godziny; dla analiz dziennych użyj `dim_date[date]`.

Kierunek filtrowania powinien być jednokierunkowy z wymiarów do faktów. Relacje dwukierunkowe dopuszczalne są tylko w osobnych widokach analitycznych, jeśli drill-through wymaga przejścia z faktu do innego faktu przez wspólny wymiar.

## Hierarchie

- **Geografia:** `voivodeship_name` → `powiat_name` → `gmina_name`. Sortowanie po kodach: `voivodeship_code`, `powiat_code`, `gmina_code`.
- **Zasoby:** `category` → `resource_name`. Sortowanie `resource_name` po `resource_type_id`.
- **Czas demo:** `day_label` → data → godzina. `day_label` sortuj po kolumnie numerycznej `demo_day_index`, tworzonej z D0…D+10.
- **Magazyny:** `owner_type` → `warehouse_name`.

## Kolumny ukryte i sortowanie

Ukryj klucze techniczne w widokach użytkownika: `*_id`, `*_code`, `lat`, `lon`, kolumny pomocnicze sortowania, surowe timestampy techniczne i pola audit. Pozostaw je dostępne dla relacji, map i drill-through. Nazwy wyświetlane powinny być po polsku, np. `resource_name` jako „Typ zasobu”, ale nazwa kolumny technicznej pozostaje bez polskich znaków.

Kolumny tekstowe sortuj kodami technicznymi: województwo po `voivodeship_code`, powiat po `powiat_code`, gmina po `gmina_code`, zasób po `resource_type_id`, status finansowy po kolejności workflow.

## Tryb przechowywania

- **Direct Lake:** wymiary, `fact_stock`, `fact_financial_request`, `coverage_analysis`, `allocation_plan_optimized`, `depletion_forecast`. To daje szybkie raportowanie bez importu i dobrze pasuje do Lakehouse/Delta.
- **Import:** małe tabele pomocnicze, `dim_date`, słowniki statusów, tabele agregacji do demo. Import stabilizuje prezentację i minimalizuje opóźnienia wizualizacji.
- **DirectQuery / KQL:** strumienie `fact_transport_tracking`, `fact_shelter_occupancy`, `fact_demand` w widokach real-time. Dla raportu zarządczego używaj agregatów lub materializowanych widoków KQL, aby nie skanować pełnej telemetrii.

## Agregacje

Zalecane agregacje: dzienne zużycie per `voivodeship_code` i `resource_type_id`; bieżące obłożenie per `shelter_id`; ostatnia pozycja per `transport_id`; dzienny stan magazynowy per `warehouse_id` i `resource_type_id`; liczba zapotrzebowań per priorytet i dzień. Agregacje zasilają kafelki „czy wystarczy”, „punkty >90%”, „transporty opóźnione” i „SPO-2 pipeline”.
