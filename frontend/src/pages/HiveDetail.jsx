import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function HiveDetail() {
  const { hiveId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [hive, setHive] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHarvest, setShowHarvest] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [floralSource, setFloralSource] = useState('Mustard');
  const [submitting, setSubmitting] = useState(false);
  const [harvestResult, setHarvestResult] = useState(null);
  const [simulating, setSimulating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getHive(hiveId);
      setHive(data);
      if (data.yield_prediction?.predicted_kg) {
        setQuantity(String(data.yield_prediction.predicted_kg));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [hiveId]);

  async function handleRecordHarvest(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createHarvest({
        hive_ids: [hiveId],
        quantity_kg: parseFloat(quantity),
        floral_source: floralSource,
      });
      setHarvestResult(result);
      setShowHarvest(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReSimulate(profile) {
    setSimulating(true);
    try {
      await api.simulateHive(hiveId, profile);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSimulating(false);
    }
  }

  if (loading) return <p className="muted">Loading hive...</p>;
  if (error && !hive) return <div className="error-box">{error}</div>;
  if (!hive) return null;

  const isBeekeeper = user?.role === 'beekeeper';
  const { health, yield_prediction, readings } = hive;
  const recent = readings.slice(-6);
  const latest = readings[readings.length - 1];

  return (
    <div>
      <Link to={isBeekeeper ? '/beekeeper' : '/cluster'} className="muted" style={{ textDecoration: 'none' }}>
        &larr; {isBeekeeper ? 'Back to apiary' : 'Back to Cluster Alerts'}
      </Link>

      {!isBeekeeper && (
        <div className="notice-box" style={{ marginTop: 12 }}>
          👁 Read-only oversight view. Harvest recording and hive management are only available to the owning beekeeper.
        </div>
      )}

      {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}

      {harvestResult && (
        <div className="notice-box" style={{ marginTop: 12 }}>
          <strong>Harvest recorded.</strong> Batch <strong>{harvestResult.batch.batch_code}</strong> created and
          written to the ledger.{' '}
          <Link to={`/admin`}>Continue in Processing / Lab &rarr;</Link>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0 }}>{hive.id}</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>{hive.species} · {hive.status}</p>
          </div>
          <span className={`status-pill status-${health.status}`} style={{ fontSize: '0.95rem' }}>
            {health.status}
          </span>
        </div>

        <div className="grid grid-2" style={{ marginTop: 18 }}>
          <div>
            <label>Health Score</label>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${health.score ?? 0}%`,
                  background: health.status === 'Healthy' ? 'var(--green-ok)' : health.status === 'Attention' ? 'var(--amber-warn)' : 'var(--red-bad)',
                }}
              />
            </div>
            <p style={{ marginTop: 6, fontSize: '0.85rem' }}>{health.score}/100</p>
          </div>
          <div>
            <label>Predicted Yield (this cycle)</label>
            <p style={{ fontSize: '1.4rem', fontWeight: 800, margin: '4px 0' }}>
              {yield_prediction.predicted_kg != null ? `${yield_prediction.predicted_kg} kg` : '—'}
            </p>
            <p className="muted" style={{ fontSize: '0.8rem' }}>Confidence: {yield_prediction.confidence}%</p>
          </div>
        </div>

        <div className="notice-box" style={{ marginTop: 14 }}>
          <strong>AI insight:</strong> {health.reason} {yield_prediction.explanation}
          {health.flag && <><br /><strong>⚠ {health.flag}</strong></>}
          <div className="muted" style={{ marginTop: 6, fontSize: '0.75rem' }}>
            Prediction only — not a diagnosis. Recommend physical inspection for confirmation.
          </div>
        </div>

        <div className="grid grid-3" style={{ marginTop: 14 }}>
          <StatCard label="Temperature" value={latest ? `${latest.temperature}°C` : '—'} />
          <StatCard label="Humidity" value={latest ? `${latest.humidity}%` : '—'} />
          <StatCard label="Weight" value={latest ? `${latest.weight} kg` : '—'} />
        </div>

        <div style={{ marginTop: 16 }}>
          <label>Recent readings (last {recent.length}h)</label>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginTop: 6 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--ink-soft)' }}>
                <th style={{ padding: '4px 0' }}>Time</th>
                <th>Temp (°C)</th>
                <th>Humidity (%)</th>
                <th>Weight (kg)</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #f0e5cc' }}>
                  <td style={{ padding: '4px 0' }}>{new Date(r.timestamp).toLocaleString()}</td>
                  <td>{r.temperature}</td>
                  <td>{r.humidity}</td>
                  <td>{r.weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isBeekeeper && (
          <>
            <div className="btn-row">
              <button className="btn" disabled={!user?.beekeeper?.verified} onClick={() => setShowHarvest(s => !s)} title={!user?.beekeeper?.verified ? 'Your account is pending admin verification' : ''}>
                {showHarvest ? 'Cancel' : '🍯 Record Harvest'}
              </button>
              <button className="btn-secondary btn" disabled={simulating} onClick={() => handleReSimulate('healthy')}>Simulate: Healthy</button>
              <button className="btn-secondary btn" disabled={simulating} onClick={() => handleReSimulate('attention')}>Simulate: Attention</button>
              <button className="btn-secondary btn" disabled={simulating} onClick={() => handleReSimulate('critical')}>Simulate: Critical</button>
            </div>

            {!user?.beekeeper?.verified && (
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>
                ⏳ Recording harvests is disabled until a Cluster Admin verifies your account.
              </p>
            )}

            {showHarvest && (
              <form onSubmit={handleRecordHarvest} style={{ marginTop: 16, maxWidth: 340 }}>
                <div className="field">
                  <label>Quantity harvested (kg)</label>
                  <input type="number" step="0.1" value={quantity} onChange={e => setQuantity(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Floral source</label>
                  <select value={floralSource} onChange={e => setFloralSource(e.target.value)}>
                    <option>Mustard</option>
                    <option>Litchi</option>
                    <option>Multi-floral</option>
                    <option>Eucalyptus</option>
                  </select>
                </div>
                <button className="btn" type="submit" disabled={submitting}>
                  {submitting ? 'Recording...' : 'Create Batch on Ledger'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ textAlign: 'center', padding: '10px 0', background: 'var(--amber-100)', borderRadius: 10 }}>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--amber-900)' }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.78rem' }}>{label}</div>
    </div>
  );
}
