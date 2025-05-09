const { logWithStyle } = require('./log.cjs');
const path = require('path');
const fs = require('fs');

const loadSettings = () => {
  const filePath = path.join(process.cwd(), 'settings.txt');
  const defaultSettings = {
    fiveStarsToPull: 2,
    fiveStarsToScreenshot: 1,
    debug: false,
  };

  // Create file with defaults if it doesn't exist
  if (!fs.existsSync(filePath)) {
    const defaultText = Object.entries(defaultSettings)
      .map(([key, val]) => `${key}=${val}`)
      .join('\n');
    fs.writeFileSync(filePath, defaultText, 'utf-8');
    console.log('✅ Created default settings.txt');
    return { ...defaultSettings };
  }

  // Load and parse existing settings
  const settings = { ...defaultSettings };
  const lines = fs.readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean);

    for (const line of lines) {
      const [key, value] = line.split('=').map(s => s.trim());
    
      if (key && value !== undefined) {
        if (!isNaN(Number(value))) {
          settings[key] = Number(value);
        } else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
          settings[key] = value.toLowerCase() === 'true';
        } else {
          settings[key] = value;
        }
      }
    }
  console.log('loaded settings');
  logWithStyle(JSON.stringify(settings, null, 2), { fg: 'green' });

  return settings;
}

module.exports = { loadSettings };