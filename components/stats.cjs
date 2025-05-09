const { logWithStyle } = require('./log.cjs');

const path = require('path');
const fs = require('fs');

const LOG_FILE = path.join(process.cwd(), 'log.txt');

function getCurrentHourKey() {
  const now = new Date();
  const date = now.toLocaleDateString('en-US'); // e.g., 5/8/2025
  let hour = now.getHours();
  const suffix = hour >= 12 ? 'pm' : 'am';
  hour = hour % 12 || 12; // Convert to 12-hour format
  return `${date}-${hour}${suffix}`;
}

const loadStats = () => {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const stats = JSON.parse(content);

    console.log('loaded log file');

    logWithStyle(JSON.stringify(stats, null, 2), { fg: 'green' });

    return stats;
  } catch {
    return { pulls: 0, fiveStars: {}, hourlyPulls: {} };
  }
}

const increaseStats = (stats) => {
  stats.pulls += 1;
  const hourKey = getCurrentHourKey();
  if (!stats.hourlyPulls) {
    stats.hourlyPulls = {};
  }
  stats.hourlyPulls[hourKey] = (stats.hourlyPulls[hourKey] || 0) + 1;
}

const saveStats = (stats, fiveStarsPulled) => {
  if (!stats.fiveStars) {
    stats.fiveStars = {};
  }

  const key = String(fiveStarsPulled);
  stats.fiveStars[key] = (stats.fiveStars[key] || 0) + 1;

  fs.writeFileSync(LOG_FILE, JSON.stringify(stats, null, 2), 'utf-8');
}


module.exports = { saveStats, increaseStats, loadStats };