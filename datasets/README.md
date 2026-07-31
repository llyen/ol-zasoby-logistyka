# Datasets

> ⚠️ **Disclaimer** — wszystkie dane w katalogu `datasets/` są w 100% syntetyczne, deterministyczne (`seed=42`) i służą wyłącznie demonstracji Microsoft Fabric. Nie stanowią danych operacyjnych RCB, wojewodów, PSP, ARS ani żadnej innej instytucji. Kody TERYT są syntetyczne, a lokalizacje i wolumeny zostały wygenerowane proceduralnie.

## Konwencje plików

- Kodowanie: UTF-8.
- CSV: separator `,`, nagłówek w pierwszym wierszu.
- JSONL: jeden rekord JSON na linię.
- Daty: ISO-8601 z offsetem `+02:00`.
- Scenariusz czasowy: D0…D+10 dla zdarzeń operacyjnych, zgodnie z „POWÓDŹ WRZESIEŃ”.
- Nazwy techniczne: angielskie bez polskich znaków.

## Pełny spis plików

| Plik | Rekordy | Ziarno | Zakres czasowy | Opis |
|---|---:|---|---|---|
| `dim_voivodeship.csv` | 16 | województwo | brak osi czasu | 16 województw, kody TERYT syntetyczne |
| `dim_powiat.csv` | 380 | powiat | brak osi czasu | powiaty z lat/lon i relacją do województwa |
| `dim_gmina.csv` | 2477 | gmina | brak osi czasu | gminy z lat/lon i populacją syntetyczną |
| `dim_resource_type.csv` | 20 | typ zasobu | brak osi czasu | 20 typów zasobów, jednostki, masa, kubatura, czas rozstawienia |
| `dim_warehouse.csv` | 60 | magazyn | brak osi czasu | magazyny ARS, OC, PSP i WOT z lokalizacją |
| `dim_shelter.csv` | 400 | punkt przyjęcia | brak osi czasu | punkty przyjęcia ewakuowanych, pojemność i wyposażenie |
| `dim_transport_unit.csv` | 180 | środek transportu | available_from w osi D0…D+1 | flota z ładownością, prędkością i bazą |
| `dim_supplier.csv` | 45 | dostawca | brak osi czasu | dostawcy ramowi z kategorią, lead time i limitem |
| `fact_stock.csv` | 1200 | magazyn x typ zasobu | snapshot wejściowy | stany dostępne, zarezerwowane i w drodze |
| `fact_financial_request.csv` | 90 | wniosek SPO-2 | D0…D+10 | wnioski o dodatkowe środki, status i ścieżka akceptacji |
| `fact_demand.jsonl` | 960 | zapotrzebowanie | D0…D+10 | zapotrzebowania gmin/powiatów, priorytet 1–4 |
| `fact_allocation.jsonl` | 520 | decyzja przydziału | D0…D+10 | przydział demand → magazyn → transport → ETA |
| `fact_transport_tracking.jsonl` | 16901 | odczyt transportu | D0…D+10 | telemetria transportów co 5 min |
| `fact_shelter_occupancy.jsonl` | 4400 | pomiar obłożenia | D0…D+10 | obłożenie punktów przyjęcia w czasie |
| `fact_consumption.jsonl` | 14300 | zużycie zasobu | D0…D+10 | zużycie zasobów w punktach |
| `fact_road_status.jsonl` | 260 | status odcinka drogi | D0…D+10 | przejezdność dróg i przyczyna utrudnienia |

## Jak czytać dane

Wymiary `dim_*` są słownikami używanymi przez raport, notebooki i aplikację. Fakty `fact_*` opisują stan lub zdarzenia: zapotrzebowania, alokacje, transporty, obłożenie, zużycie, drogi i finanse SPO-2. Najważniejszym identyfikatorem biznesowym dla procesu jest `demand_id`, który łączy zgłoszenie z planem przydziału i transportem. Najważniejszym wymiarem operacyjnym jest `resource_type_id`, bo pozwala przejść od zapotrzebowania przez stan magazynu do prognozy wyczerpania.

## Zawartość `datasets/derived/`

| Plik | Opis | Kluczowe liczby używane w demo |
|---|---|---|
| `coverage_analysis.csv` | wynik analizy pokrycia dla gmin dotkniętych; najbliższe magazyny i czas dojazdu | 226 gmin, średni czas 0.97 h, P90 1.52 h, luki >6h: 0 |
| `coverage_summary.json` | zwarte podsumowanie coverage | `affected_gminas=226`, `avg_access_time_h=0.97` |
| `allocation_plan_optimized.csv` | rekomendowany plan przydziału zasobów do zapotrzebowań | plan używany w ekranie RCB/ARS |
| `allocation_plan_fifo.csv` | plan porównawczy „ręczny FIFO” | baza porównania dla optimizer |
| `allocation_summary.json` | podsumowanie optimizer vs FIFO | FIFO 4.27 h → optymalizacja 1.70 h, oszczędność 2.57 h, priorytet 1: 100.0% |
| `depletion_forecast.csv` | prognoza dni zapasu per województwo i zasób | 23 kombinacje <2 dni, minimum 0.2 dnia dla R17 w woj. 02 |
| `whatif_scenarios.csv` | scenariusze what-if | fala we Wrocławiu, A4 nieprzejezdna, zapotrzebowanie +50% |
| `dry_run_events_preview.jsonl` | próbka zdarzeń wybranych przez `simulate_realtime.py --dry-run` | symulator wybiera 22 261 zdarzeń strumieniowych |

## Liczby narracyjne

- `fact_demand.jsonl`: 960 zapotrzebowań, w tym 223 priorytetu 1.
- `fact_transport_tracking.jsonl`: 16 901 odczytów telemetrii; w danych jest 42 transportów z opóźnieniem >30 min.
- `fact_shelter_occupancy.jsonl`: 4 400 pomiarów; 149 punktów przekracza 90% pojemności.
- `fact_road_status.jsonl`: 260 statusów; 58 odcinków ma utrudnienia lub nieprzejezdność, w tym 11 nieprzejezdnych.
- `fact_financial_request.csv`: 90 wniosków SPO-2 na łączną kwotę 357 769 364 PLN, 37 powyżej 5 mln PLN.

## Odtworzenie danych

Aby odtworzyć identyczny zestaw:

```powershell
cd C:epos\OchronaLudnosci\ol-zasoby-logistyka
python generate_datasets.py
python notebooks_coverage_analysis.py
python notebooks_allocation_optimizer.py
python notebooks_depletion_forecast.py
python notebooks_whatif_simulation.py
python simulate_realtime.py --dry-run
```

Nie edytuj ręcznie plików wynikowych przed demo. Jeśli dane zostaną zregenerowane, odśwież README i dokumentację z liczbami, aby narracja nadal była spójna z plikami.
