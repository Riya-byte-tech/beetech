import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { api } from '../api';

const EVENT_ICONS = {
  HARVEST_RECORDED: '🐝',
  BATCH_CREATED: '📦',
  BATCH_RECEIVED: '🚚',
  BATCH_TESTED: '🧪',
  BATCH_FAILED: '⛔',
  BATCH_PROCESSED: '🏭',
  QR_ACTIVATED: '🔖',
};

export default function ConsumerScan() {
  const { qrToken } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(qrToken || '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleLookup(e) {
    e?.preventDefault();
    if (!code) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.verifyProduct(code);
      setResult(data);
      navigate(`/scan/${code}`, { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (qrToken) {
      setCode(qrToken);
      handleLookup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken]);

  return (
    <div>
      <div className="card">
        <h2>🔍 Verify Your Honey</h2>
        <p className="muted">Scan the QR code on your jar, or type the batch code printed on the label.</p>
        <form onSubmit={handleLookup} style={{ display: 'flex', gap: 10, marginTop: 12, maxWidth: 420 }}>
          <input
            placeholder="e.g. HC-MH-2026-0001"
            value={code}
            onChange={e => setCode(e.target.value)}
          />
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Checking...' : 'Verify'}
          </button>
        </form>
      </div>

      {error && <div className="error-box">{error}</div>}

      {result && <ResultCard result={result} />}
    </div>
  );
}

function ResultCard({ result }) {
  const { batch_code, status, origin, harvest, quality, traceability_journey, blockchain_integrity } = result;
  const verified = blockchain_integrity.valid && quality?.result !== 'FAIL';

  return (
    <div>
      <div className="card" style={{ textAlign: 'center', background: verified ? 'var(--amber-100)' : '#fbe9e7' }}>
        <div style={{ fontSize: '2.4rem' }}>{verified ? '✅' : '⚠️'}</div>
        <h2 style={{ margin: '6px 0 0' }}>{verified ? 'Verified Product' : 'Verification Issue'}</h2>
        <p className="muted" style={{ marginTop: 4 }}>Batch {batch_code} · Status: {status}</p>
        <a className="btn" href={`/api/verify/${batch_code}/certificate`} target="_blank" rel="noreferrer" style={{ marginTop: 10 }}>
          📄 Download Certificate
        </a>
      </div>

      <div className="card">
        <h3>Origin</h3>
        <div className="stat-row"><span className="stat-label">Producer</span><span className="stat-value">{origin.producer_verified ? 'Verified beekeeper' : 'Unverified'}</span></div>
        <div className="stat-row"><span className="stat-label">District</span><span className="stat-value">{origin.district}, {origin.state}</span></div>
        {harvest && (
          <>
            <div className="stat-row"><span className="stat-label">Harvest date</span><span className="stat-value">{new Date(harvest.date).toLocaleDateString()}</span></div>
            <div className="stat-row"><span className="stat-label">Floral source</span><span className="stat-value">{harvest.floral_source}</span></div>
            <div className="stat-row"><span className="stat-label">Quantity</span><span className="stat-value">{harvest.quantity_kg} kg</span></div>
            <div className="stat-row"><span className="stat-label">Source hives</span><span className="stat-value">{harvest.hive_count}</span></div>
          </>
        )}
      </div>

      {quality && (
        <div className="card">
          <h3>Quality Record <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>{quality.is_simulated ? '(simulated demo record)' : ''}</span></h3>
          <div className="stat-row">
            <span className="stat-label">Result</span>
            <span className={`status-pill status-${quality.result}`}>{quality.result}</span>
          </div>
          <div className="stat-row"><span className="stat-label">Tested at</span><span className="stat-value">{new Date(quality.tested_at).toLocaleString()}</span></div>
        </div>
      )}

      <div className="card">
        <h3>Traceability Journey</h3>
        <div className="journey" style={{ marginTop: 10 }}>
          {traceability_journey.map((ev, i) => (
            <div className="journey-step" key={i}>
              <div className="journey-dot">{EVENT_ICONS[ev.event_type] || '•'}</div>
              <div className="journey-body">
                <div className="journey-title">{ev.event_type.replaceAll('_', ' ')}</div>
                <div className="journey-time">{new Date(ev.timestamp).toLocaleString()}</div>
                <div className="journey-hash">hash: {ev.hash.slice(0, 28)}...</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Blockchain Integrity Check</h3>
        {blockchain_integrity.valid ? (
          <div className="notice-box">✅ All {blockchain_integrity.total_events} ledger events verified. No tampering detected.</div>
        ) : (
          <div className="error-box">
            ⚠️ Integrity check FAILED. {blockchain_integrity.broken_events.length} event(s) do not match their recorded hash:
            <ul>
              {blockchain_integrity.broken_events.map(b => (
                <li key={b.id}>Event #{b.seq} ({b.event_type})</li>
              ))}
            </ul>
          </div>
        )}
        <p className="muted" style={{ fontSize: '0.78rem' }}>
          This recomputes the entire hash chain from genesis and compares it against what's stored — a real
          tamper-evidence check, not a static badge.
        </p>
      </div>
    </div>
  );
}
