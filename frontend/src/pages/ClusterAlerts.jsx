import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function ClusterAlerts() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAlerts();
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <p className="muted">Loading cluster status...</p>;
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return null;

  const { total_hives, counts, flagged } = data;

  return (
    <div>
      <div className="card">
        <h2>Cluster Alerts</h2>
        <p className="muted">
          A cross-hive view across every beekeeper in the system — the kind of dashboard a KVIC/NBB
          cluster administrator would use to spot problems without visiting each apiary individually.
        </p>
        <div className="grid grid-3" style={{ marginTop: 14 }}>
          <SummaryStat label="Total Hives" value={total_hives} />
          <SummaryStat label="Healthy" value={counts.Healthy} />
          <SummaryStat label="Needs Attention" value={counts.Attention + counts.Critical} highlight={counts.Attention + counts.Critical > 0} />
        </div>
      </div>

      <div className="card">
        <h3>Flagged Hives {flagged.length > 0 && <span className="muted">({flagged.length})</span>}</h3>

        {flagged.length === 0 ? (
          <div className="notice-box">✅ No hives currently flagged across the cluster. Everything's within normal ranges.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {flagged.map(hive => (
              <div key={hive.id} className="card" style={{ marginBottom: 10, boxShadow: 'none', border: '1px solid #f0e5cc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong>{hive.id}</strong>
                    <span className="muted"> · {hive.beekeeper_name} · {hive.district}, {hive.state} · {hive.apiary_name}</span>
                  </div>
                  <span className={`status-pill status-${hive.health.status}`}>{hive.health.status} ({hive.health.score}/100)</span>
                </div>
                <p style={{ marginTop: 8, fontSize: '0.9rem' }}>{hive.health.reason}</p>
                {hive.health.flag && (
                  <p style={{ marginTop: 4, fontSize: '0.85rem', fontWeight: 700, color: 'var(--amber-warn)' }}>
                    ⚠ {hive.health.flag}
                  </p>
                )}
                <Link to={`/beekeeper/hives/${hive.id}`} className="muted" style={{ fontSize: '0.85rem' }}>
                  View hive detail &rarr;
                </Link>
              </div>
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
