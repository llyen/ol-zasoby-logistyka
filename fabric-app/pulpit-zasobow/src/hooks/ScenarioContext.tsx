import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { indexScene, type Scene, type SceneIndex } from '@/data/model';
import { useAuth } from '@/hooks/AuthContext';
import {
  listAllocations,
  listApprovals,
  listDeliveries,
  listDemands,
  listFinance,
  listSupply,
  type Actor,
  type AllocationRecord,
  type ApprovalRecord,
  type DeliveryRecord,
  type DemandRequestRecord,
  type FinanceRecord,
  type SupplyRecord,
  type UserRole,
} from '@/services/workflow';

interface ScenarioValue {
  index: SceneIndex | null;
  loading: boolean;
  error: string | null;
  dayIndex: number;
  day: string;
  setDayIndex: (i: number) => void;
  playing: boolean;
  togglePlay: () => void;
  speed: number;
  setSpeed: (s: number) => void;
  actor: Actor;
  setRole: (role: UserRole) => void;
  setVoivodeship: (code: string) => void;
  setGmina: (code: string) => void;
  demands: DemandRequestRecord[];
  approvals: ApprovalRecord[];
  allocations: AllocationRecord[];
  deliveries: DeliveryRecord[];
  finance: FinanceRecord[];
  supply: SupplyRecord[];
  refresh: () => Promise<void>;
  writebackError: string | null;
}

const ScenarioContext = createContext<ScenarioValue | undefined>(undefined);

const ROLE_KEY = 'zasoby.role';
const VOIV_KEY = 'zasoby.voivodeship';
const GMINA_KEY = 'zasoby.gmina';

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [index, setIndex] = useState<SceneIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayIndex, setDayIndexState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1800);
  const [role, setRoleState] = useState<UserRole>(
    () => (localStorage.getItem(ROLE_KEY) as UserRole) || 'WCZK',
  );
  const [voivodeship, setVoivodeshipState] = useState<string>(
    () => localStorage.getItem(VOIV_KEY) || '',
  );
  const [gmina, setGminaState] = useState<string>(() => localStorage.getItem(GMINA_KEY) || '');
  const [demands, setDemands] = useState<DemandRequestRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [allocations, setAllocations] = useState<AllocationRecord[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [finance, setFinance] = useState<FinanceRecord[]>([]);
  const [supply, setSupply] = useState<SupplyRecord[]>([]);
  const [writebackError, setWritebackError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/scene.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Nie udało się wczytać sceny (HTTP ${r.status}).`);
        return r.json() as Promise<Scene>;
      })
      .then((scene) => {
        if (cancelled) return;
        const idx = indexScene(scene);
        setIndex(idx);
        // Start na dobie o najwyzszej liczbie otwartych wnioskow priorytetu 1 -
        // demo od razu pokazuje sytuacje wymagajaca decyzji, nie pusty poczatek.
        const peak = idx.scene.country.reduce(
          (best, c, i) => (c.p1Open > idx.scene.country[best].p1Open ? i : best),
          0,
        );
        setDayIndexState(Math.max(peak - 1, 0));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [d, ap, al, de, fi, su] = await Promise.all([
        listDemands(),
        listApprovals(),
        listAllocations(),
        listDeliveries(),
        listFinance(),
        listSupply(),
      ]);
      setDemands(d);
      setApprovals(ap);
      setAllocations(al);
      setDeliveries(de);
      setFinance(fi);
      setSupply(su);
      setWritebackError(null);
    } catch (e: unknown) {
      setWritebackError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!playing || !index) return;
    timer.current = window.setInterval(() => {
      setDayIndexState((i) => (i + 1 >= index.days.length ? 0 : i + 1));
    }, speed);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, speed, index]);

  const setDayIndex = useCallback((i: number) => {
    setPlaying(false);
    setDayIndexState(i);
  }, []);

  const setRole = useCallback((r: UserRole) => {
    setRoleState(r);
    localStorage.setItem(ROLE_KEY, r);
  }, []);

  const setVoivodeship = useCallback((code: string) => {
    setVoivodeshipState(code);
    localStorage.setItem(VOIV_KEY, code);
  }, []);

  const setGmina = useCallback((code: string) => {
    setGminaState(code);
    localStorage.setItem(GMINA_KEY, code);
  }, []);

  const actor: Actor = useMemo(
    () => ({
      id: user?.id ?? 'local-user',
      name: user?.name ?? user?.email ?? 'Użytkownik demonstracyjny',
      role,
      voivodeshipCode: voivodeship,
      gminaCode: gmina,
    }),
    [user, role, voivodeship, gmina],
  );

  const value: ScenarioValue = useMemo(
    () => ({
      index,
      loading,
      error,
      dayIndex,
      day: index ? index.days[dayIndex] : '',
      setDayIndex,
      playing,
      togglePlay: () => setPlaying((p) => !p),
      speed,
      setSpeed,
      actor,
      setRole,
      setVoivodeship,
      setGmina,
      demands,
      approvals,
      allocations,
      deliveries,
      finance,
      supply,
      refresh,
      writebackError,
    }),
    [
      index,
      loading,
      error,
      dayIndex,
      setDayIndex,
      playing,
      speed,
      actor,
      setRole,
      setVoivodeship,
      setGmina,
      demands,
      approvals,
      allocations,
      deliveries,
      finance,
      supply,
      refresh,
      writebackError,
    ],
  );

  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export function useScenario(): ScenarioValue {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error('useScenario musi być użyte wewnątrz ScenarioProvider');
  return ctx;
}
