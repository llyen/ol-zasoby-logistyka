import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REGIONS } from '@/data/poland';

/**
 * Wspolrzedne w scenie musza lezec wewnatrz granic rysowanych na mapie.
 *
 * Zbiory zrodlowe rozrzucaja punkty losowym odchyleniem wokol srodka
 * wojewodztwa, wiec czesc z nich wypadala na Baltyku albo za granica. Po
 * naniesieniu prawdziwych granic bylo to widoczne od razu, dlatego
 * `tools/build_scene.py` przyciaga takie punkty do wlasnego wojewodztwa.
 * Ten test pilnuje, zeby korekta nie zniknela przy kolejnej przebudowie sceny.
 */

const scene = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/data/scene.json'), 'utf-8'),
) as {
  voivodeships: { v: string; name: string }[];
  gminas: { name: string; v: string; lat: number; lon: number }[];
  warehouses: { name: string; v: string; lat: number; lon: number }[];
  shelters: { id: string; lat: number; lon: number }[];
  transports: { id: string; path: number[][] }[];
};

const BOUNDS = { minLat: 49.0, maxLat: 54.9, minLon: 14.1, maxLon: 24.2 };

function toXY(lat: number, lon: number): [number, number] {
  return [
    ((lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon)) * 100,
    100 - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * 100,
  ];
}

/** Rozklada atrybut `d` na pierscienie punktow. Generator uzywa wylacznie M/L/Z. */
function ringsOf(path: string): [number, number][][] {
  return path
    .split('Z')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) =>
      [...chunk.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
        (m) => [Number(m[1]), Number(m[2])] as [number, number],
      ),
    )
    .filter((ring) => ring.length > 3);
}

const RINGS = new Map(REGIONS.map((r) => [fold(r.name), ringsOf(r.path)]));

/** Test parzystosci przeciec promienia poziomego. */
function inRings(x: number, y: number, rings: [number, number][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function inPoland(lat: number, lon: number): boolean {
  const [x, y] = toXY(lat, lon);
  for (const rings of RINGS.values()) {
    if (inRings(x, y, rings)) return true;
  }
  return false;
}

/** Nazwy wojewodztw w scenie sa bez znakow diakrytycznych, w granicach - z. */
function fold(text: string): string {
  return text
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const regionByCode = new Map(
  scene.voivodeships.map((v) => [v.v, RINGS.get(fold(v.name))] as const),
);

describe('granice wojewodztw', () => {
  it('plik granic zawiera 16 wojewodztw z niepustym konturem', () => {
    expect(REGIONS).toHaveLength(16);
    for (const region of REGIONS) {
      expect(ringsOf(region.path).length).toBeGreaterThan(0);
    }
  });

  it('nazwy wojewodztw ze sceny maja odpowiednik w granicach', () => {
    for (const [, rings] of regionByCode) {
      expect(rings).toBeDefined();
    }
  });
});

describe('polozenie punktow sceny', () => {
  it('kazda gmina lezy w swoim wojewodztwie', () => {
    const wrong = scene.gminas.filter((g) => {
      const rings = regionByCode.get(g.v);
      if (!rings) return false;
      const [x, y] = toXY(g.lat, g.lon);
      return !inRings(x, y, rings);
    });
    expect(wrong.map((g) => g.name)).toEqual([]);
  });

  it('kazdy magazyn lezy w swoim wojewodztwie', () => {
    const wrong = scene.warehouses.filter((w) => {
      const rings = regionByCode.get(w.v);
      if (!rings) return false;
      const [x, y] = toXY(w.lat, w.lon);
      return !inRings(x, y, rings);
    });
    expect(wrong.map((w) => w.name)).toEqual([]);
  });

  it('zaden punkt przyjecia nie lezy poza granicami kraju', () => {
    const outside = scene.shelters.filter((s) => !inPoland(s.lat, s.lon));
    expect(outside.map((s) => s.id)).toEqual([]);
  });

  it('trasy transportow zaczynaja sie i koncza w granicach kraju', () => {
    const broken = scene.transports.filter((t) => {
      const first = t.path[0];
      const last = t.path[t.path.length - 1];
      return !inPoland(first[0], first[1]) || !inPoland(last[0], last[1]);
    });
    expect(broken.map((t) => t.id)).toEqual([]);
  });
});
