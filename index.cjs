const robot = require('robotjs');
const path = require('path');
const fs = require('fs');
const cv = require('@techstark/opencv-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const TEMPLATE_DIR = path.join(process.cwd(), 'templates');

const stats = loadStats();
const settings = loadSettings();

function loadSettings() {
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

  return settings;
}

function getCurrentHourKey() {
  const now = new Date();
  const date = now.toLocaleDateString('en-US'); // e.g., 5/8/2025
  let hour = now.getHours();
  const suffix = hour >= 12 ? 'pm' : 'am';
  hour = hour % 12 || 12; // Convert to 12-hour format
  return `${date}-${hour}${suffix}`;
}

const LOG_FILE = path.join(process.cwd(), 'log.txt');

function loadStats() {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    console.log(JSON.parse(content));
    return JSON.parse(content);
  } catch {
    return { pulls: 0, fiveStars: {}, hourlyPulls: {} };
  }
}

function saveStats(stats) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(stats, null, 2), 'utf-8');
}

let opencvReady = false;

async function waitForOpenCV() {
  if (opencvReady) {
    return;
  }

  await new Promise(resolve => {
    const originalInit = cv.onRuntimeInitialized;
    cv.onRuntimeInitialized = () => {
      originalInit?.(); // call any existing initializer if present
      opencvReady = true;
      resolve();
    };
  });
}

async function captureScreenToCanvas() {
  const screen = robot.screen.capture();

  const canvas = createCanvas(screen.width, screen.height);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(screen.width, screen.height);
  const data = imageData.data;

  for (let y = 0; y < screen.height; y++) {
    for (let x = 0; x < screen.width; x++) {
      const i = (y * screen.byteWidth) + (x * screen.bytesPerPixel);
      const j = (y * screen.width + x) * 4;
      data[j] = screen.image.readUInt8(i + 2);     // R
      data[j + 1] = screen.image.readUInt8(i + 1); // G
      data[j + 2] = screen.image.readUInt8(i);     // B
      data[j + 3] = 255;                           // A
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function saveCanvasImage(canvas, label = 'screenshot') {
  const outDir = path.join(process.cwd(), 'screenshots');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outDir, `${label}-${timestamp}.png`);

  try {
    const buffer = canvas.encodeSync('png'); // ✅ this returns a Node.js Buffer
    fs.writeFileSync(filePath, buffer);
    console.log(`✅ Screenshot saved: ${filePath}`);
  } catch (err) {
    console.error('❌ Failed to save screenshot:', err);
  }
}

async function matchTemplatesOpenCV(canvas, targetFile = null, click = true, delay = 300, threshold = 0.85) {
  await waitForOpenCV();

  const ctx = canvas.getContext('2d');
  const screenImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const screenMat = new cv.Mat(canvas.height, canvas.width, cv.CV_8UC4);
  screenMat.data.set(screenImageData.data);

  const files = targetFile
    ? [targetFile].filter(f => f.endsWith('.png') && fs.existsSync(path.join(TEMPLATE_DIR, f)))
    : fs.readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.png'));

  let totalMatches = 0;

  for (const file of files) {
    const templatePath = path.join(TEMPLATE_DIR, file);
    const fileBuffer = fs.readFileSync(templatePath);
    const templateImage = await loadImage(fileBuffer);
    const templateCanvas = createCanvas(templateImage.width, templateImage.height);
    const tCtx = templateCanvas.getContext('2d');
    tCtx.drawImage(templateImage, 0, 0);
    const templateImageData = tCtx.getImageData(0, 0, templateCanvas.width, templateCanvas.height);
    const templateMat = new cv.Mat(templateCanvas.height, templateCanvas.width, cv.CV_8UC4);
    templateMat.data.set(templateImageData.data);

    const result = new cv.Mat();
    cv.matchTemplate(screenMat, templateMat, result, cv.TM_CCOEFF_NORMED);

    if (click) {
      // Just click once on the best match
      const { maxVal, maxLoc } = cv.minMaxLoc(result);
      console.log(`${targetFile} found with :${maxVal} match`);
      if (maxVal >= threshold) {
        const centerX = maxLoc.x + templateMat.cols / 2;
        const centerY = maxLoc.y + templateMat.rows / 2;
        robot.moveMouse(centerX, centerY);
        robot.mouseClick();
        totalMatches = 1;
      }
    } else {
      // Find all matches above threshold
      while (true) {
        const { maxVal, maxLoc } = cv.minMaxLoc(result);
        if (maxVal < threshold) break;
    
        if (maxVal > threshold) {
          console.log(`${targetFile} found with :${maxVal} match`);
          totalMatches++;
        }
      
        // Zero out the region in the result matrix so it doesn't match again
        const region = result.roi(new cv.Rect(
          maxLoc.x,
          maxLoc.y,
          templateMat.cols,
          templateMat.rows
        ));
      
        region.setTo(new cv.Scalar(0));
        region.delete(); // clean up the sub-matrix
      }
    }

    templateMat.delete();
    result.delete();
  }

  screenMat.delete();

  await new Promise(resolve => setTimeout(resolve, delay));

  return totalMatches;
}

const findAndClick = async (fileName, threshold) => {
  const canvas = await captureScreenToCanvas();
  return await matchTemplatesOpenCV(canvas, fileName, true, 300, threshold);
};

const find = async (fileName, saveImageIfAtLeastNumberFound, threshold) => {
  const canvas = await captureScreenToCanvas();
  const numberFound = await matchTemplatesOpenCV(canvas, fileName, false, 300, threshold);

  if (numberFound >= saveImageIfAtLeastNumberFound) {
    saveCanvasImage(canvas, `5star-${numberFound}`);
  }
  return numberFound;
};

const pullForMe = async () => {
  try {
    await findAndClick("draw.png");
    const confirm = await findAndClick("confirm.png");

    if (confirm) {
      stats.pulls += 1;
      const hourKey = getCurrentHourKey();
      if (!stats.hourlyPulls) {
        stats.hourlyPulls = {};
      }
      stats.hourlyPulls[hourKey] = (stats.hourlyPulls[hourKey] || 0) + 1;
    }

    let fiveStarsPulled = 0;

    let next = await findAndClick("next.png", 0.3);
    while (next !== 0) {
      next = await findAndClick("next.png", 0.3);
    }

    fiveStarsPulled = await find("5star.png", settings.fiveStarsToScreenshot, 0.95);
    if (fiveStarsPulled > 0) {
      console.log('five stars pulled', fiveStarsPulled);
    }

    if (fiveStarsPulled < settings.fiveStarsToPull) {
      pullForMe();
    }

    if (!stats.fiveStars) {
      stats.fiveStars = {};
    }
    
    const key = String(fiveStarsPulled);
    stats.fiveStars[key] = (stats.fiveStars[key] || 0) + 1;

    saveStats(stats);

  } catch (err) {
    console.error(err);
  }
}

function waitForKeypress(message = '\nPress any key to exit...') {
  return new Promise(resolve => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve();
    });
  });
}

const outDir = path.join(process.cwd(), 'screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

(async () => {
  console.log(settings);
  await pullForMe();
  await waitForKeypress();
})();
