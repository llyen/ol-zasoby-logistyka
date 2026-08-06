"""Kontrola raportu: czy kazde pole wizualizacji istnieje w modelu.

Literowka w nazwie miary nie zatrzymuje publikacji raportu - kafelek po prostu
zostaje pusty i widac to dopiero na sali. Ten skrypt pobiera definicje raportu
z Fabric, wyciaga wszystkie odwolania do miar i kolumn i porownuje je ze
zrodlem prawdy: slownikiem miar w create_semantic_model.py oraz zrzutem
schematow Delta w lakehouse_schemas.json.
"""
from __future__ import annotations

import base64
import json
import subprocess
from pathlib import Path

import requests

BASE = Path(__file__).resolve().parent.parent
STATE = json.loads((BASE / ".fabric" / "deployment.json").read_text(encoding="utf-8"))
WS = STATE["workspaceId"]
NAME = "OL_LOG_Raport"
API = "https://api.fabric.microsoft.com/v1"
OCZEKIWANE_STRONY = 6


def naglowek_autoryzacji(tok: str) -> str:
    return " ".join(("Bearer", tok))


def token() -> str:
    out = subprocess.run(
        ["az", "account", "get-access-token", "--resource", "https://api.fabric.microsoft.com",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, shell=True)
    if out.returncode != 0:
        raise SystemExit(out.stderr)
    return out.stdout.strip()


def model_slownik() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """Slownik modelu z inwentarza zrzuconego przez dump_model_inventory.py.

    Model tego scenariusza powstal wczesniej i nie ma w repozytorium skryptu
    z definicja miar, wiec zrodlem prawdy jest zrzut jego wlasnej definicji TMDL.
    """
    inv = json.loads((Path(__file__).with_name("model_inventory.json"))
                     .read_text(encoding="utf-8"))
    miary = {t: set(v) for t, v in inv["measures"].items()}
    kolumny = {t: set(v) for t, v in inv["columns"].items()}
    return miary, kolumny


def pobierz_definicje(h: dict) -> dict[str, str]:
    items = requests.get(f"{API}/workspaces/{WS}/items?type=Report", headers=h, timeout=120)
    items.raise_for_status()
    rep = next((i for i in items.json()["value"] if i["displayName"] == NAME), None)
    if not rep:
        raise SystemExit(f"Nie znaleziono raportu {NAME} w obszarze {WS}.")
    r = requests.post(f"{API}/workspaces/{WS}/reports/{rep['id']}/getDefinition",
                      headers=h, timeout=300)
    if r.status_code == 202:
        import time
        loc = r.headers["Location"]
        for _ in range(60):
            time.sleep(3)
            s = requests.get(loc, headers=h, timeout=120)
            if s.json().get("status") == "Succeeded":
                r = requests.get(s.headers.get("Location") or f"{loc}/result", headers=h,
                                 timeout=300)
                break
    r.raise_for_status()
    parts = r.json()["definition"]["parts"]
    print(f"raport {NAME}: {rep['id']}, czesci definicji: {len(parts)}")
    return {p["path"]: base64.b64decode(p["payload"]).decode("utf-8") for p in parts}


def zbierz_pola(tresc: str) -> list[tuple[str, str, str]]:
    """Zwraca (rodzaj, tabela, pole) dla kazdego odwolania w wizualizacji."""
    dane = json.loads(tresc)
    znalezione: list[tuple[str, str, str]] = []

    def obejdz(w):
        if isinstance(w, dict):
            for rodzaj in ("Measure", "Column"):
                if rodzaj in w and isinstance(w[rodzaj], dict):
                    ref = w[rodzaj]
                    tabela = ref.get("Expression", {}).get("SourceRef", {}).get("Entity")
                    pole = ref.get("Property")
                    if tabela and pole:
                        znalezione.append((rodzaj, tabela, pole))
            for v in w.values():
                obejdz(v)
        elif isinstance(w, list):
            for v in w:
                obejdz(v)

    obejdz(dane)
    return znalezione


def main() -> None:
    h = {"Authorization": naglowek_autoryzacji(token()), "Content-Type": "application/json"}
    czesci = pobierz_definicje(h)
    miary, kolumny = model_slownik()

    strony = sorted({p.split("/")[2] for p in czesci if p.startswith("definition/pages/")
                     and p.count("/") >= 3})
    print(f"strony: {len(strony)} ({', '.join(strony)})")

    bledy: list[str] = []
    if len(strony) != OCZEKIWANE_STRONY:
        bledy.append(f"stron {len(strony)}, oczekiwano {OCZEKIWANE_STRONY}")

    licznik = 0
    for sciezka, tresc in sorted(czesci.items()):
        if not sciezka.endswith("visual.json"):
            continue
        strona = sciezka.split("/")[2]
        for rodzaj, tabela, pole in zbierz_pola(tresc):
            licznik += 1
            slownik = miary if rodzaj == "Measure" else kolumny
            if tabela not in slownik:
                bledy.append(f"{strona}: tabela '{tabela}' nie istnieje w modelu "
                             f"(pole '{pole}')")
            elif pole not in slownik[tabela]:
                czym = "miary" if rodzaj == "Measure" else "kolumny"
                bledy.append(f"{strona}: brak {czym} '{pole}' w tabeli '{tabela}'")

    print(f"sprawdzono {licznik} odwolan do pol")
    if bledy:
        for b in bledy:
            print("   BLAD", b)
        raise SystemExit(f"\n{len(bledy)} niezgodnosci raportu z modelem.")
    print("\nRaport zweryfikowany: wszystkie pola istnieja w modelu.")


if __name__ == "__main__":
    main()
