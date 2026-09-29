import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', district: '', state: 'Maharashtra', phone: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { message } = await register(form);
      setSuccessMessage(message);
      // Deliberately no auto-redirect here. An earlier version navigated away
      // after a couple of seconds automatically, which read as "it just
      // approved itself" even though nothing was verified - the account was
      // (correctly) still pending, but the fast, unprompted transition to the
      // normal dashboard made that easy to miss. Now the person has to
      // consciously click through, by which point they've actually seen the
      // pending-verification message.
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-page">
      <div className="card" style={{ maxWidth: 420, width: '100%' }}>
        <h2 style={{ textAlign: 'center' }}>🐝 Register as a Beekeeper</h2>

        {error && <div className="error-box">{error}</div>}

        {successMessage && (
          <div>
            <div className="notice-box">⏳ {successMessage}</div>
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
              onClick={() => navigate('/beekeeper', { replace: true })}
            >
              Continue to My Apiary
            </button>
          </div>
        )}

        {!successMessage && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full name</label>
              <input required value={form.name} onChange={update('name')} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" required value={form.email} onChange={update('email')} />
            </div>
            <div className="field">
              <label>Password (min. 8 characters)</label>
              <input type="password" required minLength={8} value={form.password} onChange={update('password')} />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label>District</label>
                <input value={form.district} onChange={update('district')} />
              </div>
              <div className="field">
                <label>State</label>
                <input value={form.state} onChange={update('state')} />
              </div>
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={form.phone} onChange={update('phone')} />
            </div>
            <button className="btn" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
              {submitting ? 'Registering...' : 'Register'}
            </button>
          </form>
        )}

        <p className="muted" style={{ textAlign: 'center', marginTop: 16, fontSize: '0.85rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
