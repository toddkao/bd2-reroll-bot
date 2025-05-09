const path = require('path');
const fs = require('fs');

const loadSettings = () => {
  const filePath = path.join(process.cwd(), 'settings.txt');
  const defaultSettings = {
    fiveStarsToPull: 2,
    fiveStarsToScreenshot: 1,
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
    if (key && value && !isNaN(Number(value))) {
      settings[key] = Number(value);
    }
  }

  console.log('loaded settings', settings);

  return settings;
}

module.exports = { loadSettings };