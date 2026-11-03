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

  /* DSH 把当前会话选择持久化在 localStorage 的这个键里（createSnapshotStore）。 */
  var SESSION_KEY = "dsh.sessions.current";
  var SESSION_RE = /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  /* 面板开着时会话可能被切走；200ms 一次只读一个几十字节的键，开销可以忽略。 */
  var SESSION_POLL_MS = 200;

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

  /**
   * 当前会话 id。优先读 DSH 持久化的选择（同步、零请求），
   * 读不到再从页面 URL 里找；都没有就返回 null，交给宿主兜底。
   */
  function readSessionId() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var id = parsed && parsed.sessionId;
        if (typeof id === "string" && SESSION_RE.test(id)) return id;
      }
    } catch (e) {
      /* 存储不可用 */
    }
    var match = SESSION_RE.exec(String(location.href || ""));
    return match ? match[0] : null;
  }

  /**
   * 请求宿主时带的 hint：有会话 id 就传它，宿主据此精确解析工作区；
   * 没有才退回原来的 URL 推断。
   */
  function hintValue() {
    return readSessionId() || location.href;
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
    var side = sideEl ? Math.round(sideEl.getBoundingClientRect().width) : 0;
    if (drawer.__side === side) return;
    drawer.__side = side;
    drawer.root.style.right = side + "px";
    drawer.backdrop.style.right = side + "px";
  }





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

var state = { files: [], current: null, loaded: "", dirty: false, saving: false, width: loadWidth(), sessionId: null, project: "", projectSource: "" };
var listSeq = 0;
var readSeq = 0;

  var drawer = null;

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
    stopSessionWatch();
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
    var inferred = data.source !== "session";
    drawer.meta.appendChild(el("span", TAG + "-meta-label", inferred ? "推断项目" : "项目"));
    var value = el("span", TAG + "-meta-path", data.project || "未知");
    value.title = (data.project || "") + (inferred ? "\n（推断，保存前请确认）" : "");
    drawer.meta.appendChild(value);
    if (inferred) {
      var note = el("span", TAG + "-meta-ver", "推断");
      note.title = state.sessionId
        ? "当前会话没有在 workspace.json 里登记，按最近使用的工作区推断；保存前请确认"
        : "页面拿不到当前会话，按最近使用的工作区推断；保存前请确认";
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
    var seq = ++readSeq;
    getJson(BASE + "/read?path=" + encodeURIComponent(file.path) + "&hint=" + encodeURIComponent(hintValue()))
      .then(function (res) {
        if (seq !== readSeq) return;
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
    if (state.projectSource !== "session") {
      var where = state.project || "未知项目";
      if (!window.confirm("当前项目是推断的：\n" + where + "\n\n确定写入这个项目的 AGENTS.md？")) return;
    }
    state.saving = true;
    refreshFoot();
    postJson(BASE + "/write", { path: state.current.path, content: drawer.editor.value, hint: hintValue() })
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

  var sessionWatch = 0;

  function stopSessionWatch() {
    if (sessionWatch) {
      clearInterval(sessionWatch);
      sessionWatch = 0;
    }
  }

  function syncSession() {
    if (!drawer || !drawer.root.hasAttribute("data-open")) return;
    var id = readSessionId();
    if (id === state.sessionId) return;
    state.sessionId = id;
    if (state.dirty) {
      state.projectSource = "stale";
      drawer.status.textContent = "会话已切换，未保存改动仍在；保存前请确认项目";
      return;
    }
    afterOpen();
  }

  function startSessionWatch() {
    stopSessionWatch();
    sessionWatch = setInterval(syncSession, SESSION_POLL_MS);
  }

  function onStorage(e) {
    if (e.key === SESSION_KEY) syncSession();
  }

  window.addEventListener("storage", onStorage);

  function afterOpen() {
    if (!drawer) drawer = buildDrawer();
    drawer.root.setAttribute("data-open", "1");
    state.sessionId = readSessionId();
    state.project = "";
    state.projectSource = "";
    /* backdrop stays hidden while docked so the composer keeps working */
    applyWidth(state.width, false);
    syncLayout();
    startSessionWatch();
    drawer.status.textContent = "加载中…";
    var seq = ++listSeq;
    readSeq++;
    getJson(BASE + "/list?hint=" + encodeURIComponent(hintValue()))
      .then(function (data) {
        if (seq !== listSeq) return;
        if (!data.ok) {
          drawer.status.textContent = data.error || "加载失败";
          return;
        }
        state.files = data.files || [];
        state.project = data.project || "";
        state.projectSource = data.source || "";
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
  // 侧栏左边界：从"收起右侧边栏"按钮出发取最内层列容器，再把贴在它左边的分隔条算进来。

  function sidebarLeft() {
    try {
      var b = document.querySelector('[aria-label="\u6536\u8d77\u53f3\u4fa7\u8fb9\u680f"]');
      if (!b) return 0;
      var vw = window.innerWidth;
      var br = b.getBoundingClientRect();
      if (br.width < 4 || br.left > vw - 4) return 0;
      // 一直往上走，取最外层但仍"像一列"的容器（宽度不超过窗口 85%）
      var left = 0;
      var n = b;
      while (n && n !== document.body) {
        var r = n.getBoundingClientRect();
        if (r.height >= 250 && r.width >= 280 && r.width < vw * 0.85) {
          left = Math.round(r.left);
        }
        n = n.parentElement;
      }
      return left;
    } catch (e) {
      return 0;
    }
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
  var dockOpenedAt = 0;

  // 面板顶部的可见诊断：把量到的数值写出来，方便截图排查。

  function syncDock() {
    if (!drawer || !drawer.root.hasAttribute("data-open")) return;
    var left = sidebarLeft();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var dock = left > 0;
    var settling = (Date.now() - dockOpenedAt) < 1200;
    var sig = settling ? '' : ((dock ? 'd' : 'o') + ':' + left + ':' + vw + ':' + vh);
    if (sig !== "" && sig === lastSig) return;
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
      drawer.root.removeAttribute('data-pending');
      return;
    }
    drawer.root.setAttribute("data-dock", "1");
    drawer.root.style.right = "auto";
    // 让出分隔条本身（约 6px），保留 DSH 原生分界线的蓝色 hover
    var lead = 6;
    drawer.root.style.left = (left + lead) + "px";
    drawer.root.style.top = "0px";
    drawer.root.style.width = Math.max(120, vw - left - lead) + "px";
    drawer.root.style.height = vh + "px";
    drawer.root.removeAttribute('data-pending');
  }



  function openDocked() {
    dockOpenedAt = Date.now();
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
    stopSessionWatch();
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
