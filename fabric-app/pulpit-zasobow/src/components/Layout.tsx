import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { dayLabel, formatDay } from '@/data/model';
import { useAuth } from '@/hooks/AuthContext';
import { useScenario } from '@/hooks/ScenarioContext';
import { USER_ROLES, type UserRole } from '@/services/workflow';
import { Button } from '@/components/ui';

const NAV = [
  { to: '/', label: 'Sytuacja zasobowa' },
  { to: '/wnioski', label: 'Kolejka wniosków' },
  { to: '/plan', label: 'Plan przydziału' },
  { to: '/transporty', label: 'Transporty' },
  { to: '/finanse', label: 'Środki SPO-2' },
];

const REGIONAL_ROLES: UserRole[] = ['wojewoda', 'WCZK'];
const LOCAL_ROLES: UserRole[] = ['wójt / burmistrz', 'starosta'];

/**
 * Pasek czasu sceny. Scena jest deterministyczna (12 dob), a nie strumieniowa,
 * dlatego uzytkownik przewija dobe po dobie albo wlacza odtwarzanie.
 * Dashboard w Fabric pokazuje strumien na zywo, aplikacja pokazuje proces
 * decyzyjny na powtarzalnej scenie - to swiadomy podzial rol.
 */
function TimeScrubber() {
  const { index, dayIndex, setDayIndex, playing, togglePlay, speed, setSpeed } = useScenario();
  if (!index) return null;
  const day = index.days[dayIndex];
  const country = index.countryByDay.get(day);
  const alarm = (country?.p1Open ?? 0) > 0;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/80 px-5 py-2.5">
      <Button variant={playing ? 'danger' : 'primary'} onClick={togglePlay} className="w-28">
        {playing ? '❚❚ Pauza' : '▶ Odtwórz'}
      </Button>
      <div className="flex min-w-[260px] flex-1 items-center gap-3">
        <input
          type="range"
          min={0}
          max={index.days.length - 1}
          value={dayIndex}
          onChange={(e) => setDayIndex(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-cyan-400"
          aria-label="Doba scenariusza"
        />
        <span
          className={`min-w-[150px] rounded-md px-2 py-1 text-center text-xs font-semibold tabular-nums ${
            alarm ? 'bg-red-500/15 text-red-300' : 'bg-cyan-500/15 text-cyan-300'
          }`}
        >
          {dayLabel(index, day)} · {formatDay(day)}
        </span>
      </div>
      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-600"
        aria-label="Tempo odtwarzania"
      >
        <option value={3000}>0,3× (3 s/dobę)</option>
        <option value={1800}>1× (1,8 s/dobę)</option>
        <option value={900}>2× (0,9 s/dobę)</option>
        <option value={400}>4× (0,4 s/dobę)</option>
      </select>
      <Button variant="ghost" onClick={() => setDayIndex(0)} title="Wróć na początek scenariusza">
        ⟲ Od zera
      </Button>
    </div>
  );
}

function RolePicker() {
  const { actor, setRole, setVoivodeship, setGmina, index } = useScenario();
  const gminas = index?.scene.gminas ?? [];
  return (
    <div className="flex items-center gap-2">
      <select
        value={actor.role}
        onChange={(e) => setRole(e.target.value as UserRole)}
        className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-600"
        aria-label="Rola użytkownika"
      >
        {USER_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {REGIONAL_ROLES.includes(actor.role) && (
        <select
          value={actor.voivodeshipCode}
          onChange={(e) => setVoivodeship(e.target.value)}
          className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-600"
          aria-label="Województwo"
        >
          <option value="">— cały kraj —</option>
          {(index?.scene.voivodeships ?? []).map((v) => (
            <option key={v.v} value={v.v}>
              {v.name}
            </option>
          ))}
        </select>
      )}
      {LOCAL_ROLES.includes(actor.role) && (
        <select
          value={actor.gminaCode}
          onChange={(e) => setGmina(e.target.value)}
          className="max-w-[190px] rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-600"
          aria-label="Gmina"
        >
          <option value="">— bez ograniczenia —</option>
          {gminas.map((g) => (
            <option key={g.g} value={g.g}>
              {g.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { signOut, user } = useAuth();
  const { writebackError } = useScenario();
  const location = useLocation();
  const active = NAV.find((n) => n.to === location.pathname)?.label ?? '';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">
              <span className="text-base font-bold">⛟</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide text-slate-100">
                Pulpit zasobów · logistyka kryzysowa
              </h1>
              <p className="text-[11px] text-slate-500">
                Od wniosku gminy do potwierdzonej dostawy · demonstracja
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <RolePicker />
            <span className="hidden text-xs text-slate-500 sm:inline">
              {user?.name ?? user?.email ?? ''}
            </span>
            <Button variant="ghost" onClick={() => void signOut()}>
              Wyloguj
            </Button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'border-amber-400 text-amber-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <TimeScrubber />

      {writebackError && (
        <div className="border-b border-amber-500/40 bg-amber-500/10 px-5 py-2 text-xs text-amber-300">
          Zapis do bazy aplikacji jest niedostępny ({writebackError}). Decyzje zapisują się lokalnie
          w sesji przeglądarki.
        </div>
      )}

      <main className="mx-auto max-w-[1500px] px-5 py-5">
        <p className="mb-3 text-[11px] uppercase tracking-widest text-slate-600">{active}</p>
        {children}
      </main>

      <footer className="border-t border-slate-800 px-5 py-3 text-[11px] text-slate-600">
        Dane są w całości syntetyczne. Normy zaopatrzenia, progi zapasu i ścieżka akceptacji środków
        są konstrukcją demonstracyjną, nie odwzorowują obowiązujących procedur.
      </footer>
    </div>
  );
}
