// File: index.mjs

import robot from 'robotjs';
import { Jimp, rgbaToInt } from 'jimp';
import Tesseract from 'tesseract.js';
import path from 'path';
import fs from 'fs';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cv from '@techstark/opencv-js';
import { createCanvas, loadImage } from 'canvas';
import { match } from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const REGION = { x: 0, y: 0, width: 800, height: 600 };
const TEMPLATE_DIR = path.join(__dirname, 'templates');


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

async function matchTemplatesOpenCV(canvas, targetFile = null, click = true, delay = 500) {
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
    const templateImage = await loadImage(templatePath);
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

const find = async (fileName, timeout = 500) => {
  const canvas = await captureScreenToCanvas();
  return await matchTemplatesOpenCV(canvas, fileName, false, timeout);
};

const pullForMe = async () => {
  try {
    await findAndClick("draw.png");
    await findAndClick("confirm.png");

    const atLeastOneFiveStar = await find("eleanor.png");
    let fiveStarsPulled = 0;

    let next = await findAndClick("next.png") || await findAndClick("darknext.png");
    while (next !== 0) {
      next = await findAndClick("next.png") || await findAndClick("darknext.png")
    }


    if (atLeastOneFiveStar) {
      fiveStarsPulled = await find("5star.png", 2_000);
      console.log('five stars pulled', fiveStarsPulled);
    }

    if (fiveStarsPulled < 2) {
      pullForMe();
    }

  } catch (err) {
    console.error(err);
  }
}

pullForMe();