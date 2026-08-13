import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { ArrowLeft, Building2, Gamepad2, LogOut, ShieldX } from 'lucide-react';
import { auth } from './lib/firebase';
import { Button } from './components/ui/Button';
import { OrganizationDirectory } from './components/platform/OrganizationDirectory';
import { WorkshopDirectory } from './components/platform/WorkshopDirectory';
import { PlatformError, PlatformLoading } from './components/platform/PlatformPrimitives';
import { reportClientError } from './lib/clientLogger';

type PlatformSection = 'organizations' | 'workshops';
type AccessState = 'checking' | 'anonymous' | 'denied' | 'authorized' | 'error';

const readSection = (): PlatformSection =>
  new URLSearchParams(window.location.search).get('section') === 'workshops'
    ? 'workshops'
    : 'organizations';

export default function PlatformApp() {
  const [user, setUser] = useState<User | null>(null);
  const [accessState, setAccessState] = useState<AccessState>('checking');
  const [accessError, setAccessError] = useState('');
  const [section, setSection] = useState<PlatformSection>(readSection);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!active) return;
      setUser(firebaseUser);
      setAccessState('checking');
      setAccessError('');
      if (!firebaseUser || firebaseUser.isAnonymous) {
        setAccessState('anonymous');
        return;
      }
      try {
        const token = await firebaseUser.getIdTokenResult(true);
        if (!active) return;
        setAccessState(token.claims.platformAdmin === true ? 'authorized' : 'denied');
      } catch (error: unknown) {
        reportClientError('Platform claim verification failed', error);
        if (active) {
          setAccessState('error');
          setAccessError('No se pudo verificar el acceso. Revisa la conexión e inténtalo de nuevo.');
        }
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    const handlePopState = () => setSection(readSection());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const changeSection = (next: PlatformSection) => {
    const url = new URL(window.location.href);
    if (next === 'organizations') url.searchParams.delete('section');
    else url.searchParams.set('section', next);
    window.history.pushState(null, '', url);
    setSection(next);
  };

  if (accessState === 'checking') {
    return <main className="min-h-screen bg-kreatum-bg-light"><PlatformLoading label="Verificando acceso" /></main>;
  }

  if (accessState !== 'authorized') {
    const denied = accessState === 'denied';
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#f2eaf2_0%,#f6f8fb_42%,#eef3f8_100%)] px-4 py-10">
        <section className="w-full max-w-lg rounded-3xl border border-black/[0.07] bg-white p-7 text-center shadow-[0_28px_90px_-55px_rgba(16,47,64,0.75)] sm:p-10" aria-labelledby="restricted-access-title">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/10 text-red-600"><ShieldX className="h-7 w-7" aria-hidden="true" /></div>
          <h1 id="restricted-access-title" className="mt-5 text-2xl font-extrabold text-kreatum-dark">Acceso restringido</h1>
          <p className="mt-3 text-sm leading-6 text-kreatum-gray/75">
            {denied
              ? 'Tu cuenta no tiene el permiso global requerido. No se ha solicitado ni mostrado información de ninguna empresa.'
              : 'Identifícate con una cuenta autorizada para continuar.'}
          </p>
          <div className="mt-5"><PlatformError message={accessError} /></div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <a href="/admin" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-kreatum-purple px-5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple/35">Ir al acceso</a>
            {user && !user.isAnonymous && <Button variant="outline" onClick={() => void signOut(auth)}>Cerrar sesión</Button>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell min-h-screen text-kreatum-gray">
      <header className="sticky top-0 z-30 border-b border-black/[0.07] bg-white/[0.94] shadow-[0_12px_30px_-28px_rgba(16,47,64,0.65)] backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-[96rem] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/logo.png" alt="KREATUM" className="h-8 w-auto flex-none" />
            <span className="hidden h-6 w-px bg-black/10 sm:block" aria-hidden="true" />
            <div className="min-w-0"><p className="truncate text-sm font-extrabold text-kreatum-dark">Plataforma GFS</p><p className="hidden truncate text-xs text-kreatum-gray/75 sm:block">Gobierno multiempresa</p></div>
          </div>
          <div className="flex flex-none items-center gap-1 sm:gap-2">
            <a
              href="/admin"
              aria-label="Volver al panel del Alquimista"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-kreatum-gray transition-all duration-200 hover:bg-black/[0.04] hover:text-kreatum-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple/35 active:scale-[0.98] sm:px-4"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Volver al panel</span>
            </a>
            <Button variant="ghost" size="sm" onClick={() => void signOut(auth)} aria-label="Cerrar sesión de Plataforma GFS"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Cerrar sesión</span></Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[96rem] gap-1 overflow-x-auto px-4 pb-3 sm:px-6 lg:px-8" aria-label="Secciones de Plataforma GFS">
          <button type="button" onClick={() => changeSection('organizations')} aria-current={section === 'organizations' ? 'page' : undefined} className={`inline-flex min-h-11 flex-none items-center gap-2 rounded-xl px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple ${section === 'organizations' ? 'bg-kreatum-purple text-white' : 'text-kreatum-gray/75 hover:bg-black/[0.04]'}`}><Building2 className="h-4 w-4" />Empresas</button>
          <button type="button" onClick={() => changeSection('workshops')} aria-current={section === 'workshops' ? 'page' : undefined} className={`inline-flex min-h-11 flex-none items-center gap-2 rounded-xl px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple ${section === 'workshops' ? 'bg-kreatum-purple text-white' : 'text-kreatum-gray/75 hover:bg-black/[0.04]'}`}><Gamepad2 className="h-4 w-4" />Partidas e informes</button>
        </nav>
      </header>

      <main className="mx-auto max-w-[96rem] px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
        {section === 'organizations' ? <OrganizationDirectory /> : <WorkshopDirectory />}
      </main>
    </div>
  );
}
