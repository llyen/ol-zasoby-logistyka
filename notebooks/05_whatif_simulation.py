# CELL
from pathlib import Path
import json
import pandas as pd
BASE=Path(__file__).resolve().parents[1]/"datasets"; OUT=BASE/"derived"; OUT.mkdir(exist_ok=True)
summary=json.loads((OUT/"allocation_summary.json").read_text(encoding="utf-8")) if (OUT/"allocation_summary.json").exists() else {}
coverage=json.loads((OUT/"coverage_summary.json").read_text(encoding="utf-8")) if (OUT/"coverage_summary.json").exists() else {}
# CELL
scenarios=[
 {"scenario":"fala_dociera_do_wroclawia","expected_effect":"+18% zapotrzebowan na schronienie i wode, presja na magazyny WH dolnoslaskie", "mitigation":"przerzut z wielkopolskie i lubuskie"},
 {"scenario":"droga_A4_nieprzejezdna","expected_effect":"czas dostawy +35-60% na osi Opole-Wroclaw", "mitigation":"trasa DK94 + mosty pontonowe"},
 {"scenario":"zapotrzebowanie_plus_50pct","expected_effect":"spadek SLA priorytetu 1 bez uruchomienia ARS", "mitigation":"SPO-2 oraz zamowienia ramowe"},
]
pd.DataFrame(scenarios).to_csv(OUT/"whatif_scenarios.csv", index=False)
print(pd.DataFrame(scenarios).to_string(index=False))
