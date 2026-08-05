import { useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';

const msLogo = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 21 21"
    className="mr-2"
  >
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

export function AuthPage() {
  const { signIn, fabricAuthEnabled } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logowanie nie powiodło się.');
    } finally {
      setIsLoading(false);
    }
  };

  const buttonLabel = isLoading
    ? fabricAuthEnabled
      ? 'Otwieram Fabric…'
      : 'Logowanie…'
    : 'Zaloguj przez Microsoft';

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute -top-40 right-0 h-[520px] w-[520px] rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-20 h-[560px] w-[560px] rounded-full bg-blue-700/10 blur-3xl" />

      <div className="relative flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="rounded-2xl bg-slate-900/80 p-8 ring-1 ring-slate-700 shadow-2xl backdrop-blur">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/40">
                <span className="text-base font-bold">24</span>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-slate-100">COP-24 · Pulpit RZZK</h1>
                <p className="text-xs text-slate-500">
                  Wspólny obraz sytuacji i rejestr decyzji
                </p>
              </div>
            </div>

            <p className="mb-6 text-sm leading-relaxed text-slate-400">
              Aplikacja demonstracyjna dla Rządowego Zespołu Zarządzania Kryzysowego. Pokazuje, jak
              dane z wielu strumieni układają się w jeden obraz sytuacji, jak powstaje rekomendacja
              poziomu reagowania i jak decyzja jest zapisywana razem z przesłankami.
            </p>

            <button
              type="button"
              onClick={handleSignIn}
              disabled={isLoading}
              className="flex w-full items-center justify-center rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-all hover:bg-cyan-400 disabled:opacity-50"
            >
              {msLogo}
              {buttonLabel}
            </button>

            {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}

            <p className="mt-6 text-[11px] leading-relaxed text-slate-600">
              Dane w aplikacji są w całości syntetyczne i wygenerowane na potrzeby demonstracji.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
