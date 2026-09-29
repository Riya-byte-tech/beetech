/**
 * Centralizes what state a batch must be in before each pipeline action is
 * allowed. Previously this was only enforced by hiding buttons in the
 * frontend - a direct API call could skip straight from CREATED to PACKAGED.
 * These functions are pure (take a plain `{ status }`-shaped object, no DB
 * access) so they're trivially unit-testable and reusable across routes.
 */

class StateTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateTransitionError';
    this.statusCode = 400;
  }
}

const ADVANCE_TRANSITIONS = {
  BATCH_RECEIVED: { from: ['CREATED'], to: 'RECEIVED' },
  BATCH_PROCESSED: { from: ['TESTED'], to: 'PROCESSED' },
};

/** Used by POST /batches/:id/advance for BATCH_RECEIVED / BATCH_PROCESSED. */
function assertAdvance(batch, eventType) {
  const rule = ADVANCE_TRANSITIONS[eventType];
  if (!rule) {
    throw new StateTransitionError(`Unknown transition: ${eventType}`);
  }
  if (batch.status === 'QUARANTINED') {
    throw new StateTransitionError('Batch is quarantined (failed quality test) and cannot advance.');
  }
  if (!rule.from.includes(batch.status)) {
    throw new StateTransitionError(
      `Batch must be '${rule.from.join("' or '")}' before '${eventType}' (currently '${batch.status}').`
    );
  }
  return rule.to;
}

/** Used by POST /batches/:batchId/quality-test. */
function assertQualityTest(batch) {
  if (batch.status === 'QUARANTINED') {
    throw new StateTransitionError('Batch is already quarantined.');
  }
  if (batch.status !== 'RECEIVED') {
    throw new StateTransitionError(
      `Batch must be 'RECEIVED' before a quality test can be run (currently '${batch.status}').`
    );
  }
}

/** Used by POST /batches/:batchId/activate-qr. */
function assertActivateQr(batch) {
  if (batch.status === 'QUARANTINED') {
    throw new StateTransitionError('Batch is quarantined and cannot be packaged.');
  }
  if (batch.status !== 'PROCESSED') {
    throw new StateTransitionError(
      `Batch must be 'PROCESSED' before packaging/QR activation (currently '${batch.status}').`
    );
  }
}

module.exports = { StateTransitionError, assertAdvance, assertQualityTest, assertActivateQr };
