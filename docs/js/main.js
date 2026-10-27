/**
 * 图提取 ImageGrab · 官网交互脚本
 * ---------------------------------------------------------------------------
 * 包含四个小功能：
 *   1. 滚动时导航栏吸顶加深 + 阴影
 *   2. 移动端汉堡菜单展开 / 收起（点击外部、Esc、点击链接都会关闭）
 *   3. IntersectionObserver 实现元素滚动进入视口时淡入上移
 *   4. 滚动监听高亮当前所在区块的导航项
 * 全部为原生 JS，无任何依赖，双击 index.html 即可运行。
 * ---------------------------------------------------------------------------
 */
(() => {
  'use strict';

  /** 导航栏吸顶状态 */
  function initNavbarScroll() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    const update = () => {
      navbar.classList.toggle('is-scrolled', window.scrollY > 8);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  /** 移动端汉堡菜单 */
  function initMobileMenu() {
    const toggle = document.getElementById('navToggle');
    const nav = document.getElementById('nav');
    if (!toggle || !nav) return;

    const close = () => {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', '展开导航菜单');
    };

    const open = () => {
      nav.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', '收起导航菜单');
    };

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (nav.classList.contains('is-open')) close();
      else open();
    });

    // 点击菜单里的链接后自动收起
    nav.addEventListener('click', (event) => {
      if (event.target.closest('.nav__link')) close();
    });

    // 点击页面其它位置收起
    document.addEventListener('click', (event) => {
      if (!nav.classList.contains('is-open')) return;
      if (nav.contains(event.target) || toggle.contains(event.target)) return;
      close();
    });

    // Esc 收起
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    // 回到桌面宽度时重置状态
    window.addEventListener('resize', () => {
      if (window.innerWidth > 767) close();
    });
  }

  /** 滚动进入视口的淡入动画 */
  function initReveal() {
    const targets = document.querySelectorAll('.reveal');
    if (!targets.length) return;

    // 老浏览器或不支持时直接显示
    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target); // 只触发一次
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
    );

    targets.forEach((el) => observer.observe(el));
  }

  /** 滚动监听：高亮当前区块对应的导航项 */
  function initScrollSpy() {
    const links = Array.from(document.querySelectorAll('.nav__link[href^="#"]'));
    if (!links.length) return;

    const sections = links
      .map((link) => {
        const id = link.getAttribute('href').slice(1);
        const el = document.getElementById(id);
        return el ? { link, el } : null;
      })
      .filter(Boolean);

    if (!sections.length) return;

    let ticking = false;

    const update = () => {
      ticking = false;
      const offset = window.scrollY + window.innerHeight * 0.28;
      let current = sections[0];

      for (const item of sections) {
        if (item.el.offsetTop <= offset) current = item;
      }

      // 页面滚到底部时，高亮最后一项
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        current = sections[sections.length - 1];
      }

      sections.forEach(({ link }) => link.classList.toggle('is-active', link === current.link));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /** 页脚年份 */
  function initFooterYear() {
    const el = document.getElementById('year');
    if (el) el.textContent = String(new Date().getFullYear());
  }

  function boot() {
    initNavbarScroll();
    initMobileMenu();
    initReveal();
    initScrollSpy();
    initFooterYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
