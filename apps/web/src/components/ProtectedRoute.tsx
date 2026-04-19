import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router-dom';
import { api } from '@/lib/api';

export const ProtectedRoute = (): JSX.Element => {
  const q = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
  });
  if (q.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-muted-foreground">Loading…</span>
      </div>
    );
  }
  if (q.isError || !q.data) return <Navigate to="/login" replace />;
  return <Outlet />;
};
