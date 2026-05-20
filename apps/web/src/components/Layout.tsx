import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cog,
  Github,
  KeyRound,
  ListOrdered,
  LogOut,
  Radio,
  Tv,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';

const NAV = [
  { to: '/', label: 'Overview', icon: Activity },
  { to: '/streams', label: 'Streams', icon: Tv },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
  { to: '/logs', label: 'Logs', icon: ListOrdered },
  { to: '/accounts', label: 'Accounts', icon: KeyRound },
  { to: '/settings', label: 'Settings', icon: Cog },
];

export const Layout = (): JSX.Element => {
  const nav = useNavigate();
  const status = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 10_000,
  });
  const accounts = status.data?.accounts ?? [];
  const disconnected = accounts.filter((a) => a.enabled && !a.loggedIn);
  const running = status.data?.running ?? false;
  const connectedCount = accounts.filter((a) => a.loggedIn).length;
  const totalEnabled = accounts.filter((a) => a.enabled).length;

  const logout = async (): Promise<void> => {
    await api.logout();
    nav('/login');
  };

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border/60 bg-card/70 backdrop-blur">
        <Link
          to="/"
          className="flex items-center gap-2.5 border-b border-border/60 px-5 py-4 transition-colors hover:bg-muted/40"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <Radio className="h-5 w-5" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-tight">MOSBot</span>
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <StatusDot variant={running ? 'success' : 'muted'} pulse={running} />
              {running ? 'Running' : 'Stopped'}
            </span>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'cursor-pointer',
                  isActive
                    ? 'bg-secondary/80 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-primary" />
                  )}
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mx-3 mb-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Accounts</span>
            <span className="font-mono tabular-nums">
              {connectedCount}/{totalEnabled}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
            <StatusDot
              variant={disconnected.length === 0 ? 'success' : 'destructive'}
            />
            <span className="text-muted-foreground">
              {disconnected.length === 0 ? 'all connected' : `${disconnected.length} offline`}
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          className="mx-3 mb-3 justify-start text-muted-foreground hover:text-foreground"
        >
          <LogOut className="mr-2 h-4 w-4" /> Log out
        </Button>
      </aside>

      <main className="flex min-h-screen flex-1 flex-col overflow-x-hidden">
        <div className="flex-1 px-6 py-6 md:px-8 md:py-8">
          {disconnected.length > 0 && (
            <div className="fade-rise mb-5 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="flex-1 text-destructive">
                <p className="font-semibold">
                  {disconnected.length === 1
                    ? `Account "${disconnected[0]!.name}" is not connected.`
                    : `${disconnected.length} accounts are not connected.`}
                </p>
                <p className="mt-0.5 text-destructive/80">
                  Twitch rejected the stored token or it was never established. Re-authorize
                  via the Accounts page.
                </p>
              </div>
              <Link
                to="/accounts"
                className="shrink-0 self-center rounded-md border border-destructive/60 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
              >
                Fix now
              </Link>
            </div>
          )}
          <div className="fade-rise">
            <Outlet />
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-6 py-3 text-xs text-muted-foreground md:px-8">
          <span>
            MOSBot · built by{' '}
            <a
              href="https://github.com/patriqcs"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground/80 transition-colors hover:text-primary"
            >
              patriQ
            </a>
          </span>
          <a
            href="https://github.com/patriqcs/mosbot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <Github className="h-3.5 w-3.5" />
            <span className="font-mono">v{__APP_VERSION__}</span>
          </a>
        </footer>
      </main>
    </div>
  );
};
