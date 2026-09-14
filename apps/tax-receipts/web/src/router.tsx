import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
  type RouterHistory,
} from '@tanstack/react-router';
import { AppShell, Button, Center, Group, Loader, Text, Anchor } from '@mantine/core';
import { api } from './api.js';
import { AdminPage } from './routes/admin.js';
import { ChangeLogPage } from './routes/change-log.js';
import { ContributionDetailPage } from './routes/contribution-detail.js';
import { ContributionsListPage } from './routes/contributions.js';
import { DashboardPage } from './routes/dashboard.js';
import { DevToolsPage } from './routes/dev-tools.js';
import { LoginPage } from './routes/login.js';
import { WorkQueuePage } from './routes/work-queue.js';

const rootRoute = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Signed-in users shouldn't land back on the login form.
  useEffect(() => {
    if (me.data && pathname === '/login') {
      void navigate({ to: '/' });
    }
  }, [me.data, pathname, navigate]);

  if (me.isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (!me.data) {
    return (
      <Center h="100vh">
        <LoginPage />
      </Center>
    );
  }

  async function signOut() {
    await api.logout();
    await qc.invalidateQueries({ queryKey: ['me'] });
  }

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={700}>GPO Tax Receipts &amp; Contributions</Text>
          <Group>
            <Anchor component={Link} to="/">
              Dashboard
            </Anchor>
            <Anchor component={Link} to="/contributions">
              Contributions
            </Anchor>
            <Anchor component={Link} to="/work-queue">
              Work queue
            </Anchor>
            <Anchor component={Link} to="/change-log">
              Change-log
            </Anchor>
            <Anchor component={Link} to="/admin">
              Admin
            </Anchor>
            {import.meta.env.DEV && (
              <Anchor component={Link} to="/dev-tools">
                Dev tools
              </Anchor>
            )}
            <Button variant="subtle" onClick={signOut}>
              Sign out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const contributionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contributions',
  component: ContributionsListPage,
});

const contributionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contributions/$id',
  component: () => {
    const { id } = useParams({ from: '/contributions/$id' });
    return <ContributionDetailPage id={id} />;
  },
});

const workQueueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/work-queue',
  component: WorkQueuePage,
});

const changeLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change-log',
  component: ChangeLogPage,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminPage,
});

const devToolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev-tools',
  component: DevToolsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  contributionsRoute,
  contributionDetailRoute,
  workQueueRoute,
  changeLogRoute,
  adminRoute,
  ...(import.meta.env.DEV ? [devToolsRoute] : []),
]);

export function makeRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
