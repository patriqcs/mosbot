import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Cog, KeyRound, ListOrdered, LogOut, Radio, Tv } from 'lucide-react';
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
      <main className="flex-1 p-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
};
