import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const HOME_BY_ROLE = {
  beekeeper: '/beekeeper',
  lab: '/admin',
  admin: '/cluster',
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(email, password);
      const dest = location.state?.from || HOME_BY_ROLE[user.role] || '/';
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-page">
      <div className="card" style={{ maxWidth: 380, width: '100%' }}>
        <h2 style={{ textAlign: 'center' }}>🍯 Honey Chain</h2>
        <p className="muted" style={{ textAlign: 'center', marginTop: -8 }}>Sign in to your account</p>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button className="btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="muted" style={{ textAlign: 'center', marginTop: 16, fontSize: '0.85rem' }}>
          New beekeeper? <Link to="/register">Register here</Link>
        </p>

        <div className="notice-box" style={{ marginTop: 16, fontSize: '0.78rem' }}>
          <strong>Demo accounts:</strong><br />
          Beekeeper: ramesh@honeychain.demo / beekeeper123<br />
          Lab: lab@honeychain.demo / lab123456<br />
          Admin: admin@honeychain.demo / admin12345
        </div>
      </div>
    </div>
  );
}
