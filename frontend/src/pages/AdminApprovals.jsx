import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AdminApprovals() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setPending(await api.getPendingBeekeepers());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleApprove(id) {
    setBusyId(id);
    try {
      await api.verifyBeekeeper(id);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="muted">Loading pending registrations...</p>;

  return (
    <div>
      <div className="card">
        <h2>Pending Beekeeper Approvals</h2>
        <p className="muted">
          New beekeeper registrations start unverified and can't record harvests until approved here.
          This is the enforcement point behind the "verified beekeeper" badge shown throughout the app.
        </p>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        {pending.length === 0 ? (
          <div className="notice-box">✅ No pending registrations right now.</div>
        ) : (
          pending.map(bk => (
            <div key={bk.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0e5cc' }}>
              <div>
                <strong>{bk.name}</strong>
                <div className="muted" style={{ fontSize: '0.85rem' }}>{bk.district}, {bk.state} · {bk.phone || 'no phone given'}</div>
              </div>
              <button className="btn" disabled={busyId === bk.id} onClick={() => handleApprove(bk.id)}>
                {busyId === bk.id ? 'Approving...' : 'Approve'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
