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
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 10_000 });
  const disconnected = (status.data?.accounts ?? []).filter((a) => a.enabled && !a.loggedIn);
  const logout = async (): Promise<void> => {
    await api.logout();
    nav('/login');
  };
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r bg-card p-4 flex flex-col">
        <Link to="/" className="mb-6 flex items-center gap-2 text-lg font-bold">
          <Radio className="h-5 w-5" /> MOSBot
        </Link>
        <nav className="flex flex-col gap-1 flex-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                  isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-accent',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" /> Log out
        </Button>
      </aside>
      <main className="flex-1 p-6 overflow-y-auto flex flex-col">
        {disconnected.length > 0 && (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div className="flex-1">
              <span className="font-semibold">
                {disconnected.length === 1
                  ? `Account "${disconnected[0]!.name}" is not connected.`
                  : `${disconnected.length} accounts are not connected.`}
              </span>{' '}
              Twitch rejected the stored token or it was never established. Re-authorize via the
              Accounts page.
            </div>
            <Link
              to="/accounts"
              className="shrink-0 rounded-md border border-destructive/60 px-3 py-1 font-medium hover:bg-destructive hover:text-destructive-foreground"
            >
              Fix now
            </Link>
          </div>
        )}
        <div className="flex-1">
          <Outlet />
        </div>
        <footer className="mt-6 pt-4 border-t text-xs text-muted-foreground flex justify-between items-center">
          <span>
            MOSBot · built by{' '}
            <a
              href="https://github.com/patriqcs"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:text-foreground hover:underline underline-offset-4"
            >
              patriQ
            </a>
          </span>
          <a
            href="https://github.com/patriqcs/mosbot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            <Github className="h-3.5 w-3.5" />
            v{__APP_VERSION__}
          </a>
        </footer>
      </main>
    </div>
  );
};
