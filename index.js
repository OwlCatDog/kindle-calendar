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
const WIDGET_SELECTOR = '#ww_bc810257cf5c1';
const WIDGET_CACHE_TTL_MS = Number.parseInt(process.env.WIDGET_CACHE_TTL_MS || `${10 * 60 * 1000}`, 10);
const WIDGET_CACHE_DIR = path.join(os.tmpdir(), 'backup-kindle-widget');
const WIDGET_BROWSER_PROFILE_DIR = path.join(WIDGET_CACHE_DIR, 'browser-profile');
const WIDGET_CACHE_IMAGE_PATH = path.join(WIDGET_CACHE_DIR, 'widget-cache.png');
const WIDGET_CACHE_META_PATH = path.join(WIDGET_CACHE_DIR, 'widget-cache.json');
const WIDGET_SOURCE_URL = `${RENDER_PAGE_ORIGIN}/widget-source`;

const screenshotApp = express();
const renderApp = express();
let widgetRefreshPromise = null;

renderApp.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.__APP_CONFIG__ = ${JSON.stringify({
    apiBaseUrl: API_BASE_URL,
    sensorQueryUrl: '/api/getSensor',
  })};`);
});

renderApp.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'render-page' });
});

renderApp.get('/widget-source', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 456px;
      min-height: 84px;
      background: #ffffff;
      overflow: hidden;
    }
    body {
      display: flex;
      align-items: flex-start;
      justify-content: flex-start;
      font-family: Arial, sans-serif;
    }
    ${WIDGET_SELECTOR} {
      width: 456px;
      min-height: 84px;
    }
  </style>
</head>
<body>
  <div id="ww_bc810257cf5c1" v="1.3" loc="id" a='{"t":"horizontal","lang":"zh","sl_lpl":1,"ids":["wl11440"],"font":"Arial","sl_ics":"one_a","el_nme":3,"sl_sot":"celsius","cl_bkg":"#FFFFFF00","cl_font":"#000000","cl_cloud":"#d4d4d4","cl_persp":"#2196F3","cl_sun":"#FFC107","cl_moon":"#FFC107","cl_thund":"#FF5722"}'><a href="https://weatherwidget.org/zh/" id="ww_bc810257cf5c1_u" target="_blank">天气插件</a></div>
  <script async src="https://app1.weatherwidget.org/js/?id=ww_bc810257cf5c1"></script>
</body>
</html>`);
});

renderApp.get('/widget.png', async (req, res) => {
  try {
    const imagePath = await getWidgetCacheImagePath();
    if (!imagePath) {
      sendWidgetFallback(res);
      return;
    }

    res.set('Cache-Control', 'no-store');
    res.sendFile(imagePath);
  } catch (error) {
    console.error('Serving cached widget failed:', error);
    sendWidgetFallback(res);
  }
});

renderApp.get('/api/getSensor', async (req, res) => {
  try {
    const upstreamResponse = await fetch(`${API_BASE_URL}/getSensor`, { cache: 'no-store' });
    const payloadText = await upstreamResponse.text();

    res.status(upstreamResponse.status);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', upstreamResponse.headers.get('content-type') || 'application/json');
    res.send(payloadText);
  } catch (error) {
    console.error('Proxy /api/getSensor failed:', error);
    res.status(502).json({
      error: 'sensor_proxy_failed',
      message: error.message,
    });
  }
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
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
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
  await page.waitForFunction(() => window.__KINDLE_RENDER_READY__ === true, { timeout: 16000 }).catch(() => {});
  await page.waitForTimeout(800);
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

async function getWidgetCacheImagePath() {
  await fs.promises.mkdir(WIDGET_CACHE_DIR, { recursive: true });
  const cacheState = await readWidgetCacheState();

  if (cacheState.exists && !cacheState.isExpired) {
    return WIDGET_CACHE_IMAGE_PATH;
  }

  if (cacheState.exists) {
    void refreshWidgetCacheInBackground();
    return WIDGET_CACHE_IMAGE_PATH;
  }

  try {
    await refreshWidgetCacheInBackground();
    return WIDGET_CACHE_IMAGE_PATH;
  } catch (error) {
    console.error('Initial widget cache refresh failed:', error);
    return null;
  }
}

async function readWidgetCacheState() {
  try {
    const [imageStat, metaRaw] = await Promise.all([
      fs.promises.stat(WIDGET_CACHE_IMAGE_PATH),
      fs.promises.readFile(WIDGET_CACHE_META_PATH, 'utf8'),
    ]);
    const meta = JSON.parse(metaRaw);
    const updatedAt = typeof meta.updatedAt === 'number' ? meta.updatedAt : imageStat.mtimeMs;

    return {
      exists: true,
      isExpired: Date.now() - updatedAt > WIDGET_CACHE_TTL_MS,
    };
  } catch (error) {
    return {
      exists: false,
      isExpired: true,
    };
  }
}

function refreshWidgetCacheInBackground() {
  if (!widgetRefreshPromise) {
    widgetRefreshPromise = refreshWidgetCache().finally(() => {
      widgetRefreshPromise = null;
    });
  }

  return widgetRefreshPromise;
}

async function refreshWidgetCache() {
  await fs.promises.mkdir(WIDGET_CACHE_DIR, { recursive: true });
  await fs.promises.mkdir(WIDGET_BROWSER_PROFILE_DIR, { recursive: true });

  const tmpImagePath = path.join(WIDGET_CACHE_DIR, `widget-${randomUUID()}.png`);
  const tmpMetaPath = path.join(WIDGET_CACHE_DIR, `widget-${randomUUID()}.json`);
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
      userDataDir: WIDGET_BROWSER_PROFILE_DIR,
    });

    const page = await browser.newPage();
    await page.setCacheEnabled(true);
    await page.setViewport({ width: 456, height: 120, deviceScaleFactor: 1 });
    await page.goto(WIDGET_SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForWidgetContent(page);

    const widgetElement = await page.$(WIDGET_SELECTOR);
    if (!widgetElement) {
      throw new Error('Widget element not found.');
    }

    await widgetElement.screenshot({ path: tmpImagePath, type: 'png' });
    await fs.promises.writeFile(tmpMetaPath, JSON.stringify({ updatedAt: Date.now() }), 'utf8');
    await fs.promises.rename(tmpImagePath, WIDGET_CACHE_IMAGE_PATH);
    await fs.promises.rename(tmpMetaPath, WIDGET_CACHE_META_PATH);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await fs.promises.unlink(tmpImagePath).catch(() => {});
    await fs.promises.unlink(tmpMetaPath).catch(() => {});
  }
}

async function waitForWidgetContent(page) {
  await page.waitForFunction((selector) => {
    const widgetNode = document.querySelector(selector);
    if (!widgetNode) {
      return false;
    }

    if (widgetNode.querySelector('iframe')) {
      return true;
    }

    const normalizedText = widgetNode.textContent.replace(/\s+/g, '').trim();
    if (normalizedText !== '' && normalizedText !== '天气插件') {
      return true;
    }

    return widgetNode.children.length > 1;
  }, { timeout: 12000 }, WIDGET_SELECTOR);
  await page.waitForTimeout(500);
}

function sendWidgetFallback(res) {
  res.status(200).type('image/svg+xml');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="456" height="84" viewBox="0 0 456 84">
  <rect width="456" height="84" fill="#ffffff"/>
  <text x="228" y="48" text-anchor="middle" font-size="20" fill="#666666" font-family="Arial, sans-serif">天气信息暂不可用</text>
</svg>`);
}
