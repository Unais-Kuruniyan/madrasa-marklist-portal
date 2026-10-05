import { AppLayout } from './layouts/AppLayout';
import { useHashRoute, paths } from './hooks/useHashRoute';
import { isSupabaseConfigured } from './lib/supabase/client';
import { DashboardPage } from './pages/DashboardPage';
import { ClassFormPage } from './pages/ClassFormPage';
import { ClassPage } from './pages/ClassPage';
import { PrintPage } from './pages/PrintPage';
import { Alert } from './components/ui/Alert';
import { EmptyState } from './components/ui/EmptyState';
import { LinkButton } from './components/ui/Button';

export default function App() {
  const route = useHashRoute();

  if (!isSupabaseConfigured) {
    return (
      <AppLayout>
        <Alert tone="error" title="Database not configured">
          <p>
            Set <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> (see <code className="font-mono">.env.example</code> and
            the README), then restart / redeploy the app.
          </p>
        </Alert>
      </AppLayout>
    );
  }

  // The print page has its own minimal layout.
  if (route.name === 'print') {
    return <PrintPage key={`${route.id}-${route.examId ?? 'default'}`} classId={route.id} examId={route.examId} />;
  }

  return (
    <AppLayout>
      {route.name === 'dashboard' && <DashboardPage />}
      {route.name === 'new-class' && <ClassFormPage key="new" classId={null} />}
      {route.name === 'edit-class' && <ClassFormPage key={`edit-${route.id}`} classId={route.id} />}
      {route.name === 'class' && (
        <ClassPage key={`${route.id}-${route.examId ?? 'default'}`} classId={route.id} examId={route.examId} />
      )}
      {route.name === 'not-found' && (
        <EmptyState
          title="Page not found"
          description="The page you are looking for does not exist."
          action={<LinkButton href={paths.dashboard()}>Go to all classes</LinkButton>}
        />
      )}
    </AppLayout>
  );
}
