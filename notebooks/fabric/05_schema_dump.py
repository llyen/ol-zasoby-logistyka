# CELL
# 🧾 Zrzut schematów tabel Lakehouse do pliku JSON
# Notatnik pomocniczy: definicja modelu semantycznego musi znać dokładne typy kolumn,
# a zgadywanie ich z plików źródłowych prowadzi do błędów Direct Lake.

# CELL
import json

tables = [t.name for t in spark.catalog.listTables()]
schema = {}
for name in sorted(tables):
    df = spark.table(name)
    schema[name] = {"rows": df.count(), "columns": [{"name": c, "type": t} for c, t in df.dtypes]}

payload = json.dumps(schema, ensure_ascii=False, indent=2)
mssparkutils.fs.put("Files/derived/lakehouse_schema.json", payload, True)
print(f"Tabele: {len(schema)}")
for name, info in schema.items():
    print(name, info["rows"], len(info["columns"]))
