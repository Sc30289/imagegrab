/**
 * 图提取 ImageGrab · gallery.js
 * ---------------------------------------------------------------------------
 * 预览页逻辑：
 *   1. 从 chrome.storage.session 读取内容脚本抓来的图片列表；
 *   2. 网格化渲染，支持勾选 / 全选 / 反选；
 *   3. 把选中项交给 background 批量下载（统一转 PNG），并展示实时进度。
 * ---------------------------------------------------------------------------
 */
(() => {
  'use strict';

  /** 与 background.js 保持一致 */
  const STORE_KEY = 'imagegrab:payload';

  /** @type {Array<{url: string, width: number, height: number, index: number, selected: boolean}>} */
  let images = [];
  let pageInfo = null;
  let downloading = false;
  let toastTimer = 0;

  const el = {
    grid: document.getElementById('grid'),
    empty: document.getElementById('empty'),
    pageMeta: document.getElementById('pageMeta'),
    totalCount: document.getElementById('totalCount'),
    selectedCount: document.getElementById('selectedCount'),
    selectAll: document.getElementById('selectAll'),
    invertAll: document.getElementById('invertAll'),
    downloadBtn: document.getElementById('downloadBtn'),
    progress: document.getElementById('progress'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    toast: document.getElementById('toast'),
  };

  /* ============================ 初始化 ============================ */

  async function init() {
    bindEvents();

    try {
      const stored = await chrome.storage.session.get(STORE_KEY);
      const payload = stored?.[STORE_KEY];
      if (payload && Array.isArray(payload.images) && payload.images.length) {
        images = payload.images.map((item) => ({ ...item, selected: true }));
        pageInfo = payload.page || null;
      }
    } catch (err) {
      console.warn('[图提取] 读取数据失败：', err);
    }

    renderHeader();
    renderGrid();
    updateCounter();
  }

  function bindEvents() {
    el.selectAll.addEventListener('click', () => {
      images.forEach((item) => { item.selected = true; });
      syncCheckboxes();
      updateCounter();
    });

    el.invertAll.addEventListener('click', () => {
      images.forEach((item) => { item.selected = !item.selected; });
      syncCheckboxes();
      updateCounter();
    });

    el.downloadBtn.addEventListener('click', handleDownload);

    // 事件委托：卡片勾选
    el.grid.addEventListener('change', (event) => {
      const input = event.target.closest('.gp-card__check');
      if (!input) return;
      const index = Number(input.dataset.index);
      const item = images[index];
      if (!item) return;
      item.selected = input.checked;
      input.closest('.gp-card')?.classList.toggle('is-selected', input.checked);
      updateCounter();
    });

    // 后台推送的下载进度
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'IMAGE_GRAB_PROGRESS') return;
      handleProgress(message.payload);
    });
  }

  /* ============================ 渲染 ============================ */

  function renderHeader() {
    if (!pageInfo) {
      el.pageMeta.textContent = '未读取到来源页面';
      return;
    }
    const title = (pageInfo.title || '未命名页面').trim();
    const platform = pageInfo.platform ? `${pageInfo.platform} · ` : '';
    el.pageMeta.textContent = `${platform}${title}`;
    el.pageMeta.title = pageInfo.url || '';
  }

  function renderGrid() {
    if (!images.length) {
      el.grid.hidden = true;
      el.empty.hidden = false;
      el.downloadBtn.disabled = true;
      return;
    }
    el.empty.hidden = true;
    el.grid.hidden = false;

    const fragment = document.createDocumentFragment();

    images.forEach((item, index) => {
      const card = document.createElement('label');
      card.className = 'gp-card is-selected';
      card.dataset.index = String(index);

      const thumb = document.createElement('span');
      thumb.className = 'gp-card__thumb';

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = item.url;
      img.alt = `商品图 ${index + 1}`;
      img.addEventListener('error', () => {
        thumb.classList.add('is-error');
        thumb.innerHTML = '<span class="gp-card__fail">加载失败</span>';
      });

      const badge = document.createElement('span');
      badge.className = 'gp-card__index';
      badge.textContent = `#${index + 1}`;

      thumb.append(img, badge);

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'gp-card__check';
      check.checked = item.selected;
      check.dataset.index = String(index);
      check.setAttribute('aria-label', `选择第 ${index + 1} 张图片`);

      const meta = document.createElement('span');
      meta.className = 'gp-card__meta';
      meta.innerHTML = `<span class="gp-card__size">${item.width} × ${item.height}</span>`;

      const link = document.createElement('a');
      link.className = 'gp-card__open';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = '原图';
      link.addEventListener('click', (event) => event.stopPropagation());
      meta.appendChild(link);

      card.append(thumb, check, meta);
      fragment.appendChild(card);
    });

    el.grid.replaceChildren(fragment);
  }

  /** 把 images 里的选中状态同步回复选框 */
  function syncCheckboxes() {
    el.grid.querySelectorAll('.gp-card__check').forEach((input) => {
      const index = Number(input.dataset.index);
      const checked = Boolean(images[index]?.selected);
      input.checked = checked;
      input.closest('.gp-card')?.classList.toggle('is-selected', checked);
    });
  }

  function updateCounter() {
    const total = images.length;
    const selected = images.filter((item) => item.selected).length;
    el.totalCount.textContent = String(total);
    el.selectedCount.textContent = String(selected);
    el.downloadBtn.disabled = downloading || selected === 0;
    el.selectAll.disabled = downloading || total === 0;
    el.invertAll.disabled = downloading || total === 0;
  }

  /* ============================ 下载 ============================ */

  async function handleDownload() {
    if (downloading) return;
    const items = images.filter((item) => item.selected);
    if (!items.length) {
      showToast('请先勾选要下载的图片', true);
      return;
    }

    setDownloading(true);
    showProgress(true);
    setProgress(0, items.length, '正在准备…');

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'IMAGE_GRAB_DOWNLOAD',
        payload: { items: items.map((item) => ({ url: item.url })) },
      });

      if (!result?.ok) throw new Error(result?.error || '下载失败');

      const parts = [`已保存 ${result.ok} 张 PNG 到浏览器默认下载目录`];
      if (result.fallback) parts.push(`${result.fallback} 张转换失败已保存原图`);
      if (result.failed) parts.push(`${result.failed} 张下载失败`);
      showToast(parts.join('，'), Boolean(result.failed));
      setProgress(result.total, result.total, '下载完成');
    } catch (err) {
      console.error('[图提取] 下载失败：', err);
      showToast(`下载失败：${err?.message || '请稍后重试'}`, true);
      hideProgress();
    } finally {
      setDownloading(false);
      setTimeout(hideProgress, 2600);
    }
  }

  function setDownloading(value) {
    downloading = value;
    el.downloadBtn.textContent = value ? '下载中…' : '';
    if (!value) {
      el.downloadBtn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.8v9.6m0 0 3.8-3.8M12 13.4 8.2 9.6" fill="none" stroke="currentColor"
                stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M5 16.2v1.4A2.4 2.4 0 0 0 7.4 20h9.2a2.4 2.4 0 0 0 2.4-2.4v-1.4"
                fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>下载选中`;
    }
    updateCounter();
  }

  function handleProgress(payload) {
    if (!payload) return;
    if (payload.phase === 'start') {
      showProgress(true);
      setProgress(0, payload.total, `正在下载 0/${payload.total}`);
      return;
    }
    if (payload.phase === 'progress') {
      setProgress(payload.done, payload.total, `正在下载 ${payload.done}/${payload.total}`);
      return;
    }
    if (payload.phase === 'done') {
      setProgress(payload.total, payload.total, '下载完成');
    }
  }

  function showProgress(visible) {
    el.progress.hidden = !visible;
  }

  function hideProgress() {
    el.progress.hidden = true;
    el.progressBar.style.width = '0%';
  }

  function setProgress(done, total, text) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    el.progressBar.style.width = `${percent}%`;
    el.progressText.textContent = text || `${done}/${total}`;
  }

  /* ============================ 轻提示 ============================ */

  function showToast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle('is-error', isError);
    el.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-show'), 4200);
  }

  init();
})();
