const db = require('../db/db');
const { computeHealthScore, predictYield } = require('./ai');

/**
 * Given a hive row, attach its latest sensor readings, computed health score,
 * and yield prediction. Shared by routes/hives.js and routes/alerts.js so the
 * "what counts as healthy/attention/critical" logic lives in exactly one place.
 */
function enrichHive(hive) {
  const readings = db.prepare(
    'SELECT * FROM sensor_readings WHERE hive_id = ? ORDER BY timestamp ASC'
  ).all(hive.id);

  const health = computeHealthScore(readings);
  const yield_prediction = predictYield(readings, health);

  return { ...hive, readings, health, yield_prediction };
}

/**
 * Lightweight version for list views - skips returning the full readings array.
 */
function enrichHiveSummary(hive) {
  const { readings, ...rest } = enrichHive(hive);
  return { ...rest, health_status: rest.health.status, health_score: rest.health.score };
}

module.exports = { enrichHive, enrichHiveSummary };
