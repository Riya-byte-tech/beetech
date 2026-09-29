import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const HOME_BY_ROLE = {
  beekeeper: '/beekeeper',
  lab: '/admin',
  admin: '/cluster',
};

/** Wrap a route element: <ProtectedRoute roles={['admin']}><Page /></ProtectedRoute> */
export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <p className="muted">Loading...</p>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
  }
  return children;
}
