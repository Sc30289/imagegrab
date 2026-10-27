/**
 * 图提取 ImageGrab · 本地演示脚手架
 * ---------------------------------------------------------------------------
 * ⚠️ 本文件只用于 demo 目录，不属于扩展本体。
 *
 * 作用：在没有安装扩展的普通浏览器里，用最小实现模拟 chrome.runtime /
 *      chrome.storage，让 content.js、gallery.js 可以「原样」跑起来，
 *      方便快速预览界面、录制演示、截图。
 *
 * 实现方式：
 *   - content.js 采集完图片后调用 chrome.runtime.sendMessage，
 *     这里把数据写进 localStorage，再打开 preview.html；
 *   - preview.html 里的 gallery.js 通过 chrome.storage.session.get 读数据，
 *     这里直接返回 localStorage 里的那份。
 * ---------------------------------------------------------------------------
 */
(() => {
  'use strict';

  // 已经装了真正的扩展就不要覆盖它的 API
  if (window.chrome && window.chrome.runtime && window.chrome.runtime.id) return;

  const STORE_KEY = 'imagegrab:payload';
  const listeners = new Set();

  // content.js 会读取这个标记，从而在本地地址上也注入按钮
  window.__IMAGEGRAB_DEMO__ = true;

  const readPayload = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch {
      return null;
    }
  };

  const writePayload = (payload) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('[图提取] 演示数据写入失败：', err);
    }
  };

  window.chrome = {
    runtime: {
      id: 'imagegrab-demo-mode',
      lastError: null,
      async sendMessage(message) {
        switch (message?.type) {
          case 'IMAGE_GRAB_OPEN': {
            // 模拟 background 的行为：存数据 + 打开预览页
            writePayload(message.payload);
            // 无用户手势时浏览器会拦截 window.open，兜底改为当前标签页跳转
            const opened = window.open('preview.html', '_blank');
            if (!opened) location.href = 'preview.html';
            return { ok: true };
          }

          case 'IMAGE_GRAB_GET_DATA':
            return { ok: true, payload: readPayload() };

          case 'IMAGE_GRAB_DOWNLOAD':
            // 演示模式下不真的写文件，如实告诉用户
            return { ok: false, error: '演示模式：安装扩展后才会真正保存 PNG 文件' };

          default:
            return { ok: false, error: `未知消息：${message?.type}` };
        }
      },
      onMessage: {
        addListener(fn) {
          listeners.add(fn);
        },
        removeListener(fn) {
          listeners.delete(fn);
        },
      },
    },

    storage: {
      session: {
        async get(key) {
          return { [key]: readPayload() };
        },
        async set(obj) {
          if (obj && STORE_KEY in obj) writePayload(obj[STORE_KEY]);
        },
      },
    },
  };

  console.info('%c[图提取] 当前为本地演示模式（未安装扩展）', 'color:#5b6cf9;font-weight:600');
})();
