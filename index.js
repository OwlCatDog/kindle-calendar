const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const puppeteer = require('puppeteer');

const SCREENSHOT_PORT = Number.parseInt(process.env.PORT || '3000', 10);
const RENDER_PORT = Number.parseInt(process.env.RENDER_PORT || '1145', 10);
const API_BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:3643').replace(/\/$/, '');
const RENDER_PAGE_ORIGIN = (process.env.RENDER_PAGE_ORIGIN || `http://127.0.0.1:${RENDER_PORT}`).replace(/\/$/, '');
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH;
const WEBPAGE_DIR = path.join(__dirname, 'webpage');

const screenshotApp = express();
const renderApp = express();

renderApp.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.__APP_CONFIG__ = ${JSON.stringify({ apiBaseUrl: API_BASE_URL })};`);
});

renderApp.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'render-page' });
});

renderApp.use(express.static(WEBPAGE_DIR));

screenshotApp.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'screenshot' });
});

screenshotApp.get('/', async (req, res) => {
  const batt = req.query.batt || '0';
  const charge = req.query.charge || '';
  const screenshotPath = path.join(os.tmpdir(), `kindle-screenshot-${randomUUID()}.png`);
  const targetUrl = `${RENDER_PAGE_ORIGIN}/?batt=${encodeURIComponent(batt)}&charge=${encodeURIComponent(charge)}`;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [
        '--disable-gpu',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--no-zygote',
        '--lang=zh-CN,zh',
      ],
      executablePath: PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const page = await browser.newPage();
    await setupPage(page);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitForPageToSettle(page);
    await page.screenshot({ path: screenshotPath, type: 'png' });

    await convertImage(screenshotPath);
    const screenshot = await fs.promises.readFile(screenshotPath);

    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': screenshot.length,
    });
    res.end(screenshot);
  } catch (error) {
    console.error('Screenshot request failed:', error);
    res.status(500).json({
      error: 'screenshot_failed',
      message: error.message,
      targetUrl,
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await fs.promises.unlink(screenshotPath).catch(() => {});
  }
});

screenshotApp.listen(SCREENSHOT_PORT, () => {
  console.log(`Screenshot service listening on ${SCREENSHOT_PORT}`);
});

renderApp.listen(RENDER_PORT, () => {
  console.log(`Render page listening on ${RENDER_PORT}`);
});

async function setupPage(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'language', {
      get: () => 'zh-CN',
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh'],
    });
  });
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1072, height: 1448, deviceScaleFactor: 1 });
}

async function waitForPageToSettle(page) {
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => {
    if (!document.fonts) {
      return true;
    }
    return document.fonts.status === 'loaded';
  }, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__KINDLE_RENDER_READY__ === true, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
}

function convertImage(filename) {
  return new Promise((resolve, reject) => {
    const args = [
      filename,
      '-gravity',
      'center',
      '-resize',
      '1072x1448',
      '-colorspace',
      'gray',
      '-depth',
      '8',
      filename,
    ];
    execFile('convert', args, (error, stdout, stderr) => {
      if (error) {
        console.error('Image conversion failed:', { error, stdout, stderr });
        reject(new Error('Image conversion failed.'));
        return;
      }
      resolve();
    });
  });
}
