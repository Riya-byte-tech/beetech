import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const PIPELINE = [
  { key: 'CREATED', label: 'Harvested', event: null },
  { key: 'RECEIVED', label: 'Received at processing unit', event: 'BATCH_RECEIVED' },
  { key: 'TESTED', label: 'Quality tested', event: null }, // handled via quality-test endpoint
  { key: 'PROCESSED', label: 'Processed', event: 'BATCH_PROCESSED' },
  { key: 'PACKAGED', label: 'Packaged & QR activated', event: null }, // handled via activate-qr
];

function stepIndex(status) {
  if (status === 'QUARANTINED') return -1;
  const idx = PIPELINE.findIndex(p => p.key === status);
  return idx === -1 ? 0 : idx;
}

export default function AdminBatchPipeline() {
  const { batchId: deepLinkBatchId } = useParams();
  const { user } = useAuth();
  const isLab = user?.role === 'lab';
  const [batches, setBatches] = useState([]);
  const [selectedId, setSelectedId] = useState(deepLinkBatchId || null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [qrImage, setQrImage] = useState(null);

  async function loadBatches() {
    setLoading(true);
    try {
      const data = await api.getBatches();
      setBatches(data);
      // A deep link from the Ledger takes priority; otherwise default to the first batch.
      if (!selectedId && data.length > 0) setSelectedId(data[0].id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    if (!id) return;
    setError(null);
    try {
      const data = await api.getBatch(id);
      setDetail(data);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { loadBatches(); }, []);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId]);

  async function handleAdvance(eventType) {
    setBusy(true);
    setError(null);
    try {
      await api.advanceBatch(selectedId, eventType);
      await loadDetail(selectedId);
      await loadBatches();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleQualityTest(forceFail) {
    setBusy(true);
    setError(null);
    try {
      const body = forceFail ? { moisture: 24, hmf: 95, c4_sugar: 9 } : {};
      await api.qualityTest(selectedId, body);
      await loadDetail(selectedId);
      await loadBatches();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleActivateQr() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.activateQr(selectedId);
      setQrImage(result.qr_data_url);
      await loadDetail(selectedId);
      await loadBatches();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading batches...</p>;

  return (
    <div>
      <div className="card">
        <h2>Batch Pipeline</h2>
        <p className="muted">Simulates the processing unit, laboratory, and packaging steps of the honey supply chain. Every transition below writes a real event to the hash-chained ledger.</p>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="grid" style={{ gridTemplateColumns: '260px 1fr', gap: 18 }}>
        <div className="card" style={{ padding: 12 }}>
          <label style={{ padding: '0 8px' }}>Batches</label>
          {batches.length === 0 && <p className="muted" style={{ padding: '0 8px' }}>No batches yet. Record a harvest from the Beekeeper view first.</p>}
          {batches.map(b => (
            <div
              key={b.id}
              onClick={() => { setSelectedId(b.id); setQrImage(null); }}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                background: b.id === selectedId ? 'var(--amber-100)' : 'transparent',
                marginBottom: 4,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{b.batch_code}</div>
              <span className={`status-pill status-${b.status}`} style={{ marginTop: 4 }}>{b.status}</span>
            </div>
          ))}
        </div>

        <div>
          {detail ? (
            <BatchDetailPanel
              detail={detail}
              busy={busy}
              qrImage={qrImage}
              isLab={isLab}
              onAdvance={handleAdvance}
              onQualityTest={handleQualityTest}
              onActivateQr={handleActivateQr}
            />
          ) : (
            <div className="card"><p className="muted">Select a batch to view its ledger and pipeline.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}

function BatchDetailPanel({ detail, busy, qrImage, isLab, onAdvance, onQualityTest, onActivateQr }) {
  const idx = stepIndex(detail.status);
  const quarantined = detail.status === 'QUARANTINED';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{detail.batch_code}</h3>
        <span className={`status-pill status-${detail.status}`}>{detail.status}</span>
      </div>
      {detail.harvest && (
        <p className="muted" style={{ marginTop: 6 }}>
          {detail.harvest.quantity_kg} kg · {detail.harvest.floral_source} · hives: {detail.harvest.hive_ids.join(', ')}
        </p>
      )}

      {!isLab && (
        <div className="notice-box">
          👁 Read-only oversight view. Pipeline actions are only available to Lab/Processing accounts.
        </div>
      )}

      {quarantined && (
        <div className="error-box">
          This batch failed its quality test and is <strong>quarantined</strong>. It cannot proceed to packaging.
        </div>
      )}

      <div className="btn-row">
        {isLab && (
          <>
            <button className="btn" disabled={busy || detail.status !== 'CREATED'} onClick={() => onAdvance('BATCH_RECEIVED')}>
              Mark Received
            </button>
            <button className="btn" disabled={busy || detail.status !== 'RECEIVED'} onClick={() => onQualityTest(false)}>
              Run Quality Test (Pass)
            </button>
            <button className="btn-secondary btn" disabled={busy || detail.status !== 'RECEIVED'} onClick={() => onQualityTest(true)}>
              Run Quality Test (Force Fail)
            </button>
            <button className="btn" disabled={busy || detail.status !== 'TESTED'} onClick={() => onAdvance('BATCH_PROCESSED')}>
              Mark Processed
            </button>
            <button className="btn" disabled={busy || detail.status !== 'PROCESSED'} onClick={onActivateQr}>
              Package &amp; Activate QR
            </button>
          </>
        )}
        <a className="btn-secondary btn" href={`/api/batches/${detail.id}/certificate`} target="_blank" rel="noreferrer">
          📄 Download Certificate
        </a>
      </div>

      {detail.quality_tests?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label>Latest Quality Test <span className="muted">(simulated lab record)</span></label>
          {detail.quality_tests.slice(-1).map(qt => (
            <div key={qt.id} className="grid grid-3" style={{ marginTop: 8 }}>
              <StatMini label="Moisture" value={`${qt.moisture}%`} />
              <StatMini label="HMF" value={`${qt.hmf} mg/kg`} />
              <StatMini label="C4 Sugar" value={`${qt.c4_sugar}%`} />
            </div>
          ))}
        </div>
      )}

      {qrImage && (
        <div className="qr-frame">
          <img src={qrImage} alt="Batch QR code" width={200} height={200} />
          <p className="muted">Scan this on the Consumer Scan page (or paste the batch code manually).</p>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <label>Ledger Events (hash-chained)</label>
        <div className="journey" style={{ marginTop: 10 }}>
          {detail.events.map((ev, i) => (
            <div className="journey-step" key={ev.id}>
              <div className="journey-dot">{i + 1}</div>
              <div className="journey-body">
                <div className="journey-title">{ev.event_type.replaceAll('_', ' ')}</div>
                <div className="journey-time">{new Date(ev.timestamp).toLocaleString()}</div>
                <div className="journey-hash">hash: {ev.hash.slice(0, 24)}...</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatMini({ label, value }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 0', background: 'var(--amber-100)', borderRadius: 8 }}>
      <div style={{ fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.75rem' }}>{label}</div>
    </div>
  );
}
