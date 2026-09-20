import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useParams,
  useRouterState,
  useSearch,
  type RouterHistory,
} from '@tanstack/react-router';
import { AppShell, Button, Center, Group, Loader, Anchor } from '@mantine/core';
import gpoLogo from './assets/gpo-logo-EN-horizontal-green.svg';
import { api } from './api.js';
import { ADMIN_SECTIONS, AdminLayout, visibleAdminSections } from './routes/admin.js';
import { ContributionDetailPage } from './routes/contribution-detail.js';
import { ContributionsListPage } from './routes/contributions.js';
import { DashboardPage } from './routes/dashboard.js';
import { LoginPage } from './routes/login.js';
import { SpaceIssuancePage } from './routes/space-issuance.js';
import { WorkQueuePage } from './routes/work-queue.js';

/**
 * A header nav item styled as a plain top-bar link rather than a bordered
 * button: muted until active/hovered, with a soft highlight pill instead of
 * an underline.
 */
function HeaderLink({ to, children }: { to: string; children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Anchor
      component={Link}
      to={to}
      underline="never"
      fw={500}
      c={active ? 'gpoGreen.8' : 'dimmed'}
      px="sm"
      py={4}
      style={{
        borderRadius: 'var(--mantine-radius-sm)',
        backgroundColor: active ? 'var(--mantine-color-gpoGreen-0)' : undefined,
      }}
    >
      {children}
    </Anchor>
  );
}

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
          <Link to="/" style={{ display: 'flex', alignItems: 'center' }}>
            <img src={gpoLogo} alt="Green Party of Ontario" height={32} />
          </Link>
          <Group gap="xs">
            <HeaderLink to="/contributions">Contributions</HeaderLink>
            <HeaderLink to="/work-queue">Work queue</HeaderLink>
            <HeaderLink to="/admin">Admin</HeaderLink>
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

const spaceIssuanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/spaces/$periodId/$entityKind/issue',
  component: () => {
    const { periodId, entityKind } = useParams({ from: '/spaces/$periodId/$entityKind/issue' });
    const search = useSearch({ strict: false }) as { ridingNumber?: number };
    return (
      <SpaceIssuancePage
        periodId={Number(periodId)}
        entityKind={entityKind}
        ridingNumber={search.ridingNumber ?? null}
      />
    );
  },
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminLayout,
});

// Bare /admin has no section of its own — send it to the first one so the
// nav and Outlet always have a matching child route to render.
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: `/admin/${ADMIN_SECTIONS[0].slug}` });
  },
});

const adminSectionRoutes = visibleAdminSections.map((section) =>
  createRoute({
    getParentRoute: () => adminRoute,
    path: section.slug,
    component: section.component,
  }),
);

const adminRouteWithChildren = adminRoute.addChildren([adminIndexRoute, ...adminSectionRoutes]);

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  contributionsRoute,
  contributionDetailRoute,
  workQueueRoute,
  spaceIssuanceRoute,
  adminRouteWithChildren,
]);

export function makeRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
