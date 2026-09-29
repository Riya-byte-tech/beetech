import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_BY_ROLE = {
  beekeeper: [{ to: '/beekeeper', label: 'My Apiary' }],
  lab: [{ to: '/admin', label: 'Processing / Lab' }],
  admin: [
    { to: '/cluster', label: 'Cluster Alerts' },
    { to: '/ledger', label: 'Ledger' },
    { to: '/admin/approvals', label: 'Approvals' },
  ],
};

export default function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const links = user ? (NAV_BY_ROLE[user.role] || []) : [];

  return (
    <div className="topbar">
      <NavLink to="/" className="brand">
        <span className="emoji">🍯</span> Honey Chain
      </NavLink>
      <div className="nav-links" style={{ alignItems: 'center' }}>
        {links.map(link => (
          <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            {link.label}
          </NavLink>
        ))}
        <NavLink to="/scan" className={({ isActive }) => (isActive ? 'active' : '')}>
          Consumer Scan
        </NavLink>
        {user ? (
          <>
            <span className="muted" style={{ marginLeft: 10, fontSize: '0.85rem' }}>{user.email}</span>
            <button className="btn-secondary btn" style={{ marginLeft: 8, padding: '6px 12px' }} onClick={handleLogout}>
              Logout
            </button>
          </>
        ) : (
          <NavLink to="/login" className="btn" style={{ marginLeft: 8 }}>Sign In</NavLink>
        )}
      </div>
    </div>
  );
}
