# CELL
from pathlib import Path
import pandas as pd
BASE = Path(__file__).resolve().parents[1] / "datasets"
# CELL
tables = {p.stem: pd.read_csv(p) for p in BASE.glob("dim_*.csv")}
for name, df in tables.items():
    print(f"{name}: {len(df):,} rows, {len(df.columns)} columns")
# CELL
assert len(tables["dim_voivodeship"]) == 16
assert len(tables["dim_resource_type"]) == 20
print("Dimensions loaded and validated.")
