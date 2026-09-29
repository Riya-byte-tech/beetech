/**
 * Honey Chain MVP - AI layer
 *
 * IMPORTANT (matches team research findings):
 * - This does NOT diagnose disease. It flags anomalies / risk levels only.
 * - It's a transparent rule-based scorer for the MVP, not a trained model.
 *   The interface (inputs -> score/status/explanation) is what would later
 *   be swapped for a real ML model without changing callers.
 */

const NORMAL_RANGES = {
  temperature: [30, 36],   // deg C, inside brood nest
  humidity: [50, 70],      // %
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * computeHealthScore(readings) -> { score, status, reason }
 * readings: array of { temperature, humidity, weight, timestamp } sorted oldest->newest
 */
function computeHealthScore(readings) {
  if (!readings || readings.length === 0) {
    return { score: null, status: 'Unknown', reason: 'No sensor data available yet.' };
  }

  const latest = readings[readings.length - 1];
  let score = 100;
  const reasons = [];

  // Temperature check
  const [tMin, tMax] = NORMAL_RANGES.temperature;
  if (latest.temperature < tMin || latest.temperature > tMax) {
    const deviation = Math.abs(latest.temperature - clamp(latest.temperature, tMin, tMax));
    const penalty = Math.min(35, deviation * 8);
    score -= penalty;
    reasons.push(`Temperature ${latest.temperature}°C is outside the normal brood-nest range (${tMin}-${tMax}°C).`);
  }

  // Humidity check
  const [hMin, hMax] = NORMAL_RANGES.humidity;
  if (latest.humidity < hMin || latest.humidity > hMax) {
    const deviation = Math.abs(latest.humidity - clamp(latest.humidity, hMin, hMax));
    const penalty = Math.min(30, deviation * 3);
    score -= penalty;
    reasons.push(`Humidity ${latest.humidity}% is outside the normal range (${hMin}-${hMax}%).`);
  }

  // Weight trend check (needs history)
  if (readings.length >= 3) {
    const first = readings[0].weight;
    const last = latest.weight;
    const pctChange = ((last - first) / first) * 100;
    if (pctChange < -5) {
      score -= 25;
      reasons.push(`Hive weight dropped ${Math.abs(pctChange).toFixed(1)}% over the observed period - possible stress, absconding risk, or robbing.`);
    } else if (pctChange > 3) {
      reasons.push(`Hive weight increased ${pctChange.toFixed(1)}% over the observed period - consistent with active nectar flow.`);
    }
  }

  score = Math.round(clamp(score, 0, 100));

  let status;
  if (score >= 75) status = 'Healthy';
  else if (score >= 50) status = 'Attention';
  else status = 'Critical';

  const reason = reasons.length > 0
    ? reasons.join(' ')
    : 'All monitored parameters are within normal ranges.';

  const flag = score < 50
    ? 'Abnormal hive pattern detected. Inspection recommended.'
    : (score < 75 ? 'Minor deviation detected. Keep monitoring.' : null);

  return { score, status, reason, flag };
}

/**
 * predictYield(readings, hive) -> { predicted_kg, confidence, explanation }
 * Simple heuristic: base yield adjusted by weight-trend and health score.
 * Explicitly labeled as a prediction, never presented as a guaranteed figure.
 */
function predictYield(readings, healthScore) {
  if (!readings || readings.length < 2) {
    return {
      predicted_kg: null,
      confidence: 0,
      explanation: 'Not enough sensor history yet to predict yield.',
    };
  }

  const first = readings[0].weight;
  const last = readings[readings.length - 1].weight;
  const weightGainKg = Math.max(0, last - first);

  // Heuristic: assume ~55% of accumulated weight gain is harvestable honey,
  // scaled down if the hive is under stress.
  const healthFactor = healthScore && healthScore.score != null
    ? clamp(healthScore.score / 100, 0.4, 1)
    : 0.75;

  const predicted_kg = Math.round((weightGainKg * 0.55 * healthFactor) * 10) / 10;
  const confidence = Math.round(clamp(60 + (readings.length * 2) - (100 - (healthScore?.score ?? 75)) / 4, 40, 92));

  const pctChange = ((last - first) / first) * 100;
  const explanation = `Weight ${pctChange >= 0 ? 'increased' : 'decreased'} ${Math.abs(pctChange).toFixed(1)}% over the observed period. ` +
    `Environmental conditions are factored via the current health score (${healthScore?.score ?? 'n/a'}/100).`;

  return { predicted_kg, confidence, explanation };
}

module.exports = { computeHealthScore, predictYield };
