const test = require('node:test');
const assert = require('node:assert');
const {
  assertAdvance,
  assertQualityTest,
  assertActivateQr,
  StateTransitionError,
} = require('../services/batchStateMachine');

test('assertAdvance allows CREATED -> RECEIVED', () => {
  const result = assertAdvance({ status: 'CREATED' }, 'BATCH_RECEIVED');
  assert.strictEqual(result, 'RECEIVED');
});

test('assertAdvance allows TESTED -> PROCESSED', () => {
  const result = assertAdvance({ status: 'TESTED' }, 'BATCH_PROCESSED');
  assert.strictEqual(result, 'PROCESSED');
});

test('assertAdvance rejects skipping straight from CREATED to PROCESSED', () => {
  assert.throws(() => assertAdvance({ status: 'CREATED' }, 'BATCH_PROCESSED'), StateTransitionError);
});

test('assertAdvance rejects re-running BATCH_RECEIVED on an already-received batch', () => {
  assert.throws(() => assertAdvance({ status: 'RECEIVED' }, 'BATCH_RECEIVED'), StateTransitionError);
});

test('assertAdvance rejects any transition on a QUARANTINED batch', () => {
  assert.throws(() => assertAdvance({ status: 'QUARANTINED' }, 'BATCH_RECEIVED'), StateTransitionError);
});

test('assertAdvance rejects an unknown event type', () => {
  assert.throws(() => assertAdvance({ status: 'CREATED' }, 'NOT_A_REAL_EVENT'), StateTransitionError);
});

test('assertQualityTest requires RECEIVED status', () => {
  assert.throws(() => assertQualityTest({ status: 'CREATED' }), StateTransitionError);
  assert.doesNotThrow(() => assertQualityTest({ status: 'RECEIVED' }));
});

test('assertQualityTest rejects a batch that is already quarantined', () => {
  assert.throws(() => assertQualityTest({ status: 'QUARANTINED' }), StateTransitionError);
});

test('assertActivateQr requires PROCESSED status', () => {
  assert.throws(() => assertActivateQr({ status: 'TESTED' }), StateTransitionError);
  assert.doesNotThrow(() => assertActivateQr({ status: 'PROCESSED' }));
});

test('assertActivateQr rejects a QUARANTINED batch even if it were somehow marked PROCESSED elsewhere', () => {
  assert.throws(() => assertActivateQr({ status: 'QUARANTINED' }), StateTransitionError);
});
