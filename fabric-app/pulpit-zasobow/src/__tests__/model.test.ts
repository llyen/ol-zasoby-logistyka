import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  breachesSla,
  countryKpis,
  demandRows,
  depletionRows,
  indexScene,
  planKpiForDay,
  planRows,
  suggestQuantity,
  supplyCase,
  toCsv,
  transportRows,
  voivodeshipRows,
  type Scene,
} from '@/data/model';
import {
  approvalPath,
  canActOn,
  HIGH_VALUE_PLN,
  nextStage,
  travelDelta,
  validateAllocation,
  validateDelivery,
  validateDemand,
  validateFinance,
  validateSupply,
  type Actor,
  type AllocationDraft,
  type DeliveryDraft,
  type DemandDraft,
  type FinanceDraft,
  type SupplyDraft,
} from '@/services/workflow';

const scene = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/data/scene.json'), 'utf-8'),
) as Scene;
const index = indexScene(scene);
const lastDay = scene.meta.days[scene.meta.days.length - 1];

const wczk = (voiv = ''): Actor => ({
  id: 'u1',
  name: 'Test',
  role: 'WCZK',
  voivodeshipCode: voiv,
  gminaCode: '',
});

describe('scena', () => {
  it('ma komplet dni i spójne odwołania', () => {
    expect(scene.meta.days.length).toBeGreaterThanOrEqual(10);
    expect(scene.meta.days).toContain(scene.meta.d0);
    expect(index.countryByDay.size).toBe(scene.meta.days.length);
    for (const d of scene.demands.slice(0, 200)) {
      expect(index.gminaById.has(d.g)).toBe(true);
      expect(index.resById.has(d.res)).toBe(true);
    }
  });

  it('każdy transport wskazuje istniejącą alokację', () => {
    for (const t of scene.transports.slice(0, 200)) {
      expect(index.allocById.has(t.alloc)).toBe(true);
    }
  });
});

describe('wskaźniki krajowe', () => {
  it('zwracają osiem kafelków i liczbę otwartych zgodną z danymi', () => {
    const day = scene.meta.days[3];
    const kpis = countryKpis(index, day);
    expect(kpis).toHaveLength(8);
    const open = kpis.find((k) => k.label === 'Wnioski otwarte');
    expect(open?.value).toBe(index.countryByDay.get(day)!.open.toLocaleString('pl-PL'));
  });

  it('pierwsza doba nie ma delty, bo nie ma z czym porównywać', () => {
    for (const k of countryKpis(index, scene.meta.days[0])) expect(k.delta).toBeNull();
  });
});

describe('kolejka wniosków', () => {
  it('narasta wraz z dobami i nigdy nie maleje', () => {
    let prev = 0;
    for (const d of scene.meta.days) {
      const n = demandRows(index, d).length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('sortuje po priorytecie, potem po czasie oczekiwania', () => {
    const rows = demandRows(index, lastDay);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].prio).toBeGreaterThanOrEqual(rows[i - 1].prio);
      if (rows[i].prio === rows[i - 1].prio) {
        expect(rows[i].ageH).toBeLessThanOrEqual(rows[i - 1].ageH);
      }
    }
  });

  it('SLA łamie wyłącznie priorytet 1 bez przydziału', () => {
    const rows = demandRows(index, lastDay);
    for (const r of rows.filter((x) => breachesSla(x))) {
      expect(r.prio).toBe(1);
      expect(r.status).toBe('oczekuje');
      expect(r.ageH).toBeGreaterThan(2);
    }
    expect(rows.filter((r) => breachesSla(r)).length).toBeGreaterThan(0);
  });
});

describe('plan przydziału', () => {
  it('KPI całej sceny liczy średnie wyłącznie na parach', () => {
    const kpi = scene.planKpi;
    expect(kpi.comparable).toBeGreaterThan(0);
    expect(kpi.comparable).toBeLessThanOrEqual(kpi.count);
    expect(kpi.count - kpi.comparable).toBe(kpi.onlyOptimizer);
    expect(kpi.savedH).toBeCloseTo(kpi.fifoAvgH - kpi.optAvgH, 2);
  });

  it('optymalizator skraca średni czas dojazdu względem FIFO', () => {
    expect(scene.planKpi.optAvgH).toBeLessThan(scene.planKpi.fifoAvgH);
    expect(scene.planKpi.improved).toBeGreaterThan(scene.planKpi.worse);
  });

  it('KPI zgadza się z allocation_summary.json — jeden wiersz na wniosek', () => {
    // Wniosek z dostawa dzielona ma kilka wierszy w pliku planu; scena agreguje
    // je po demand_id tak samo jak notatnik 03. Rozjazd tych liczb oznaczalby,
    // ze aplikacja pokazuje inna wartosc niz raport i dokumentacja.
    expect(scene.planKpi.fifoAvgH).toBeCloseTo(4.27, 2);
    expect(scene.planKpi.optAvgH).toBeCloseTo(1.7, 2);
    expect(scene.planKpi.savedH).toBeCloseTo(2.57, 2);
    expect(scene.planKpi.comparable).toBe(420);
  });

  it('dostawa dzielona jest oznaczona liczbą części', () => {
    for (const p of scene.plans) expect(p.parts).toBeGreaterThanOrEqual(1);
    expect(scene.plans.some((p) => p.parts > 1)).toBe(true);
  });

  it('KPI ostatniej doby pokrywa się z KPI całej sceny', () => {
    const kpi = planKpiForDay(index, lastDay);
    expect(kpi.count).toBe(scene.planKpi.count);
    expect(kpi.comparable).toBe(scene.planKpi.comparable);
    expect(kpi.optAvgH).toBeCloseTo(scene.planKpi.optAvgH, 2);
  });

  it('filtr porównywalnych odrzuca pozycje bez odpowiednika w FIFO', () => {
    const all = planRows(index, lastDay);
    const pairs = planRows(index, lastDay, true);
    expect(pairs.length).toBe(scene.planKpi.comparable);
    expect(pairs.every((r) => r.fifoH !== null)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(pairs.length);
  });
});

describe('transporty', () => {
  it('w oknie doby mieszczą się tylko trwające przejazdy', () => {
    const rows = transportRows(index, scene.meta.days[5]);
    for (const r of rows) {
      expect(r.start.slice(0, 10) <= scene.meta.days[5]).toBe(true);
      expect(r.end.slice(0, 10) >= scene.meta.days[5]).toBe(true);
    }
  });

  it('opóźnienie oznaczane jest progiem ze sceny', () => {
    const rows = transportRows(index, lastDay);
    for (const r of rows) expect(r.late).toBe(r.maxDelay >= scene.meta.delayAlertMin);
  });
});

describe('zapasy', () => {
  it('krytyczne pozycje są pierwsze i zgodne z progiem', () => {
    const rows = depletionRows(index, lastDay);
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].dos).toBeGreaterThanOrEqual(rows[i - 1].dos);
    for (const r of rows) expect(r.critical).toBe(r.dos < scene.meta.criticalDaysOfStock);
  });

  it('rekomendacja zaostrza się wraz ze spadkiem zapasu', () => {
    for (const r of depletionRows(index, lastDay)) {
      if (r.dos < 1) expect(r.action).toBe('rezerwy_strategiczne');
      else if (r.dos < scene.meta.criticalDaysOfStock) expect(r.action).toBe('dostawca_ramowy');
    }
  });

  it('przesłanki „czy wystarczy?” opisują realne sygnały', () => {
    const c = supplyCase(index, lastDay);
    expect(c.pros.length + c.cons.length).toBeGreaterThan(0);
    if (c.criticalRows.length === 0) expect(c.suggestReserves).toBe(false);
  });
});

describe('kalkulator norm', () => {
  it('woda: 3 litry na osobę na dobę, paleta 600 litrów', () => {
    const water = scene.resourceTypes.find((r) => r.name.toLowerCase().includes('woda'));
    expect(water).toBeDefined();
    expect(suggestQuantity(water, 1000)?.qty).toBe(5);
  });

  it('bez podanej liczby osób nie zgaduje', () => {
    expect(suggestQuantity(scene.resourceTypes[0], 0)).toBeNull();
    expect(suggestQuantity(undefined, 500)).toBeNull();
  });
});

describe('uprawnienia', () => {
  const gmina = scene.gminas[0];

  it('RCB widzi cały kraj', () => {
    const rcb: Actor = { ...wczk(), role: 'RCB / ARS' };
    expect(canActOn(rcb, gmina.g, gmina.v)).toBe(true);
  });

  it('wojewoda tylko własne województwo', () => {
    const other = scene.voivodeships.find((v) => v.v !== gmina.v)!;
    const w: Actor = { ...wczk(gmina.v), role: 'wojewoda' };
    expect(canActOn(w, gmina.g, gmina.v)).toBe(true);
    expect(canActOn(w, gmina.g, other.v)).toBe(false);
  });

  it('wójt tylko własną gminę', () => {
    const other = scene.gminas.find((g) => g.g !== gmina.g)!;
    const a: Actor = {
      id: 'u',
      name: 'W',
      role: 'wójt / burmistrz',
      voivodeshipCode: gmina.v,
      gminaCode: gmina.g,
    };
    expect(canActOn(a, gmina.g, gmina.v)).toBe(true);
    expect(canActOn(a, other.g, other.v)).toBe(false);
  });

  it('kierowca nie działa na wnioskach', () => {
    const k: Actor = { ...wczk(), role: 'kierowca' };
    expect(canActOn(k, gmina.g, gmina.v)).toBe(false);
  });
});

describe('walidacja wniosku', () => {
  const gmina = scene.gminas[0];
  const base: DemandDraft = {
    scene_day: lastDay,
    gmina_code: gmina.g,
    gmina_name: gmina.name,
    voivodeship_code: gmina.v,
    resource_type_id: scene.resourceTypes[0].id,
    resource_name: scene.resourceTypes[0].name,
    quantity: 10,
    unit: scene.resourceTypes[0].unit,
    priority: 2,
    affected_people: 100,
    needed_by: `${lastDay}T18:00`,
    justification: 'Uzasadnienie wystarczająco długie dla testu.',
    suggested_quantity: 0,
    status: 'zlozony',
  };

  it('poprawny wniosek przechodzi', () => {
    expect(validateDemand(base, wczk()).ok).toBe(true);
  });

  it('priorytet 1 wymaga uzasadnienia i liczby osób', () => {
    const r = validateDemand(
      { ...base, priority: 1, justification: 'za krótkie', affected_people: 0 },
      wczk(),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(2);
  });

  it('ilość musi być dodatnia', () => {
    expect(validateDemand({ ...base, quantity: 0 }, wczk()).ok).toBe(false);
  });
});

describe('walidacja przydziału', () => {
  const base: AllocationDraft = {
    demand_id: scene.demands[0].id,
    scene_day: lastDay,
    recommended_warehouse_id: scene.warehouses[0].id,
    recommended_travel_h: 1.2,
    chosen_warehouse_id: scene.warehouses[0].id,
    chosen_travel_h: 1.2,
    allocated_qty: 10,
    resource_type_id: scene.resourceTypes[0].id,
    priority: 1,
    mode: 'plan_optymalizatora',
    override_reason: '',
    transport_unit_id: '',
    eta: '',
    voivodeship_code: '',
  };

  it('zgodny z planem przechodzi bez uzasadnienia', () => {
    expect(validateAllocation(base, wczk()).ok).toBe(true);
  });

  it('korekta ręczna bez uzasadnienia jest odrzucana', () => {
    const r = validateAllocation({ ...base, mode: 'korekta_reczna' }, wczk());
    expect(r.ok).toBe(false);
  });

  it('gmina nie zatwierdza przydziału', () => {
    const wojt: Actor = { ...wczk(), role: 'wójt / burmistrz' };
    expect(validateAllocation(base, wojt).ok).toBe(false);
  });

  it('różnica czasu dodatnia oznacza wydłużenie dostawy', () => {
    expect(travelDelta({ ...base, chosen_travel_h: 3.2 })).toBeCloseTo(2, 2);
    expect(travelDelta({ ...base, chosen_travel_h: 0.2 })).toBeCloseTo(-1, 2);
  });
});

describe('walidacja odbioru', () => {
  const base: DeliveryDraft = {
    transport_id: scene.transports[0].id,
    allocation_id: scene.transports[0].alloc,
    scene_day: lastDay,
    gmina_code: scene.gminas[0].g,
    resource_type_id: scene.resourceTypes[0].id,
    allocated_qty: 100,
    received_qty: 100,
    shortage_reason: '',
    delay_min: 0,
    receiver_name: 'Jan Kowalski, kierownik',
    lat: 51,
    lon: 17,
  };
  const kierowca: Actor = { ...wczk(), role: 'kierowca' };

  it('pełny odbiór przechodzi', () => {
    expect(validateDelivery(base, kierowca).ok).toBe(true);
  });

  it('nadwyżka jest odrzucana', () => {
    expect(validateDelivery({ ...base, received_qty: 120 }, kierowca).ok).toBe(false);
  });

  it('niedobór wymaga przyczyny', () => {
    expect(validateDelivery({ ...base, received_qty: 80 }, kierowca).ok).toBe(false);
    expect(
      validateDelivery({ ...base, received_qty: 80, shortage_reason: 'uszkodzone palety' }, kierowca)
        .ok,
    ).toBe(true);
  });
});

describe('ścieżka finansowa', () => {
  const base: FinanceDraft = {
    financial_request_id: '',
    step_no: 1,
    scene_day: lastDay,
    voivodeship_code: scene.voivodeships[0].v,
    amount_pln: 1_000_000,
    purpose: 'zakup agregatów',
    linked_demands: [],
    justification: 'Uzasadnienie wystarczająco długie dla testu walidacji.',
    stage: 'wojewoda',
    status: 'zlozony',
    comment: '',
  };

  it('mała kwota kończy się na ministrze wiodącym', () => {
    expect(approvalPath(1_000_000)).toEqual(['wojewoda', 'minister_wiodacy']);
  });

  it('duża kwota wymaga RZZK i MF', () => {
    expect(approvalPath(HIGH_VALUE_PLN + 1)).toEqual([
      'wojewoda',
      'minister_wiodacy',
      'RZZK',
      'MF',
    ]);
  });

  it('wojewoda nie zamyka wniosku powyżej progu', () => {
    const r = validateFinance(
      { ...base, amount_pln: HIGH_VALUE_PLN + 1, status: 'zaakceptowany' },
      wczk(scene.voivodeships[0].v),
    );
    expect(r.ok).toBe(false);
  });

  it('etap spoza ścieżki jest odrzucany', () => {
    expect(validateFinance({ ...base, stage: 'MF' }, wczk()).ok).toBe(false);
  });

  it('kolejny etap wynika z kwoty', () => {
    expect(nextStage(1_000_000, 'minister_wiodacy')).toBeNull();
    expect(nextStage(HIGH_VALUE_PLN + 1, 'minister_wiodacy')).toBe('RZZK');
    expect(nextStage(HIGH_VALUE_PLN + 1, 'MF')).toBeNull();
  });
});

describe('działania zaopatrzeniowe', () => {
  const base: SupplyDraft = {
    scene_day: lastDay,
    action_type: 'dostawca_ramowy',
    voivodeship_code: scene.voivodeships[0].v,
    resource_type_id: scene.resourceTypes[0].id,
    resource_name: scene.resourceTypes[0].name,
    days_of_stock: 0.5,
    daily_rate: 100,
    supplier_id: scene.suppliers[0].id,
    lead_time_h: 12,
    quantity: 300,
    comment: 'Zapas schodzi poniżej doby przy rosnącym zużyciu w regionie.',
  };

  it('zamówienie u dostawcy przechodzi dla WCZK', () => {
    expect(validateSupply(base, wczk()).ok).toBe(true);
  });

  it('rezerwy strategiczne wyłącznie dla RCB', () => {
    expect(validateSupply({ ...base, action_type: 'rezerwy_strategiczne' }, wczk()).ok).toBe(false);
    const rcb: Actor = { ...wczk(), role: 'RCB / ARS' };
    expect(validateSupply({ ...base, action_type: 'rezerwy_strategiczne' }, rcb).ok).toBe(true);
  });

  it('zamówienie u dostawcy wymaga wskazania dostawcy', () => {
    expect(validateSupply({ ...base, supplier_id: '' }, wczk()).ok).toBe(false);
  });
});

describe('eksport', () => {
  it('CSV ma BOM, średniki i cytuje wartości ze średnikiem', () => {
    const csv = toCsv([{ a: 'x;y', b: 1 }]);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('a;b');
    expect(csv).toContain('"x;y"');
  });

  it('pusty zbiór daje samo BOM', () => {
    expect(toCsv([])).toBe('\ufeff');
  });
});

describe('rozkład wojewódzki', () => {
  it('sortuje po pilności i liczy udział otwartych', () => {
    const rows = voivodeshipRows(index, lastDay);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].p1Open).toBeLessThanOrEqual(rows[i - 1].p1Open);
    }
    for (const r of rows) expect(r.openPct).toBeLessThanOrEqual(100);
  });
});
