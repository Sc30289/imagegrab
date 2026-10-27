/**
 * 图提取 ImageGrab · background.js（Service Worker）
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 接收内容脚本采集到的图片列表，写入 chrome.storage.session，并打开预览页；
 *   2. 接收预览页的下载请求，把图片统一转成 PNG 后交给 chrome.downloads 保存；
 *   3. 下载过程中持续把进度回传给预览页，结束后给出结果汇总。
 *
 * 为什么转 PNG 放在后台做？
 *   详情页里的图片是跨域的，页面里直接用 canvas 会污染画布导致 toBlob 报错；
 *   Service Worker 里用 fetch（依赖 host_permissions）+ createImageBitmap +
 *   OffscreenCanvas 处理，不存在跨域限制。
 * ---------------------------------------------------------------------------
 */

/** 预览页的数据存在这里 */
const STORE_KEY = 'imagegrab:payload';
/** 预览页地址 */
const GALLERY_PATH = 'gallery.html';
/** 同时处理几张图片 */
const MAX_PARALLEL = 3;
/** 文件名前缀，规则：商品图_序号.png（序号补零到三位） */
const FILE_PREFIX = '商品图';

/* ============================ 工具函数 ============================ */

/**
 * 把二进制数据编码成 base64
 * Service Worker 里没有 URL.createObjectURL，也没有 FileReader，
 * 所以这里用 arrayBuffer + btoa 分块转换，避免大图爆栈。
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 任意格式的图片 blob → PNG blob
 * @param {Blob} blob
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
async function convertToPng(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    // 透明背景的 webp / png 直接铺在画布上，保持原样
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    return { blob: pngBlob, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}

/**
 * 生成补零后的文件名
 * @param {number} seq 从 1 开始
 * @param {string} ext
 * @returns {string}
 */
function buildFilename(seq, ext = 'png') {
  return `${FILE_PREFIX}_${String(seq).padStart(3, '0')}.${ext}`;
}

/** 把进度广播给预览页 */
function broadcast(payload) {
  chrome.runtime.sendMessage({ type: 'IMAGE_GRAB_PROGRESS', payload }).catch(() => {
    /* 预览页可能已经关闭，忽略 */
  });
}

/* ============================ 打开预览页 ============================ */

/**
 * 保存数据并打开预览页
 * @param {{images: Array, page: Object, grabbedAt: number}} payload
 */
async function openGallery(payload) {
  await chrome.storage.session.set({ [STORE_KEY]: payload });
  await chrome.tabs.create({ url: chrome.runtime.getURL(GALLERY_PATH), active: true });
}

/* ============================ 下载 ============================ */

/**
 * 下载单张图片并转成 PNG
 * @param {{url: string}} item
 * @param {number} seq
 */
async function downloadAsPng(item, seq) {
  const response = await fetch(item.url, { credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) throw new Error(`图片请求失败（HTTP ${response.status}）`);

  const sourceBlob = await response.blob();
  const { blob, width, height } = await convertToPng(sourceBlob);
  const dataUrl = `data:image/png;base64,${arrayBufferToBase64(await blob.arrayBuffer())}`;

  const filename = buildFilename(seq, 'png');
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });

  return { downloadId, filename, width, height };
}

/**
 * 兜底：转换失败时直接下载原图，至少不让用户空手而归
 * @param {{url: string}} item
 * @param {number} seq
 */
async function downloadOriginal(item, seq) {
  const matched = /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.exec(item.url);
  const ext = matched ? matched[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
  const filename = buildFilename(seq, ext);
  const downloadId = await chrome.downloads.download({
    url: item.url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });
  return { downloadId, filename, fallback: true };
}

/**
 * 批量下载
 * @param {Array<{url: string}>} items
 * @returns {Promise<{ok: number, failed: number, fallback: number, total: number}>}
 */
async function runDownloads(items) {
  const total = items.length;
  let done = 0;
  let ok = 0;
  let failed = 0;
  let fallback = 0;
  let cursor = 0;

  broadcast({ phase: 'start', done, total });

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      const seq = index + 1;

      try {
        await downloadAsPng(item, seq);
        ok += 1;
      } catch (err) {
        console.warn('[图提取] PNG 转换失败，改为直接下载原图：', item.url, err);
        try {
          await downloadOriginal(item, seq);
          fallback += 1;
        } catch (err2) {
          console.error('[图提取] 下载失败：', item.url, err2);
          failed += 1;
        }
      }

      done += 1;
      broadcast({ phase: 'progress', done, total, ok, failed, fallback, url: item.url });
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, items.length) }, worker));

  const result = { total, ok, failed, fallback };
  broadcast({ phase: 'done', done: total, total, ...result });
  return result;
}

/* ============================ 消息路由 ============================ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 内容脚本：拿到图片列表，打开预览页
  if (message?.type === 'IMAGE_GRAB_OPEN') {
    openGallery(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true; // 异步响应
  }

  // 预览页：读取数据（页面刷新时从这里恢复）
  if (message?.type === 'IMAGE_GRAB_GET_DATA') {
    chrome.storage.session
      .get(STORE_KEY)
      .then((result) => sendResponse({ ok: true, payload: result[STORE_KEY] || null }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  // 预览页：下载选中的图片
  if (message?.type === 'IMAGE_GRAB_DOWNLOAD') {
    const items = message?.payload?.items || [];
    if (!items.length) {
      sendResponse({ ok: false, error: '没有选中任何图片' });
      return false;
    }
    runDownloads(items)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  return false;
});

/* ============================ 工具栏图标 ============================ */

// 点击扩展图标 → 通知当前标签页的内容脚本执行一次提取
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'IMAGE_GRAB_TRIGGER' });
  } catch {
    // 当前页面没有内容脚本（不在支持的平台），忽略即可
  }
});
