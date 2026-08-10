import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { LoadingState } from './components/ui';
import { useSession } from './lib/session';
import { CalendarPage } from './pages/CalendarPage';
import { DashboardPage } from './pages/DashboardPage';
import { FunderDetailPage } from './pages/FunderDetailPage';
import { FundersPage } from './pages/FundersPage';
import { GrantDetailPage } from './pages/GrantDetailPage';
import { GrantPacketPage } from './pages/GrantPacketPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignInPage } from './pages/SignInPage';
import { TeamPage } from './pages/TeamPage';

export function App() {
  const { session, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <LoadingState label="Opening your workspace…" />
      </div>
    );
  }

  if (!session) {
    if (location.pathname === '/signin') return <SignInPage />;
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }

  if (location.pathname === '/signin') {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/grants" element={<PortfolioPage />} />
        <Route path="/grants/:grantId" element={<GrantDetailPage />} />
        <Route path="/grants/:grantId/packet" element={<GrantPacketPage />} />
        <Route path="/funders" element={<FundersPage />} />
        <Route path="/funders/:funderId" element={<FunderDetailPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
