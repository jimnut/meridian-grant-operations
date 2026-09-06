import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { LoadingState } from './components/ui';
import { trackPageView } from './lib/analytics';
import { useSession } from './lib/session';
import { CalendarPage } from './pages/CalendarPage';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { FunderDetailPage } from './pages/FunderDetailPage';
import { FundersPage } from './pages/FundersPage';
import { GrantDetailPage } from './pages/GrantDetailPage';
import { GrantPacketPage } from './pages/GrantPacketPage';
import { ImportPage } from './pages/ImportPage';
import { InvitePage } from './pages/InvitePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { ReportsPage } from './pages/ReportsPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { TeamPage } from './pages/TeamPage';

/** Routes reachable without a session. Invitations work both ways. */
const PUBLIC_ROUTES: Record<string, () => JSX.Element> = {
  '/signin': SignInPage,
  '/signup': SignUpPage,
  '/forgot-password': ForgotPasswordPage,
  '/reset-password': ResetPasswordPage,
};

export function App() {
  const { session, isLoading } = useSession();
  const location = useLocation();

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  if (isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <LoadingState label="Opening your workspace…" />
      </div>
    );
  }

  const path = location.pathname.replace(/\/+$/, '') || '/';
  const isInvite = /^\/invite\/[^/]+$/.test(path);

  if (!session) {
    const Page = PUBLIC_ROUTES[path];
    if (Page) return <Page />;
    if (isInvite) {
      return (
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
        </Routes>
      );
    }
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }

  if (PUBLIC_ROUTES[path]) {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/grants" element={<PortfolioPage />} />
        <Route path="/grants/import" element={<ImportPage />} />
        <Route path="/grants/:grantId" element={<GrantDetailPage />} />
        <Route path="/grants/:grantId/packet" element={<GrantPacketPage />} />
        <Route path="/funders" element={<FundersPage />} />
        <Route path="/funders/:funderId" element={<FunderDetailPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
