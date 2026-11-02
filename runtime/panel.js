/**
 * AGENTS.md 面板 —— 注入到 Harness 页面里的客户端脚本。
 *
 * 布局：对话区 ｜ 本面板 ｜ DSH 自带右侧边栏。
 * 面板贴在原生边栏左边，边栏开合时会重新对齐。
 *
 * 交互：左边缘 6px 拖拽条改宽；左侧收起条、Esc、点遮罩、工具栏按钮都能关。
 */
(function () {
  "use strict";
  if (window.__DSH_AGENTS_VIEWER__) return;
  window.__DSH_AGENTS_VIEWER__ = true;

  var BASE = "/dsh-agents-viewer";
  var TAG = "agv";
  var WIDTH_KEY = "agv.width";
  var DEFAULT_WIDTH = 440;
  var MIN_WIDTH = 300;
  var MAX_WIDTH = 900;

  var TITLEBAR_MAX_TOP = 40;
  var HEADER_MAX_TOP = 150;
  var RIGHT_BAND = 560;

  function getJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      return r.json();
    });
  }

  function postJson(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json();
    });
  }

  function loadWidth() {
    try {
      var n = parseInt(localStorage.getItem(WIDTH_KEY), 10);
      if (isFinite(n) && n >= MIN_WIDTH) return Math.min(n, MAX_WIDTH);
    } catch (e) {
      /* 存储不可用 */
    }
    return DEFAULT_WIDTH;
  }

  function saveWidth(w) {
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
    } catch (e) {
      /* 存不下就算了 */
    }
  }

  // ── 探测 ──────────────────────────────────────────────────────────




  // ── 原生右侧边栏 ──────────────────────────────────────────────────

  /** DSH 自带右侧边栏的宽度；没开就是 0。 */
  // 返回原生右侧边栏的元素；侧栏关着（按钮在屏幕外）返回 null。
  function nativeSidebarEl() {
    // 优先：从页签元素反查侧栏容器（最可靠，不依赖 aria 文案）。
    try {
      var tabEl = document.querySelector("[data-dockkit-tab], [data-sidebar-right-tab]");
      if (tabEl) {
        var tn = tabEl;
        while (tn && tn !== document.body) {
          var tr = tn.getBoundingClientRect();
          if (tr.width > 300 && tr.height > 300) return tn;
          tn = tn.parentElement;
        }
      }
    } catch (e) { /* 继续用旧办法 */ }

    try {
      var btn = document.querySelector('[aria-label="\u6536\u8d77\u53f3\u4fa7\u8fb9\u680f"]');
      if (!btn) return null;
      var vb = btn.getBoundingClientRect();
      if (vb.width < 4 || vb.left > window.innerWidth - 4) return null;
      var node = btn;
      while (node && node !== document.body) {
        var r = node.getBoundingClientRect();
        if (r.height > 200 && r.width > 160 && Math.abs(r.right - window.innerWidth) < 6) return node;
        node = node.parentElement;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }


  /** 抽屉、遮罩、对话区让位三者对齐同一个宽度。 */
  function syncLayout() {
    if (!drawer) return;
    var sideEl = nativeSidebarEl();
    if (sideEl && state.sideW) {
      sideEl.style.width = state.sideW + "px";
      sideEl.style.minWidth = state.sideW + "px";
    }
    var side = sideEl ? Math.round(sideEl.getBoundingClientRect().width) : 0;
    if (drawer.__side === side) return;
    drawer.__side = side;
    drawer.root.style.right = side + "px";
    drawer.backdrop.style.right = side + "px";
  }

  // 找到对话列：从工具条按钮往上，第一个够高够宽的祖先。
  var chatEl = null;
  var chatOrigMargin = null;




  // 找聊天列：body 的直接子节点里，包含工具栏按钮且面积最小的那个。
  var chatCol = null;
  var chatColOrig = null;




  function applyWidth(width, persist) {
    var max = Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.85));
    var w = Math.max(MIN_WIDTH, Math.min(Math.round(width), max));
    state.width = w;
    if (drawer) {
      drawer.root.style.width = w + "px";
      syncLayout();
      /* 对话区让位已停用：注入 DOM 改布局会切字/闪烁，放弃这条路 */
    }
    if (persist) saveWidth(w);
    return w;
  }

  // ── 找锚点 ────────────────────────────────────────────────────────

  var foundAnchor = null;

  function findAnchor() {
    // 优先钉在"更多操作"左边：这是确认过正确的位置，不会随按钮增减漂移。
    try {
      var pref = document.querySelector('[aria-label="\u66f4\u591a\u64cd\u4f5c"]');
      if (pref && pref.getAttribute("data-agv") === null) {
        var pr = pref.getBoundingClientRect();
        if (pr.width >= 8 && pr.height >= 8 && pr.top >= TITLEBAR_MAX_TOP) return pref;
      }
    } catch (e) {
      /* 退回通用查找 */
    }

    var els = document.querySelectorAll('button, [role="button"]');
    var best = null;
    var bestLeft = Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.getAttribute("data-agv") !== null) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.top < TITLEBAR_MAX_TOP) continue;
      if (r.top > HEADER_MAX_TOP) continue;
      if (r.left < window.innerWidth - RIGHT_BAND) continue;
      if (r.left < bestLeft) {
        bestLeft = r.left;
        best = el;
      }
    }
    return best;
  }

  var BUTTON_SVG =
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
    'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 1.8h5.2L12.2 5v9.2H4z"/><path d="M9 1.8V5h3.2"/>' +
    '<path d="M6 8h4M6 10.4h4"/></svg>';

  function makeButton() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-agv", "btn");
    btn.className = TAG + "-btn";
    btn.title = "AGENTS.md（点击编辑）";
    btn.setAttribute("aria-label", "AGENTS.md");
    btn.innerHTML = BUTTON_SVG;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleDrawer();
    });
    return btn;
  }

  function mountButton() {
    try {
      if (document.querySelector('[data-agv="btn"]')) return true;
      var anchor = findAnchor();
      if (!anchor || !anchor.parentElement) return false;
      var btn = makeButton();
      anchor.parentElement.insertBefore(btn, anchor);
      btn.setAttribute("data-agv-mode", "inline");
      return true;
    } catch (e) {
      return false;
    }
  }

  function mountWithRetry() {
    if (mountButton()) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (mountButton()) {
        clearInterval(timer);
        return;
      }
      if (tries >= 100) {
        clearInterval(timer);
        mountFallback();
      }
    }, 300);
  }

  function mountFallback() {
    try {
      if (document.querySelector('[data-agv="btn"]')) return;
      var btn = makeButton();
      btn.setAttribute("data-agv-mode", "fixed");
      btn.style.position = "fixed";
      btn.style.top = "64px";
      btn.style.right = "340px";
      btn.style.zIndex = "2147482000";
      document.body.appendChild(btn);
    } catch (e) {
      /* 兜底失败就彻底没有按钮 */
    }
  }

  // ── 抽屉 ──────────────────────────────────────────────────────────

  var drawer = null;
  var state = { files: [], current: null, loaded: "", dirty: false, saving: false, width: loadWidth(), sideW: null };

  function el(tagName, className, text) {
    var node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function buildDrawer() {
    var backdrop = el("div", TAG + "-backdrop");
    backdrop.setAttribute("data-agv", "backdrop");
    backdrop.addEventListener("click", closeDrawer);
    document.body.appendChild(backdrop);

    var root = el("div", TAG + "-drawer");
    root.setAttribute("data-agv", "drawer");
    var card = el("div", TAG + "-card");
    root.appendChild(card);
    root.style.width = state.width + "px";

    // 左边缘拖拽条
    // 顶部留白：让第一条横线落在和左侧卡片顶部相同的高度。
    var topspace = el("div", TAG + "-topspace");
    topspace.setAttribute("data-agv", "topspace");
    card.appendChild(topspace);

    var resizer = el("div", TAG + "-resizer");
    resizer.setAttribute("data-agv", "resizer");
    resizer.title = "拖动调整宽度";
    resizer.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var startX = e.clientX;
      var startW = state.width;
      try {
        resizer.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 无指针捕获时靠 document 监听兜底 */
      }
      root.setAttribute("data-resizing", "1");

      function onMove(ev) {
        applyWidth(startW + (startX - ev.clientX), false);
      }
      function onUp(ev) {
        root.removeAttribute("data-resizing");
        applyWidth(state.width, true);
        try {
          resizer.releasePointerCapture(ev.pointerId);
        } catch (err) {
          /* ignore */
        }
        resizer.removeEventListener("pointermove", onMove);
        resizer.removeEventListener("pointerup", onUp);
        resizer.removeEventListener("pointercancel", onUp);
      }

      resizer.addEventListener("pointermove", onMove);
      resizer.addEventListener("pointerup", onUp);
      resizer.addEventListener("pointercancel", onUp);
    });
    root.appendChild(resizer);
    // 右界线：拖它改原生侧边栏宽度，面板随之让位。
    var resizerR = el("div", TAG + "-resizer-r");
    resizerR.setAttribute("data-agv", "resizer-r");
    resizerR.addEventListener("pointerdown", function (e) {
      var sideEl = nativeSidebarEl();
      if (!sideEl) return;
      e.preventDefault();
      e.stopPropagation();
      var startX = e.clientX;
      var startW = sideEl.getBoundingClientRect().width;
      try { resizerR.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      function onMove(ev) {
        var max = Math.min(900, Math.round(window.innerWidth * 0.6));
        var w = Math.max(240, Math.min(Math.round(startW + (startX - ev.clientX)), max));
        state.sideW = w;
        sideEl.style.width = w + "px";
        sideEl.style.minWidth = w + "px";
        drawer.__side = -1;
        syncLayout();
      }
      function onUp(ev) {
        try { resizerR.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
        resizerR.removeEventListener("pointermove", onMove);
        resizerR.removeEventListener("pointerup", onUp);
        resizerR.removeEventListener("pointercancel", onUp);
      }
      resizerR.addEventListener("pointermove", onMove);
      resizerR.addEventListener("pointerup", onUp);
      resizerR.addEventListener("pointercancel", onUp);
    });
    root.appendChild(resizerR);


    // 左侧收起条：箭头朝右（面板在右边，往右收起）
    var handle = el("div", TAG + "-handle", ">");
    handle.setAttribute("data-agv", "handle");
    handle.title = "收起";
    handle.addEventListener("click", closeDrawer);
    root.appendChild(handle);

    var head = el("div", TAG + "-head");
    head.appendChild(el("div", TAG + "-title", "AGENTS.md"));
    var close = el("button", TAG + "-close", "×");
    close.type = "button";
    close.title = "关闭（Esc）";
    close.addEventListener("click", closeDrawer);
    head.appendChild(close);
    card.appendChild(head);

    var meta = el("div", TAG + "-meta");
    card.appendChild(meta);

    var list = el("div", TAG + "-list");
    card.appendChild(list);

    var editor = el("textarea", TAG + "-editor");
    editor.spellcheck = false;
    editor.placeholder = "这个文件还不存在。写入内容后点保存就会创建。";
    editor.addEventListener("input", function () {
      state.dirty = editor.value !== state.loaded;
      refreshFoot();
    });
    editor.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    });
    card.appendChild(editor);

    var foot = el("div", TAG + "-foot");
    var status = el("span", TAG + "-status");
    var saveBtn = el("button", TAG + "-save", "保存");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", save);
    foot.appendChild(status);
    foot.appendChild(saveBtn);
    card.appendChild(foot);

    document.body.appendChild(root);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root.hasAttribute("data-open")) {
        e.stopPropagation();
        closeDrawer();
      }
    });

    return { root: root, backdrop: backdrop, head: head, meta: meta, list: list, editor: editor, status: status, save: saveBtn };
  }

  var closeArmed = 0;

  function armedClose() {
    var now = Date.now();
    if (now - closeArmed < 4000) {
      closeArmed = 0;
      return true;
    }
    closeArmed = now;
    if (drawer) drawer.status.textContent = "\u6709\u672a\u4fdd\u5b58\u6539\u52a8\uff0c\u518d\u70b9\u4e00\u6b21\u5173\u95ed";
    return false;
  }

  function closeDrawer() {
    if (!drawer) return;
    if (state.dirty && !armedClose()) return;
    drawer.root.removeAttribute("data-open");
    drawer.backdrop.removeAttribute("data-open");
    syncLayout();
  }

  function refreshFoot() {
    if (!drawer) return;
    if (state.saving) drawer.status.textContent = "保存中…";
    else if (state.dirty) drawer.status.textContent = "未保存";
    drawer.save.disabled = !state.dirty || state.saving || !state.current;
  }

  function renderMeta(data) {
    drawer.meta.innerHTML = "";
    drawer.meta.appendChild(el("span", TAG + "-meta-label", "项目"));
    var value = el("span", TAG + "-meta-path", data.project || "未知");
    value.title = data.project || "";
    drawer.meta.appendChild(value);
    if (data.source === "recent") {
      var note = el("span", TAG + "-meta-ver", "推断");
      note.title = "页面拿不到 session id，按「最近使用的工作区」推断";
      drawer.meta.appendChild(note);
    }
    if (data.dshVersion) drawer.meta.appendChild(el("span", TAG + "-meta-ver", "DSH " + data.dshVersion));
  }

  function renderList() {
    drawer.list.innerHTML = "";
    for (var i = 0; i < state.files.length; i++) {
      (function (file) {
        var row = el("button", TAG + "-row");
        row.type = "button";
        row.setAttribute("data-agv", "row");
        if (state.current && state.current.path === file.path) row.setAttribute("data-active", "1");
        if (!file.exists) row.setAttribute("data-missing", "1");
        row.appendChild(el("span", TAG + "-scope", file.scope));
        row.appendChild(el("span", TAG + "-name", file.path.split(/[\\/]/).pop() || file.path));
        row.appendChild(el("span", TAG + "-size", file.exists ? (file.size / 1024).toFixed(1) + " KB" : "不存在"));
        row.title = file.path;
        row.addEventListener("click", function () {
          selectFile(file);
        });
        drawer.list.appendChild(row);
      })(state.files[i]);
    }
  }

  function selectFile(file) {
    state.current = file;
    state.loaded = "";
    state.dirty = false;
    drawer.editor.value = "";
    renderList();
    refreshFoot();
    getJson(BASE + "/read?path=" + encodeURIComponent(file.path) + "&hint=" + encodeURIComponent(location.href))
      .then(function (res) {
        if (!res.ok) {
          drawer.status.textContent = res.error || "读取失败";
          return;
        }
        state.loaded = res.content || "";
        drawer.editor.value = state.loaded;
        state.dirty = false;
        drawer.status.textContent = res.exists ? "已加载" : "新文件";
        refreshFoot();
      })
      .catch(function (e) {
        drawer.status.textContent = "读取失败：" + e;
      });
  }

  function save() {
    if (!state.current || state.saving) return;
    state.saving = true;
    refreshFoot();
    postJson(BASE + "/write", { path: state.current.path, content: drawer.editor.value, hint: location.href })
      .then(function (res) {
        state.saving = false;
        if (!res.ok) {
          drawer.status.textContent = res.error || "保存失败";
        } else {
          state.loaded = drawer.editor.value;
          state.dirty = false;
          state.current.exists = true;
          var d = new Date();
          var pad = function (n) {
            return ("0" + n).slice(-2);
          };
          drawer.status.textContent = "已保存 " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
          renderList();
        }
        refreshFoot();
      })
      .catch(function (e) {
        state.saving = false;
        drawer.status.textContent = "保存失败：" + e;
        refreshFoot();
      });
  }

  // 把本面板的两条横线和左侧工具条那两层的下边界对齐。
  // 找到左侧那一列真正的横线位置（1-3px 的分隔条，或带下边框的容器）。
  // 扫描左侧的横线候选：细条、带下边框或上边框的容器都算。

  // 把本面板的两条横线摆到和左侧那两条同高；文字贴底由 CSS 负责。

  // 把本面板的两条横线摆到和左侧那两条同高；文字贴底由 CSS 负责。

  function afterOpen() {
    if (!drawer) drawer = buildDrawer();
    drawer.root.setAttribute("data-open", "1");
    /* backdrop stays hidden while docked so the composer keeps working */
    applyWidth(state.width, false);
    syncLayout();
    drawer.status.textContent = "加载中…";
    getJson(BASE + "/list?hint=" + encodeURIComponent(location.href))
      .then(function (data) {
        if (!data.ok) {
          drawer.status.textContent = data.error || "加载失败";
          return;
        }
        state.files = data.files || [];
        renderMeta(data);
        renderList();
        var first = null;
        for (var i = 0; i < state.files.length; i++) {
          if (state.files[i].exists) {
            first = state.files[i];
            break;
          }
        }
        if (first) selectFile(first);
        else if (state.files.length) selectFile(state.files[0]);
        else drawer.status.textContent = "没有可用文件";
      })
      .catch(function (e) {
        drawer.status.textContent = "加载失败：" + e;
      });
  }

  var hintTimer = 0;

  // 侧栏开着时按钮不打开面板，只在图标下面淡淡提示一句。

  // dock 模式：让原生右侧边栏展开，本面板贴到它那块区域上。
  var docked = false;

  function clickSidebarToggle(open) {
    var label = open ? "\u6253\u5f00\u53f3\u4fa7\u8fb9\u680f" : "\u6536\u8d77\u53f3\u4fa7\u8fb9\u680f";
    var btn = document.querySelector('[aria-label="' + label + '"]');
    if (btn) { btn.click(); return true; }
    return false;
  }

  // 在原生页签条上加一个 AGENTS.md 入口，像浏览器/终端那样。


  // 侧栏左边界：从页签往上找，取最宽但仍贴着窗口右边的那个的左边界。
  function sidebarLeft() {
    try {
      var b = document.querySelector('[aria-label="\u6536\u8d77\u53f3\u4fa7\u8fb9\u680f"]');
      if (!b) return 0;
      var br0 = b.getBoundingClientRect();
      if (br0.width < 4 || br0.left > window.innerWidth - 4) return 0;
      var n = b;
      while (n && n !== document.body) {
        var r = n.getBoundingClientRect();
        if (r.width >= 300 && r.height >= 300 && Math.abs(r.right - window.innerWidth) < 8) {
          return Math.round(r.left);
        }
        n = n.parentElement;
      }
    } catch (e) { /* ignore */ }
    return 0;
  }

  var dockRaf = 0;

  function startDockWatch() {
    stopDockWatch();
    var tick = function () {
      syncDock();
      dockRaf = requestAnimationFrame(tick);
    };
    dockRaf = requestAnimationFrame(tick);
  }

  function stopDockWatch() {
    if (dockRaf) { cancelAnimationFrame(dockRaf); dockRaf = 0; }
  }

  var lastSig = "";

  function syncDock() {
    if (!drawer || !drawer.root.hasAttribute("data-open")) return;
    var left = sidebarLeft();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var dock = left > 0 && vw - left >= 320;
    var sig = (dock ? "d" : "o") + ":" + left + ":" + vw + ":" + vh;
    if (sig === lastSig) return;
    lastSig = sig;
    if (!dock) {
      if (drawer.root.getAttribute("data-dock") === "1") {
        closeDocked();
        return;
      }
      drawer.root.removeAttribute("data-dock");
      drawer.root.style.left = "";
      drawer.root.style.top = "";
      drawer.root.style.height = "";
      drawer.root.style.width = state.width + "px";
      /* diagnostics removed */
      drawer.root.removeAttribute('data-pending');
      return;
    }
    drawer.root.setAttribute("data-dock", "1");
    drawer.root.style.right = "auto";
    drawer.root.style.left = left + "px";
    drawer.root.style.top = "0px";
    drawer.root.style.width = (vw - left) + "px";
    drawer.root.style.height = vh + "px";
      /* diagnostics removed */
    drawer.root.removeAttribute('data-pending');
  }



  function openDocked() {
    if (!drawer) drawer = buildDrawer();
    drawer.root.setAttribute("data-open", "1");
    drawer.root.setAttribute('data-pending', '1');
    lastSig = '';
    if (sidebarLeft()) {
      docked = false;
      syncDock();
      startDockWatch();
      afterOpen();
      return;
    }
    var clicked = clickSidebarToggle(true);
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (sidebarLeft() || tries > 25) {
        clearInterval(timer);
        if (sidebarLeft()) {
          docked = clicked;
          syncDock();
          startDockWatch();
        }
        afterOpen();
      }
    }, 80);
  }

  function closeDocked() {
    if (!drawer) return;
    lastSig = '';
    stopDockWatch();
    drawer.root.removeAttribute("data-open");
    drawer.root.removeAttribute("data-dock");
    if (docked) {
      clickSidebarToggle(false);
      docked = false;
    }
  }

  function toggleDrawer() {
    if (drawer && drawer.root.hasAttribute("data-open")) closeDocked();
    else openDocked();
  }

  // ── 启动 ──────────────────────────────────────────────────────────

  function boot() {
    try {
      mountWithRetry();

      // 界面变化（包括原生侧边栏开合）时：补按钮 + 重新对齐布局。
      var scheduled = false;
      var observer = new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        setTimeout(function () {
          scheduled = false;
          try {
            if (!document.querySelector('[data-agv="btn"]')) mountButton();
            if (drawer && drawer.root.hasAttribute("data-open")) syncLayout();
          } catch (e) {
            /* ignore */
          }
        }, 250);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      window.addEventListener("resize", function () {
        try {
          if (drawer && drawer.root.hasAttribute("data-open")) applyWidth(state.width, false);
        } catch (e) {
          /* ignore */
        }
      });

      setTimeout(function () {
      }, 2500);
    } catch (e) {
      /* 整个面板失效也好过影响应用 */
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
