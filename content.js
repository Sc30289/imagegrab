/**
 * 图提取 ImageGrab · content.js
 * ---------------------------------------------------------------------------
 * 职责（注入到淘宝 / 天猫 / 京东 / 拼多多商家版商品详情页）：
 *   1. 在页面右下角注入「获取图片」悬浮按钮；
 *   2. 点击后扫描整页商品图片：<img>、srcset、各种懒加载属性、background-image；
 *   3. 过滤图标 / logo / 占位图 / 1×1 像素图 / 小于 100×100 的图片；
 *   4. 补全相对路径、去重、按需拿到真实尺寸；
 *   5. 通过 chrome.runtime.sendMessage 把结果交给 background，由它打开预览页。
 * ---------------------------------------------------------------------------
 */
(() => {
  'use strict';

  /* ============================ 常量 ============================ */

  /** 最小可接受尺寸：宽或高任一边小于该值，视为图标 / 占位图 */
  const MIN_SIZE = 100;
  /** 单张图片预加载的超时时间（毫秒），避免个别图片卡住整个流程 */
  const PROBE_TIMEOUT = 8000;
  /** 预加载并发数 */
  const PROBE_CONCURRENCY = 6;
  /** 单页最多扫描的元素数量，防止超长页面卡死 */
  const MAX_ELEMENTS = 6000;

  /** 需要扫描的懒加载属性（各平台命名并不统一，这里做兼容） */
  const LAZY_ATTRS = [
    'src',
    'data-src',
    'data-lazy-src',
    'data-lazy',
    'data-original',
    'data-original-src',
    'data-ks-lazyload',
    'data-lazyload',
    'data-echo',
    'data-url',
    'data-img',
    'data-background-image',
  ];

  /** 命中这些关键词的地址大概率是图标 / 占位图 */
  const NOISE_PATTERN = /(logo|sprite|icon-|icons\/|placeholder|loading\.(gif|svg|png)|spacer|blank\.(gif|png))/i;

  /** 支持注入的平台 */
  const PLATFORMS = [
    { test: /(^|\.)taobao\.com$/i, name: '淘宝' },
    { test: /(^|\.)tmall\.com$/i, name: '天猫' },
    { test: /(^|\.)jd\.com$/i, name: '京东' },
    { test: /(^|\.)pinduoduo\.com$/i, name: '拼多多商家版' },
    { test: /(^|\.)yangkeduo\.com$/i, name: '拼多多' },
  ];

  /* ============================ 前置判断 ============================ */

  // 只在顶层页面注入，iframe 里不重复出现按钮
  if (window.top !== window) return;
  // 防止重复注入（SPA 路由切换 / 手动再次执行脚本）
  if (document.getElementById('igx-fab')) return;

  const isDebug =
    new URLSearchParams(location.search).get('imagegrab') === '1' ||
    // demo/harness.js 会置位该标记，方便在本地演示页上直接预览效果
    window.__IMAGEGRAB_DEMO__ === true;
  const platform = PLATFORMS.find((p) => p.test.test(location.hostname));
  // 不在支持列表里就直接退出（调试参数 ?imagegrab=1 可在本地演示页启用）
  if (!platform && !isDebug) return;

  /* ============================ 通用工具 ============================ */

  /**
   * 把相对地址补全为绝对地址，非法地址返回 null
   * @param {string} raw
   * @returns {string|null}
   */
  function absolutize(raw) {
    if (!raw) return null;
    const value = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!value || value.startsWith('#') || value.startsWith('javascript:')) return null;
    try {
      return new URL(value, location.href).href;
    } catch {
      return null;
    }
  }

  /**
   * 图片地址归一化：去掉电商 CDN 的缩放 / 压缩后缀，尽量还原原图
   * 这样缩略图和原图会被合并成同一张，减少了重复下载。
   * @param {string} url
   * @returns {string}
   */
  function normalizeUrl(url) {
    let u = url;

    // —— 淘宝 / 天猫（alicdn）常见写法 ——
    // a.jpg_400x400.jpg        老式缩放写法
    u = u.replace(/\.(jpg|jpeg|png|webp)_\d+x\d+[a-z0-9]*\.(jpg|jpeg|png|webp)$/i, '.$1');
    // a_430x430q90.jpg
    u = u.replace(/_\d+x\d+(q\d+)?\.(jpg|jpeg|png|webp)$/i, '.$2');
    // a_q90.jpg / a_sum.jpg
    u = u.replace(/_(q\d+|sum)\.(jpg|jpeg|png|webp)$/i, '.$2');
    // a.jpg_.webp
    u = u.replace(/\.(jpg|jpeg|png|webp)_\.webp$/i, '.$1');

    // —— 京东（360buyimg）常见写法 ——
    // .../s450x450_jfs/...  →  .../jfs/...
    u = u.replace(/\/s\d+x\d+_jfs\//gi, '/jfs/');
    // /n5/ /n4/ 等尺寸目录 → /n1/（800×800，清晰且体积可控）
    u = u.replace(/\/n\d\//gi, (m) => (m === '/n0/' || m === '/n1/' ? m : '/n1/'));

    return u;
  }

  /**
   * 解析 srcset，返回其中尺寸最大的那一张
   * @param {string} srcset
   * @returns {string|null}
   */
  function pickLargestFromSrcset(srcset) {
    if (!srcset) return null;
    let best = null;
    let bestScore = -1;
    for (const part of srcset.split(',')) {
      const item = part.trim();
      if (!item) continue;
      const [href, descriptor = '1x'] = item.split(/\s+/);
      const match = /([\d.]+)(w|x)$/i.exec(descriptor);
      const score = match ? parseFloat(match[1]) : 1;
      if (score > bestScore) {
        bestScore = score;
        best = href;
      }
    }
    return best;
  }

  /**
   * 从 CSS 的 background-image 值里取出所有 url(...)
   * @param {string} value
   * @returns {string[]}
   */
  function extractBackgroundUrls(value) {
    if (!value || value === 'none') return [];
    const urls = [];
    const re = /url\((['"]?)([^'")]+)\1\)/gi;
    let m;
    while ((m = re.exec(value))) urls.push(m[2]);
    return urls;
  }

  /**
   * 在页面里预加载一张图片，拿到它的真实宽高
   * @param {string} url
   * @returns {Promise<{ok: boolean, width: number, height: number}>}
   */
  function probeImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => done({ ok: false, width: 0, height: 0 }), PROBE_TIMEOUT);

      // 部分 CDN 开了防盗链，带上 no-referrer 通常能直接读到
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => done({ ok: true, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({ ok: false, width: 0, height: 0 });
      img.src = url;
    });
  }

  /**
   * 有限并发地跑一组异步任务
   * @template T
   * @param {Array<() => Promise<T>>} tasks
   * @param {number} limit
   * @returns {Promise<T[]>}
   */
  async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let cursor = 0;

    async function worker() {
      while (cursor < tasks.length) {
        const index = cursor++;
        results[index] = await tasks[index]();
      }
    }

    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
  }

  /* ============================ 图片采集 ============================ */

  /**
   * 扫描整个页面，收集所有可能的图片地址（未去重、未校验）
   * @returns {Array<{url: string, raw: string}>}
   */
  function collectCandidates() {
    /** @type {Map<string, string>} 归一化后的地址 → 原始地址（用于归一化失败时兜底） */
    const candidates = new Map();
    let scanned = 0;

    const push = (raw) => {
      const abs = absolutize(raw);
      if (!abs) return;
      if (!/^(https?:|data:image\/)/i.test(abs)) return;
      // SVG 多为图标，直接跳过
      if (/^data:image\/svg/i.test(abs) || /\.svg($|\?)/i.test(abs)) return;
      if (NOISE_PATTERN.test(abs)) return;
      const normalized = normalizeUrl(abs);
      if (!candidates.has(normalized)) candidates.set(normalized, abs);
    };

    // 1) 所有 <img>
    const images = document.images || [];
    for (let i = 0; i < images.length && scanned < MAX_ELEMENTS; i++, scanned++) {
      const el = images[i];
      if (el.currentSrc) push(el.currentSrc);
      for (const attr of LAZY_ATTRS) {
        const value = el.getAttribute(attr);
        if (value) push(value);
      }
      const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset');
      const fromSet = pickLargestFromSrcset(srcset);
      if (fromSet) push(fromSet);
    }

    // 2) <picture> 里的 <source srcset>
    for (const source of document.querySelectorAll('picture source[srcset]')) {
      const best = pickLargestFromSrcset(source.getAttribute('srcset'));
      if (best) push(best);
    }

    // 3) 非 <img> 元素上的懒加载属性（很多详情页用 div + 背景图实现）
    const lazySelector = LAZY_ATTRS.filter((a) => a !== 'src').map((a) => `[${a}]`).join(',');
    for (const el of document.querySelectorAll(lazySelector)) {
      if (scanned++ > MAX_ELEMENTS) break;
      for (const attr of LAZY_ATTRS) {
        const value = el.getAttribute?.(attr);
        if (!value) continue;
        if (attr === 'data-background-image') {
          extractBackgroundUrls(`url(${value})`).forEach(push);
        } else if (attr.includes('srcset')) {
          const best = pickLargestFromSrcset(value);
          if (best) push(best);
        } else {
          push(value);
        }
      }
    }

    // 4) 内联 background-image
    for (const el of document.querySelectorAll('[style*="background-image"]')) {
      if (scanned++ > MAX_ELEMENTS) break;
      extractBackgroundUrls(el.getAttribute('style')).forEach(push);
    }

    // 5) 样式表里声明的 background-image（活动 banner、装修模块常用这种写法）
    const collectFromRules = (rules) => {
      for (const rule of rules) {
        if (rule.style && rule.style.backgroundImage) {
          extractBackgroundUrls(rule.style.backgroundImage).forEach(push);
        }
        // @media / @supports 里还嵌着一层规则
        if (rule.cssRules) collectFromRules(rule.cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        // 跨域样式表读取 cssRules 会抛 SecurityError，跳过即可
        if (sheet.cssRules) collectFromRules(sheet.cssRules);
      } catch {
        /* 忽略 */
      }
    }

    // 6) 计算后的 background-image（兜底：样式由脚本动态写入的情况）
    const bgCandidates = document.querySelectorAll('[class*="bg"], [class*="cover"], [class*="pic"], [class*="banner"]');
    for (const el of Array.from(bgCandidates).slice(0, 800)) {
      if (scanned++ > MAX_ELEMENTS) break;
      const style = getComputedStyle(el);
      if (style.backgroundImage && style.backgroundImage !== 'none') {
        extractBackgroundUrls(style.backgroundImage).forEach(push);
      }
    }

    return Array.from(candidates, ([url, raw]) => ({ url, raw }));
  }

  /**
   * 采集 + 校验 + 过滤，得到最终图片列表
   * @param {(done: number, total: number) => void} onProgress
   * @returns {Promise<Array<{url: string, width: number, height: number}>>}
   */
  async function extractImages(onProgress) {
    const candidates = collectCandidates();
    const total = candidates.length;

    let done = 0;
    const tasks = candidates.map(({ url, raw }) => async () => {
      let target = url;
      let info = await probeImage(url);
      // 归一化后的“原图”地址可能 404（部分商家上传的就是缩放图），退回原始地址再试一次
      if (!info.ok && raw !== url) {
        info = await probeImage(raw);
        target = raw;
      }
      onProgress?.(++done, total);

      if (!info.ok) return null;
      // 过滤 1×1 像素图、图标、占位图
      if (info.width < MIN_SIZE || info.height < MIN_SIZE) return null;
      return { url: target, width: info.width, height: info.height };
    });

    const probed = await runWithConcurrency(tasks, PROBE_CONCURRENCY);

    // 再去一次重（归一化后可能出现相同地址），并剔掉 null
    const seen = new Set();
    const result = [];
    for (const item of probed) {
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      result.push({ url: item.url, width: item.width, height: item.height });
    }
    return result;
  }

  /* ============================ 界面 ============================ */

  const ICON_DOWNLOAD = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 3.5v10.5m0 0 4.2-4.2M12 14l-4.2-4.2" stroke="#fff" stroke-width="1.9"
            stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4.5 16.5v1.6A2.4 2.4 0 0 0 6.9 20.5h10.2a2.4 2.4 0 0 0 2.4-2.4v-1.6"
            stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>
    </svg>`;

  const ICON_SPINNER = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="rgba(255,255,255,.35)" stroke-width="2.4"/>
      <path d="M20 12a8 8 0 0 0-8-8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`;

  let toastTimer = 0;

  /** 创建并挂载悬浮按钮 */
  function mountFab() {
    if (document.getElementById('igx-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'igx-fab';
    fab.type = 'button';
    fab.title = `图提取：扫描当前${platform ? platform.name : ''}页面的所有商品图片`;
    fab.setAttribute('aria-label', '获取图片');
    fab.innerHTML = `<span id="igx-fab__icon">${ICON_DOWNLOAD}</span><span id="igx-fab__label">获取图片</span>`;
    fab.addEventListener('click', handleClick);

    document.documentElement.appendChild(fab);
  }

  /**
   * 按钮状态切换
   * @param {'idle'|'busy'} state
   * @param {string} [label]
   */
  function setFabState(state, label) {
    const fab = document.getElementById('igx-fab');
    if (!fab) return;
    const icon = fab.querySelector('#igx-fab__icon');
    const text = fab.querySelector('#igx-fab__label');
    if (state === 'busy') {
      fab.classList.add('is-busy');
      icon.innerHTML = ICON_SPINNER;
    } else {
      fab.classList.remove('is-busy');
      icon.innerHTML = ICON_DOWNLOAD;
    }
    if (label) text.textContent = label;
  }

  /**
   * 浮层提示
   * @param {string} message
   * @param {boolean} [isError]
   */
  function showToast(message, isError = false) {
    let toast = document.getElementById('igx-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'igx-toast';
      toast.setAttribute('role', 'status');
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('is-error', isError);
    toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-show'), 3200);
  }

  /* ============================ 主流程 ============================ */

  async function handleClick() {
    // 扩展被重载后，旧的内容脚本会失去 chrome.runtime，这里做个兜底
    if (!chrome?.runtime?.id) {
      showToast('扩展已更新，请刷新页面后重试', true);
      return;
    }

    setFabState('busy', '扫描中…');
    try {
      const images = await extractImages((done, total) => {
        if (total > 1) setFabState('busy', `扫描中 ${done}/${total}`);
      });

      if (!images.length) {
        setFabState('idle', '获取图片');
        showToast('没有找到符合条件的商品图片，试试先滚动页面让图片加载出来', true);
        return;
      }

      setFabState('busy', `找到 ${images.length} 张`);
      await chrome.runtime.sendMessage({
        type: 'IMAGE_GRAB_OPEN',
        payload: {
          images: images.map((item, i) => ({ ...item, index: i + 1 })),
          page: {
            url: location.href,
            title: document.title,
            platform: platform ? platform.name : '本地演示',
          },
          grabbedAt: Date.now(),
        },
      });

      setFabState('idle', `获取图片`);
      showToast(`已提取 ${images.length} 张图片，预览页已打开`);
    } catch (err) {
      console.error('[图提取] 提取失败：', err);
      setFabState('idle', '获取图片');
      showToast(`提取失败：${err?.message || '请稍后重试'}`, true);
    }
  }

  /* ============================ 启动 ============================ */

  mountFab();
  // 供 background 在用户点击工具栏图标时手动触发
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'IMAGE_GRAB_TRIGGER') handleClick();
  });
})();
