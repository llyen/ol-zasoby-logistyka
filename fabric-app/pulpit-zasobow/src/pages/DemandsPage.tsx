import { useMemo, useState } from 'react';

import {
  breachesSla,
  demandRows,
  formatHours,
  formatNumber,
  priorityColor,
  suggestQuantity,
  toCsv,
  type DemandRow,
} from '@/data/model';
import { useScenario } from '@/hooks/ScenarioContext';
import {
  canActOn,
  saveApproval,
  saveDemand,
  validateDemand,
  type ApprovalDraft,
  type ApprovalKind,
  type DemandDraft,
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

const STATUS_STYLE: Record<DemandRow['status'], string> = {
  oczekuje: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
  przydzielony: 'bg-sky-500/15 text-sky-300 ring-sky-500/40',
  'w transporcie': 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/40',
  dostarczony: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
  opóźniony: 'bg-red-500/15 text-red-300 ring-red-500/40',
};

const DECISION_LABEL: Record<ApprovalKind, string> = {
  akceptacja: 'Akceptuj',
  odrzucenie: 'Odrzuć',
  prosba_o_informacje: 'Poproś o informacje',
  eskalacja: 'Eskaluj',
};

const ESCALATION_TARGETS = ['starosta', 'wojewoda', 'minister wiodący', 'RZZK'];

export function DemandsPage() {
  const { index, day, actor, refresh, approvals, demands: written } = useScenario();
  const [statusFilter, setStatusFilter] = useState('');
  const [prioFilter, setPrioFilter] = useState('');
  const [onlyMyScope, setOnlyMyScope] = useState(false);
  const [decisionFor, setDecisionFor] = useState<DemandRow | null>(null);
  const [kind, setKind] = useState<ApprovalKind>('akceptacja');
  const [escalatedTo, setEscalatedTo] = useState('');
  const [reason, setReason] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [form, setForm] = useState({
    gmina: '',
    res: '',
    qty: 0,
    prio: 2,
    people: 0,
    neededBy: '',
    justification: '',
  });

  const rows = useMemo(() => (index ? demandRows(index, day) : []), [index, day]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (statusFilter && r.status !== statusFilter) return false;
        if (prioFilter && String(r.prio) !== prioFilter) return false;
        if (onlyMyScope && !canActOn(actor, r.g, r.v)) return false;
        return true;
      }),
    [rows, statusFilter, prioFilter, onlyMyScope, actor],
  );

  if (!index) return null;

  const open = rows.filter((r) => r.status === 'oczekuje');
  const breaches = open.filter((r) => breachesSla(r));
  const resource = index.resById.get(form.res);
  const suggestion = suggestQuantity(resource, form.people);
  const gmina = index.gminaById.get(form.gmina);

  const resetForm = () => {
    setForm({ gmina: '', res: '', qty: 0, prio: 2, people: 0, neededBy: '', justification: '' });
    setErrors([]);
  };

  const submitDemand = async () => {
    const draft: DemandDraft = {
      scene_day: day,
      gmina_code: form.gmina,
      gmina_name: gmina?.name ?? '',
      voivodeship_code: gmina?.v ?? '',
      resource_type_id: form.res,
      resource_name: resource?.name ?? '',
      quantity: form.qty,
      unit: resource?.unit ?? '',
      priority: form.prio,
      affected_people: form.people,
      needed_by: form.neededBy,
      justification: form.justification,
      suggested_quantity: suggestion?.qty ?? 0,
      status: 'zlozony',
    };
    const v = validateDemand(draft, actor);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    try {
      const saved = await saveDemand(draft, actor);
      await refresh();
      setToast(`Złożono wniosek ${saved.request_id}.`);
      setNewOpen(false);
      resetForm();
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  };

  const submitDecision = async () => {
    if (!decisionFor) return;
    const draft: ApprovalDraft = {
      request_id: decisionFor.id,
      scene_day: day,
      decision: kind,
      escalated_to: kind === 'eskalacja' ? escalatedTo : '',
      reason,
      voivodeship_code: decisionFor.v,
      gmina_code: decisionFor.g,
      resource_type_id: decisionFor.res,
      evidence: {
        priorytet: decisionFor.prio,
        ilosc: decisionFor.qty,
        zasob: decisionFor.resName,
        gmina: decisionFor.gminaName,
        oczekuje_h: decisionFor.ageH,
        sla_zlamane: breachesSla(decisionFor),
      },
    };
    try {
      const saved = await saveApproval(draft, actor);
      await refresh();
      setToast(`Zapisano decyzję ${saved.decision_id} dla wniosku ${decisionFor.id}.`);
      setDecisionFor(null);
      setReason('');
      setEscalatedTo('');
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Wnioski w scenariuszu" value={rows.length} />
        <Metric label="Oczekujące" value={open.length} tone="amber" />
        <Metric
          label="Złamane SLA priorytetu 1"
          value={breaches.length}
          tone={breaches.length ? 'red' : 'default'}
          hint="Priorytet 1 czekający dłużej niż 2 godziny."
        />
        <Metric label="Zapisane w aplikacji" value={written.length + approvals.length} tone="cyan" />
      </div>

      <Panel
        title="Kolejka wniosków"
        subtitle="Sortowanie: priorytet, potem czas oczekiwania. Czerwona ramka = złamane SLA."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={prioFilter}
              onChange={(e) => setPrioFilter(e.target.value)}
              className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-600"
              aria-label="Priorytet"
            >
              <option value="">wszystkie priorytety</option>
              {[1, 2, 3, 4].map((p) => (
                <option key={p} value={p}>
                  priorytet {p}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-600"
              aria-label="Status"
            >
              <option value="">wszystkie statusy</option>
              {Object.keys(STATUS_STYLE).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={onlyMyScope}
                onChange={(e) => setOnlyMyScope(e.target.checked)}
                className="accent-cyan-500"
              />
              tylko mój zakres
            </label>
            <Button
              onClick={() =>
                downloadCsv(
                  `wnioski-${day}.csv`,
                  toCsv(
                    filtered.map((r) => ({
                      id: r.id,
                      doba: r.d,
                      godzina: r.ts,
                      gmina: r.gminaName,
                      wojewodztwo: r.voivName,
                      zasob: r.resName,
                      ilosc: r.qty,
                      jednostka: r.unit,
                      priorytet: r.prio,
                      status: r.status,
                      oczekuje_h: r.ageH,
                      uzasadnienie: r.why,
                    })),
                  ),
                )
              }
            >
              Eksport CSV
            </Button>
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              + Złóż wniosek
            </Button>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState text="Brak wniosków spełniających filtry." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">P</th>
                  <th className="py-2 pr-3">Gmina</th>
                  <th className="py-2 pr-3">Zasób</th>
                  <th className="py-2 pr-3 text-right">Ilość</th>
                  <th className="py-2 pr-3 text-right">Czeka</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Uzasadnienie</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 60).map((r) => {
                  const sla = breachesSla(r);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-slate-800/60 hover:bg-slate-800/40 ${
                        sla ? 'bg-red-500/5' : ''
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
                      <td className="py-2 pr-3 text-slate-200">
                        {r.gminaName}
                        <span className="ml-1 text-xs text-slate-500">{r.voivName}</span>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">{r.resName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-300">
                        {formatNumber(r.qty)} {r.unit}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right tabular-nums ${
                          sla ? 'font-semibold text-red-400' : 'text-slate-400'
                        }`}
                      >
                        {formatHours(r.ageH)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge className={STATUS_STYLE[r.status]}>{r.status}</Badge>
                      </td>
                      <td className="max-w-[260px] truncate py-2 pr-3 text-xs text-slate-500" title={r.why}>
                        {r.why}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant={sla ? 'danger' : 'ghost'}
                          onClick={() => {
                            setDecisionFor(r);
                            setKind('akceptacja');
                            setReason('');
                            setErrors([]);
                          }}
                        >
                          Decyzja
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 60 && (
              <p className="mt-2 text-xs text-slate-500">
                Pokazano 60 z {filtered.length} wniosków. Pełna lista w eksporcie CSV.
              </p>
            )}
          </div>
        )}
      </Panel>

      {approvals.length > 0 && (
        <Panel title="Podjęte decyzje" subtitle="Rejestr bieżącej sesji, w kolejności zapisu.">
          <ul className="space-y-1.5 text-sm text-slate-300">
            {approvals.slice(0, 10).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Badge className="bg-slate-800 text-slate-300 ring-slate-600">{a.decision}</Badge>
                <span>
                  {a.request_id} · {a.decision_level}
                  {a.escalated_to && ` → ${a.escalated_to}`}
                </span>
                <span className="text-xs text-slate-500">{a.reason.slice(0, 80)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Modal
        open={decisionFor !== null}
        title={decisionFor ? `Decyzja o wniosku ${decisionFor.id}` : ''}
        onClose={() => setDecisionFor(null)}
      >
        {decisionFor && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-800/60 p-3 text-sm text-slate-300">
              {decisionFor.gminaName} · {formatNumber(decisionFor.qty)} {decisionFor.unit}{' '}
              {decisionFor.resName} · priorytet {decisionFor.prio} · czeka{' '}
              {formatHours(decisionFor.ageH)}
              {breachesSla(decisionFor) && (
                <span className="ml-2 font-semibold text-red-400">SLA złamane</span>
              )}
              <p className="mt-1 text-xs text-slate-400">{decisionFor.why}</p>
            </div>
            <Field label="Rodzaj decyzji">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DECISION_LABEL) as ApprovalKind[]).map((k) => (
                  <Button
                    key={k}
                    variant={kind === k ? 'primary' : 'default'}
                    onClick={() => setKind(k)}
                  >
                    {DECISION_LABEL[k]}
                  </Button>
                ))}
              </div>
            </Field>
            {kind === 'eskalacja' && (
              <Field label="Szczebel docelowy">
                <select
                  value={escalatedTo}
                  onChange={(e) => setEscalatedTo(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— wybierz —</option>
                  {ESCALATION_TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Uzasadnienie" hint="Minimum 10 znaków — zapis dla protokołu.">
              <textarea
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={inputClass}
              />
            </Field>
            {errors.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDecisionFor(null)}>
                Anuluj
              </Button>
              <Button variant="primary" onClick={() => void submitDecision()}>
                Zapisz decyzję
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={newOpen} title="Nowy wniosek o zasób" onClose={() => setNewOpen(false)} wide>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Gmina">
            <select
              value={form.gmina}
              onChange={(e) => setForm({ ...form, gmina: e.target.value })}
              className={inputClass}
            >
              <option value="">— wybierz —</option>
              {index.scene.gminas.map((g) => (
                <option key={g.g} value={g.g}>
                  {g.name} ({index.voivById.get(g.v)?.name})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Zasób">
            <select
              value={form.res}
              onChange={(e) => setForm({ ...form, res: e.target.value })}
              className={inputClass}
            >
              <option value="">— wybierz —</option>
              {index.scene.resourceTypes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.unit})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Liczba osób objętych" hint="Podstawa kalkulatora norm.">
            <input
              type="number"
              min={0}
              value={form.people}
              onChange={(e) => setForm({ ...form, people: Number(e.target.value) })}
              className={inputClass}
            />
          </Field>
          <Field
            label="Ilość"
            hint={
              suggestion
                ? `Kalkulator norm podpowiada ${formatNumber(suggestion.qty)} ${resource?.unit ?? ''} — ${suggestion.rule}.`
                : 'Dla tego zasobu nie ma ustalonej normy — podaj ilość samodzielnie.'
            }
          >
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={form.qty}
                onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })}
                className={inputClass}
              />
              {suggestion && (
                <Button onClick={() => setForm({ ...form, qty: suggestion.qty })}>Użyj normy</Button>
              )}
            </div>
          </Field>
          <Field label="Priorytet" hint="1 wymaga uzasadnienia i liczby osób zagrożonych.">
            <select
              value={form.prio}
              onChange={(e) => setForm({ ...form, prio: Number(e.target.value) })}
              className={inputClass}
            >
              <option value={1}>1 — zagrożenie życia</option>
              <option value={2}>2 — pilne</option>
              <option value={3}>3 — standardowe</option>
              <option value={4}>4 — planowe</option>
            </select>
          </Field>
          <Field label="Termin realizacji">
            <input
              type="datetime-local"
              value={form.neededBy}
              onChange={(e) => setForm({ ...form, neededBy: e.target.value })}
              className={inputClass}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Uzasadnienie" hint="Priorytet 1 wymaga minimum 20 znaków.">
              <textarea
                rows={3}
                value={form.justification}
                onChange={(e) => setForm({ ...form, justification: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          {errors.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-red-500/10 p-3 text-sm text-red-300 md:col-span-2">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2 md:col-span-2">
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Anuluj
            </Button>
            <Button variant="primary" onClick={() => void submitDemand()}>
              Złóż wniosek
            </Button>
          </div>
        </div>
      </Modal>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'amber' | 'red' | 'cyan';
  hint?: string;
}) {
  const color = {
    default: 'text-slate-50',
    amber: 'text-amber-300',
    red: 'text-red-400',
    cyan: 'text-cyan-300',
  }[tone];
  return (
    <div className="rounded-xl bg-slate-900/80 p-4 ring-1 ring-slate-700/60" title={hint}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>
        {formatNumber(value)}
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
