const robot = require('robotjs');
const path = require('path');
const fs = require('fs');
const cv = require('@techstark/opencv-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const TEMPLATE_DIR = path.join(process.cwd(), 'templates');

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
    fs.mkdirSync(outDir);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outDir, `${label}-${timestamp}.png`);

  const out = fs.createWriteStream(filePath);
  const stream = canvas.createPNGStream();
  stream.pipe(out);

  out.on('finish', () => {
    console.log(`✅ Screenshot saved: ${filePath}`);
  });

  out.on('error', (err) => {
    console.error('❌ Failed to write screenshot:', err);
  });
}

async function matchTemplatesOpenCV(canvas, targetFile = null, click = true, delay = 300) {
  await waitForOpenCV();

  const ctx = canvas.getContext('2d');
  const screenImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const screenMat = new cv.Mat(canvas.height, canvas.width, cv.CV_8UC4);
  screenMat.data.set(screenImageData.data);

  const files = targetFile
    ? [targetFile].filter(f => f.endsWith('.png') && fs.existsSync(path.join(TEMPLATE_DIR, f)))
    : fs.readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.png'));

  let totalMatches = 0;
  const threshold = 0.85;

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

        totalMatches++;

        const point1 = new cv.Point(maxLoc.x, maxLoc.y);
        const point2 = new cv.Point(maxLoc.x + templateMat.cols, maxLoc.y + templateMat.rows);
        cv.rectangle(result, point1, point2, new cv.Scalar(0), -1); // mask matched area
      }
    }

    templateMat.delete();
    result.delete();
  }

  screenMat.delete();

  await new Promise(resolve => setTimeout(resolve, delay));

  return totalMatches;
}

const findAndClick = async (fileName) => {
  const canvas = await captureScreenToCanvas();
  return await matchTemplatesOpenCV(canvas, fileName, true);
};

const find = async (fileName, saveImageIfAtLeastNumberFound) => {
  const canvas = await captureScreenToCanvas();
  const numberFound = await matchTemplatesOpenCV(canvas, fileName, false);

  if (saveImageIfAtLeastNumberFound && numberFound >= saveImageIfAtLeastNumberFound) {
    saveCanvasImage(canvas, `5star-${fiveStarsPulled}`);
    console.log('five stars pulled', fiveStarsPulled);
  }
  return numberFound;
};

const stats = loadStats();

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

    const atLeastOneFiveStar = await find("eleanor.png");
    let fiveStarsPulled = 0;

    let next = await findAndClick("next.png") || await findAndClick("darknext.png");
    while (next !== 0) {
      next = await findAndClick("next.png") || await findAndClick("darknext.png")
    }


    if (atLeastOneFiveStar) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      fiveStarsPulled = await find("5star.png", 1);
    }

    if (fiveStarsPulled < 3) {
      pullForMe();
    }

    if (!stats.fiveStars) {
      stats.fiveStars = {};
    }
    
    const key = String(fiveStarsPulled);
    stats.fiveStars[key] = (stats.fiveStars[key] || 0) + 1;

    console.log(stats);

    saveStats(stats);

  } catch (err) {
    console.error(err);
  }
}

pullForMe();