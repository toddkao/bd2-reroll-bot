const path = require('path');
const fs = require('fs');

const outDir = path.join(process.cwd(), 'screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
