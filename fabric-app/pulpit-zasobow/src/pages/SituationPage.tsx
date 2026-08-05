import { useMemo, useState } from 'react';

import {
  countryKpis,
  depletionRows,
  formatNumber,
  priorityColor,
  stockColor,
  supplyCase,
  suppliersFor,
  toCsv,
  voivodeshipRows,
  type DepletionRow,
} from '@/data/model';
import { useScenario } from '@/hooks/ScenarioContext';
import {
  saveSupplyAction,
  type SupplyDraft,
  type ValidationResult,
} from '@/services/workflow';
import {
  BarList,
  Badge,
  Button,
  CountryMap,
  downloadCsv,
  EmptyState,
  Field,
  inputClass,
  Modal,
  Panel,
  Sparkline,
  TimelineBars,
  Toast,
  type MapPoint,
} from '@/components/ui';

const ACTION_LABEL: Record<string, string> = {
  rezerwy_strategiczne: 'uruchom rezerwy strategiczne',
  dostawca_ramowy: 'zamów u dostawcy ramowego',
  przerzut_miedzywojewodzki: 'przerzuć między województwami',
  monitoruj: 'monitoruj',
};

export function SituationPage() {
  const { index, day, dayIndex, setDayIndex, actor, refresh, supply } = useScenario();
  const [selected, setSelected] = useState<DepletionRow | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [supplierId, setSupplierId] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const kpis = useMemo(() => (index ? countryKpis(index, day) : []), [index, day]);
  const voivs = useMemo(() => (index ? voivodeshipRows(index, day) : []), [index, day]);
  const depletion = useMemo(() => (index ? depletionRows(index, day) : []), [index, day]);
  const decision = useMemo(() => (index ? supplyCase(index, day) : null), [index, day]);

  const points: MapPoint[] = useMemo(() => {
    if (!index) return [];
    // Punkt na mapie = gmina z otwartymi wnioskami; wielkosc oddaje wolumen,
    // barwa najostrzejszy priorytet, ktory tam czeka.
    const byGmina = new Map<string, { qty: number; prio: number; count: number }>();
    for (const d of index.scene.demands) {
      if (d.d > day || d.alloc) continue;
      const cur = byGmina.get(d.g) ?? { qty: 0, prio: 4, count: 0 };
      cur.qty += d.qty;
      cur.prio = Math.min(cur.prio, d.prio);
      cur.count += 1;
      byGmina.set(d.g, cur);
    }
    const out: MapPoint[] = [];
    for (const [code, agg] of byGmina) {
      const g = index.gminaById.get(code);
      if (!g) continue;
      out.push({
        id: code,
        lat: g.lat,
        lon: g.lon,
        value: (5 - agg.prio) * 22,
        label: g.name,
        detail: `${agg.count} otwartych wniosków · najwyższy priorytet ${agg.prio}`,
        alarm: agg.prio === 1,
      });
    }
    return out;
  }, [index, day]);

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

  if (!index || !decision) return null;
  const days = index.days;
  const openSeries = index.scene.country.map((c) => c.open);
  const p1Series = index.scene.country.map((c) => c.p1Open);

  const openForm = (row: DepletionRow) => {
    setSelected(row);
    // Domyslna ilosc = zapotrzebowanie na trzy doby przy biezacym tempie zuzycia.
    setQuantity(Math.max(1, Math.ceil(row.rate * 3)));
    setSupplierId(suppliersFor(index, row.res, row.v)[0]?.id ?? '');
    setComment('');
    setErrors([]);
  };

  const submit = async () => {
    if (!selected) return;
    const draft: SupplyDraft = {
      scene_day: day,
      action_type:
        selected.action === 'monitoruj' ? 'przerzut_miedzywojewodzki' : selected.action,
      voivodeship_code: selected.v,
      resource_type_id: selected.res,
      resource_name: selected.resName,
      days_of_stock: selected.dos,
      daily_rate: selected.rate,
      supplier_id: supplierId,
      lead_time_h: index.scene.suppliers.find((s) => s.id === supplierId)?.leadH ?? 0,
      quantity,
      comment,
    };
    try {
      await saveSupplyAction(draft, actor);
      await refresh();
      setToast(`Zapisano działanie zaopatrzeniowe: ${selected.resName} — ${selected.voivName}.`);
      setSelected(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const result: ValidationResult = { ok: false, errors: msg.split('. ').filter(Boolean) };
      setErrors(result.errors);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl bg-white p-4 ring-1 ring-slate-300"
            title={k.hint}
          >
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {k.label}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-slate-900">{k.value}</span>
              {k.delta !== null && k.delta !== 0 && (
                <span
                  className={`text-xs font-medium tabular-nums ${
                    (k.delta > 0) === k.inverse ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {k.delta > 0 ? '▲' : '▼'} {formatNumber(Math.abs(k.delta))}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{k.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Panel
          title="Gdzie czekają niezaspokojone potrzeby"
          subtitle="Kropka = gmina z otwartymi wnioskami. Kwadrat = magazyn. Barwa oddaje najwyższy czekający priorytet."
        >
          <CountryMap
            points={points}
            anchors={anchors}
            colorFor={(v) => priorityColor(5 - Math.round(v / 22))}
            legend={[
              { label: 'P1', value: 88 },
              { label: 'P2', value: 66 },
              { label: 'P3', value: 44 },
              { label: 'P4', value: 22 },
            ]}
            height={430}
          />
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Przebieg scenariusza"
            subtitle="Kliknij słupek, żeby przejść do wybranej doby."
          >
            <div className="mb-1 flex items-baseline justify-between text-xs text-slate-500">
              <span>Wnioski otwarte</span>
              <span className="tabular-nums">{formatNumber(openSeries[dayIndex])}</span>
            </div>
            <TimelineBars
              values={openSeries}
              labels={days}
              activeIndex={dayIndex}
              onSelect={setDayIndex}
              height={64}
            />
            <div className="mt-4 mb-1 flex items-baseline justify-between text-xs text-slate-500">
              <span>W tym priorytet 1</span>
              <span className="tabular-nums">{formatNumber(p1Series[dayIndex])}</span>
            </div>
            <Sparkline values={p1Series} marker={dayIndex} color="#d5233f" height={44} />
          </Panel>

          <Panel
            title="Rozkład wojewódzki"
            subtitle="Otwarte wnioski priorytetu 1 — kolejność interwencji."
          >
            {voivs.length === 0 ? (
              <EmptyState text="Brak zapotrzebowań w tej dobie." />
            ) : (
              <BarList
                rows={voivs.slice(0, 8).map((v) => ({
                  label: v.name,
                  value: v.p1Open,
                  hint: `${v.open} otwartych z ${v.demands} złożonych (${v.openPct}%), ${v.delayed} transportów opóźnionych`,
                }))}
                color="#d5233f"
              />
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Czy wystarczy?"
        subtitle="Przesłanki za uruchomieniem dodatkowego zaopatrzenia i przeciw niemu."
        tone={decision.suggestReserves ? 'alert' : 'default'}
        right={
          <div className="flex gap-2">
            {decision.suggestReserves && (
              <Badge className="bg-red-50 text-red-700 ring-red-600/40">
                rekomendacja: rezerwy strategiczne
              </Badge>
            )}
            {decision.suggestSpo2 && (
              <Badge className="bg-amber-50 text-amber-700 ring-amber-600/40">
                rozważ wniosek SPO-2
              </Badge>
            )}
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-700">
              Przesłanki za
            </h3>
            {decision.pros.length === 0 ? (
              <p className="text-sm text-slate-500">Brak sygnałów wymagających działania.</p>
            ) : (
              <ul className="space-y-1.5 text-sm text-slate-700">
                {decision.pros.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="text-red-700">▸</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Przesłanki przeciw
            </h3>
            {decision.cons.length === 0 ? (
              <p className="text-sm text-slate-500">
                Żaden wskaźnik nie przemawia za wstrzymaniem się z decyzją.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm text-slate-700">
                {decision.cons.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span className="text-emerald-700">▸</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      <Panel
        title="Prognoza wyczerpania zapasu"
        subtitle={`Próg krytyczny: ${index.scene.meta.criticalDaysOfStock} dni. Zapas liczony narastająco od stanu początkowego.`}
        right={
          <Button
            onClick={() =>
              downloadCsv(
                `zapasy-${day}.csv`,
                toCsv(
                  depletion.map((r) => ({
                    doba: r.d,
                    wojewodztwo: r.voivName,
                    zasob: r.resName,
                    pozostalo: r.left,
                    zuzycie_dobowe: r.rate,
                    dni_zapasu: r.dos,
                    rekomendacja: ACTION_LABEL[r.action],
                  })),
                ),
              )
            }
          >
            Eksport CSV
          </Button>
        }
      >
        {depletion.length === 0 ? (
          <EmptyState text="Brak danych o zużyciu w tej dobie." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3">Województwo</th>
                  <th className="py-2 pr-3">Zasób</th>
                  <th className="py-2 pr-3 text-right">Pozostało</th>
                  <th className="py-2 pr-3 text-right">Zużycie / dobę</th>
                  <th className="py-2 pr-3 text-right">Dni zapasu</th>
                  <th className="py-2 pr-3">Rekomendacja</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {depletion.slice(0, 14).map((r) => (
                  <tr
                    key={`${r.v}-${r.res}`}
                    className="border-b border-slate-200 hover:bg-slate-50"
                  >
                    <td className="py-2 pr-3 text-slate-700">{r.voivName}</td>
                    <td className="py-2 pr-3 text-slate-900">{r.resName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-700">
                      {formatNumber(Math.round(r.left))} {r.unit}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                      {formatNumber(Math.round(r.rate))}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <span
                        className="rounded px-2 py-0.5 text-xs font-semibold tabular-nums"
                        style={{
                          background: `${stockColor(r.dos, index.scene.meta.criticalDaysOfStock)}22`,
                          color: stockColor(r.dos, index.scene.meta.criticalDaysOfStock),
                        }}
                      >
                        {r.dos.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{ACTION_LABEL[r.action]}</td>
                    <td className="py-2 text-right">
                      <Button
                        variant={r.critical ? 'primary' : 'ghost'}
                        onClick={() => openForm(r)}
                      >
                        Uzupełnij
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {depletion.length > 14 && (
              <p className="mt-2 text-xs text-slate-500">
                Pokazano 14 z {depletion.length} pozycji, od najbardziej zagrożonych. Pełna lista w
                eksporcie CSV.
              </p>
            )}
          </div>
        )}
      </Panel>

      {supply.length > 0 && (
        <Panel title="Zapisane działania zaopatrzeniowe" subtitle="Rejestr bieżącej sesji.">
          <ul className="space-y-1.5 text-sm text-slate-700">
            {supply.slice(0, 8).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <Badge className="bg-slate-50 text-slate-700 ring-slate-300">{s.action_id}</Badge>
                <span>
                  {s.resource_name} · {s.quantity} szt. · {ACTION_LABEL[s.action_type]}
                </span>
                <span className="text-xs text-slate-500">
                  {s.author_role} · {s.scene_day}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Modal
        open={selected !== null}
        title={selected ? `Uzupełnienie zapasu: ${selected.resName}` : ''}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {selected.voivName} · zapas na {selected.dos.toFixed(1)} dnia przy zużyciu{' '}
              {formatNumber(Math.round(selected.rate))} {selected.unit} na dobę. Rekomendowane
              działanie: <strong>{ACTION_LABEL[selected.action]}</strong>.
            </div>
            <Field label="Ilość" hint="Domyślnie zapotrzebowanie na trzy doby przy bieżącym tempie.">
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className={inputClass}
              />
            </Field>
            <Field label="Dostawca" hint="Umowy ramowe posortowane wg czasu realizacji.">
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className={inputClass}
              >
                <option value="">— bez dostawcy (rezerwy / przerzut) —</option>
                {suppliersFor(index, selected.res).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.leadH} h · limit {formatNumber(s.limit)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Uzasadnienie" hint="Minimum 20 znaków — trafia do rejestru audytowego.">
              <textarea
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className={inputClass}
                placeholder="Np. Zapas wody w województwie schodzi poniżej doby przy rosnącej liczbie ewakuowanych."
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
                Zapisz działanie
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
