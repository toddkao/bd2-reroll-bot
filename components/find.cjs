const { logWithStyle } = require('./log.cjs');

const robot = require('robotjs');
const cv = require('@techstark/opencv-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { increaseStats, saveStats } = require('./stats.cjs');
const { loadSettings } = require('./settings.cjs');
const { loadStats } = require('./stats.cjs');
const { GlobalKeyboardListener } = require('node-global-key-listener');
const { windowManager } = require('node-window-manager');

const windows = windowManager.getWindows();
const targetWindow = windows.find(w => w.getTitle().toLowerCase().includes('browndust'));
targetWindow.bringToTop();

const getScaleFactor = () => {
  const windows = windowManager.getWindows();
  const targetWindow = windows.find(w => w.getTitle().toLowerCase().includes('browndust'));
  
  if (!targetWindow) {
    console.log('❌ Window not found');
  }
  
  targetWindow.bringToTop();

  const screenSize = {
    width: targetWindow.getBounds().width,
    height: targetWindow.getBounds().height,
  }
  
  const TEMPLATE_BASE_RES = { width: 2560, height: 1080 };
  
  return screenSize.height / TEMPLATE_BASE_RES.height;
}

const path = require('path');
const fs = require('fs');

const TEMPLATE_DIR = path.join(__dirname, '../templates');

new GlobalKeyboardListener({
  windows: {
    serverPath: path.join(process.cwd(), 'helper.exe')
  }
}).addListener((e) => {
  if (e.name === 'ESCAPE') {
    isRunning = false;
  }
});

var opencvReady = false;
var isRunning = true;
var stats = loadStats();
var settings = loadSettings();

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

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outDir, `${label}-${timestamp}.png`);

  try {
    const buffer = canvas.encodeSync('png');
    fs.writeFileSync(filePath, buffer);
    console.log(`✅ Screenshot saved: ${filePath}`);
  } catch (err) {
    console.error('❌ Failed to save screenshot:', err);
  }
}

const templateCache = new Map();

function preloadTemplates(files) {
  for (const file of files) {
    const templatePath = path.join(TEMPLATE_DIR, file);
    const buffer = fs.readFileSync(templatePath);
    loadImage(buffer).then((templateImage) => {
      const scaleFactor = getScaleFactor();
      const scaledWidth = Math.round(templateImage.width * scaleFactor);
      const scaledHeight = Math.round(templateImage.height * scaleFactor);
      const canvas = createCanvas(scaledWidth, scaledHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(templateImage, 0, 0, scaledWidth, scaledHeight);
      const data = ctx.getImageData(0, 0, scaledWidth, scaledHeight);
      templateCache.set(file, cv.matFromImageData(data));
    });
  }
}

async function buildTemplateMat(file) {
  const templatePath = path.join(TEMPLATE_DIR, file);
  const fileBuffer = fs.readFileSync(templatePath);
  const image = await loadImage(fileBuffer);

  const scaleFactor = getScaleFactor();
  const scaledWidth = Math.round(image.width * scaleFactor);
  const scaledHeight = Math.round(image.height * scaleFactor);

  const canvas = createCanvas(scaledWidth, scaledHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, scaledWidth, scaledHeight);
  const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);

  const mat = cv.matFromImageData(imageData);
  templateCache.set(file, mat);

  return mat;
}

async function matchTemplatesOpenCV(canvas, targetFiles = null, click = true, delay = 300, threshold = 0.6) {
  await waitForOpenCV();

  const ctx = canvas.getContext('2d');
  const screenImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const screenMat = cv.matFromImageData(screenImageData);

  // Normalize targetFiles to an array
  const files = Array.isArray(targetFiles)
    ? targetFiles.filter(f => f.endsWith('.png') && fs.existsSync(path.join(TEMPLATE_DIR, f)))
    : typeof targetFiles === 'string'
    ? [targetFiles].filter(f => f.endsWith('.png') && fs.existsSync(path.join(TEMPLATE_DIR, f)))
    : fs.readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.png'));

  const matchResults = await Promise.all(files.map(async (file) => {
    const templateMat = templateCache.has(file)
      ? templateCache.get(file)
      : await buildTemplateMat(file); // fallback
  
    const result = new cv.Mat();
    cv.matchTemplate(screenMat, templateMat, result, cv.TM_CCOEFF_NORMED);
  
    const matches = [];
  
    if (click) {
      const { maxVal, maxLoc } = cv.minMaxLoc(result);
      if (maxVal >= threshold) {
        const centerX = maxLoc.x + templateMat.cols / 2;
        const centerY = maxLoc.y + templateMat.rows / 2;
        robot.moveMouse(centerX, centerY);
        robot.mouseClick();
        matches.push({ file, maxVal });
      }
    } else {
      while (true) {
        const { maxVal, maxLoc } = cv.minMaxLoc(result);
        if (maxVal < threshold) break;
  
        matches.push({ file, maxVal });
        const region = result.roi(new cv.Rect(maxLoc.x, maxLoc.y, templateMat.cols, templateMat.rows));
        region.setTo(new cv.Scalar(0));
        region.delete();
      }
    }
  
    result.delete();
  
    return matches.length;
  }));
  
  const totalMatches = matchResults.reduce((a, b) => a + b, 0);

  screenMat.delete();

  await new Promise(resolve => setTimeout(resolve, delay));
  return totalMatches;
}

const findAndClick = async (fileName, threshold) => {
  const canvas = await withAbort(captureScreenToCanvas());
  return await withAbort(matchTemplatesOpenCV(canvas, fileName, true, 300, threshold));
};

const find = async (fileName, threshold, delay = 300) => {
  const canvas = await withAbort(captureScreenToCanvas());
  const numberFound = await withAbort(matchTemplatesOpenCV(canvas, fileName, false, delay, threshold));
  return { numberFound, canvas };
};

const thresholdScaling = getScaleFactor();

let thresholds = {
  drawThreshold: settings.drawThreshold * thresholdScaling,
  confirmThreshold: settings.confirmThreshold * thresholdScaling,
  nextThreshold: settings.nextThreshold * thresholdScaling,
  fiveStarThreshold: settings.fiveStarThreshold * thresholdScaling,
}

const pullForMe = async () => {
  try {
    while (isRunning) {
      console.log(thresholds);
      await findAndClick("draw.png", thresholds.drawThreshold);
      const pull = await findAndClick("confirm.png", thresholds.confirmThreshold);

      if (pull) {
        increaseStats(stats);
      }

      let next = await findAndClick("next.png", thresholds.nextThreshold);
      while (next !== 0) {
        next = await findAndClick("next.png", thresholds.nextThreshold);
      }

      const { numberFound, canvas } = await find("5star.png", thresholds.fiveStarThreshold);
      fiveStarsPulled = numberFound;
      console.log('⭐five stars pulled', numberFound);

      if (numberFound > 0) {
        const files = [
          'helena.png',
          'lathel.png',
          'justia.png',
          'liberta1.png',
          'liberta2.png',
          'luvencia.png',
          'medicalclub.png',
          'nebris.png',
          'refi.png',
          'zenith.png',
        ];
        
        const { numberFound: score } = await find(files, thresholds.fiveStarThreshold);
      
        console.log(`Score of 5 stars is ${score}`);
  
        if (score >= settings.targetScore) {
          throw new Error("🛑 Score is equal to or better than target, aborting application...");
        };
      }
      
      if (numberFound >= settings.fiveStarsToScreenshot) {
        saveCanvasImage(canvas, `5star-${numberFound}`);
      }

      saveStats(stats, fiveStarsPulled);
    }
  } catch (err) {
    if (err.message === 'aborted') {
      console.log('🛑 Aborted application');
    } else {
      console.error(err);
    }
  }
};

function withAbort(promise) {
  if (!isRunning) throw new Error('aborted');

  const abortPromise = new Promise((_, reject) => {
    const interval = setInterval(() => {
      if (!isRunning) {
        clearInterval(interval);
        reject(new Error('aborted'));
      }
    }, 50);
    promise.finally(() => clearInterval(interval));
  });

  return Promise.race([promise, abortPromise]);
}

module.exports = { find, findAndClick, saveCanvasImage, pullForMe, getScaleFactor };