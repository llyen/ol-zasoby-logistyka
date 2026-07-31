# Prompt do Rayfin / Fabric Apps

Wygeneruj aplikację Microsoft Fabric App o nazwie **„Rezerwy i Zasoby — Wniosek i Przydział”**. Interfejs w języku polskim. Nazwy techniczne pól, tabel i akcji po angielsku bez polskich znaków. Aplikacja jest demonstratorem dla scenariusza **POWÓDŹ WRZESIEŃ**: Nysa Kłodzka/Odra, perspektywa krajowa RCB/RZZK/ARS/wojewodowie. Dane są syntetyczne i muszą być oznaczone jako demo.

## Kontekst domenowy

W kryzysie decydent pyta: czym dysponujemy, gdzie to jest, ile czasu zajmie dostarczenie i czy wystarczy. Aplikacja ma wspierać poziomy reagowania gmina → powiat → wojewoda → minister → RZZK oraz procedurę SPO-2 dla dodatkowych środków finansowych. Algorytm rekomenduje, człowiek zatwierdza.

## Dane i schematy

Lakehouse: `dim_voivodeship`, `dim_powiat`, `dim_gmina`, `dim_resource_type`, `dim_warehouse`, `dim_shelter`, `dim_transport_unit`, `dim_supplier`, `fact_stock`, `fact_financial_request`, `allocation_plan_optimized`, `coverage_analysis`, `depletion_forecast`. Eventhouse: `Demand`, `TransportTracking`, `ShelterOccupancy`, `RoadStatus`, `Allocation`, `Consumption`.

Kluczowe kolumny: `gmina_code`, `powiat_code`, `voivodeship_code`, `resource_type_id`, `warehouse_id`, `demand_id`, `allocation_id`, `transport_id`, `timestamp`, `quantity`, `priority`, `status`, `eta`, `delay_min`, `capacity`, `occupied`, `amount_pln`. Wynik optymalizacji do pokazania jako KPI: FIFO **4.27 h** → optimization **1.70 h**, oszczędność **2.57 h**, priorytet 1 **100.0%**.

## Role i bezpieczeństwo

Utwórz role `wojt`, `starosta`, `wojewoda`, `RCB`, `ARS`, `kierowca`. Gmina widzi tylko własne rekordy; powiat własny powiat; wojewoda własne województwo; RCB i ARS widzą kraj; kierowca widzi własny transport. Każda akcja zapisuje audyt.

## Ekrany

1. **Złożenie zapotrzebowania** — formularz: `gmina_code`, `resource_type_id`, `quantity`, `priority`, `justification`, `affected_people`, `needed_by`. Walidacja: ilość >0, priorytet 1 wymaga uzasadnienia, zasób musi istnieć w `dim_resource_type`. Dodaj podpowiedź ilości dla wody, łóżek, koców, agregatów i racji.
2. **Kolejka WCZK** — tabela wniosków z filtrami województwo/powiat/gmina/priority/status. Akcje: `approve`, `reject`, `request_info`, `escalate`. Przy eskalacji wymagaj powodu „brak sił i środków”.
3. **Pulpit RCB/ARS** — karta rekomendacji: `warehouse_id`, `warehouse_name`, `resource_type_id`, `allocated_qty`, `travel_time_h`, `eta`, `constraint_notes`. Przyciski: `accept_plan`, `manual_edit`, `split_shipment`, `activate_reserves`, `order_supplier`.
4. **Mapa transportów** — mapa z `TransportTracking`, kolory statusów, ETA, delay. Akcje: `report_delay`, `update_status`, `confirm_delivery` z podpisem odbiorcy.
5. **SPO-2** — formularz finansowy: `amount_pln`, `purpose`, `linked_demands`, `approval_path`, `status`. Powyżej 5 mln PLN wymagaj RZZK/MF.
6. **Pulpit decydenta „czy wystarczy?”** — KPI: `days_of_stock`, gaps, over-capacity shelters, priority1 SLA, SPO-2 amount. Dodaj rekomendacje tekstowe i przyciski decyzji.

## Write-back

Utwórz tabele Delta: `demand_requests`, `approval_decisions`, `allocation_decisions`, `delivery_confirmations`, `financial_requests_writeback`, `audit_log`. Każda akcja zapisuje `timestamp`, `user_role`, `user_id_demo`, `source_screen`, `comment`, `old_value`, `new_value`. W trybie offline zapisuj status `pending_sync`.

## UX

Styl administracji publicznej: wysoki kontrast, mało ozdobników, czytelne statusy. Banner: „Dane syntetyczne — demo, nie używać operacyjnie”. Karty KPI u góry, mapa lub tabela w centrum, panel decyzji po prawej. Każdy ekran ma `Pokaż źródło danych`, `Eksport decyzji`, `Historia`. Komunikaty po polsku, bez żargonu dla ról nietechnicznych.

## Powiadomienia

Teams/e-mail dla: priority 1, eskalacja do RCB, delay >30 min, shelter >90%, days_of_stock <2, SPO-2 > limit. Treść ma zawierać rekord, próg, rekomendowaną akcję i link do aplikacji.

## Warunki akceptacji

Aplikacja musi przejść pełny scenariusz: wójt składa wniosek, wojewoda eskaluje, RCB/ARS akceptuje rekomendację, transport pojawia się na mapie, punkt przyjęcia generuje alert, decydent uruchamia rezerwy strategiczne i tworzy SPO-2. Każda decyzja jest audytowana.

## Obsługa błędów i tryb offline

Dodaj globalny komponent statusu połączenia. Jeśli aplikacja nie ma sieci, Ekran 1 i Ekran 4 nadal działają: formularze zapisują rekordy lokalnie ze statusem `pending_sync`, a po powrocie połączenia użytkownik widzi listę rekordów do synchronizacji. Przy konflikcie wersji pokaż porównanie „wersja lokalna” i „wersja w Lakehouse” oraz wymagaj komentarza przed nadpisaniem.

Jeśli brakuje zasobu w magazynie, nie pozwalaj na ciche zatwierdzenie. Pokaż komunikat: „Brak wystarczającego stanu. Wybierz eskalację, rezerwy strategiczne albo dostawcę ramowego”. Jeśli pole słownikowe nie ładuje się, pokaż tryb read-only i przycisk ponowienia. Wszystkie błędy zapisu zapisuj do `audit_log` z `error_code`, `error_message`, `screen_name` i `correlation_id`.

## Dostępność i prezentacja demo

Interfejs ma być czytelny na projektorze: duże karty KPI, kontrastowe statusy, krótkie etykiety, brak małych ikon bez tekstu. Dodaj tryb „Demo presenter mode”, który eksponuje liczby: `4.27 h -> 1.70 h`, `2.57 h saved`, `Priority 1 = 100.0%`, `149 shelters over 90%`, `37 SPO-2 over limit`. Ten tryb nie zmienia danych, tylko pomaga prowadzić narrację.
