# Pulpit zasobów — aplikacja Fabric

Aplikacja decyzyjna dla scenariusza logistyki kryzysowej. Prowadzi użytkownika przez pełną
ścieżkę: od wniosku gminy o zasób, przez akceptację i przydział, po transport, potwierdzenie
odbioru i wniosek o dodatkowe środki.

## Wdrożenie

| Element | Wartość |
|---|---|
| Adres | https://trim-cove-aca76ba030-westeurope.webapp.fabricapps.net |
| Rayfin Item ID | `2bc222c5-2486-4bc1-9330-8dcc3c6822e0` |
| Workspace | `aebf1df2-3be8-4f89-9d8d-647ae519d50b` (OL-ZK-Demo-Zasoby) |
| Pojemność | `fcdemo` (F8, West Europe, `rg-fabric-cap-demo`) |
| Dzierżawa | `7ada8cf4-c4be-488f-a844-6d37ee64849e` |

```powershell
az resource show -g rg-fabric-cap-demo -n fcdemo --resource-type Microsoft.Fabric/capacities --query properties.state -o tsv
# jesli "Paused":
az resource invoke-action -g rg-fabric-cap-demo -n fcdemo --resource-type Microsoft.Fabric/capacities --action resume

npx rayfin login -t 7ada8cf4-c4be-488f-a844-6d37ee64849e
npx rayfin up -y
npx rayfin up db apply --force
```

## Architektura danych

Aplikacja ma dwie rozdzielne warstwy.

**Odczyt — scena statyczna.** `tools/build_scene.py` czyta `datasets/raw` i `datasets/derived`,
po czym generuje jeden plik `public/data/scene.json` (1,03 MB). Aplikacja pobiera go raz przy
starcie. Dzięki temu demonstracja jest deterministyczna, działa bez pojemności Fabric i nie
obciąża Lakehouse przy każdym kliknięciu. Scena obejmuje 12 dób (D0 = 2026-09-15), 960 wniosków,
520 przydziałów i transportów, 60 magazynów, 226 gmin.

**Zapis — sześć encji Rayfin.** `DemandRequest`, `ApprovalDecision`, `AllocationDecision`,
`DeliveryConfirmation`, `FinancialRequestStep`, `SupplyAction`. Żadna z nich nie ma akcji
`delete`: wycofanie wniosku to zmiana statusu, a korekta decyzji to nowy wiersz. Ścieżka
gmina → powiat → wojewoda → minister → RZZK musi dać się odtworzyć co do kroku.

Bez skonfigurowanego backendu zapisy trafiają do pamięci przeglądarki, więc aplikację da się
pokazać także offline — sygnalizuje to pasek nad treścią.

## Ekrany

| Ekran | Co pokazuje | Decyzja użytkownika |
|---|---|---|
| Sytuacja zasobowa | 8 wskaźników krajowych, mapa otwartych wniosków, prognoza wyczerpania zapasu, panel „Czy wystarczy?” | uruchomienie rezerw, zamówienie u dostawcy, przerzut |
| Kolejka wniosków | wnioski wg priorytetu i czasu oczekiwania, wyróżnione złamania SLA | akceptacja, odrzucenie, prośba o informacje, eskalacja; złożenie nowego wniosku |
| Plan przydziału | rekomendacja optymalizatora obok wyniku reguły „kto pierwszy” | zatwierdzenie planu albo korekta ręczna z uzasadnieniem |
| Transporty | trasy na mapie, opóźnienia względem ETA | potwierdzenie odbioru, zgłoszenie niedoboru |
| Środki SPO-2 | wnioski finansowe i ich ścieżka akceptacji | kolejny krok ścieżki |

## Mapa

Mapa (`src/components/CountryMap.tsx`) rysuje granice 16 województw i pozwala ją
przeglądać: kółko myszy lub gest szczypania przybliża w miejscu kursora, przeciągnięcie
przesuwa, dwuklik przybliża dwukrotnie, przyciski w rogu i klawisze `+`, `−`, `0` oraz
strzałki robią to samo z klawiatury. Maksymalne przybliżenie to 14×. Znaczniki, trasy
i napisy są dzielone przez współczynnik przybliżenia, więc na ekranie zachowują stałą
wielkość — przybliża się mapa, a nie symbole. Skala barw jest wstrzykiwana (`colorFor`),
bo ta sama mapa służy raz do priorytetów wniosków, raz do opóźnień transportów.

Granice pochodzą z [polska-geojson](https://github.com/ppatrzyk/polska-geojson) (dane GUS,
licencja MIT). `tools/build_poland_geo.py` upraszcza je z 76 881 do 6 960 wierzchołków
i **wstępnie rzutuje** na tę samą siatkę 0..100, której używa `project` w `model.ts`,
zapisując wynik do `src/data/poland.ts` (83 kB). Dzięki temu warstwa granic i warstwa
punktów zawsze się pokrywają, a przeglądarka nie liczy rzutu przy każdej klatce.

**Trzy miejsca muszą mieć identyczne `BOUNDS`**: `model.ts`, `CountryMap.tsx` i
`build_poland_geo.py`. Rozjazd przesunie punkty względem granic — to jedyny sposób,
w jaki ta mapa może zepsuć się po cichu.

### Dlaczego nie Azure Maps

Azure Maps wymagałby klucza subskrypcji wkompilowanego w paczkę przeglądarki. Rayfin jest
wyłącznie warstwą danych (Data API Builder) i nie ma funkcji serwerowych, więc nie da się
bezpiecznie wydać tokenu, a kluczy Azure Maps nie można ograniczyć do domeny — każdy widz
demonstracji mógłby generować koszty. Mapa własna nie ma sekretów, kosztów ani zależności
sieciowych i działa przy wstrzymanej pojemności.

## Role i uprawnienia

Reguły są w `src/services/workflow.ts` (funkcja `canActOn` i walidatory), nie w komponentach —
dzięki temu da się je sprawdzić testem.

| Rola | Zakres | Ograniczenia |
|---|---|---|
| wójt / burmistrz | własna gmina | nie akceptuje własnych wniosków, nie przydziela zasobów |
| starosta | powiat (4 pierwsze znaki kodu gminy) | nie przydziela zasobów |
| WCZK, wojewoda | województwo | mogą przydzielać zasoby |
| RCB / ARS | kraj | jedyna rola uprawniona do uruchomienia rezerw strategicznych |
| kierowca | własny transport | wyłącznie potwierdzenie odbioru |

Wybrane twarde walidacje: priorytet 1 wymaga uzasadnienia od 20 znaków i liczby osób zagrożonych;
odebrana ilość nie może przekroczyć przydzielonej, a niedobór wymaga przyczyny; odejście od
rekomendacji optymalizatora wymaga uzasadnienia; kwota powyżej 5 mln zł nie może zamknąć się na
szczeblu wojewody.

## Kluczowe liczby

Wskaźnik demonstracji: optymalizator skraca średni czas dojazdu z **4,27 h do 1,70 h**, czyli o
**2,57 h na dostawę**, na **420 porównywalnych wnioskach** (368 szybszych, 43 wolniejszych,
łącznie 1077,7 h). Wartości pochodzą ze sceny i są zgodne z `datasets/derived/allocation_summary.json`
co do drugiego miejsca po przecinku — pilnuje tego test regresyjny.

## Napotkane problemy i rozstrzygnięcia

| Problem | Rozstrzygnięcie |
|---|---|
| Plany FIFO i optimized obejmują **różne zbiory wniosków** | Średnie liczone wyłącznie na parach obecnych w obu planach. Wnioski występujące tylko u optymalizatora są pokazane osobno, nie wchodzą do średnich. |
| Pierwsza wersja `build_scene.py` brała **ostatni wiersz** przydziału na wniosek | Błąd: 167 z 420 wniosków ma dostawę dzieloną między magazyny, więc konstrukcja `{r["demand_id"]: r for r in rows}` po cichu gubiła pozostałe wiersze. Scena pokazywała 4,31 → 1,78 h zamiast 4,27 → 1,70 h. Naprawione przez agregację po `demand_id` (ilość sumowana, czas uśredniany) — tak samo jak w notatniku `03_allocation_optimizer.py`. Test `KPI zgadza się z allocation_summary.json` blokuje nawrót. Dokumentacja scenariusza była poprawna od początku. |
| `depletion_forecast.csv` ma `days_of_stock` = 999 w większości wierszy | Plik jest w tym zakresie bezużyteczny — zużycie występuje tylko w województwach dotkniętych. Scena liczy zapas samodzielnie, narastająco: `pozostało = dostępne − skumulowane zużycie`. |
| Mapa z COP-24 była wpięta na sztywno w skalę barw indeksu KIS | `CountryMap` przyjmuje teraz `colorFor` i `legend` jako właściwości oraz `paths` do rysowania tras. W tej aplikacji mapa służy raz do priorytetów wniosków, raz do opóźnień transportów — to dwie różne skale. **Przy kolejnych scenariuszach kopiować `ui.tsx` stąd, nie z COP-24.** |
| Scena nie zawiera macierzy odległości dla wszystkich par magazyn–gmina | Przy ręcznej korekcie przydziału czas dojazdu z innego magazynu jest szacowany proporcjonalnie do odległości geograficznej względem magazynu rekomendowanego. Dla demonstracji liczy się kierunek i rząd wielkości zmiany, nie precyzja co do minuty — nie jest to liczba do cytowania. |
| Po naniesieniu prawdziwych granic część punktów wypadła **poza krajem** | `generate_datasets.py` rozrzuca punkty losowym odchyleniem wokół środka województwa, bez sprawdzania granic: 6 gmin, 3 magazyny i 28 punktów przyjęcia lądowało poza Polską, a 82 z 226 gmin w cudzym województwie. `build_scene.py` przyciąga je do własnego województwa **wyłącznie w warstwie prezentacji** — zbiory źródłowe, `derived/`, notatniki i model semantyczny zostają nietknięte, więc wskaźniki się nie zmieniają. Mediana przesunięcia: 24 km dla gmin (fikcyjnych, nie tych 15 nazwanych), 9 km dla magazynów. |
| Zaokrąglanie współrzędnych do dwóch miejsc (~1 km) przenosiło punkt przygraniczny na drugą stronę granicy | Współrzędne mają teraz trzy miejsca (~100 m), a poprawność jest sprawdzana na wartości **już zaokrąglonej** — tej, która faktycznie trafia na mapę. Granice do sprawdzania są odtwarzane z tych samych zaokrąglonych liczb, z których powstaje kontur w `poland.ts`. |
| Przyciągnięcie do granicy nie zawsze trafiało do środka województwa | Przy kształtach wklęsłych (Lubuskie, Pomorskie) jedno zanurzenie nie wystarcza — przyciąganie zwiększa je kolejno 6% → 12% → 25% → 50%, aż punkt naprawdę znajdzie się wewnątrz. |
| Trasy transportów rozjeżdżały się ze znacznikami po korekcie | Trasa w zbiorze źródłowym to interpolacja magazyn → gmina. Skoro obie końcówki mogły zostać przesunięte, przebieg jest odtwarzany z poprawionych końcówek, z zachowaniem postępu każdego odczytu. |

## Uwaga o danych

**Otwarte wnioski narastają do końca scenariusza.** Alokacje kończą się 2026-09-22, a wnioski
płyną do 2026-09-26, więc zaległość rośnie monotonicznie. Narracyjnie to działa (presja narasta,
system nie nadąża bez decyzji o rezerwach), ale jest to konsekwencja zakresu wygenerowanych
danych, nie zjawisko naturalne. Warto o tym wiedzieć przed prezentacją.

## Rozwój lokalny

```powershell
npm install
python tools\build_poland_geo.py   # tylko raz - granice wojewodztw
python tools\build_scene.py        # regeneracja sceny po zmianie datasets/
npm run dev                        # aplikacja z backendem Rayfin
npm run test                       # 52 testy regresyjne
npm run lint
npx vite build
```

Testy czytają `public/data/scene.json` bezpośrednio z dysku, bez środowiska przeglądarki, więc
regeneracja sceny natychmiast ujawnia rozjazd z dokumentacją.

Trzy ostrzeżenia `react-refresh/only-export-components` są dziedziczone z szablonu Rayfin i
dotyczą plików eksportujących zarówno komponent, jak i hook. Nie wpływają na działanie.
