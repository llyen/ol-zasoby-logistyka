# Fabric App — „Rezerwy i Zasoby — Wniosek i Przydział”

> Wdrożona aplikacja nosi nazwę techniczną `pulpit-zasobow` — adres, identyfikatory i stan
> wdrożenia są w `DEPLOYMENT_STATUS.md` (sekcja 8), a opis implementacji w
> `fabric-app\pulpit-zasobow\README.md`. Ten dokument jest specyfikacją funkcjonalną,
> względem której weryfikuje się wygenerowaną aplikację.

Aplikacja operatorska jest kluczowym elementem demo. Raport i dashboard pokazują sytuację, ale aplikacja pozwala działać: złożyć wniosek, zaakceptować go, eskalować, zatwierdzić rekomendację optymalizatora, śledzić transport, potwierdzić odbiór i uruchomić SPO-2. Dane są syntetyczne, ale proces jest zbudowany wokół poziomów reagowania gmina → powiat → wojewoda → minister → RZZK.

## Role i zakres danych

| Rola | Zakres widoczności | Główne akcje |
|---|---|---|
| `wojt` / `burmistrz` | własna gmina | złożenie wniosku, uzupełnienie, potwierdzenie odbioru. |
| `starosta` | powiat | konsolidacja, komentarz, przekazanie do wojewody. |
| `wojewoda` / `WCZK` | województwo | akceptacja, odrzucenie, eskalacja. |
| `RCB` | kraj | priorytetyzacja, rekomendacja dla RZZK, monitoring. |
| `ARS` | kraj i magazyny | wydanie rezerw, modyfikacja planu, dostawcy. |
| `kierowca` | przypisany transport | aktualizacja statusu i potwierdzenie dostawy. |

## Ekran 1 — Złożenie zapotrzebowania

**Cel:** pozwolić gminie lub powiatowi złożyć ustandaryzowany wniosek o zasób bez telefonu i arkusza.  
**Użytkownik:** `wojt`, `burmistrz`, `starosta`.  
**Źródła danych:** `dim_gmina(gmina_code, gmina_name, powiat_code, voivodeship_code, population)`, `dim_resource_type(resource_type_id, resource_name, unit, category, setup_time_h)`, zapis do `demand_requests` i docelowo `fact_demand`.

**Wireframe:**

```text
+--------------------------------------------------------------+
| Zlozenie zapotrzebowania                                     |
| Gmina [select]  Zasob [select]  Priorytet [1..4]             |
| Liczba osob objetych [number]  Potrzebne do [datetime]       |
| Ilosc [number]  Jednostka [auto]  Podpowiedz [button]        |
| Uzasadnienie [textarea]                                      |
| [Zapisz szkic] [Zloz wniosek] [Zalacz dokument]              |
+--------------------------------------------------------------+
```

**Pola i walidacje:** `gmina_code` wymagane i zgodne z `dim_gmina`; `resource_type_id` wymagane; `quantity` >0; `priority` 1–4; dla priority 1 wymagane `justification` min. 20 znaków i `affected_people`; `needed_by` nie może być wcześniejsze niż timestamp wniosku. Podpowiedź ilości: woda = osoby * 3 l/dzień przeliczona na palety, łóżka = osoby bez zakwaterowania, koce = osoby * 1.2, agregaty = punkty bez zasilania.

**Akcje i write-back:** `save_draft`, `submit_request`, `attach_file_demo`. Zapis do `demand_requests`: `request_id`, `timestamp`, `gmina_code`, `resource_type_id`, `quantity`, `priority`, `justification`, `affected_people`, `status=submitted`, `reported_by`. Audit do `audit_log`.

**Przejścia:** po `submit_request` rekord trafia do Ekranu 2. Priorytet 1 wysyła powiadomienie Teams do WCZK.  
**Uprawnienia:** gmina widzi tylko własne wnioski, starosta widzi powiat.  
**Obsługa błędów:** brak sieci → zapis lokalny `pending_sync`; brak słownika zasobu → blokada zapisu; konflikt wersji → komunikat i odświeżenie.

## Ekran 2 — Kolejka wniosków WCZK

**Cel:** dać wojewodzie i WCZK kontrolę nad akceptacją, odrzuceniem i eskalacją.  
**Użytkownik:** `wojewoda`, `WCZK`, `starosta`.  
**Źródła danych:** `fact_demand`, `demand_requests`, `dim_gmina`, `dim_powiat`, `fact_allocation`.

**Wireframe:**

```text
+--------------------------------------------------------------+
| Kolejka WCZK                                                  |
| Filtry: wojewodztwo | powiat | priorytet | status | czas     |
| Lista: demand_id | gmina | zasob | ilosc | priority | age     |
| Panel: uzasadnienie, historia, stany lokalne, rekomendacja   |
| [Akceptuj] [Odrzuc] [Prosba o info] [Eskalui wyzej]          |
+--------------------------------------------------------------+
```

**Pola i walidacje:** `decision` wymagane; `rejection_reason` wymagany przy odrzuceniu; `escalation_reason` wymagany przy eskalacji; `decision_level` = powiat/wojewoda/minister/RZZK; `status` zmienia się tylko według dozwolonego workflow.

**Akcje i write-back:** `approve_request`, `reject_request`, `request_info`, `escalate_request`. Zapis do `approval_decisions`: `decision_id`, `request_id`, `decision`, `decision_level`, `reason`, `decided_by`, `timestamp`. Eskalacja z powodu „brak sił i środków” tworzy powiadomienie do RCB.

**Przejścia:** zaakceptowany wniosek idzie do Ekranu 3; odrzucony wraca do gminy z uzasadnieniem; eskalowany pojawia się u RCB/ARS.  
**Uprawnienia:** wojewoda widzi tylko województwo, RCB cały kraj.  
**Powiadomienia:** P1 >2h bez obsługi → alert; eskalacja → RCB; odrzucenie → wójt/starosta.

## Ekran 3 — Pulpit przydziału RCB/ARS

**Cel:** pokazać rekomendację optimizer i umożliwić akceptację lub ręczną zmianę.  
**Użytkownik:** `RCB`, `ARS`, obserwator RZZK.  
**Źródła danych:** `allocation_plan_optimized(demand_id, warehouse_id, allocated_qty, travel_time_h)`, `allocation_plan_fifo`, `fact_stock`, `dim_warehouse`, `dim_resource_type`, `fact_demand`.

**Wireframe:**

```text
+--------------------------------------------------------------+
| Pulpit RCB/ARS                                                |
| KPI: FIFO 4.27h -> Opt 1.70h | oszczednosc 2.57h | P1 100%   |
| Tabela rekomendacji: demand | magazyn | zasob | qty | ETA     |
| Panel ograniczen: stany, drogi, priorytet, alternatywy        |
| [Akceptuj plan] [Zmien recznie] [Podziel dostawe] [ARS]       |
+--------------------------------------------------------------+
```

**Pola i walidacje:** `warehouse_id` musi istnieć i mieć stan; `allocated_qty` <= `available_qty`; `manual_override_reason` wymagany przy ręcznej zmianie; `transport_unit_id` wymagany przed wysyłką; `eta` wymagane i większe od timestamp decyzji.

**Akcje i write-back:** `accept_plan`, `manual_edit`, `split_shipment`, `activate_reserves`, `order_supplier`. Zapis do `allocation_decisions`: `allocation_decision_id`, `demand_id`, `warehouse_id`, `allocated_qty`, `transport_unit_id`, `eta`, `manual_override`, `approved_by`. Zmiana ręczna zapisuje różnicę względem rekomendacji.

**Przejścia:** zaakceptowany plan tworzy transport na Ekranie 4. `activate_reserves` prowadzi do Ekranu 6 i ewentualnie Ekranu 5 SPO-2.  
**Uprawnienia:** tylko RCB/ARS może zatwierdzić plan krajowy; wojewoda może zatwierdzać własny poziom, jeśli zasoby są wojewódzkie.  
**Powiadomienia:** akceptacja planu → kierowca i odbiorca; ręczna zmiana → audit i RCB.

## Ekran 4 — Śledzenie transportów i potwierdzenie odbioru

**Cel:** monitorować transport i zamknąć pętlę dostawy.  
**Użytkownik:** `kierowca`, `ARS`, `wojt`, `WCZK`.  
**Źródła danych:** `fact_transport_tracking(transport_id, lat, lon, speed_kmh, eta, status, delay_min)`, `fact_allocation`, `dim_transport_unit`.

**Wireframe:**

```text
+--------------------------------------------------------------+
| Mapa transportow                                              |
| Mapa: pinezki statusow | Lista: delay | ETA | zasob          |
| Panel transportu: kierowca, allocation_id, trasa, opoznienie |
| [Zglos opoznienie] [Zmien status] [Potwierdz odbior]          |
+--------------------------------------------------------------+
```

**Pola i walidacje:** `transport_id` wymagany; `status` w planned/accepted/in_transit/delivered/delayed; `delay_min` >=0; `receiver_signature` wymagany przy odbiorze; `received_qty` <= allocated qty.

**Akcje i write-back:** `update_transport_status`, `report_delay`, `confirm_delivery`. Zapis do `delivery_confirmations`: `confirmation_id`, `transport_id`, `receiver_name_demo`, `received_qty`, `signature_hash`, `timestamp`, `lat`, `lon`. Opóźnienie >30 min uruchamia powiadomienie.

**Przejścia:** dostarczony transport aktualizuje zapotrzebowanie i raport realizacji.  
**Tryb offline:** kierowca może zapisać potwierdzenie lokalnie i zsynchronizować po odzyskaniu sieci.

## Ekran 5 — Wniosek o środki finansowe SPO-2

**Cel:** powiązać decyzję logistyczną z finansowaniem dodatkowym.  
**Użytkownik:** `wojewoda`, `RCB`, `minister`, `MF`.  
**Źródła danych:** `fact_financial_request(financial_request_id, amount_pln, purpose, status, approval_path)`, `financial_requests_writeback`, `fact_demand`.

**Wireframe:**

```text
+--------------------------------------------------------------+
| SPO-2 Uruchomienie dodatkowych srodkow                       |
| Kwota [PLN] | Cel [select] | Wojewodztwo | Powiazane demand |
| Uzasadnienie | Sciezka: wojewoda > minister > RZZK > MF       |
| [Zapisz] [Przekaz dalej] [Zatwierdz] [Odrzuc]                |
+--------------------------------------------------------------+
```

**Pola i walidacje:** `amount_pln` >0; powyżej 5 mln wymagany etap RZZK/MF; `purpose` ze słownika; `linked_demands` wymagane; `justification` wymagane; status zgodny ze ścieżką.

**Akcje i write-back:** `create_financial_request`, `approve_financial_step`, `reject_financial_step`. Zapis do `financial_requests_writeback` i `approval_decisions`. Alert przy przekroczeniu limitu.

## Ekran 6 — Pulpit decydenta „czy wystarczy?”

**Cel:** odpowiedzieć, czy zasoby wystarczą i co trzeba uruchomić.  
**Użytkownik:** `dyrektor RCB`, `wojewoda`, `ARS`.  
**Źródła danych:** `depletion_forecast`, `coverage_analysis`, `allocation_summary`, `fact_shelter_occupancy`, `fact_stock`.

**Wireframe:**

```text
+--------------------------------------------------------------+
| Czy wystarczy?                                                |
| KPI: days_of_stock | gaps | P1 SLA | shelters >90 | SPO-2    |
| Lista rekomendacji: zasob | wojewodztwo | dni zapasu | akcja  |
| [Uruchom rezerwy] [Zamow u dostawcy] [Utworz SPO-2]          |
+--------------------------------------------------------------+
```

**Pola i walidacje:** `days_of_stock` tylko do odczytu; `recommendation_action` wymagane przy brakach <2 dni; `decision_comment` wymagany; `linked_financial_request_id` opcjonalny.

**Akcje i write-back:** `activate_reserves`, `order_supplier`, `create_spo2_request`, `send_decision_note`. Każda akcja tworzy audyt i powiadomienie.

## Model tabel write-back

| Tabela | Ziarno | Kluczowe kolumny |
|---|---|---|
| `demand_requests` | jeden formularz | `request_id`, `gmina_code`, `resource_type_id`, `quantity`, `priority`, `status`. |
| `approval_decisions` | jedna decyzja workflow | `decision_id`, `request_id`, `decision_level`, `decision`, `reason`, `decided_by`, `timestamp`. |
| `allocation_decisions` | jedna decyzja przydziału | `allocation_decision_id`, `demand_id`, `warehouse_id`, `allocated_qty`, `transport_unit_id`, `eta`, `manual_override`. |
| `delivery_confirmations` | potwierdzenie odbioru | `confirmation_id`, `transport_id`, `received_qty`, `signature_hash`, `timestamp`, `lat`, `lon`. |
| `financial_requests_writeback` | wniosek SPO-2 | `financial_request_id`, `amount_pln`, `purpose`, `linked_demands`, `approval_path`, `status`. |
| `audit_log` | każda zmiana | `audit_id`, `entity`, `entity_id`, `action`, `old_value`, `new_value`, `user_role`, `timestamp`. |

## Obsługa błędów i tryb offline

Brak sieci zapisuje rekordy jako `pending_sync`. Konflikt wersji pokazuje różnice i wymaga potwierdzenia. Brak zasobu blokuje akceptację i proponuje eskalację, rezerwy strategiczne albo dostawcę. Dane niepełne oznaczane są `data_quality_warning`. Tryb offline musi działać przynajmniej dla Ekranu 1 i Ekranu 4, bo gmina i kierowca mogą pracować bez stabilnej łączności.
