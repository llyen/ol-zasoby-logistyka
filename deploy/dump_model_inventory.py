"""Zrzuca inwentarz modelu semantycznego (miary i kolumny) do JSON.

Model tego scenariusza powstal przed wprowadzeniem skryptow definiujacych model
w repozytorium, wiec jedynym pewnym zrodlem jego zawartosci jest wlasna
definicja TMDL pobrana z Fabric. Inwentarz sluzy potem do kontroli raportu:
literowka w nazwie miary nie zatrzymuje publikacji, tylko zostawia pusty kafelek.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
import time
from pathlib import Path

import requests

BASE = Path(__file__).resolve().parent.parent
STATE = json.loads((BASE / ".fabric" / "deployment.json").read_text(encoding="utf-8"))
WS, DS = STATE["workspaceId"], STATE["semanticModelId"]
API = "https://api.fabric.microsoft.com/v1"
OUT = Path(__file__).with_name("model_inventory.json")


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


def main() -> None:
    h = {"Authorization": naglowek_autoryzacji(token()), "Content-Type": "application/json"}
    r = requests.post(f"{API}/workspaces/{WS}/semanticModels/{DS}/getDefinition",
                      headers=h, timeout=300)
    if r.status_code == 202:
        loc = r.headers["Location"]
        for _ in range(60):
            time.sleep(3)
            s = requests.get(loc, headers=h, timeout=120)
            if s.json().get("status") == "Succeeded":
                r = requests.get(s.headers.get("Location") or f"{loc}/result", headers=h,
                                 timeout=300)
                break
    r.raise_for_status()

    inv: dict[str, dict[str, list[str]]] = {"measures": {}, "columns": {}}
    for part in r.json()["definition"]["parts"]:
        if not part["path"].startswith("definition/tables/"):
            continue
        tabela = part["path"].split("/")[-1][:-5]
        tmdl = base64.b64decode(part["payload"]).decode("utf-8")
        inv["measures"][tabela] = (re.findall(r"^\tmeasure '([^']+)'", tmdl, re.M)
                                   + re.findall(r"^\tmeasure ([A-Za-z_]\w*) =", tmdl, re.M))
        inv["columns"][tabela] = re.findall(r"^\tcolumn '?([^'\n]+?)'?$", tmdl, re.M)

    OUT.write_text(json.dumps(inv, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    miar = sum(len(v) for v in inv["measures"].values())
    print(f"zapisano {OUT}: {len(inv['columns'])} tabel, {miar} miar")


if __name__ == "__main__":
    main()
