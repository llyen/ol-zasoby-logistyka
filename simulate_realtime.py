"""Symulator strumieni do Fabric Eventstream / Event Hub.
Tryb --dry-run nie wymaga azure-eventhub ani poświadczeń.
"""
from __future__ import annotations
import argparse, json, os, time
from datetime import datetime
from pathlib import Path

STREAM_FILES = ["fact_transport_tracking.jsonl", "fact_shelter_occupancy.jsonl", "fact_demand.jsonl"]

def parse_dt(value: str | None):
    return datetime.fromisoformat(value) if value else None

def load_events(base: Path, start, end):
    events=[]
    for file in STREAM_FILES:
        for line in (base / file).open(encoding="utf-8"):
            item=json.loads(line); ts=datetime.fromisoformat(item["timestamp"])
            if (not start or ts>=start) and (not end or ts<=end):
                item["_stream"] = file.replace(".jsonl", ""); events.append((ts,item))
    return [e for _,e in sorted(events, key=lambda x:x[0])]

def send_eventhub(events, connection_string, eventhub_name):
    from azure.eventhub import EventData, EventHubProducerClient  # lazy import
    producer=EventHubProducerClient.from_connection_string(connection_string, eventhub_name=eventhub_name)
    with producer:
        batch=producer.create_batch()
        for event in events:
            body=json.dumps(event, ensure_ascii=False)
            try: batch.add(EventData(body))
            except ValueError:
                producer.send_batch(batch); batch=producer.create_batch(); batch.add(EventData(body))
        if len(batch)>0: producer.send_batch(batch)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--stream", default="all", help="all|fact_transport_tracking|fact_shelter_occupancy|fact_demand")
    ap.add_argument("--speed", type=float, default=120.0, help="Przyspieszenie czasu symulacji")
    ap.add_argument("--from", dest="from_ts", default=None)
    ap.add_argument("--to", dest="to_ts", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--endpoint", default=os.getenv("EVENTHUB_CONNECTION_STRING"))
    ap.add_argument("--eventhub", default=os.getenv("EVENTHUB_NAME", "ol-logistics-events"))
    args=ap.parse_args()
    base=Path(__file__).parent / "datasets"
    events=load_events(base, parse_dt(args.from_ts), parse_dt(args.to_ts))
    if args.stream != "all": events=[e for e in events if e["_stream"]==args.stream]
    if args.dry_run:
        out=base / "derived" / "dry_run_events_preview.jsonl"; out.parent.mkdir(exist_ok=True)
        with out.open("w", encoding="utf-8") as f:
            for e in events[:1000]: f.write(json.dumps(e, ensure_ascii=False)+"\n")
        print(f"DRY-RUN OK: {len(events)} events selected, preview written to {out}")
        return
    if not args.endpoint: raise SystemExit("Brak endpointu. Ustaw EVENTHUB_CONNECTION_STRING albo użyj --dry-run.")
    # Real send in batches; sleep lightly according to speed to avoid flooding custom endpoint.
    for i in range(0, len(events), 100):
        send_eventhub(events[i:i+100], args.endpoint, args.eventhub)
        time.sleep(max(0.01, 1.0 / args.speed))
    print(f"Sent {len(events)} events to {args.eventhub}")
if __name__ == "__main__": main()
