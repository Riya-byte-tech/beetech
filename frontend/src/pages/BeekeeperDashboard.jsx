import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function BeekeeperDashboard() {
  const { user, refresh } = useAuth();
  const [hives, setHives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddHive, setShowAddHive] = useState(false);
  const [newHiveProfile, setNewHiveProfile] = useState('healthy');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setHives(await api.getHives());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleAddHive(e) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createHive({ species: 'Apis cerana', simulate_profile: newHiveProfile });
      setShowAddHive(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  const beekeeper = user?.beekeeper;
  const counts = hives.reduce((acc, h) => {
    acc[h.health_status] = (acc[h.health_status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="card">
        <h2 style={{ margin: 0 }}>My Apiary — {beekeeper?.name}</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          {beekeeper?.district}, {beekeeper?.state} · {beekeeper?.verified ? 'Verified beekeeper' : 'Pending verification'}
        </p>

        {!beekeeper?.verified && (
          <div className="notice-box" style={{ marginTop: 14 }}>
            ⏳ Your account is pending Cluster Admin verification. You can register hives and watch
            sensor data in the meantime, but you won't be able to record a harvest until you're approved.
            {' '}<button className="btn-secondary btn" style={{ marginLeft: 6, padding: '4px 10px', fontSize: '0.8rem' }} onClick={refresh}>
              Check again
            </button>
          </div>
        )}

        <div className="grid grid-3" style={{ marginTop: 14 }}>
          <SummaryStat label="Total Hives" value={hives.length} />
          <SummaryStat label="Healthy / Attention" value={`${counts.Healthy || 0} / ${counts.Attention || 0}`} />
          <SummaryStat label="Critical" value={counts.Critical || 0} highlight={counts.Critical > 0} />
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Hives</h3>
          <button className="btn" onClick={() => setShowAddHive(s => !s)}>
            {showAddHive ? 'Cancel' : '+ Register Hive'}
          </button>
        </div>

        {showAddHive && (
          <form onSubmit={handleAddHive} style={{ marginTop: 16, maxWidth: 320 }}>
            <div className="field">
              <label>Simulated sensor profile (demo only)</label>
              <select value={newHiveProfile} onChange={e => setNewHiveProfile(e.target.value)}>
                <option value="healthy">Healthy</option>
                <option value="attention">Attention</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <button className="btn" type="submit" disabled={creating}>
              {creating ? 'Registering...' : 'Register Hive'}
            </button>
          </form>
        )}

        {loading ? (
          <p className="muted">Loading hives...</p>
        ) : hives.length === 0 ? (
          <p className="muted" style={{ marginTop: 16 }}>No hives yet. Register one above.</p>
        ) : (
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            {hives.map(hive => (
              <Link to={`/beekeeper/hives/${hive.id}`} key={hive.id} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="hive-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <strong>{hive.id}</strong>
                    <span className={`status-pill status-${hive.health_status}`}>{hive.health_status}</span>
                  </div>
                  <p className="muted" style={{ margin: '8px 0 0' }}>{hive.species}</p>
                  <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                    Health score: <strong>{hive.health_score ?? '—'}</strong>/100
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryStat({ label, value, highlight }) {
  return (
    <div style={{ textAlign: 'center', padding: '10px 0' }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: highlight ? 'var(--red-bad)' : 'var(--amber-900)' }}>
        {value}
      </div>
      <div className="muted">{label}</div>
    </div>
  );
}
