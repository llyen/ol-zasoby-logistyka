import { getRayfinClient, isLocalBackend } from './rayfinClient';
import { auditHash } from '@/data/model';

/**
 * Zapis zwrotny pulpitu zasobow.
 *
 * Zasady z APP_SPEC.md:
 * 1. Nic sie nie usuwa - wycofanie wniosku to zmiana statusu, korekta decyzji
 *    to nowy wiersz. Sciezka gmina -> powiat -> wojewoda -> minister -> RZZK
 *    musi dac sie odtworzyc co do kroku.
 * 2. Kazda decyzja niesie migawke przeslanek i skrot kontrolny.
 * 3. Zakres uprawnien wynika z roli: gmina widzi swoje, wojewoda swoje
 *    wojewodztwo, RCB caly kraj.
 *
 * Bez skonfigurowanego backendu dane trafiaja do pamieci, zeby aplikacje dalo
 * sie zademonstrowac offline.
 */

export type UserRole =
  | 'wójt / burmistrz'
  | 'starosta'
  | 'WCZK'
  | 'wojewoda'
  | 'RCB / ARS'
  | 'kierowca';

export const USER_ROLES: UserRole[] = [
  'wójt / burmistrz',
  'starosta',
  'WCZK',
  'wojewoda',
  'RCB / ARS',
  'kierowca',
];

/** Role uprawnione do zatwierdzania przydzialu zasobow. */
export const ALLOCATING_ROLES: UserRole[] = ['WCZK', 'wojewoda', 'RCB / ARS'];

/** Role uprawnione do uruchomienia rezerw strategicznych. */
export const RESERVE_ROLES: UserRole[] = ['RCB / ARS'];

/** Szczeble sciezki finansowej SPO-2, w kolejnosci. */
export const FINANCE_STAGES = ['wojewoda', 'minister_wiodacy', 'RZZK', 'MF'] as const;
export type FinanceStage = (typeof FINANCE_STAGES)[number];

/** Powyzej tej kwoty wniosek nie moze zamknac sie na szczeblu wojewody. */
export const HIGH_VALUE_PLN = 5_000_000;

export interface Actor {
  id: string;
  name: string;
  role: UserRole;
  /** Kod wojewodztwa; pusty = zakres krajowy. */
  voivodeshipCode: string;
  /** Kod gminy dla rol gminnych; pusty = brak ograniczenia gminnego. */
  gminaCode: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/* ------------------------------------------------------------------ */
/* Zakres widocznosci                                                  */
/* ------------------------------------------------------------------ */

/**
 * Czy aktor moze dzialac na wniosku z danej gminy i wojewodztwa.
 * Reguly sa tu, a nie w komponencie, zeby dalo sie je sprawdzic testem.
 */
export function canActOn(actor: Actor, gminaCode: string, voivodeshipCode: string): boolean {
  switch (actor.role) {
    case 'RCB / ARS':
      return true;
    case 'wojewoda':
    case 'WCZK':
      return !actor.voivodeshipCode || actor.voivodeshipCode === voivodeshipCode;
    case 'starosta':
      // Powiat wynika z pierwszych czterech znakow kodu TERYT gminy.
      return !actor.gminaCode || actor.gminaCode.slice(0, 4) === gminaCode.slice(0, 4);
    case 'wójt / burmistrz':
      return !actor.gminaCode || actor.gminaCode === gminaCode;
    case 'kierowca':
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Wniosek o zasob                                                     */
/* ------------------------------------------------------------------ */

export interface DemandRequestRecord {
  id: string;
  request_id: string;
  scene_day: string;
  gmina_code: string;
  gmina_name: string;
  voivodeship_code: string;
  resource_type_id: string;
  resource_name: string;
  quantity: number;
  unit: string;
  priority: number;
  affected_people: number;
  needed_by: string;
  justification: string;
  suggested_quantity: number;
  status: string;
  author_id: string;
  author_name: string;
  author_role: string;
  created_at: Date;
}

export type DemandDraft = Omit<
  DemandRequestRecord,
  'id' | 'request_id' | 'author_id' | 'author_name' | 'author_role' | 'created_at'
>;

export function validateDemand(draft: DemandDraft, actor: Actor): ValidationResult {
  const errors: string[] = [];
  if (!draft.gmina_code) errors.push('Wskaż gminę, której dotyczy wniosek.');
  if (!draft.resource_type_id) errors.push('Wybierz rodzaj zasobu.');
  if (!Number.isFinite(draft.quantity) || draft.quantity <= 0)
    errors.push('Ilość musi być liczbą większą od zera.');
  if (draft.priority < 1 || draft.priority > 4) errors.push('Priorytet musi mieścić się w zakresie 1–4.');
  if (draft.priority === 1) {
    if (draft.justification.trim().length < 20)
      errors.push('Priorytet 1 wymaga uzasadnienia o długości co najmniej 20 znaków.');
    if (!draft.affected_people || draft.affected_people <= 0)
      errors.push('Priorytet 1 wymaga podania liczby osób zagrożonych.');
  }
  if (draft.justification.trim().length > 1200)
    errors.push('Uzasadnienie nie może przekraczać 1200 znaków.');
  if (!draft.needed_by) errors.push('Podaj termin, do którego zasób jest potrzebny.');
  if (actor.role === 'kierowca') errors.push('Kierowca nie składa wniosków o zasoby.');
  else if (!canActOn(actor, draft.gmina_code, draft.voivodeship_code))
    errors.push('Rola nie obejmuje wskazanej gminy — wniosek złoży właściwy szczebel.');
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Decyzja workflow                                                    */
/* ------------------------------------------------------------------ */

export type ApprovalKind = 'akceptacja' | 'odrzucenie' | 'prosba_o_informacje' | 'eskalacja';

export interface ApprovalRecord {
  id: string;
  decision_id: string;
  request_id: string;
  scene_day: string;
  decision: string;
  decision_level: string;
  escalated_to: string;
  reason: string;
  voivodeship_code: string;
  resource_type_id: string;
  evidence: string;
  audit_hash: string;
  author_id: string;
  author_name: string;
  author_role: string;
  created_at: Date;
}

export interface ApprovalDraft {
  request_id: string;
  scene_day: string;
  decision: ApprovalKind;
  escalated_to: string;
  reason: string;
  voivodeship_code: string;
  gmina_code: string;
  resource_type_id: string;
  evidence: Record<string, unknown>;
}

export function validateApproval(draft: ApprovalDraft, actor: Actor): ValidationResult {
  const errors: string[] = [];
  if (!draft.request_id) errors.push('Brak wskazanego wniosku.');
  if (draft.reason.trim().length < 10)
    errors.push('Uzasadnienie decyzji musi mieć co najmniej 10 znaków — to zapis dla protokołu.');
  if (draft.reason.trim().length > 1200) errors.push('Uzasadnienie nie może przekraczać 1200 znaków.');
  if (draft.decision === 'eskalacja' && !draft.escalated_to)
    errors.push('Przy eskalacji wskaż szczebel docelowy.');
  if (draft.decision !== 'eskalacja' && draft.escalated_to)
    errors.push('Szczebel docelowy dotyczy wyłącznie eskalacji.');
  if (actor.role === 'kierowca') errors.push('Kierowca nie podejmuje decyzji o wnioskach.');
  else if (!canActOn(actor, draft.gmina_code, draft.voivodeship_code))
    errors.push('Wniosek jest poza zakresem terytorialnym roli.');
  if (draft.decision === 'akceptacja' && actor.role === 'wójt / burmistrz')
    errors.push('Wniosek gminny akceptuje starosta, WCZK albo wojewoda.');
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Przydzial                                                           */
/* ------------------------------------------------------------------ */

export type AllocationMode = 'plan_optymalizatora' | 'korekta_reczna' | 'podzial_dostawy';

export interface AllocationRecord {
  id: string;
  allocation_decision_id: string;
  demand_id: string;
  scene_day: string;
  recommended_warehouse_id: string;
  recommended_travel_h: number;
  chosen_warehouse_id: string;
  chosen_travel_h: number;
  delta_travel_h: number;
  allocated_qty: number;
  resource_type_id: string;
  priority: number;
  mode: string;
  override_reason: string;
  transport_unit_id: string;
  eta: string;
  audit_hash: string;
  author_id: string;
  author_name: string;
  author_role: string;
  created_at: Date;
}

export interface AllocationDraft {
  demand_id: string;
  scene_day: string;
  recommended_warehouse_id: string;
  recommended_travel_h: number;
  chosen_warehouse_id: string;
  chosen_travel_h: number;
  allocated_qty: number;
  resource_type_id: string;
  priority: number;
  mode: AllocationMode;
  override_reason: string;
  transport_unit_id: string;
  eta: string;
  voivodeship_code: string;
}

export function validateAllocation(draft: AllocationDraft, actor: Actor): ValidationResult {
  const errors: string[] = [];
  if (!draft.demand_id) errors.push('Brak wskazanego wniosku.');
  if (!draft.chosen_warehouse_id) errors.push('Wskaż magazyn źródłowy.');
  if (!Number.isFinite(draft.allocated_qty) || draft.allocated_qty <= 0)
    errors.push('Przydzielona ilość musi być większa od zera.');
  if (draft.mode !== 'plan_optymalizatora' && draft.override_reason.trim().length < 10)
    errors.push('Odejście od rekomendacji wymaga uzasadnienia o długości co najmniej 10 znaków.');
  if (!ALLOCATING_ROLES.includes(actor.role))
    errors.push('Przydział zasobów zatwierdza WCZK, wojewoda albo RCB.');
  else if (!canActOn(actor, '', draft.voivodeship_code))
    errors.push('Przydział dotyczy województwa spoza zakresu roli.');
  return { ok: errors.length === 0, errors };
}

/** Dodatnia wartosc = decyzja reczna wydluzyla dostawe. */
export function travelDelta(draft: AllocationDraft): number {
  return Math.round((draft.chosen_travel_h - draft.recommended_travel_h) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Potwierdzenie odbioru                                               */
/* ------------------------------------------------------------------ */

export interface DeliveryRecord {
  id: string;
  confirmation_id: string;
  transport_id: string;
  allocation_id: string;
  scene_day: string;
  gmina_code: string;
  resource_type_id: string;
  allocated_qty: number;
  received_qty: number;
  shortage_reason: string;
  delay_min: number;
  receiver_name: string;
  signature_hash: string;
  lat: number;
  lon: number;
  author_id: string;
  author_name: string;
  author_role: string;
  created_at: Date;
}

export type DeliveryDraft = Omit<
  DeliveryRecord,
  'id' | 'confirmation_id' | 'signature_hash' | 'author_id' | 'author_name' | 'author_role' | 'created_at'
>;

export function validateDelivery(draft: DeliveryDraft, actor: Actor): ValidationResult {
  const errors: string[] = [];
  if (!draft.transport_id) errors.push('Brak wskazanego transportu.');
  if (!draft.receiver_name.trim()) errors.push('Podaj osobę odbierającą dostawę.');
  if (!Number.isFinite(draft.received_qty) || draft.received_qty < 0)
    errors.push('Odebrana ilość nie może być ujemna.');
  if (draft.received_qty > draft.allocated_qty)
    errors.push('Odebrana ilość nie może przekraczać przydzielonej.');
  if (draft.received_qty < draft.allocated_qty && draft.shortage_reason.trim().length < 5)
    errors.push('Niedobór wymaga podania przyczyny — to on generuje ponowne zapotrzebowanie.');
  if (actor.role !== 'kierowca' && actor.role !== 'wójt / burmistrz' && actor.role !== 'RCB / ARS')
    errors.push('Odbiór potwierdza kierowca albo przedstawiciel gminy.');
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Sciezka finansowa SPO-2                                             */
/* ------------------------------------------------------------------ */

export interface FinanceRecord {
  id: string;
  financial_request_id: string;
  step_no: number;
  scene_day: string;
  voivodeship_code: string;
  amount_pln: number;
  purpose: string;
  linked_demands: string;
  justification: string;
  approval_path: string;
  stage: string;
  status: string;
  comment: string;
  audit_hash: string;
  author_id: string;
  author_name: string;
  author_role: string;
  created_at: Date;
}

export interface FinanceDraft {
  financial_request_id: string;
  step_no: number;
  scene_day: string;
  voivodeship_code: string;
  amount_pln: number;
  purpose: string;
  linked_demands: string[];
  justification: string;
  stage: FinanceStage;
  status: 'zlozony' | 'zaakceptowany' | 'odrzucony' | 'przekazany_dalej';
  comment: string;
}

/**
 * Sciezka akceptacji zalezy od kwoty: powyzej progu wniosek musi przejsc
 * przez RZZK i Ministerstwo Finansow, ponizej konczy sie u ministra wiodacego.
 */
export function approvalPath(amountPln: number): FinanceStage[] {
  return amountPln > HIGH_VALUE_PLN
    ? [...FINANCE_STAGES]
    : (['wojewoda', 'minister_wiodacy'] as FinanceStage[]);
}

export function validateFinance(draft: FinanceDraft, actor: Actor): ValidationResult {
  const errors: string[] = [];
  const path = approvalPath(draft.amount_pln);
  if (!Number.isFinite(draft.amount_pln) || draft.amount_pln <= 0)
    errors.push('Kwota musi być liczbą większą od zera.');
  if (draft.purpose.trim().length < 3) errors.push('Podaj przeznaczenie środków.');
  if (draft.justification.trim().length < 20)
    errors.push('Uzasadnienie musi mieć co najmniej 20 znaków.');
  if (draft.justification.trim().length > 1500)
    errors.push('Uzasadnienie nie może przekraczać 1500 znaków.');
  if (!path.includes(draft.stage))
    errors.push(
      draft.amount_pln > HIGH_VALUE_PLN
        ? `Kwota powyżej ${HIGH_VALUE_PLN / 1_000_000} mln zł wymaga ścieżki ${path.join(' > ')}.`
        : `Dla tej kwoty ścieżka akceptacji obejmuje wyłącznie ${path.join(' > ')}.`,
    );
  if (draft.amount_pln > HIGH_VALUE_PLN && draft.status === 'zaakceptowany' && draft.stage === 'wojewoda')
    errors.push(
      `Kwota powyżej ${HIGH_VALUE_PLN / 1_000_000} mln zł nie może zostać zamknięta na szczeblu wojewody — wymagany etap RZZK albo MF.`,
    );
  if (draft.step_no < 1) errors.push('Numer kroku musi być dodatni.');
  if (actor.role === 'wójt / burmistrz' || actor.role === 'kierowca')
    errors.push('Wniosek finansowy SPO-2 prowadzi wojewoda, WCZK albo RCB.');
  else if (draft.stage === 'wojewoda' && !canActOn(actor, '', draft.voivodeship_code))
    errors.push('Wniosek dotyczy województwa spoza zakresu roli.');
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Dzialanie zaopatrzeniowe                                            */
/* ------------------------------------------------------------------ */

export interface SupplyRecord {
  id: string;
  action_id: string;
  scene_day: string;
  action_type: string;
  voivodeship_code: string;
  resource_type_id: string;
  resource_name: string;
  days_of_stock: string;
  daily_rate: string;
  supplier_id: string;
  lead_time_h: string;
  quantity: string;
  comment: string;
  audit_hash: string;
  author_id: string;
  author_name: string;
  author_role: string;
  created_at: Date;
}

export interface SupplyDraft {
  scene_day: string;
  action_type: 'rezerwy_strategiczne' | 'dostawca_ramowy' | 'przerzut_miedzywojewodzki';
  voivodeship_code: string;
  resource_type_id: string;
  resource_name: string;
  days_of_stock: number;
  daily_rate: number;
  supplier_id: string;
  lead_time_h: number;
  quantity: number;
  comment: string;
}

export function validateSupply(draft: SupplyDraft, actor: Actor): ValidationResult {
  const errors: string[] = [];
  if (!draft.resource_type_id) errors.push('Wskaż zasób.');
  if (!Number.isFinite(draft.quantity) || draft.quantity <= 0)
    errors.push('Zamawiana ilość musi być większa od zera.');
  if (draft.comment.trim().length < 20)
    errors.push('Uzasadnienie działania musi mieć co najmniej 20 znaków.');
  if (draft.action_type === 'dostawca_ramowy' && !draft.supplier_id)
    errors.push('Przy zamówieniu u dostawcy wskaż dostawcę z umowy ramowej.');
  if (draft.action_type === 'rezerwy_strategiczne' && !RESERVE_ROLES.includes(actor.role))
    errors.push('Rezerwy strategiczne uruchamia wyłącznie RCB / ARS.');
  if (draft.action_type !== 'rezerwy_strategiczne' && !ALLOCATING_ROLES.includes(actor.role))
    errors.push('Działanie zaopatrzeniowe uruchamia WCZK, wojewoda albo RCB.');
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Zapis                                                               */
/* ------------------------------------------------------------------ */

const memory = {
  demands: [] as DemandRequestRecord[],
  approvals: [] as ApprovalRecord[],
  allocations: [] as AllocationRecord[],
  deliveries: [] as DeliveryRecord[],
  finance: [] as FinanceRecord[],
  supply: [] as SupplyRecord[],
};

function newId(prefix: string, day: string): string {
  const stamp = day.replace(/-/g, '').slice(4);
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

const DEMAND_COLS = [
  'id', 'request_id', 'scene_day', 'gmina_code', 'gmina_name', 'voivodeship_code',
  'resource_type_id', 'resource_name', 'quantity', 'unit', 'priority', 'affected_people',
  'needed_by', 'justification', 'suggested_quantity', 'status',
  'author_id', 'author_name', 'author_role', 'created_at',
] as const;

const APPROVAL_COLS = [
  'id', 'decision_id', 'request_id', 'scene_day', 'decision', 'decision_level', 'escalated_to',
  'reason', 'voivodeship_code', 'resource_type_id', 'evidence', 'audit_hash',
  'author_id', 'author_name', 'author_role', 'created_at',
] as const;

const ALLOCATION_COLS = [
  'id', 'allocation_decision_id', 'demand_id', 'scene_day', 'recommended_warehouse_id',
  'recommended_travel_h', 'chosen_warehouse_id', 'chosen_travel_h', 'delta_travel_h',
  'allocated_qty', 'resource_type_id', 'priority', 'mode', 'override_reason',
  'transport_unit_id', 'eta', 'audit_hash', 'author_id', 'author_name', 'author_role', 'created_at',
] as const;

const DELIVERY_COLS = [
  'id', 'confirmation_id', 'transport_id', 'allocation_id', 'scene_day', 'gmina_code',
  'resource_type_id', 'allocated_qty', 'received_qty', 'shortage_reason', 'delay_min',
  'receiver_name', 'signature_hash', 'lat', 'lon',
  'author_id', 'author_name', 'author_role', 'created_at',
] as const;

const FINANCE_COLS = [
  'id', 'financial_request_id', 'step_no', 'scene_day', 'voivodeship_code', 'amount_pln',
  'purpose', 'linked_demands', 'justification', 'approval_path', 'stage', 'status', 'comment',
  'audit_hash', 'author_id', 'author_name', 'author_role', 'created_at',
] as const;

const SUPPLY_COLS = [
  'id', 'action_id', 'scene_day', 'action_type', 'voivodeship_code', 'resource_type_id',
  'resource_name', 'days_of_stock', 'daily_rate', 'supplier_id', 'lead_time_h', 'quantity',
  'comment', 'audit_hash', 'author_id', 'author_name', 'author_role', 'created_at',
] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function readAll<T>(entityName: string, cols: readonly string[], fallback: T[]): Promise<T[]> {
  if (isLocalBackend()) return [...fallback];
  const client = getRayfinClient() as any;
  const rows = await client.data[entityName]
    .select([...cols])
    .orderBy({ created_at: 'desc' })
    .execute();
  return rows as T[];
}

async function writeOne<T extends { id: string }>(
  entityName: string,
  record: T,
  fallback: T[],
): Promise<T> {
  if (isLocalBackend()) {
    fallback.unshift(record);
    return record;
  }
  const client = getRayfinClient() as any;
  const { id: _ignored, ...payload } = record;
  void _ignored;
  const saved = await client.data[entityName].create(payload);
  return saved as T;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const listDemands = () =>
  readAll<DemandRequestRecord>('DemandRequest', DEMAND_COLS, memory.demands);
export const listApprovals = () =>
  readAll<ApprovalRecord>('ApprovalDecision', APPROVAL_COLS, memory.approvals);
export const listAllocations = () =>
  readAll<AllocationRecord>('AllocationDecision', ALLOCATION_COLS, memory.allocations);
export const listDeliveries = () =>
  readAll<DeliveryRecord>('DeliveryConfirmation', DELIVERY_COLS, memory.deliveries);
export const listFinance = () =>
  readAll<FinanceRecord>('FinancialRequestStep', FINANCE_COLS, memory.finance);
export const listSupply = () => readAll<SupplyRecord>('SupplyAction', SUPPLY_COLS, memory.supply);

export async function saveDemand(draft: DemandDraft, actor: Actor): Promise<DemandRequestRecord> {
  const v = validateDemand(draft, actor);
  if (!v.ok) throw new Error(v.errors.join(' '));
  const record: DemandRequestRecord = {
    ...draft,
    justification: draft.justification.trim(),
    id: crypto.randomUUID(),
    request_id: newId('WN', draft.scene_day),
    author_id: actor.id,
    author_name: actor.name,
    author_role: actor.role,
    created_at: new Date(),
  };
  return writeOne('DemandRequest', record, memory.demands);
}

export async function saveApproval(draft: ApprovalDraft, actor: Actor): Promise<ApprovalRecord> {
  const v = validateApproval(draft, actor);
  if (!v.ok) throw new Error(v.errors.join(' '));
  const record: ApprovalRecord = {
    id: crypto.randomUUID(),
    decision_id: newId('DEC', draft.scene_day),
    request_id: draft.request_id,
    scene_day: draft.scene_day,
    decision: draft.decision,
    decision_level: actor.role,
    escalated_to: draft.escalated_to,
    reason: draft.reason.trim(),
    voivodeship_code: draft.voivodeship_code,
    resource_type_id: draft.resource_type_id,
    evidence: JSON.stringify(draft.evidence).slice(0, 2000),
    audit_hash: auditHash({ r: draft.request_id, d: draft.decision, e: draft.evidence }),
    author_id: actor.id,
    author_name: actor.name,
    author_role: actor.role,
    created_at: new Date(),
  };
  return writeOne('ApprovalDecision', record, memory.approvals);
}

export async function saveAllocation(draft: AllocationDraft, actor: Actor): Promise<AllocationRecord> {
  const v = validateAllocation(draft, actor);
  if (!v.ok) throw new Error(v.errors.join(' '));
  const record: AllocationRecord = {
    id: crypto.randomUUID(),
    allocation_decision_id: newId('PRZ', draft.scene_day),
    demand_id: draft.demand_id,
    scene_day: draft.scene_day,
    recommended_warehouse_id: draft.recommended_warehouse_id,
    recommended_travel_h: draft.recommended_travel_h,
    chosen_warehouse_id: draft.chosen_warehouse_id,
    chosen_travel_h: draft.chosen_travel_h,
    delta_travel_h: travelDelta(draft),
    allocated_qty: draft.allocated_qty,
    resource_type_id: draft.resource_type_id,
    priority: draft.priority,
    mode: draft.mode,
    override_reason: draft.override_reason.trim(),
    transport_unit_id: draft.transport_unit_id,
    eta: draft.eta,
    audit_hash: auditHash({
      d: draft.demand_id,
      w: draft.chosen_warehouse_id,
      q: draft.allocated_qty,
      m: draft.mode,
    }),
    author_id: actor.id,
    author_name: actor.name,
    author_role: actor.role,
    created_at: new Date(),
  };
  return writeOne('AllocationDecision', record, memory.allocations);
}

export async function saveDelivery(draft: DeliveryDraft, actor: Actor): Promise<DeliveryRecord> {
  const v = validateDelivery(draft, actor);
  if (!v.ok) throw new Error(v.errors.join(' '));
  const record: DeliveryRecord = {
    ...draft,
    id: crypto.randomUUID(),
    confirmation_id: newId('ODB', draft.scene_day),
    signature_hash: auditHash({
      t: draft.transport_id,
      r: draft.receiver_name,
      q: draft.received_qty,
      a: actor.id,
    }),
    author_id: actor.id,
    author_name: actor.name,
    author_role: actor.role,
    created_at: new Date(),
  };
  return writeOne('DeliveryConfirmation', record, memory.deliveries);
}

export async function saveFinanceStep(draft: FinanceDraft, actor: Actor): Promise<FinanceRecord> {
  const v = validateFinance(draft, actor);
  if (!v.ok) throw new Error(v.errors.join(' '));
  const record: FinanceRecord = {
    id: crypto.randomUUID(),
    financial_request_id: draft.financial_request_id || newId('FIN', draft.scene_day),
    step_no: draft.step_no,
    scene_day: draft.scene_day,
    voivodeship_code: draft.voivodeship_code,
    amount_pln: Math.round(draft.amount_pln),
    purpose: draft.purpose.trim(),
    linked_demands: draft.linked_demands.join(',').slice(0, 600),
    justification: draft.justification.trim(),
    approval_path: approvalPath(draft.amount_pln).join('>'),
    stage: draft.stage,
    status: draft.status,
    comment: draft.comment.trim(),
    audit_hash: auditHash({
      f: draft.financial_request_id,
      s: draft.step_no,
      a: draft.amount_pln,
      st: draft.stage,
    }),
    author_id: actor.id,
    author_name: actor.name,
    author_role: actor.role,
    created_at: new Date(),
  };
  return writeOne('FinancialRequestStep', record, memory.finance);
}

export async function saveSupplyAction(draft: SupplyDraft, actor: Actor): Promise<SupplyRecord> {
  const v = validateSupply(draft, actor);
  if (!v.ok) throw new Error(v.errors.join(' '));
  const record: SupplyRecord = {
    id: crypto.randomUUID(),
    action_id: newId('ZAO', draft.scene_day),
    scene_day: draft.scene_day,
    action_type: draft.action_type,
    voivodeship_code: draft.voivodeship_code,
    resource_type_id: draft.resource_type_id,
    resource_name: draft.resource_name,
    days_of_stock: String(draft.days_of_stock),
    daily_rate: String(draft.daily_rate),
    supplier_id: draft.supplier_id,
    lead_time_h: String(draft.lead_time_h),
    quantity: String(draft.quantity),
    comment: draft.comment.trim(),
    audit_hash: auditHash({
      r: draft.resource_type_id,
      v: draft.voivodeship_code,
      t: draft.action_type,
      q: draft.quantity,
    }),
    author_id: actor.id,
    author_name: actor.name,
    author_role: actor.role,
    created_at: new Date(),
  };
  return writeOne('SupplyAction', record, memory.supply);
}

/** Kroki jednego wniosku finansowego w kolejnosci. */
export function financeTrail(rows: FinanceRecord[], requestId: string): FinanceRecord[] {
  return rows.filter((r) => r.financial_request_id === requestId).sort((a, b) => a.step_no - b.step_no);
}

/** Kolejny etap sciezki po biezacym; null gdy wniosek jest domkniety. */
export function nextStage(amountPln: number, current: FinanceStage): FinanceStage | null {
  const path = approvalPath(amountPln);
  const i = path.indexOf(current);
  return i >= 0 && i + 1 < path.length ? path[i + 1] : null;
}
