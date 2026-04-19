import { Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { LoginPage } from '@/pages/Login';
import { OverviewPage } from '@/pages/Overview';
import { StreamsPage } from '@/pages/Streams';
import { StatsPage } from '@/pages/Stats';
import { LogsPage } from '@/pages/Logs';
import { AccountsPage } from '@/pages/Accounts';
import { SettingsPage } from '@/pages/Settings';

export const App = (): JSX.Element => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<Layout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/streams" element={<StreamsPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Route>
  </Routes>
);
