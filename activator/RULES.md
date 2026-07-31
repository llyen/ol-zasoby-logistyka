# Reguły Data Activator

Reguły zamieniają dane w działanie. W aktualnych danych demo występuje 42 transportów z opóźnieniem >30 min, 149 punktów przyjęcia powyżej 90% pojemności, 23 kombinacje zasób/województwo z zapasem poniżej 2 dni oraz 37 wniosków SPO-2 powyżej 5 mln PLN. Reguły można wdrożyć w Activator albo jako KQL alerts.

## 1. Transport opóźniony >30 min

**Cel biznesowy:** ochrona SLA dostawy i szybkie przeplanowanie trasy.  
**Źródło danych:** `TransportTracking`, funkcja `CurrentTransportPositions()`.  
**Warunek KQL:**
```kql
CurrentTransportPositions()
| where delay_min > 30
| project transport_id, allocation_id, delay_min, eta, status, lat, lon
```
**Próg i uzasadnienie:** 30 minut, bo po tym czasie opóźnienie zaczyna wpływać na gotowość punktu przyjęcia i decyzje WCZK.  
**Odbiorca:** WCZK, ARS, kierowca.  
**Treść powiadomienia:** „Transport {transport_id} opóźniony o {delay_min} min. Sprawdź trasę i potwierdź nowe ETA.”  
**Rekomendowana akcja:** przeliczyć trasę, poinformować odbiorcę, przy zasobie krytycznym eskalować do ARS.  
**SPO:** SPO-12 obieg informacji.

## 2. Punkt przyjęcia >90% pojemności

**Cel biznesowy:** zapobieganie przepełnieniu i utracie jakości opieki nad ewakuowanymi.  
**Źródło danych:** `ShelterOccupancy`, funkcja `CurrentShelterOccupancy()`.  
**Warunek KQL:**
```kql
CurrentShelterOccupancy()
| where occupancy_pct > 0.9
| project shelter_id, occupied, capacity, occupancy_pct, medical_care_required
```
**Próg i uzasadnienie:** 90% zostawia bufor dla osób już w drodze i dla segregacji medycznej.  
**Odbiorca:** wojewoda, WCZK, pomoc społeczna.  
**Treść powiadomienia:** „Punkt {shelter_id} przekroczył 90% pojemności. Uruchom relokację lub dodatkowe zasoby.”  
**Rekomendowana akcja:** otworzyć punkt zapasowy, dosłać łóżka, koce, wodę i opiekę medyczną.  
**SPO:** SPO-12 oraz ochrona ludności.

## 3. Zapas zasobu krytycznego <2 dni

**Cel biznesowy:** wczesne uruchomienie rezerw strategicznych albo dostawcy ramowego.  
**Źródło danych:** `depletion_forecast` / `DepletionForecast`.  
**Warunek KQL:**
```kql
DepletionForecast
| where days_of_stock < 2
| project voivodeship_code, resource_type_id, available_qty, daily_consumption, days_of_stock, recommendation
```
**Próg i uzasadnienie:** 2 dni, bo przerzut między województwami, przygotowanie magazynu i zamówienia ramowe wymagają czasu.  
**Odbiorca:** ARS, RCB, wojewoda.  
**Treść powiadomienia:** „Zapas {resource_type_id} w woj. {voivodeship_code} wynosi {days_of_stock} dnia. Wymagana decyzja.”  
**Rekomendowana akcja:** uruchomić rezerwy strategiczne lub dostawcę ramowego.  
**SPO:** SPO-2, jeśli wymagane są dodatkowe środki.

## 4. Zapotrzebowanie priorytetu 1 nieobsłużone >2h

**Cel biznesowy:** ochrona życia i ciągłości krytycznych usług.  
**Źródło danych:** `Demand` + `Allocation`.  
**Warunek KQL:**
```kql
Demand
| where priority == 1 and timestamp < ago(2h)
| join kind=leftouter Allocation on demand_id
| where isempty(allocation_id) or status !in ("accepted", "in_transit", "delivered")
| project demand_id, timestamp, gmina_code, resource_type_id, quantity, priority
```
**Próg i uzasadnienie:** 2 godziny, bo priorytet 1 powinien być widoczny na poziomie wojewody/RCB natychmiast.  
**Odbiorca:** RCB, wojewoda.  
**Treść powiadomienia:** „Zapotrzebowanie P1 {demand_id} czeka ponad 2h bez obsługi.”  
**Rekomendowana akcja:** eskalować i wymusić decyzję przydziału albo odmowę z uzasadnieniem.  
**SPO:** SPO-12.

## 5. Droga na trasie transportu nieprzejezdna

**Cel biznesowy:** uniknięcie utknięcia transportu i błędnego ETA.  
**Źródło danych:** `RoadStatus`.  
**Warunek KQL:**
```kql
RoadStatus
| summarize arg_max(timestamp, *) by road_segment_id
| where status == "nieprzejezdna"
| project road_segment_id, road_name, reason, voivodeship_code, lat, lon, timestamp
```
**Próg i uzasadnienie:** status `nieprzejezdna` wymaga zmiany trasy, środka transportu albo decyzji o moście pontonowym.  
**Odbiorca:** WCZK, kierowca, PSP, ARS.  
**Treść powiadomienia:** „Odcinek {road_name} jest nieprzejezdny z powodu {reason}. Przelicz trasę.”  
**Rekomendowana akcja:** przeliczyć ETA, rozważyć amfibie, śmigłowiec lub most pontonowy.  
**SPO:** SPO-12.

## 6. Przekroczenie limitu finansowego SPO-2

**Cel biznesowy:** kontrola ścieżki akceptacji i budżetu.  
**Źródło danych:** `FinancialRequest`.  
**Warunek KQL:**
```kql
FinancialRequest
| where amount_pln > 5000000 and status !in ("MF_approved", "paid")
| project financial_request_id, timestamp, applicant, voivodeship_code, amount_pln, purpose, status, approval_path
```
**Próg i uzasadnienie:** 5 mln PLN jako próg demonstracyjny wymagający dodatkowej kontroli RZZK/MF.  
**Odbiorca:** wojewoda, RCB, MF.  
**Treść powiadomienia:** „Wniosek SPO-2 {financial_request_id} przekracza limit i wymaga akceptacji.”  
**Rekomendowana akcja:** uzupełnić uzasadnienie, powiązać z zapotrzebowaniami i skierować do RZZK/MF.  
**SPO:** SPO-2.

## 7. Nagły wzrost zapotrzebowań +50% w 6h

**Cel biznesowy:** wykrycie zmiany dynamiki powodzi i potrzeby what-if.  
**Źródło danych:** `Demand`.  
**Warunek KQL:**
```kql
Demand
| summarize cnt=count() by voivodeship_code, bin(timestamp, 6h)
| serialize
| extend prev_cnt=prev(cnt), prev_voivodeship=prev(voivodeship_code)
| where voivodeship_code == prev_voivodeship and cnt > prev_cnt * 1.5
```
**Próg i uzasadnienie:** 50% w 6h oznacza, że fala albo ewakuacja przyspieszyła.  
**Odbiorca:** RCB, wojewoda, ARS.  
**Treść powiadomienia:** „Zapotrzebowania wzrosły o ponad 50% w 6h w woj. {voivodeship_code}.”  
**Rekomendowana akcja:** uruchomić scenariusz what-if i przygotować rezerwy.  
**SPO:** SPO-12 / SPO-2.

## Zasady operacyjne

Każdy alert musi mieć właściciela, suppress window i link do rekordu w Fabric App. Alert nie powinien być tylko informacją — powinien prowadzić do akcji: eskalacji, zmiany trasy, uruchomienia rezerw, relokacji albo SPO-2.
