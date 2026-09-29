import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import TopBar from './components/TopBar';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import BeekeeperDashboard from './pages/BeekeeperDashboard';
import HiveDetail from './pages/HiveDetail';
import AdminBatchPipeline from './pages/AdminBatchPipeline';
import ConsumerScan from './pages/ConsumerScan';
import ClusterAlerts from './pages/ClusterAlerts';
import LedgerExplorer from './pages/LedgerExplorer';
import AdminApprovals from './pages/AdminApprovals';

const HOME_BY_ROLE = { beekeeper: '/beekeeper', lab: '/admin', admin: '/cluster' };

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted">Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app-shell">
          <TopBar />
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route path="/beekeeper" element={<ProtectedRoute roles={['beekeeper']}><BeekeeperDashboard /></ProtectedRoute>} />
            <Route path="/beekeeper/hives/:hiveId" element={<ProtectedRoute roles={['beekeeper', 'admin']}><HiveDetail /></ProtectedRoute>} />

            <Route path="/admin" element={<ProtectedRoute roles={['lab', 'admin']}><AdminBatchPipeline /></ProtectedRoute>} />
            <Route path="/admin/batches/:batchId" element={<ProtectedRoute roles={['lab', 'admin']}><AdminBatchPipeline /></ProtectedRoute>} />

            <Route path="/cluster" element={<ProtectedRoute roles={['admin']}><ClusterAlerts /></ProtectedRoute>} />
            <Route path="/ledger" element={<ProtectedRoute roles={['admin']}><LedgerExplorer /></ProtectedRoute>} />
            <Route path="/admin/approvals" element={<ProtectedRoute roles={['admin']}><AdminApprovals /></ProtectedRoute>} />

            {/* Fully public - no login needed to scan and verify a product */}
            <Route path="/scan" element={<ConsumerScan />} />
            <Route path="/scan/:qrToken" element={<ConsumerScan />} />
            <Route path="/verify/:qrToken" element={<ConsumerScan />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
