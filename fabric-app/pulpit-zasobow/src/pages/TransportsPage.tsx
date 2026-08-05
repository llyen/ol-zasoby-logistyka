import { useMemo, useState } from 'react';

import { formatNumber, priorityColor, toCsv, transportRows, type TransportRow } from '@/data/model';
import { useScenario } from '@/hooks/ScenarioContext';
import { saveDelivery, type DeliveryDraft } from '@/services/workflow';
import {
  Badge,
  Button,
  CountryMap,
  downloadCsv,
  EmptyState,
  Field,
  inputClass,
  Modal,
  Panel,
  Toast,
  type MapPoint,
} from '@/components/ui';

const STATUS_LABEL: Record<string, string> = {
  planned: 'zaplanowany',
  in_transit: 'w drodze',
  delivered: 'dostarczony',
  delayed: 'opóźniony',
  cancelled: 'odwołany',
};

export function TransportsPage() {
  const { index, day, actor, refresh, deliveries } = useScenario();
  const [onlyLate, setOnlyLate] = useState(false);
  const [selected, setSelected] = useState<TransportRow | null>(null);
  const [received, setReceived] = useState(0);
  const [shortage, setShortage] = useState('');
  const [receiver, setReceiver] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const rows = useMemo(() => (index ? transportRows(index, day) : []), [index, day]);
  const visible = useMemo(() => (onlyLate ? rows.filter((r) => r.late) : rows), [rows, onlyLate]);

  const points: MapPoint[] = useMemo(
    () =>
      visible.map((t) => ({
        id: t.id,
        lat: t.lat,
        lon: t.lon,
        // Wielkosc kropki oddaje opoznienie, nie wolumen - tu liczy sie ryzyko.
        value: Math.min(t.maxDelay, 120),
        label: `${t.resName} → ${t.gminaName}`,
        detail: `${STATUS_LABEL[t.status] ?? t.status} · priorytet ${t.prio}${
          t.maxDelay > 0 ? ` · opóźnienie ${t.maxDelay} min` : ''
        }`,
        alarm: t.late,
      })),
    [visible],
  );

  const anchors: MapPoint[] = useMemo(
    () =>
      (index?.scene.warehouses ?? []).map((w) => ({
        id: w.id,
        lat: w.lat,
        lon: w.lon,
        value: 0,
        label: w.name.length > 18 ? `${w.name.slice(0, 17)}…` : w.name,
      })),
    [index],
  );

  const paths = useMemo(
    () =>
      visible
        .filter((t) => t.path.length > 1)
        .slice(0, 40)
        .map((t) => ({
          id: t.id,
          points: t.path,
          color: t.late ? '#d5233f' : '#0052a5',
        })),
    [visible],
  );

  if (!index) return null;
  const late = rows.filter((r) => r.late);
  const alertMin = index.scene.meta.delayAlertMin;

  const openForm = (row: TransportRow) => {
    setSelected(row);
    setReceived(row.qty);
    setShortage('');
    setReceiver('');
    setErrors([]);
  };

  const submit = async () => {
    if (!selected) return;
    const g = selected.gmina ? index.gminaById.get(selected.gmina) : null;
    const draft: DeliveryDraft = {
      transport_id: selected.id,
      allocation_id: selected.alloc,
      scene_day: day,
      gmina_code: selected.gmina ?? '',
      resource_type_id: selected.res ?? '',
      allocated_qty: selected.qty,
      received_qty: received,
      shortage_reason: shortage,
      delay_min: selected.maxDelay,
      receiver_name: receiver,
      lat: g?.lat ?? selected.lat,
      lon: g?.lon ?? selected.lon,
    };
    try {
      const saved = await saveDelivery(draft, actor);
      await refresh();
      setToast(
        received < selected.qty
          ? `Potwierdzono odbiór ${saved.confirmation_id} z niedoborem ${formatNumber(selected.qty - received)}.`
          : `Potwierdzono odbiór ${saved.confirmation_id}.`,
      );
      setSelected(null);
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Transporty w tej dobie" value={rows.length} />
        <Metric
          label={`Opóźnione ponad ${alertMin} min`}
          value={late.length}
          tone={late.length ? 'red' : 'default'}
        />
        <Metric
          label="Największe opóźnienie"
          value={rows.length ? Math.max(...rows.map((r) => r.maxDelay)) : 0}
          suffix=" min"
          tone="amber"
        />
        <Metric label="Potwierdzone odbiory" value={deliveries.length} tone="cyan" />
      </div>

      <Panel
        title="Trasy w toku"
        subtitle="Linia = przebieg trasy, kropka = bieżąca pozycja pojazdu. Czerwony oznacza opóźnienie przekraczające próg alertu."
      >
        <CountryMap
          points={points}
          anchors={anchors}
          paths={paths}
          colorFor={(v) =>
            v >= alertMin * 2 ? '#d5233f' : v >= alertMin ? '#c2410c' : v > 0 ? '#a16207' : '#0052a5'
          }
          legend={[
            { label: 'na czas', value: 0 },
            { label: 'lekkie', value: alertMin / 2 },
            { label: `${alertMin}+ min`, value: alertMin },
            { label: 'krytyczne', value: alertMin * 2 },
          ]}
          height={430}
        />
      </Panel>

      <Panel
        title="Rejestr transportów"
        subtitle="Sortowanie wg opóźnienia, potem priorytetu."
        right={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={onlyLate}
                onChange={(e) => setOnlyLate(e.target.checked)}
                className="accent-gov"
              />
              tylko opóźnione
            </label>
            <Button
              onClick={() =>
                downloadCsv(
                  `transporty-${day}.csv`,
                  toCsv(
                    visible.map((r) => ({
                      transport: r.id,
                      przydzial: r.alloc,
                      magazyn: r.whName,
                      gmina: r.gminaName,
                      zasob: r.resName,
                      ilosc: r.qty,
                      priorytet: r.prio,
                      status: STATUS_LABEL[r.status] ?? r.status,
                      opoznienie_min: r.maxDelay,
                      eta: r.eta,
                    })),
                  ),
                )
              }
            >
              Eksport CSV
            </Button>
          </div>
        }
      >
        {visible.length === 0 ? (
          <EmptyState text="Brak transportów w tej dobie." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3">P</th>
                  <th className="py-2 pr-3">Transport</th>
                  <th className="py-2 pr-3">Z magazynu</th>
                  <th className="py-2 pr-3">Do gminy</th>
                  <th className="py-2 pr-3">Zasób</th>
                  <th className="py-2 pr-3 text-right">Ilość</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Opóźnienie</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 60).map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-slate-200 hover:bg-slate-50 ${
                      r.late ? 'bg-red-50' : ''
                    }`}
                  >
                    <td className="py-2 pr-3">
                      <span
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-xs font-bold"
                        style={{
                          background: `${priorityColor(r.prio)}22`,
                          color: priorityColor(r.prio),
                        }}
                      >
                        {r.prio}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-500">{r.id}</td>
                    <td className="py-2 pr-3 text-slate-700">{r.whName}</td>
                    <td className="py-2 pr-3 text-slate-900">{r.gminaName}</td>
                    <td className="py-2 pr-3 text-slate-700">{r.resName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-700">
                      {formatNumber(r.qty)}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge
                        className={
                          r.status === 'delivered'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/40'
                            : r.late
                              ? 'bg-red-50 text-red-700 ring-red-600/40'
                              : 'bg-gov/15 text-gov ring-gov/40'
                        }
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        r.late ? 'font-semibold text-red-700' : 'text-slate-500'
                      }`}
                    >
                      {r.maxDelay > 0 ? `${r.maxDelay} min` : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <Button variant={r.late ? 'danger' : 'ghost'} onClick={() => openForm(r)}>
                        Potwierdź odbiór
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length > 60 && (
              <p className="mt-2 text-xs text-slate-500">
                Pokazano 60 z {formatNumber(visible.length)} transportów. Pełna lista w eksporcie CSV.
              </p>
            )}
          </div>
        )}
      </Panel>

      {deliveries.length > 0 && (
        <Panel
          title="Potwierdzone odbiory"
          subtitle="Niedobory generują ponowne zapotrzebowanie w kolejce wniosków."
        >
          <ul className="space-y-1.5 text-sm text-slate-700">
            {deliveries.slice(0, 10).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Badge className="bg-slate-50 text-slate-700 ring-slate-300">
                  {d.confirmation_id}
                </Badge>
                <span>
                  {d.transport_id} · odebrano {formatNumber(d.received_qty)} z{' '}
                  {formatNumber(d.allocated_qty)}
                </span>
                {d.received_qty < d.allocated_qty && (
                  <span className="text-xs text-amber-700">niedobór: {d.shortage_reason}</span>
                )}
                <span className="text-xs text-slate-500">{d.receiver_name}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Modal
        open={selected !== null}
        title={selected ? `Potwierdzenie odbioru — ${selected.id}` : ''}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {selected.whName} → {selected.gminaName} · {formatNumber(selected.qty)}{' '}
              {selected.resName}
              {selected.maxDelay > 0 && (
                <span className="ml-2 text-amber-700">opóźnienie {selected.maxDelay} min</span>
              )}
            </div>
            <Field label="Odebrana ilość" hint="Nie może przekraczać ilości przydzielonej.">
              <input
                type="number"
                min={0}
                max={selected.qty}
                value={received}
                onChange={(e) => setReceived(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
            {received < selected.qty && (
              <Field
                label="Przyczyna niedoboru"
                hint="Wymagana — to ona uruchamia ponowne zapotrzebowanie."
              >
                <input
                  value={shortage}
                  onChange={(e) => setShortage(e.target.value)}
                  className={inputClass}
                  placeholder="Np. część palet uszkodzona podczas przeładunku"
                />
              </Field>
            )}
            <Field label="Osoba odbierająca">
              <input
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                className={inputClass}
                placeholder="Imię i nazwisko, funkcja"
              />
            </Field>
            {errors.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Anuluj
              </Button>
              <Button variant="primary" onClick={() => void submit()}>
                Potwierdź odbiór
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
  suffix = '',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'amber' | 'red' | 'cyan';
  suffix?: string;
}) {
  const color = {
    default: 'text-slate-900',
    amber: 'text-amber-700',
    red: 'text-red-700',
    cyan: 'text-gov',
  }[tone];
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-300">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>
        {formatNumber(value)}
        {suffix}
      </div>
    </div>
  );
}
