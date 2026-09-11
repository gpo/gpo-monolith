import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { AppShell, Group, Text, Anchor } from '@mantine/core';
import { ContributionsListPage } from './routes/contributions.js';
import { DashboardPage } from './routes/dashboard.js';
import { LoginPage } from './routes/login.js';

const rootRoute = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
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
            <Anchor component={Link} to="/login">
              Sign in
            </Anchor>
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

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, contributionsRoute]);

export function makeRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
