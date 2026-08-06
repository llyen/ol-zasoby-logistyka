# Demo Script — 15–20 min

> Scenariusz prowadzenia demo przed decydentem. Dane są syntetyczne, ale liczby pochodzą z aktualnych plików `datasets/` i `datasets/derived/`. Scenariusz: **POWÓDŹ WRZESIEŃ**, Z02 Powódź, dorzecze Odry i Nysy Kłodzkiej, perspektywa krajowa RCB / RZZK / Agencji Rezerw Strategicznych / wojewodów.

## Obsada ról

- **Prezenter** — prowadzi narrację, wyjaśnia kontekst prawny i biznesowy, przełącza ekrany.
- **„Wójt gminy Kłodzko”** — składa pierwsze zapotrzebowanie na agregaty, wodę, łóżka polowe, koce i leki/opatrunki.
- **„Wojewoda dolnośląski”** — akceptuje i eskaluje wniosek, gdy poziom lokalny nie ma sił i środków.
- **„Dyrektor RCB”** — patrzy na obraz kraju, porównuje ryzyka, przygotowuje rekomendację na poziom RZZK.
- **„Agencja Rezerw Strategicznych”** — zatwierdza wydanie rezerw, widzi magazyny i plan transportu.
- **„Kierowca / operator logistyczny”** — aktualizuje status transportu i potwierdza dostarczenie.

## Liczby, które muszą paść

- Wygenerowano **960** zapotrzebowań i **16 901** rekordów telemetrii transportów.
- W modelu jest **2 477** gmin, **380** powiatów, **60** magazynów i **400** punktów przyjęcia.
- W całej osi D0…D+10 występują **223** zapotrzebowania priorytetu 1.
- Analiza pokrycia obejmuje **226** gmin, średni czas do najbliższego magazynu to **0.97 h**, P90 to **1.52 h**.
- Optymalizator skraca średni czas dostawy z **4.27 h** (FIFO) do **1.70 h**, czyli o **2.57 h**.
- W próbie optymalizacyjnej priorytet 1 ma **100.0%** obsługi.
- W danych jest **42** transportów z opóźnieniem >30 min, maksymalne opóźnienie to **89 min**.
- W danych jest **149** punktów przyjęcia powyżej 90% pojemności.
- Wnioski SPO-2: **90** rekordów, suma **357 769 364 PLN**, **37** wniosków powyżej 5 mln PLN.

## Co otworzyć przed demem

Wszystko żyje w workspace `OL-ZK-Demo-Zasoby` (adresy i identyfikatory: `DEPLOYMENT_STATUS.md`).

| Zakładka | Element | Rola w narracji |
|---|---|---|
| 1 | Fabric App `pulpit-zasobow` | akty I–IV i VI — tu klikamy |
| 2 | Real-Time Dashboard `OL_LOG_Dashboard` | akt IV i V — obraz dyżurnego |
| 3 | Raport `OL_LOG_Raport` | tło liczbowe i plan B |
| 4 | Data Agent `agent_zasoby_logistyka` | akt VII — pytanie po polsku |

Na 30 minut przed demonstracją uruchom silnik odtwarzania — bez niego dashboard pokazuje dane
sprzed miesięcy zamiast bieżącego ruchu:

```powershell
.\deploy\ensure_capacity.ps1
.\scenario\run_scenario.ps1 -Preset ciagly -Background
```

---

## Akt I. Sytuacja i pierwsze zapotrzebowania

**Obsada:** prezenter oraz „wójt gminy Kłodzko”.  
**Ekran:** Fabric App `pulpit-zasobow`, ekran **Kolejka wniosków** → przycisk złożenia nowego wniosku.  
**Co kliknąć:** wybierz `gmina_code` dla Kłodzka, zasób `agregaty_pradotworcze`, wpisz ilość, priorytet 1, uzasadnienie „brak zasilania w punkcie przyjęcia i pompowni”, liczba osób objętych działaniem. Następnie przełącz zasób na `woda_butelkowana` i pokaż automatyczną podpowiedź ilości.

**Kwestia do wypowiedzenia:**  
„Jesteśmy w D0 scenariusza POWÓDŹ WRZESIEŃ. Na poziomie gminy pojawiają się pierwsze skutki: przerwy w zasilaniu, ewakuacja mieszkańców i presja na punkty przyjęcia. Wójt nie dzwoni już do kilku magazynów i nie wysyła arkuszy — składa jeden ustandaryzowany wniosek, który od razu trafia do wspólnego obrazu województwa i kraju.”

**Co widz zobaczy:** formularz z listą zasobów z `dim_resource_type.csv`, walidacją priorytetu i podpowiedzią ilości. Widz powinien zobaczyć, że aplikacja nie jest „ładnym formularzem”, tylko punktem wejścia do całego procesu decyzyjnego. W nagłówku musi być widoczny disclaimer „Dane syntetyczne — demo”.

**Jakie liczby padną:** „W modelu mamy 20 typów zasobów, 60 magazynów i 400 punktów przyjęcia. W dolnośląskich magazynach jest 844 agregatów prądotwórczych oraz 10 112 palet wody butelkowanej. To nadal nie odpowiada na pytanie, czy wystarczy — dlatego przejdziemy do eskalacji i optymalizacji.”

---

## Akt II. Eskalacja gmina → powiat → wojewoda

**Obsada:** wójt, starosta jako kontekst procesu, wojewoda dolnośląski.  
**Ekran:** Fabric App, ekran **Kolejka wniosków**.  
**Co kliknąć:** filtr `priority = 1`, filtr `status = submitted`, sortowanie po wieku wniosku. Otwórz szczegóły wniosku i kliknij `escalate`, powód „brak sił i środków na poziomie powiatu”. Zwróć uwagę na wyróżnione złamania SLA — priorytet 1 wymaga uzasadnienia od 20 znaków i liczby osób zagrożonych, więc wniosek nie przejdzie „na skróty”.

**Kwestia do wypowiedzenia:**  
„To jest moment przewidziany w systemie zarządzania kryzysowego. Gmina i powiat wykorzystały lokalne zasoby, ale skala powodzi przekracza ich możliwości. Wojewoda nie tylko widzi wniosek — widzi też, czy lokalne magazyny mają stany, jaki jest priorytet, kto zgłosił potrzebę i jak długo wniosek czeka.”

**Co widz zobaczy:** kolejkę wniosków z priorytetami 1–4, czasem oczekiwania, zasobem, gminą i uzasadnieniem. Po kliknięciu `escalate` status zmienia się i wniosek jest widoczny dla poziomu krajowego. W panelu bocznym pojawia się historia decyzji.

**Jakie liczby padną:** „W całym zbiorze mamy 960 zapotrzebowań, z czego 223 to priorytet 1. To są sprawy, których nie chcemy zgubić między telefonem a arkuszem. Dlatego każdy wniosek ma identyfikator, timestamp i ścieżkę decyzji.”

---

## Akt III. Optymalizator proponuje plan przydziału

**Obsada:** dyrektor RCB i Agencja Rezerw Strategicznych.  
**Ekran:** Fabric App, ekran **Plan przydziału**, oraz raport Power BI `OL_LOG_Raport`, strona „Zapotrzebowania i realizacja”.  
**Co kliknąć:** porównanie rekomendacji optymalizatora z wynikiem reguły „kto pierwszy”, filtr `priority = 1`, otwórz wiersz rekomendacji: magazyn, zasób, ilość, ETA. Pokaż, że odejście od rekomendacji wymaga uzasadnienia.

**Kwestia do wypowiedzenia:**  
„Teraz dochodzimy do serca demo. Ręczny tryb FIFO jest zrozumiały, ale w kryzysie nie zawsze najlepszy: pierwszy wniosek nie musi być najbliższy magazynowi, a droga może być utrudniona. Optimizer patrzy na dostępność, priorytet, czas, przejezdność i magazyn, a następnie proponuje plan. Wynik jest konkretny: średni czas dostawy spada z 4.27 h do 1.70 h.”

**Co widz zobaczy:** porównanie planu FIFO i planu optymalizacyjnego, listę przydziałów z magazynu do zapotrzebowania, ETA i status. Najważniejsze jest pokazanie, że algorytm nie ukrywa wyniku — prezentuje go jako propozycję do akceptacji.

**Jakie liczby padną:** „Oszczędzamy średnio 2.57 h na dostawie. W próbie optymalizacyjnej obsłużono 420 zapotrzebowań, a priorytet 1 osiąga 100.0% obsługi. W planie dla dolnośląskich zgłoszeń 2 002 agregaty mieszczą się w czasie do 6 godzin według wyniku optymalizatora.”

---

## Akt IV. Akceptacja decyzji i transporty na mapie

**Obsada:** ARS, dyrektor RCB, kierowca/operator logistyczny.  
**Ekran:** Fabric App, ekran **Transporty**, oraz Real-Time Dashboard `OL_LOG_Dashboard`, kafelek „Current transport positions”.  
**Co kliknąć:** w rekomendacji zatwierdź plan, przejdź na mapę transportów, filtr `status = in_transit OR delayed`, kliknij transport z największym `delay_min`. Mapę można przybliżać kółkiem myszy, przesuwać przeciągnięciem i wyzerować klawiszem `0`.

**Kwestia do wypowiedzenia:**  
„To jest kluczowy element zaufania: człowiek zatwierdza rekomendację, a decyzja zapisuje się w historii. Od tego momentu nie rozmawiamy o planie w abstrakcji — transport jest widoczny na mapie, ma ETA, status i opóźnienie. Jeśli kierowca zgłosi przeszkodę, dyżurny widzi ją natychmiast.”

**Co widz zobaczy:** mapę z transportami, statusami `in_transit`, `delayed`, `delivered`, opóźnienie i ETA. Po kliknięciu transportu panel szczegółów pokazuje `transport_id`, `allocation_id`, prędkość i rekomendowaną akcję.

**Jakie liczby padną:** „W strumieniu mamy 16 901 rekordów telemetrycznych transportów. W danych jest 42 transportów z opóźnieniem powyżej 30 minut, a maksymalne opóźnienie to 89 minut. To jest typ zdarzenia, które powinno automatycznie trafić do WCZK i ARS.”

---

## Akt V. Alert o przepełnionym punkcie przyjęcia

**Obsada:** wojewoda dolnośląski, WCZK, prezenter.  
**Ekran:** Real-Time Dashboard kafelek „Shelters above 90% capacity” oraz `activator/RULES.md`.  
**Co kliknąć:** filtr `occupancy_pct > 90%`, otwórz szczegóły punktu, pokaż liczbę zajętych miejsc i osoby wymagające opieki medycznej. Następnie pokaż regułę Activator `Punkt przyjęcia >90%`.

**Kwestia do wypowiedzenia:**  
„Kryzys logistyczny nie kończy się na wydaniu agregatu. Jeśli punkt przyjęcia zapełnia się powyżej 90%, wojewoda musi wiedzieć, czy uruchomić kolejny punkt, wysłać łóżka, koce, wodę albo opiekę medyczną. Tu alert nie jest czerwonym kafelkiem dla samego kafelka — prowadzi do decyzji.”

**Co widz zobaczy:** listę punktów przyjęcia powyżej 90%, mapę i rekomendację akcji. Warto pokazać, że alert ma odbiorcę, próg, uzasadnienie i powiązane SPO.

**Jakie liczby padną:** „W danych mamy 400 punktów przyjęcia i 4 400 pomiarów obłożenia. 149 punktów przekracza 90% pojemności, a maksymalne obłożenie w danych osiąga 100%. To jest sygnał do relokacji i dosłania zasobów.”

---

## Akt VI. Prognoza wyczerpania i decyzja o uruchomieniu rezerw strategicznych + SPO-2

**Obsada:** dyrektor RCB, ARS, wojewoda, opcjonalnie minister/MF jako głos decyzyjny.  
**Ekran:** Fabric App, ekran **Sytuacja zasobowa** (panel „Czy wystarczy?” i prognoza wyczerpania), następnie ekran **Środki SPO-2**; w tle raport, strona „Prognoza wyczerpania”.  
**Co kliknąć:** filtr `days_of_stock < 2`, zasób krytyczny, potem uruchomienie rezerw — to jedyna akcja zastrzeżona wyłącznie dla roli RCB/ARS. Następnie przejdź do SPO-2, wpisz kwotę i pokaż ścieżkę `wojewoda > minister_wiodacy > RZZK > MF`. Kwota powyżej 5 mln zł nie może zamknąć się na szczeblu wojewody.

**Kwestia do wypowiedzenia:**  
„Ostatni akt odpowiada na pytanie, które decydent zada zawsze: czy wystarczy. Jeśli prognoza pokazuje mniej niż 2 dni zapasu, sama informacja nie wystarcza — potrzebna jest decyzja o rezerwach strategicznych albo dostawcach ramowych i, jeśli trzeba, uruchomienie SPO-2. W tej aplikacji finanse nie są dokumentem tworzonym po spotkaniu; są elementem tej samej decyzji.”

**Co widz zobaczy:** tabelę `depletion_forecast.csv`, rekomendację `uruchomic_rezerwy_strategiczne_lub_umowe_ramowa`, wniosek finansowy i ścieżkę akceptacji. Warto pokazać limit finansowy jako regułę Activator.

**Jakie liczby padną:** „W prognozie mamy 23 kombinacje zasób/województwo z zapasem poniżej 2 dni. Najniższy odczyt to 0.2 dnia dla zasobu R17 w województwie 02. W SPO-2 mamy 90 wniosków na łączną kwotę 357 769 364 PLN, w tym 37 powyżej 5 mln PLN.”

---

---

## Akt VII (opcjonalny, 2 min). Pytanie zadane po polsku

**Obsada:** dyrektor RCB albo osoba z sali.  
**Ekran:** Data Agent `agent_zasoby_logistyka`.  
**Co kliknąć:** zadaj pytanie wprost, najlepiej takie, które przyjdzie z sali. Sprawdzone:
„Ile agregatów prądotwórczych mamy w dolnośląskim?”, „Które punkty przyjęcia są przepełnione?”,
„Jaki jest efekt optymalizatora?”.

**Kwestia do wypowiedzenia:**  
„Do tej pory pokazywałem ekrany przygotowane wcześniej. Teraz zadam pytanie, którego nikt nie
przygotował. Agent ma dostęp do tych samych trzech warstw co raport — Lakehouse, Eventhouse
i modelu semantycznego — więc odpowiada z danych, a nie z modelu językowego. To jest różnica
między asystentem, który zgaduje, a takim, który liczy.”

**Co widz zobaczy:** krótką odpowiedź liczbową ze wskazaniem źródła i przypomnieniem, że dane
są syntetyczne. Warto pokazać, że agent potrafi też powiedzieć „nie mam takich danych” — to
buduje zaufanie mocniej niż odpowiedź na każde pytanie.

---

## Wow moments

1. **Jedno pytanie, jeden obraz kraju.** Decydent widzi magazyny, zapotrzebowania, punkty przyjęcia, transporty i finanse razem. To działa, bo odpowiada na problem „arkusze + telefony”.
2. **Twarda liczba optymalizacji: 4.27 h → 1.70 h.** To nie jest ogólny slajd o AI, tylko mierzalna poprawa czasu dostarczenia pomocy o 2.57 h.
3. **Human-in-the-loop.** System proponuje, ale RCB/ARS akceptuje. To działa na decydenta, bo nie odbiera kompetencji, tylko skraca przygotowanie decyzji.
4. **Alert z akcją.** Punkt >90% pojemności prowadzi do relokacji i dodatkowych zasobów. To pokazuje, że dashboard nie jest bierny.
5. **SPO-2 w tym samym procesie.** Decyzja finansowa jest powiązana z brakami zasobów i prognozą, więc łatwiej uzasadnić kwotę i ścieżkę akceptacji.
6. **Pytanie z sali, odpowiedź z danych.** Data Agent odpowiada po polsku na pytanie, którego nikt nie przygotował, korzystając z tych samych źródeł co raport.

## Wartość biznesowa

- **Czas dostarczenia pomocy:** skrócenie średniego czasu z 4.27 h do 1.70 h oznacza, że pomoc przyjeżdża średnio o 2.57 h szybciej. W powodzi to może oznaczać uruchomienie zasilania punktu przyjęcia przed nocą albo szybszą dostawę wody.
- **Liczba objętych osób:** unikalne gminy z zapotrzebowaniami obejmują syntetyczną populację 7 931 435 osób. To nie znaczy, że tyle osób jest ewakuowanych; to skala obszaru decyzyjnego.
- **Koszt operacji:** roboczy koszt planu optymalizacyjnego, liczony jako ilość * masa * 0.45, wynosi około 32 467 865 PLN. W produkcji ta miara byłaby zastąpiona taryfami transportu i kosztami umów.
- **Ryzyko:** 42 opóźnione transporty, 11 odcinków nieprzejezdnych, 149 punktów >90% i 23 krytyczne braki zapasu to sygnały, które wymagają aktywnego zarządzania.
- **Zgodność z ustawą o ZK:** narracja zachowuje poziomy reagowania i pokazuje eskalację przy braku sił i środków. SPO-2 jest jawnie włączone do procesu finansowania.

## Plan B

### Awaria aplikacji
Pokaż raport Power BI oraz pliki `fabric-app/APP_SPEC.md` i `fabric-app/RAYFIN_PROMPT.md`. Powiedz: „Aplikacja jest warstwą operatorską, ale dane, rekomendacja i proces są nadal widoczne. Decyzję można zaprezentować z raportu i zapisać po przywróceniu aplikacji”.

### Brak sieci
Uruchom `python simulate_realtime.py --dry-run`. Pokaż `datasets/derived/dry_run_events_preview.jsonl`. Powiedz: „Tryb offline pokazuje strukturę zdarzeń i pozwala prowadzić demo bez poświadczeń. W produkcji aplikacja kolejkowałaby zapisy lokalnie”.

### Brak odświeżenia danych
Pokaż `datasets/derived/allocation_summary.json`, `coverage_summary.json` i `depletion_forecast.csv`. Powiedz: „W rzeczywistym wdrożeniu każdy kafelek ma last refresh i confidence score. Decydent widzi, czy pracuje na danych bieżących czy ostatnio zatwierdzonych”.

### Błąd dashboardu KQL
Przejdź na raport Power BI i otwórz `kql/03_dashboard_queries.kql`. Pokaż, że zapytania są jawne i można je uruchomić w Queryset. Najważniejsze liczby są zapisane w derived.

## Najczęstsze pytania decydenta i odpowiedzi

1. **Skąd pochodzą dane?** W demo są syntetyczne. W produkcji źródłami byłyby systemy ARS, PSP, WOT, WCZK, samorządowe formularze, dostawcy ramowi i systemy finansowe.
2. **Czy to zastępuje istniejące systemy?** Nie. To warstwa integracji, analityki i decyzji nad systemami dziedzinowymi.
3. **Kto podejmuje decyzję — człowiek czy algorytm?** Człowiek. Optimizer rekomenduje, ale decyzja jest akceptowana przez uprawnioną rolę i zapisywana w audycie.
4. **Co jeśli dane są niepełne?** System powinien pokazać last refresh, confidence score i pozwolić na ręczną korektę z komentarzem.
5. **Jak wygląda bezpieczeństwo?** RBAC per rola i obszar, etykiety Purview, audyt, brak sekretów w repo, konfiguracja przez `.env` poza repo.
6. **Jaki jest koszt?** Demo pokazuje mechanizm. Koszt pilota zależy od integracji i skali, a robocza miara operacji w danych wynosi około 32 467 865 PLN.
7. **Ile trwa wdrożenie?** Pilot z ograniczonym zakresem można zaplanować w tygodniach; produkcja wymaga integracji, procedur, testów i utrzymania.
8. **Co jeśli nie ma sieci?** Formularze krytyczne powinny działać offline i synchronizować po odzyskaniu łączności.
9. **Czy można podłączyć arkusze?** Tak. Lakehouse może przyjąć CSV/Excel jako etap przejściowy, a później konektory API.
10. **Jak rozliczyć decyzję finansową?** Przez ekran SPO-2, ścieżkę akceptacji i audyt decyzji powiązany z zapotrzebowaniami.

## Checklista przed demo

- [ ] `deploy\ensure_capacity.ps1` — pojemność w stanie `Active`.
- [ ] `scenario\run_scenario.ps1 -Preset ciagly -Background` uruchomione, log w `scenario\_ciagly.log`.
- [ ] Data Agent opublikowany w portalu (wersja robocza nie odpowiada gościom).
- [ ] Cztery zakładki otwarte wg tabeli „Co otworzyć przed demem”.
- [ ] `python generate_datasets.py` wykonane bez błędów.
- [ ] `python notebooks\02_coverage_analysis.py` wykonane bez błędów.
- [ ] `python notebooks\03_allocation_optimizer.py` wykonane bez błędów.
- [ ] `python simulate_realtime.py --dry-run` wykonane bez poświadczeń.
- [ ] Otwarty raport lub README z liczbą 4.27 h → 1.70 h.
- [ ] Otwarty `fabric-app/APP_SPEC.md` jako zapas dla aplikacji.
- [ ] Otwarty `activator/RULES.md` dla alertu punktu >90%.
- [ ] Przygotowana odpowiedź „algorytm rekomenduje, człowiek decyduje”.
- [ ] Sprawdzone powiększenie czcionki na sali.
- [ ] Przygotowany plan B bez sieci i bez aplikacji.
