import { useMemo, useState } from 'react';

import {
  formatHours,
  formatNumber,
  planKpiForDay,
  planRows,
  priorityColor,
  toCsv,
  type PlanRow,
} from '@/data/model';
import { useScenario } from '@/hooks/ScenarioContext';
import {
  saveAllocation,
  travelDelta,
  type AllocationDraft,
  type AllocationMode,
} from '@/services/workflow';
import {
  Badge,
  Button,
  downloadCsv,
  EmptyState,
  Field,
  inputClass,
  Modal,
  Panel,
  Toast,
} from '@/components/ui';

const MODE_LABEL: Record<AllocationMode, string> = {
  plan_optymalizatora: 'zgodnie z planem',
  korekta_reczna: 'korekta ręczna',
  podzial_dostawy: 'podział dostawy',
};

export function PlanPage() {
  const { index, day, actor, refresh, allocations } = useScenario();
  const [onlyComparable, setOnlyComparable] = useState(true);
  const [selected, setSelected] = useState<PlanRow | null>(null);
  const [warehouse, setWarehouse] = useState('');
  const [qty, setQty] = useState(0);
  const [unit, setUnit] = useState('');
  const [mode, setMode] = useState<AllocationMode>('plan_optymalizatora');
  const [override, setOverride] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const rows = useMemo(
    () => (index ? planRows(index, day, onlyComparable) : []),
    [index, day, onlyComparable],
  );
  const kpi = useMemo(() => (index ? planKpiForDay(index, day) : null), [index, day]);

  if (!index || !kpi) return null;
  const total = index.scene.planKpi;

  /**
   * Czas dojazdu z wybranego magazynu szacujemy proporcjonalnie do planu
   * optymalizatora - scena nie zawiera macierzy odleglosci dla wszystkich par,
   * a dla demonstracji liczy sie kierunek zmiany, nie precyzja co do minuty.
   */
  const chosenTravelH = (row: PlanRow, warehouseId: string): number => {
    if (warehouseId === row.optWh) return row.optH;
    if (warehouseId === row.fifoWh && row.fifoH !== null) return row.fifoH;
    const optWh = index.whById.get(row.optWh);
    const alt = index.whById.get(warehouseId);
    const g = row.gmina ? index.gminaById.get(row.gmina) : null;
    if (!optWh || !alt || !g) return row.optH;
    const dist = (a: { lat: number; lon: number }) =>
      Math.hypot((a.lat - g.lat) * 111, (a.lon - g.lon) * 68);
    const base = dist(optWh) || 1;
    return Math.round((row.optH * (dist(alt) / base)) * 100) / 100;
  };

  const openForm = (row: PlanRow) => {
    setSelected(row);
    setWarehouse(row.optWh);
    setQty(row.qty);
    setUnit(index.resById.get(row.res)?.unit ?? '');
    setMode('plan_optymalizatora');
    setOverride('');
    setErrors([]);
  };

  const submit = async () => {
    if (!selected) return;
    const draft: AllocationDraft = {
      demand_id: selected.demand,
      scene_day: day,
      recommended_warehouse_id: selected.optWh,
      recommended_travel_h: selected.optH,
      chosen_warehouse_id: warehouse,
      chosen_travel_h: chosenTravelH(selected, warehouse),
      allocated_qty: qty,
      resource_type_id: selected.res,
      priority: selected.prio,
      mode,
      override_reason: override,
      transport_unit_id: '',
      eta: '',
      voivodeship_code: selected.v ?? '',
    };
    try {
      const saved = await saveAllocation(draft, actor);
      await refresh();
      setToast(
        saved.delta_travel_h > 0
          ? `Zapisano przydział ${saved.allocation_decision_id}. Decyzja wydłużyła dostawę o ${formatHours(saved.delta_travel_h)}.`
          : `Zapisano przydział ${saved.allocation_decision_id}.`,
      );
      setSelected(null);
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  };

  const draftPreview =
    selected !== null
      ? travelDelta({
          recommended_travel_h: selected.optH,
          chosen_travel_h: chosenTravelH(selected, warehouse),
        } as AllocationDraft)
      : 0;

  return (
    <div className="space-y-4">
      <Panel
        title="Ile daje optymalizacja przydziału"
        subtitle="Porównanie wyłącznie na parach: te same wnioski obsłużone regułą „kto pierwszy” i optymalizatorem. Wnioski występujące tylko w jednym planie nie wchodzą do średnich."
        tone="accent"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              Średni czas dojazdu — reguła FIFO
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-700">
              {kpi.fifoAvgH.toFixed(2)} h
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Pierwszy wolny magazyn z listy, bez uwzględnienia odległości.
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-600/30">
            <div className="text-[11px] uppercase tracking-wider text-emerald-700">
              Średni czas dojazdu — optymalizator
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-emerald-700">
              {kpi.optAvgH.toFixed(2)} h
            </div>
            <p className="mt-1 text-xs text-emerald-800">
              Magazyn dobrany do gminy, priorytetu i dostępności zapasu.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              Oszczędność na wniosek
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-gov">
              {kpi.savedH.toFixed(2)} h
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Łącznie {formatHours(kpi.totalSavedH)} na {formatNumber(kpi.comparable)} porównywalnych
              wnioskach.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Wniosków w planie" value={formatNumber(kpi.count)} />
          <Stat
            label="Porównywalnych"
            value={`${formatNumber(kpi.comparable)} z ${formatNumber(kpi.count)}`}
            hint="Pozostałe pojawiły się wyłącznie w planie optymalizatora."
          />
          <Stat
            label="Skróconych / wydłużonych"
            value={`${formatNumber(kpi.improved)} / ${formatNumber(kpi.worse)}`}
            hint="Optymalizator nie wygrywa w każdym pojedynczym przypadku — liczy się bilans."
          />
          <Stat
            label="Priorytet 1"
            value={`${kpi.p1FifoAvgH.toFixed(2)} h → ${kpi.p1OptAvgH.toFixed(2)} h`}
            hint={`${formatNumber(kpi.p1Count)} wniosków najwyższego priorytetu.`}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          W całym scenariuszu: {total.fifoAvgH.toFixed(2)} h → {total.optAvgH.toFixed(2)} h na{' '}
          {formatNumber(total.comparable)} porównywalnych wnioskach, łącznie{' '}
          {formatHours(total.totalSavedH)} skróconego czasu dojazdu.
        </p>
      </Panel>

      <Panel
        title="Plan przydziału"
        subtitle="Rekomendacja optymalizatora obok wyniku reguły „kto pierwszy”. Operator może odejść od planu, ale musi to uzasadnić."
        right={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={onlyComparable}
                onChange={(e) => setOnlyComparable(e.target.checked)}
                className="accent-gov"
              />
              tylko porównywalne
            </label>
            <Button
              onClick={() =>
                downloadCsv(
                  `plan-${day}.csv`,
                  toCsv(
                    rows.map((r) => ({
                      wniosek: r.demand,
                      priorytet: r.prio,
                      gmina: r.gminaName,
                      zasob: r.resName,
                      ilosc: r.qty,
                      magazyn_optymalizator: r.optWhName,
                      godzin_optymalizator: r.optH,
                      magazyn_fifo: r.fifoWhName ?? '',
                      godzin_fifo: r.fifoH ?? '',
                      oszczednosc_h: r.savedH,
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
        {rows.length === 0 ? (
          <EmptyState text="Brak pozycji planu do tej doby." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3">P</th>
                  <th className="py-2 pr-3">Gmina</th>
                  <th className="py-2 pr-3">Zasób</th>
                  <th className="py-2 pr-3 text-right">Ilość</th>
                  <th className="py-2 pr-3">Magazyn (optymalizator)</th>
                  <th className="py-2 pr-3 text-right">Czas</th>
                  <th className="py-2 pr-3">Magazyn (FIFO)</th>
                  <th className="py-2 pr-3 text-right">Czas</th>
                  <th className="py-2 pr-3 text-right">Zysk</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((r) => (
                  <tr key={r.demand} className="border-b border-slate-200 hover:bg-slate-50">
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
                    <td className="py-2 pr-3 text-slate-900">{r.gminaName}</td>
                    <td className="py-2 pr-3 text-slate-700">{r.resName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-700">
                      {formatNumber(r.qty)}
                    </td>
                    <td className="py-2 pr-3 text-emerald-700">{r.optWhName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-emerald-700">
                      {r.optH.toFixed(2)} h
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{r.fifoWhName ?? '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                      {r.fifoH === null ? '—' : `${r.fifoH.toFixed(2)} h`}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        r.savedH > 0 ? 'text-gov' : r.savedH < 0 ? 'text-red-700' : 'text-slate-500'
                      }`}
                    >
                      {r.fifoH === null ? '—' : `${r.savedH > 0 ? '+' : ''}${r.savedH.toFixed(2)} h`}
                    </td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" onClick={() => openForm(r)}>
                        Zatwierdź
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 60 && (
              <p className="mt-2 text-xs text-slate-500">
                Pokazano 60 z {formatNumber(rows.length)} pozycji. Pełna lista w eksporcie CSV.
              </p>
            )}
          </div>
        )}
      </Panel>

      {allocations.length > 0 && (
        <Panel
          title="Zatwierdzone przydziały"
          subtitle="Odejścia od rekomendacji są oznaczone kosztem czasowym."
        >
          <ul className="space-y-1.5 text-sm text-slate-700">
            {allocations.slice(0, 10).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Badge className="bg-slate-50 text-slate-700 ring-slate-300">
                  {MODE_LABEL[a.mode as AllocationMode] ?? a.mode}
                </Badge>
                <span>
                  {a.demand_id} · {index.whById.get(a.chosen_warehouse_id)?.name ?? a.chosen_warehouse_id}
                </span>
                {a.delta_travel_h !== 0 && (
                  <span
                    className={`text-xs font-semibold ${
                      a.delta_travel_h > 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {a.delta_travel_h > 0 ? '+' : ''}
                    {a.delta_travel_h.toFixed(2)} h względem rekomendacji
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Modal
        open={selected !== null}
        title={selected ? `Przydział do wniosku ${selected.demand}` : ''}
        onClose={() => setSelected(null)}
        wide
      >
        {selected && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {selected.gminaName} · {formatNumber(selected.qty)} {unit} {selected.resName} ·
              priorytet {selected.prio}
              <p className="mt-1 text-xs text-slate-500">
                Rekomendacja: <strong className="text-emerald-700">{selected.optWhName}</strong> —{' '}
                {selected.optH.toFixed(2)} h dojazdu.
                {selected.fifoWhName &&
                  ` Reguła FIFO wskazałaby ${selected.fifoWhName} (${selected.fifoH?.toFixed(2)} h).`}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Magazyn źródłowy">
                <select
                  value={warehouse}
                  onChange={(e) => {
                    setWarehouse(e.target.value);
                    setMode(e.target.value === selected.optWh ? 'plan_optymalizatora' : 'korekta_reczna');
                  }}
                  className={inputClass}
                >
                  {index.scene.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.id === selected.optWh ? ' — rekomendowany' : ''}
                      {w.h24 ? ' · 24 h' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Przydzielona ilość" hint={`Wnioskowano ${formatNumber(selected.qty)} ${unit}.`}>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => {
                    setQty(Number(e.target.value));
                    if (Number(e.target.value) < selected.qty) setMode('podzial_dostawy');
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label="Tryb">
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as AllocationMode)}
                  className={inputClass}
                >
                  {(Object.keys(MODE_LABEL) as AllocationMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end">
                <div
                  className={`w-full rounded-lg p-3 text-sm ${
                    draftPreview > 0
                      ? 'bg-red-50 text-red-700'
                      : draftPreview < 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-50 text-slate-500'
                  }`}
                >
                  {draftPreview === 0
                    ? 'Wybór zgodny z rekomendacją — bez kosztu czasowego.'
                    : draftPreview > 0
                      ? `Ta zmiana wydłuża dostawę o ${formatHours(draftPreview)}.`
                      : `Ta zmiana skraca dostawę o ${formatHours(-draftPreview)}.`}
                </div>
              </div>
            </div>
            {mode !== 'plan_optymalizatora' && (
              <Field
                label="Uzasadnienie odejścia od planu"
                hint="Minimum 10 znaków. Bez tego nie da się później ocenić, ile kosztowała decyzja ręczna."
              >
                <textarea
                  rows={3}
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                  className={inputClass}
                />
              </Field>
            )}
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
                Zatwierdź przydział
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2" title={hint}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}
