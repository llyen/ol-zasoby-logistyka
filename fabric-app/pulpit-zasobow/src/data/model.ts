/**
 * Warstwa domenowa aplikacji logistycznej.
 *
 * Funkcje sa czyste i przyjmuja SceneIndex, dzieki czemu testy wczytuja scene
 * przez readFileSync, bez srodowiska przegladarki. Scena jest statyczna i
 * deterministyczna - zrodlem jest tools/build_scene.py.
 */

export interface SceneMeta {
  days: string[];
  d0: string;
  generated: string;
  criticalDaysOfStock: number;
  delayAlertMin: number;
  decisionLevels: string[];
}

export interface Voivodeship {
  v: string;
  name: string;
}

export interface ResourceType {
  id: string;
  name: string;
  unit: string;
  cat: string;
  setupH: number;
  operator: boolean;
}

export interface Warehouse {
  id: string;
  name: string;
  owner: string;
  v: string;
  lat: number;
  lon: number;
  ramp: boolean;
  h24: boolean;
}

export interface Gmina {
  g: string;
  name: string;
  p: string;
  v: string;
  pop: number;
  lat: number;
  lon: number;
}

export interface Demand {
  id: string;
  d: string;
  ts: string;
  g: string;
  v: string;
  res: string;
  qty: number;
  prio: number;
  why: string;
  by: string;
  alloc: string | null;
}

export interface Allocation {
  id: string;
  demand: string;
  wh: string;
  qty: number;
  unit: string;
  eta: string;
  status: string;
  level: string;
}

export interface Transport {
  id: string;
  alloc: string;
  demand: string | null;
  wh: string | null;
  gmina: string | null;
  res: string | null;
  qty: number;
  prio: number;
  status: string;
  delay: number;
  maxDelay: number;
  start: string;
  end: string;
  eta: string;
  path: number[][];
  lat: number;
  lon: number;
}

export interface Plan {
  demand: string;
  prio: number;
  res: string;
  gmina: string | null;
  v: string | null;
  qty: number;
  /** Liczba wierszy przydzialu; >1 oznacza dostawe dzielona miedzy magazyny. */
  parts: number;
  optWh: string;
  optH: number;
  fifoWh: string | null;
  fifoH: number | null;
  day: string;
}

export interface PlanKpi {
  count: number;
  comparable: number;
  onlyOptimizer: number;
  optAvgH: number;
  fifoAvgH: number;
  savedH: number;
  p1Count: number;
  p1OptAvgH: number;
  p1FifoAvgH: number;
  improved: number;
  worse: number;
  totalSavedH: number;
}

export interface Coverage {
  gmina: string;
  name: string;
  v: string;
  wh: string;
  h: number;
  h2: number;
  gap: boolean;
}

export interface Depletion {
  d: string;
  v: string;
  res: string;
  left: number;
  rate: number;
  dos: number;
}

export interface CountryDay {
  d: string;
  demands: number;
  newDemands: number;
  open: number;
  p1Open: number;
  served: number;
  inTransit: number;
  delayed: number;
  delivered: number;
  shelterCap: number;
  shelterOcc: number;
  sheltersFull: number;
  medical: number;
  roadsBlocked: number;
  roadsHindered: number;
  criticalStock: number;
}

export interface VoivDay {
  d: string;
  v: string;
  demands: number;
  open: number;
  p1Open: number;
  qty: number;
  delayed: number;
  crit: number;
}

export interface Road {
  id: string;
  v: string;
  name: string;
  status: string;
  reason: string;
  lat: number;
  lon: number;
}

export interface Shelter {
  id: string;
  name: string;
  g: string;
  type: string;
  cap: number;
  med: boolean;
  acc: boolean;
  lat: number;
  lon: number;
}

export interface ShelterDay {
  d: string;
  id: string;
  occ: number;
  cap: number;
  med: number;
}

export interface Supplier {
  id: string;
  name: string;
  cat: string;
  v: string;
  leadH: number;
  limit: number;
}

export interface TransportUnit {
  id: string;
  type: string;
  payload: number;
  speed: number;
  base: string;
}

export interface FinanceRequest {
  id: string;
  d: string;
  by: string;
  v: string;
  amount: number;
  purpose: string;
  status: string;
  path: string[];
}

export interface WhatIf {
  name: string;
  effect: string;
  fix: string;
}

export interface Scene {
  meta: SceneMeta;
  voivodeships: Voivodeship[];
  resourceTypes: ResourceType[];
  warehouses: Warehouse[];
  gminas: Gmina[];
  powiats: { p: string; name: string; v: string }[];
  demands: Demand[];
  allocations: Allocation[];
  transports: Transport[];
  plans: Plan[];
  planKpi: PlanKpi;
  coverage: Coverage[];
  depletion: Depletion[];
  country: CountryDay[];
  voivDaily: VoivDay[];
  roads: Record<string, Road[]>;
  shelters: Shelter[];
  shelterDaily: ShelterDay[];
  suppliers: Supplier[];
  transportUnits: TransportUnit[];
  finance: FinanceRequest[];
  whatif: WhatIf[];
}

export interface SceneIndex {
  scene: Scene;
  days: string[];
  countryByDay: Map<string, CountryDay>;
  voivByDay: Map<string, VoivDay[]>;
  gminaById: Map<string, Gmina>;
  voivById: Map<string, Voivodeship>;
  resById: Map<string, ResourceType>;
  whById: Map<string, Warehouse>;
  unitById: Map<string, TransportUnit>;
  allocById: Map<string, Allocation>;
  allocByDemand: Map<string, Allocation>;
  demandById: Map<string, Demand>;
  transportByAlloc: Map<string, Transport>;
  shelterById: Map<string, Shelter>;
  shelterByDay: Map<string, ShelterDay[]>;
  depletionByDay: Map<string, Depletion[]>;
  coverageByGmina: Map<string, Coverage>;
}

export function indexScene(scene: Scene): SceneIndex {
  const countryByDay = new Map(scene.country.map((c) => [c.d, c]));
  const voivByDay = new Map<string, VoivDay[]>();
  for (const r of scene.voivDaily) {
    const arr = voivByDay.get(r.d) ?? [];
    arr.push(r);
    voivByDay.set(r.d, arr);
  }
  const shelterByDay = new Map<string, ShelterDay[]>();
  for (const r of scene.shelterDaily) {
    const arr = shelterByDay.get(r.d) ?? [];
    arr.push(r);
    shelterByDay.set(r.d, arr);
  }
  const depletionByDay = new Map<string, Depletion[]>();
  for (const r of scene.depletion) {
    const arr = depletionByDay.get(r.d) ?? [];
    arr.push(r);
    depletionByDay.set(r.d, arr);
  }
  const allocById = new Map(scene.allocations.map((a) => [a.id, a]));
  const allocByDemand = new Map(scene.allocations.map((a) => [a.demand, a]));
  const transportByAlloc = new Map(scene.transports.map((t) => [t.alloc, t]));

  return {
    scene,
    days: scene.meta.days,
    countryByDay,
    voivByDay,
    gminaById: new Map(scene.gminas.map((g) => [g.g, g])),
    voivById: new Map(scene.voivodeships.map((v) => [v.v, v])),
    resById: new Map(scene.resourceTypes.map((r) => [r.id, r])),
    whById: new Map(scene.warehouses.map((w) => [w.id, w])),
    unitById: new Map(scene.transportUnits.map((u) => [u.id, u])),
    allocById,
    allocByDemand,
    demandById: new Map(scene.demands.map((d) => [d.id, d])),
    transportByAlloc,
    shelterById: new Map(scene.shelters.map((s) => [s.id, s])),
    shelterByDay,
    depletionByDay,
    coverageByGmina: new Map(scene.coverage.map((c) => [c.gmina, c])),
  };
}

/* ------------------------------------------------------------------ */
/* Wskazniki                                                           */
/* ------------------------------------------------------------------ */

export interface Kpi {
  label: string;
  value: string;
  delta: number | null;
  /** true, gdy wzrost wartosci jest zjawiskiem negatywnym. */
  inverse: boolean;
  hint: string;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('pl-PL');
}

export function formatHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return hh > 0 ? `${hh} h ${mm} min` : `${mm} min`;
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

export function formatPln(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mln zł`;
  if (n >= 1_000) return `${Math.round(n / 1000).toLocaleString('pl-PL')} tys. zł`;
  return `${formatNumber(n)} zł`;
}

/** Etykieta doby wzgledem D0, np. „D+2”. */
export function dayLabel(index: SceneIndex, day: string): string {
  const i = index.scene.meta.days.indexOf(day);
  const zero = index.scene.meta.days.indexOf(index.scene.meta.d0);
  if (i < 0 || zero < 0) return day;
  const diff = i - zero;
  return diff === 0 ? 'D0' : diff > 0 ? `D+${diff}` : `D${diff}`;
}

export function countryKpis(index: SceneIndex, day: string): Kpi[] {
  const c = index.countryByDay.get(day);
  const days = index.scene.meta.days;
  const prev = index.countryByDay.get(days[Math.max(0, days.indexOf(day) - 1)]);
  if (!c) return [];
  const same = prev === c ? null : prev;
  const d = (a: number, b: number | undefined) => (b === undefined ? null : a - b);
  const occPct = c.shelterCap ? Math.round((c.shelterOcc / c.shelterCap) * 100) : 0;
  const prevOccPct = same?.shelterCap ? Math.round((same.shelterOcc / same.shelterCap) * 100) : undefined;

  return [
    {
      label: 'Wnioski otwarte',
      value: formatNumber(c.open),
      delta: d(c.open, same?.open),
      inverse: true,
      hint: 'Zapotrzebowania bez przydzielonego zasobu.',
    },
    {
      label: 'w tym priorytet 1',
      value: formatNumber(c.p1Open),
      delta: d(c.p1Open, same?.p1Open),
      inverse: true,
      hint: 'Zagrożenie życia lub zdrowia — wymagają decyzji w pierwszej kolejności.',
    },
    {
      label: 'Transporty w drodze',
      value: formatNumber(c.inTransit),
      delta: d(c.inTransit, same?.inTransit),
      inverse: false,
      hint: 'Pojazdy aktualnie realizujące dostawę.',
    },
    {
      label: 'Transporty opóźnione',
      value: formatNumber(c.delayed),
      delta: d(c.delayed, same?.delayed),
      inverse: true,
      hint: `Opóźnienie co najmniej ${index.scene.meta.delayAlertMin} min względem ETA.`,
    },
    {
      label: 'Dostawy zrealizowane',
      value: formatNumber(c.delivered),
      delta: d(c.delivered, same?.delivered),
      inverse: false,
      hint: 'Narastająco od początku scenariusza.',
    },
    {
      label: 'Zapasy krytyczne',
      value: formatNumber(c.criticalStock),
      delta: d(c.criticalStock, same?.criticalStock),
      inverse: true,
      hint: `Pary województwo–zasób z zapasem poniżej ${index.scene.meta.criticalDaysOfStock} dni.`,
    },
    {
      label: 'Zajętość miejsc',
      value: `${occPct}%`,
      delta: prevOccPct === undefined ? null : occPct - prevOccPct,
      inverse: true,
      hint: `${formatNumber(c.shelterOcc)} z ${formatNumber(c.shelterCap)} miejsc w punktach przyjęcia.`,
    },
    {
      label: 'Drogi nieprzejezdne',
      value: formatNumber(c.roadsBlocked),
      delta: d(c.roadsBlocked, same?.roadsBlocked),
      inverse: true,
      hint: `Dodatkowo ${c.roadsHindered} odcinków z utrudnieniami.`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Wnioski                                                             */
/* ------------------------------------------------------------------ */

export interface DemandRow extends Demand {
  gminaName: string;
  voivName: string;
  resName: string;
  unit: string;
  allocation: Allocation | null;
  transport: Transport | null;
  /** Godziny od zlozenia wniosku do konca wybranej doby - miara zaleglosci. */
  ageH: number;
  status: 'oczekuje' | 'przydzielony' | 'w transporcie' | 'dostarczony' | 'opóźniony';
}

function hoursBetween(fromDay: string, fromTime: string, toDay: string): number {
  const from = new Date(`${fromDay}T${fromTime}:00Z`).getTime();
  const to = new Date(`${toDay}T23:59:00Z`).getTime();
  return Math.max(0, Math.round(((to - from) / 3_600_000) * 10) / 10);
}

export function demandRows(index: SceneIndex, day: string): DemandRow[] {
  const out: DemandRow[] = [];
  for (const d of index.scene.demands) {
    if (d.d > day) continue;
    const allocation = index.allocByDemand.get(d.id) ?? null;
    const transport = allocation ? (index.transportByAlloc.get(allocation.id) ?? null) : null;
    let status: DemandRow['status'] = 'oczekuje';
    if (transport) {
      if (transport.status === 'delivered') status = 'dostarczony';
      else if (transport.maxDelay >= index.scene.meta.delayAlertMin) status = 'opóźniony';
      else status = 'w transporcie';
    } else if (allocation) {
      status = 'przydzielony';
    }
    out.push({
      ...d,
      gminaName: index.gminaById.get(d.g)?.name ?? d.g,
      voivName: index.voivById.get(d.v)?.name ?? d.v,
      resName: index.resById.get(d.res)?.name ?? d.res,
      unit: index.resById.get(d.res)?.unit ?? '',
      allocation,
      transport,
      ageH: hoursBetween(d.d, d.ts, day),
      status,
    });
  }
  return out.sort((a, b) => a.prio - b.prio || b.ageH - a.ageH);
}

/**
 * Wniosek priorytetu 1 czekajacy dluzej niz slaHours lamie SLA i musi byc
 * wyrozniony w kolejce - to on generuje alert w Activatorze.
 */
export function breachesSla(row: DemandRow, slaHours = 2): boolean {
  return row.prio === 1 && row.status === 'oczekuje' && row.ageH > slaHours;
}

/* ------------------------------------------------------------------ */
/* Wojewodztwa                                                         */
/* ------------------------------------------------------------------ */

export interface VoivRow extends VoivDay {
  name: string;
  /** Udzial otwartych wnioskow w zlozonych - miara zatoru. */
  openPct: number;
}

export function voivodeshipRows(index: SceneIndex, day: string): VoivRow[] {
  const rows = index.voivByDay.get(day) ?? [];
  return rows
    .map((r) => ({
      ...r,
      name: index.voivById.get(r.v)?.name ?? r.v,
      openPct: r.demands ? Math.round((r.open / r.demands) * 100) : 0,
    }))
    .sort((a, b) => b.p1Open - a.p1Open || b.open - a.open);
}

/* ------------------------------------------------------------------ */
/* Plan przydzialu                                                     */
/* ------------------------------------------------------------------ */

export interface PlanRow extends Plan {
  gminaName: string;
  voivName: string;
  resName: string;
  optWhName: string;
  fifoWhName: string | null;
  /** Dodatnia = optymalizator szybszy od FIFO. */
  savedH: number;
}

export function planRows(index: SceneIndex, day: string, onlyComparable = false): PlanRow[] {
  const out: PlanRow[] = [];
  for (const p of index.scene.plans) {
    if (p.day > day) continue;
    if (onlyComparable && p.fifoH === null) continue;
    out.push({
      ...p,
      gminaName: p.gmina ? (index.gminaById.get(p.gmina)?.name ?? p.gmina) : '—',
      voivName: p.v ? (index.voivById.get(p.v)?.name ?? p.v) : '—',
      resName: index.resById.get(p.res)?.name ?? p.res,
      optWhName: index.whById.get(p.optWh)?.name ?? p.optWh,
      fifoWhName: p.fifoWh ? (index.whById.get(p.fifoWh)?.name ?? p.fifoWh) : null,
      savedH: p.fifoH === null ? 0 : Math.round((p.fifoH - p.optH) * 100) / 100,
    });
  }
  return out.sort((a, b) => a.prio - b.prio || b.savedH - a.savedH);
}

/** KPI planu policzone dla wybranej doby, nie dla calej sceny. */
export function planKpiForDay(index: SceneIndex, day: string): PlanKpi {
  const rows = planRows(index, day);
  const pairs = rows.filter((r) => r.fifoH !== null);
  const p1 = pairs.filter((r) => r.prio === 1);
  const avg = (arr: number[]) =>
    arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : 0;
  const optAvg = avg(pairs.map((r) => r.optH));
  const fifoAvg = avg(pairs.map((r) => r.fifoH as number));
  return {
    count: rows.length,
    comparable: pairs.length,
    onlyOptimizer: rows.length - pairs.length,
    optAvgH: optAvg,
    fifoAvgH: fifoAvg,
    savedH: Math.round((fifoAvg - optAvg) * 100) / 100,
    p1Count: p1.length,
    p1OptAvgH: avg(p1.map((r) => r.optH)),
    p1FifoAvgH: avg(p1.map((r) => r.fifoH as number)),
    improved: pairs.filter((r) => r.optH < (r.fifoH as number)).length,
    worse: pairs.filter((r) => r.optH > (r.fifoH as number)).length,
    totalSavedH: Math.round(pairs.reduce((a, r) => a + ((r.fifoH as number) - r.optH), 0) * 10) / 10,
  };
}

/* ------------------------------------------------------------------ */
/* Transporty                                                          */
/* ------------------------------------------------------------------ */

export interface TransportRow extends Transport {
  gminaName: string;
  resName: string;
  whName: string;
  late: boolean;
}

export function transportRows(index: SceneIndex, day: string): TransportRow[] {
  const out: TransportRow[] = [];
  for (const t of index.scene.transports) {
    if (t.start.slice(0, 10) > day || t.end.slice(0, 10) < day) continue;
    out.push({
      ...t,
      gminaName: t.gmina ? (index.gminaById.get(t.gmina)?.name ?? t.gmina) : '—',
      resName: t.res ? (index.resById.get(t.res)?.name ?? t.res) : '—',
      whName: t.wh ? (index.whById.get(t.wh)?.name ?? t.wh) : '—',
      late: t.maxDelay >= index.scene.meta.delayAlertMin,
    });
  }
  return out.sort((a, b) => b.maxDelay - a.maxDelay || a.prio - b.prio);
}

/* ------------------------------------------------------------------ */
/* Zapasy i luki                                                       */
/* ------------------------------------------------------------------ */

export type SupplyActionType =
  | 'rezerwy_strategiczne'
  | 'dostawca_ramowy'
  | 'przerzut_miedzywojewodzki'
  | 'monitoruj';

export interface DepletionRow extends Depletion {
  voivName: string;
  resName: string;
  unit: string;
  critical: boolean;
  action: SupplyActionType;
}

export function depletionRows(index: SceneIndex, day: string): DepletionRow[] {
  const rows = index.depletionByDay.get(day) ?? [];
  const crit = index.scene.meta.criticalDaysOfStock;
  return rows
    .map((r) => {
      const res = index.resById.get(r.res);
      let action: SupplyActionType = 'monitoruj';
      if (r.dos < 1) action = 'rezerwy_strategiczne';
      else if (r.dos < crit) action = 'dostawca_ramowy';
      else if (r.dos < crit * 2) action = 'przerzut_miedzywojewodzki';
      return {
        ...r,
        voivName: index.voivById.get(r.v)?.name ?? r.v,
        resName: res?.name ?? r.res,
        unit: res?.unit ?? '',
        critical: r.dos < crit,
        action,
      };
    })
    .sort((a, b) => a.dos - b.dos);
}

/** Dostawcy zdolni dostarczyc zasob danej kategorii; najszybszy pierwszy. */
export function suppliersFor(index: SceneIndex, resourceId: string, voivodeship?: string): Supplier[] {
  const cat = index.resById.get(resourceId)?.cat;
  return index.scene.suppliers
    .filter((s) => (!cat || s.cat === cat) && (!voivodeship || s.v === voivodeship))
    .sort((a, b) => a.leadH - b.leadH);
}

/**
 * Przeslanki decyzji „czy wystarczy?” - zestawia sygnaly, ktore razem
 * uzasadniaja uruchomienie rezerw albo wniosek o srodki SPO-2.
 */
export interface SupplyCase {
  day: string;
  criticalRows: DepletionRow[];
  worstDays: number;
  sheltersFull: number;
  openP1: number;
  blockedRoads: number;
  gapsOver2h: number;
  pros: string[];
  cons: string[];
  suggestReserves: boolean;
  suggestSpo2: boolean;
}

export function supplyCase(index: SceneIndex, day: string): SupplyCase {
  const c = index.countryByDay.get(day);
  const dep = depletionRows(index, day);
  const critical = dep.filter((r) => r.critical);
  const worst = critical.length ? critical[0].dos : 999;
  const gaps = index.scene.coverage.filter((r) => r.h > 2).length;
  const pros: string[] = [];
  const cons: string[] = [];

  if (critical.length)
    pros.push(
      `${critical.length} par województwo–zasób ma zapas poniżej ${index.scene.meta.criticalDaysOfStock} dni; najgorzej jest z pozycją „${critical[0].resName}” w ${critical[0].voivName} (${critical[0].dos} dnia).`,
    );
  if (c && c.p1Open > 0) pros.push(`${c.p1Open} wniosków priorytetu 1 czeka bez przydziału.`);
  if (c && c.sheltersFull > 0) pros.push(`${c.sheltersFull} punktów przyjęcia zapełnionych powyżej 90%.`);
  if (c && c.roadsBlocked > 0)
    pros.push(`${c.roadsBlocked} odcinków dróg nieprzejezdnych — wydłuża czas dostaw i wymusza objazdy.`);
  if (c && c.delayed > 0)
    pros.push(`${c.delayed} transportów opóźnionych powyżej ${index.scene.meta.delayAlertMin} min.`);

  if (!critical.length) cons.push('Żadna pozycja zapasu nie schodzi poniżej progu krytycznego.');
  if (c && c.p1Open === 0) cons.push('Brak nieobsłużonych wniosków priorytetu 1.');
  if (gaps === 0) cons.push('Wszystkie gminy w scenie mają magazyn w zasięgu 2 godzin.');
  if (c && c.roadsBlocked === 0) cons.push('Sieć drogowa przejezdna — brak ograniczeń transportowych.');

  return {
    day,
    criticalRows: critical,
    worstDays: worst,
    sheltersFull: c?.sheltersFull ?? 0,
    openP1: c?.p1Open ?? 0,
    blockedRoads: c?.roadsBlocked ?? 0,
    gapsOver2h: gaps,
    pros,
    cons,
    suggestReserves: critical.length > 0 && worst < 1,
    suggestSpo2: critical.length >= 3 && (c?.p1Open ?? 0) > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Kalkulator norm                                                     */
/* ------------------------------------------------------------------ */

/**
 * Podpowiedz ilosci wg norm z APP_SPEC.md. Zwraca null, gdy dla zasobu nie ma
 * ustalonej normy - aplikacja nie zgaduje wtedy za uzytkownika.
 */
export function suggestQuantity(
  resource: ResourceType | undefined,
  people: number,
): { qty: number; rule: string } | null {
  if (!resource || people <= 0) return null;
  const name = resource.name.toLowerCase();
  if (name.includes('woda')) {
    return { qty: Math.ceil((people * 3) / 600), rule: '3 l na osobę na dobę, paleta = 600 l' };
  }
  if (name.includes('lozk') || name.includes('łóżk')) {
    return { qty: people, rule: '1 łóżko na osobę bez zakwaterowania' };
  }
  if (name.includes('koc')) {
    return { qty: Math.ceil(people * 1.2), rule: '1,2 koca na osobę (zapas na wymianę)' };
  }
  if (name.includes('agregat')) {
    return { qty: Math.max(1, Math.ceil(people / 500)), rule: '1 agregat na 500 osób w punkcie' };
  }
  if (name.includes('zywnos') || name.includes('żywnoś') || name.includes('racj')) {
    return { qty: people * 2, rule: '2 racje na osobę na dobę' };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Mapa                                                                */
/* ------------------------------------------------------------------ */

const BOUNDS = { minLat: 49.0, maxLat: 54.9, minLon: 14.1, maxLon: 24.2 };

/** Rzut rownoprostokatny - dla Polski znieksztalcenie jest pomijalne. */
export function project(lat: number, lon: number, width: number, height: number): { x: number; y: number } {
  const x = ((lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon)) * width;
  const y = height - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * height;
  return { x, y };
}

export function priorityColor(prio: number): string {
  if (prio === 1) return '#f87171';
  if (prio === 2) return '#fb923c';
  if (prio === 3) return '#fbbf24';
  return '#60a5fa';
}

export function stockColor(daysOfStock: number, critical: number): string {
  if (daysOfStock < 1) return '#dc2626';
  if (daysOfStock < critical) return '#f97316';
  if (daysOfStock < critical * 2) return '#facc15';
  return '#4ade80';
}

/* ------------------------------------------------------------------ */
/* Audyt i eksport                                                     */
/* ------------------------------------------------------------------ */

/** Skrot FNV-1a - stabilny slad przeslanek, nie funkcja kryptograficzna. */
export function auditHash(payload: unknown): string {
  const text = JSON.stringify(payload);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16);
}

/** CSV dla Excela w polskiej lokalizacji: BOM i srednik jako separator. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '\ufeff';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))];
  return `\ufeff${lines.join('\n')}`;
}
