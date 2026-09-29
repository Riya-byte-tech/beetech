import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

export default function LedgerExplorer() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getLedger(200);
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <p className="muted">Loading ledger...</p>;
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return null;

  const { total_events, integrity, events } = data;

  return (
    <div>
      <div className="card">
        <h2>Global Ledger Explorer</h2>
        <p className="muted">
          Every event, from every batch, in one globally-ordered sequence — this is the "whole
          chain" view, not just a single batch's history. The sequence number (#) below <em>is</em> the
          chain order; each event's hash depends on the one before it, regardless of which batch it belongs to.
        </p>
        <div style={{ marginTop: 14 }}>
          {integrity.valid ? (
            <div className="notice-box">✅ All {total_events} events verified. No tampering detected anywhere in the ledger.</div>
          ) : (
            <div className="error-box">
              ⚠️ Integrity check FAILED. {integrity.broken_events.length} event(s) do not match their recorded hash:
              <ul>
                {integrity.broken_events.map(b => <li key={b.id}>#{b.seq} ({b.event_type})</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Events (most recent first)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', marginTop: 10 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--ink-soft)' }}>
              <th style={{ padding: '6px 4px' }}>#</th>
              <th>Event</th>
              <th>Batch</th>
              <th>Timestamp</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.id} style={{ borderTop: '1px solid #f0e5cc' }}>
                <td style={{ padding: '6px 4px', color: 'var(--ink-soft)' }}>{ev.seq}</td>
                <td>{EVENT_ICONS[ev.event_type] || '•'} {ev.event_type.replaceAll('_', ' ')}</td>
                <td>
                  {ev.batch_code ? (
                    <Link to={`/admin/batches/${ev.batch_id}`} className="muted">{ev.batch_code}</Link>
                  ) : <span className="muted">—</span>}
                </td>
                <td className="muted">{new Date(ev.timestamp).toLocaleString()}</td>
                <td className="journey-hash" style={{ fontSize: '0.7rem' }}>{ev.hash.slice(0, 16)}...</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
