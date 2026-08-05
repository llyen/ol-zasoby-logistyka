import { useMemo, useState } from 'react';

import { formatPln, formatNumber, toCsv } from '@/data/model';
import { useScenario } from '@/hooks/ScenarioContext';
import {
  approvalPath,
  financeTrail,
  HIGH_VALUE_PLN,
  nextStage,
  saveFinanceStep,
  validateFinance,
  FINANCE_STAGES,
  type FinanceDraft,
  type FinanceStage,
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

const STAGE_LABEL: Record<FinanceStage, string> = {
  wojewoda: 'wojewoda',
  minister_wiodacy: 'minister wiodący',
  RZZK: 'RZZK',
  MF: 'Ministerstwo Finansów',
};

const STATUS_STYLE: Record<string, string> = {
  zlozony: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
  przekazany_dalej: 'bg-sky-500/15 text-sky-300 ring-sky-500/40',
  zaakceptowany: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
  odrzucony: 'bg-red-500/15 text-red-300 ring-red-500/40',
};

export function FinancePage() {
  const { index, day, actor, refresh, finance } = useScenario();
  const [newOpen, setNewOpen] = useState(false);
  const [trailFor, setTrailFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [form, setForm] = useState({
    voivodeship: '',
    amount: 0,
    purpose: '',
    justification: '',
    stage: 'wojewoda' as FinanceStage,
    status: 'zlozony' as FinanceDraft['status'],
    comment: '',
    requestId: '',
    stepNo: 1,
  });

  /** Wnioski ze sceny do biezacej doby - tlo dla wlasnych wpisow. */
  const sceneRows = useMemo(
    () => (index ? index.scene.finance.filter((f) => f.d <= day) : []),
    [index, day],
  );

  const myRequests = useMemo(() => {
    const ids = new Set(finance.map((f) => f.financial_request_id));
    return [...ids];
  }, [finance]);

  if (!index) return null;

  const sceneTotal = sceneRows.reduce((a, f) => a + f.amount, 0);
  const myTotal = finance
    .filter((f) => f.step_no === 1)
    .reduce((a, f) => a + f.amount_pln, 0);
  const path = approvalPath(form.amount);

  const submit = async () => {
    const draft: FinanceDraft = {
      financial_request_id: form.requestId,
      step_no: form.stepNo,
      scene_day: day,
      voivodeship_code: form.voivodeship,
      amount_pln: form.amount,
      purpose: form.purpose,
      linked_demands: [],
      justification: form.justification,
      stage: form.stage,
      status: form.status,
      comment: form.comment,
    };
    const v = validateFinance(draft, actor);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    try {
      const saved = await saveFinanceStep(draft, actor);
      await refresh();
      setToast(
        `Zapisano krok ${saved.step_no} wniosku ${saved.financial_request_id} (${STAGE_LABEL[saved.stage as FinanceStage] ?? saved.stage}).`,
      );
      setNewOpen(false);
      setErrors([]);
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  };

  const startNew = () => {
    setForm({
      voivodeship: actor.voivodeshipCode || index.scene.voivodeships[0]?.v || '',
      amount: 0,
      purpose: '',
      justification: '',
      stage: 'wojewoda',
      status: 'zlozony',
      comment: '',
      requestId: '',
      stepNo: 1,
    });
    setErrors([]);
    setNewOpen(true);
  };

  const continueRequest = (requestId: string) => {
    const trail = financeTrail(finance, requestId);
    const last = trail[trail.length - 1];
    if (!last) return;
    const next = nextStage(last.amount_pln, last.stage as FinanceStage);
    setForm({
      voivodeship: last.voivodeship_code,
      amount: last.amount_pln,
      purpose: last.purpose,
      justification: last.justification,
      stage: next ?? (last.stage as FinanceStage),
      status: next ? 'przekazany_dalej' : 'zaakceptowany',
      comment: '',
      requestId,
      stepNo: last.step_no + 1,
    });
    setErrors([]);
    setNewOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Wnioski w scenariuszu" value={formatNumber(sceneRows.length)} />
        <Metric label="Kwota w scenariuszu" value={formatPln(sceneTotal)} tone="amber" />
        <Metric label="Wnioski zapisane w aplikacji" value={formatNumber(myRequests.length)} tone="cyan" />
        <Metric label="Kwota zapisana" value={formatPln(myTotal)} tone="cyan" />
      </div>

      <Panel
        title="Ścieżka akceptacji środków"
        subtitle={`Kwota powyżej ${formatPln(HIGH_VALUE_PLN)} nie może zamknąć się na szczeblu wojewody — wymaga RZZK i Ministerstwa Finansów.`}
        tone="accent"
        right={
          <Button variant="primary" onClick={startNew}>
            + Nowy wniosek
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {FINANCE_STAGES.map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              <span className="rounded-lg bg-slate-800 px-3 py-1.5 text-slate-200 ring-1 ring-slate-600">
                {STAGE_LABEL[s]}
              </span>
              {i < FINANCE_STAGES.length - 1 && <span className="text-slate-600">→</span>}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Dla kwot do {formatPln(HIGH_VALUE_PLN)} ścieżka kończy się na ministrze wiodącym. Każdy
          krok to osobny wpis z tym samym identyfikatorem wniosku — historii nie da się nadpisać.
        </p>
      </Panel>

      {myRequests.length > 0 && (
        <Panel title="Wnioski prowadzone w aplikacji" subtitle="Kliknij, żeby zobaczyć pełną ścieżkę.">
          <div className="space-y-2">
            {myRequests.map((id) => {
              const trail = financeTrail(finance, id);
              const last = trail[trail.length - 1];
              const next = nextStage(last.amount_pln, last.stage as FinanceStage);
              return (
                <div
                  key={id}
                  className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-800/40 px-3 py-2"
                >
                  <Badge className="bg-slate-800 text-slate-300 ring-slate-600">{id}</Badge>
                  <span className="text-sm text-slate-200">{formatPln(last.amount_pln)}</span>
                  <span className="text-sm text-slate-400">{last.purpose}</span>
                  <Badge className={STATUS_STYLE[last.status] ?? 'bg-slate-800 text-slate-300 ring-slate-600'}>
                    {STAGE_LABEL[last.stage as FinanceStage] ?? last.stage} · {last.status}
                  </Badge>
                  <span className="text-xs text-slate-500">{trail.length} kroków</span>
                  <div className="ml-auto flex gap-2">
                    <Button variant="ghost" onClick={() => setTrailFor(id)}>
                      Ścieżka
                    </Button>
                    {next && (
                      <Button onClick={() => continueRequest(id)}>
                        Przekaż do: {STAGE_LABEL[next]}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel
        title="Wnioski finansowe w scenariuszu"
        subtitle="Tło danych — wnioski wygenerowane wraz ze sceną."
        right={
          <Button
            onClick={() =>
              downloadCsv(
                `finanse-${day}.csv`,
                toCsv(
                  sceneRows.map((f) => ({
                    id: f.id,
                    doba: f.d,
                    wnioskodawca: f.by,
                    wojewodztwo: index.voivById.get(f.v)?.name ?? f.v,
                    kwota_pln: f.amount,
                    przeznaczenie: f.purpose,
                    status: f.status,
                    sciezka: f.path.join(' > '),
                  })),
                ),
              )
            }
          >
            Eksport CSV
          </Button>
        }
      >
        {sceneRows.length === 0 ? (
          <EmptyState text="Brak wniosków finansowych do tej doby." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">Doba</th>
                  <th className="py-2 pr-3">Wnioskodawca</th>
                  <th className="py-2 pr-3">Województwo</th>
                  <th className="py-2 pr-3 text-right">Kwota</th>
                  <th className="py-2 pr-3">Przeznaczenie</th>
                  <th className="py-2 pr-3">Ścieżka</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {sceneRows.slice(0, 40).map((f) => (
                  <tr key={f.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                    <td className="py-2 pr-3 tabular-nums text-slate-400">{f.d}</td>
                    <td className="py-2 pr-3 text-slate-300">{f.by}</td>
                    <td className="py-2 pr-3 text-slate-200">
                      {index.voivById.get(f.v)?.name ?? f.v}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        f.amount > HIGH_VALUE_PLN ? 'font-semibold text-amber-300' : 'text-slate-300'
                      }`}
                    >
                      {formatPln(f.amount)}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">{f.purpose}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{f.path.join(' > ')}</td>
                    <td className="py-2 pr-3">
                      <Badge
                        className={STATUS_STYLE[f.status] ?? 'bg-slate-800 text-slate-300 ring-slate-600'}
                      >
                        {f.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sceneRows.length > 40 && (
              <p className="mt-2 text-xs text-slate-500">
                Pokazano 40 z {formatNumber(sceneRows.length)} wniosków. Pełna lista w eksporcie CSV.
              </p>
            )}
          </div>
        )}
      </Panel>

      <Modal
        open={newOpen}
        title={form.requestId ? `Kolejny krok wniosku ${form.requestId}` : 'Nowy wniosek o środki SPO-2'}
        onClose={() => setNewOpen(false)}
        wide
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Województwo">
            <select
              value={form.voivodeship}
              onChange={(e) => setForm({ ...form, voivodeship: e.target.value })}
              className={inputClass}
              disabled={form.stepNo > 1}
            >
              {index.scene.voivodeships.map((v) => (
                <option key={v.v} value={v.v}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Kwota (zł)"
            hint={`Ścieżka dla tej kwoty: ${path.map((s) => STAGE_LABEL[s]).join(' → ')}.`}
          >
            <input
              type="number"
              min={0}
              step={100000}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              className={inputClass}
              disabled={form.stepNo > 1}
            />
          </Field>
          <Field label="Przeznaczenie">
            <input
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              className={inputClass}
              placeholder="Np. zakup agregatów prądotwórczych"
              disabled={form.stepNo > 1}
            />
          </Field>
          <Field label="Etap">
            <select
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value as FinanceStage })}
              className={inputClass}
            >
              {path.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rozstrzygnięcie">
            <select
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as FinanceDraft['status'] })
              }
              className={inputClass}
            >
              <option value="zlozony">złożony</option>
              <option value="przekazany_dalej">przekazany dalej</option>
              <option value="zaakceptowany">zaakceptowany</option>
              <option value="odrzucony">odrzucony</option>
            </select>
          </Field>
          <Field label="Numer kroku">
            <input
              type="number"
              min={1}
              value={form.stepNo}
              onChange={(e) => setForm({ ...form, stepNo: Number(e.target.value) })}
              className={inputClass}
              disabled
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Uzasadnienie" hint="Minimum 20 znaków.">
              <textarea
                rows={3}
                value={form.justification}
                onChange={(e) => setForm({ ...form, justification: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Komentarz do etapu" hint="Opcjonalny — uzasadnienie decyzji na tym szczeblu.">
              <textarea
                rows={2}
                value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
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
            <Button variant="primary" onClick={() => void submit()}>
              Zapisz krok
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={trailFor !== null}
        title={trailFor ? `Ścieżka wniosku ${trailFor}` : ''}
        onClose={() => setTrailFor(null)}
      >
        {trailFor && (
          <ol className="space-y-3">
            {financeTrail(finance, trailFor).map((s) => (
              <li key={s.id} className="rounded-lg bg-slate-800/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">krok {s.step_no}</span>
                  <Badge className={STATUS_STYLE[s.status] ?? 'bg-slate-800 text-slate-300 ring-slate-600'}>
                    {STAGE_LABEL[s.stage as FinanceStage] ?? s.stage} · {s.status}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    {s.author_name} ({s.author_role})
                  </span>
                </div>
                {s.comment && <p className="mt-1.5 text-sm text-slate-300">{s.comment}</p>}
                <p className="mt-1 font-mono text-[10px] text-slate-600">{s.audit_hash}</p>
              </li>
            ))}
          </ol>
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
}: {
  label: string;
  value: string;
  tone?: 'default' | 'amber' | 'cyan';
}) {
  const color = {
    default: 'text-slate-50',
    amber: 'text-amber-300',
    cyan: 'text-cyan-300',
  }[tone];
  return (
    <div className="rounded-xl bg-slate-900/80 p-4 ring-1 ring-slate-700/60">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
