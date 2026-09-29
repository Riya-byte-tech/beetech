const { v4: uuidv4 } = require('uuid');

/**
 * Generate a realistic-looking sensor reading history for a hive.
 * profile: 'healthy' | 'attention' | 'critical' - lets the demo show all three states.
 */
function generateReadings(hiveId, hours = 24, profile = 'healthy') {
  const readings = [];
  const now = Date.now();

  // Base values per profile
  // Base values are deliberately picked to sit clearly inside/outside the AI's
  // normal ranges (temp 30-36C, humidity 50-70%) regardless of jitter, so the
  // three demo profiles reliably map to Healthy / Attention / Critical.
  const base = {
    healthy:   { temp: 33, hum: 60, weight: 30, tempDrift: 0.6, humDrift: 2,   weightTrend: 0.35 },
    attention: { temp: 38, hum: 76, weight: 28, tempDrift: 0.5, humDrift: 1.5, weightTrend: -0.05 },
    critical:  { temp: 41, hum: 82, weight: 26, tempDrift: 0.5, humDrift: 1.5, weightTrend: -0.7 },
  }[profile] || { temp: 33, hum: 60, weight: 30, tempDrift: 0.6, humDrift: 2, weightTrend: 0.35 };

  for (let i = hours; i >= 0; i--) {
    const timestamp = new Date(now - i * 60 * 60 * 1000).toISOString();
    const jitter = () => (Math.random() - 0.5) * 2;

    const temperature = Math.round((base.temp + jitter() * base.tempDrift) * 10) / 10;
    const humidity = Math.round((base.hum + jitter() * base.humDrift) * 10) / 10;
    const weight = Math.round((base.weight + (hours - i) * base.weightTrend + jitter() * 0.3) * 10) / 10;

    readings.push({
      id: uuidv4(),
      hive_id: hiveId,
      timestamp,
      temperature,
      humidity,
      weight,
    });
  }

  return readings;
}

module.exports = { generateReadings };
