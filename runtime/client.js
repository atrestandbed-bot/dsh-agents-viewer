/**
 * dsh-agents-viewer — 右侧栏原生 AGENTS.md tab。
 *
 * 客户端插件（window.__ModuleLoader__ 格式，手写、无构建步骤）：
 *   - ctx.sidebarRightTabs.register 注册页面类型 "agents"
 *   - sidebar.right.pane.tab 槽挂正文
 *   - 正文通过宿主 /dsh-agents-viewer/* 路由读写指令文件
 *
 * 当前会话由槽的标准 props 直接给出（sessionId / useSessions），
 * 不再从 URL、DOM 或 workspace.json 猜项目。
 */
window.__ModuleLoader__.load({
  id: "dsh-agents-viewer",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;

    var VIEW_ID = "dsh-agents-viewer";
    var VIEW_KIND = "agents";
    var API = "/dsh-agents-viewer";
    var openAgentsTab = null;

    var CSS_ID = "dsh-agents-viewer/tab.css";
    var CSS = [
      ".agv2-root{height:100%;min-height:0;min-width:0;width:100%;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5;display:flex;flex-direction:column;font-family:ui-monospace,'Geist Mono',Menlo,Consolas,monospace}",
      ".agv2-head{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:8px;min-height:38px;padding:0 10px 0 16px;display:flex}",
      ".agv2-path{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}",
      ".agv2-badge{flex:none;border-radius:999px;padding:1px 7px;font-size:11px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
      ".agv2-tool{height:28px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;padding:0 8px;flex:none}",
      ".agv2-tool:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
      ".agv2-tool:disabled{opacity:.45;cursor:default}",
      ".agv2-list{flex:none;max-height:38%;min-height:72px;overflow:auto;border-bottom:.5px solid var(--dsw-alias-border-l3);padding:6px}",
      ".agv2-row{width:100%;min-width:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer;align-items:center;gap:6px;padding:5px 8px;display:flex}",
      ".agv2-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".agv2-row[data-active]{background:var(--dsw-alias-interactive-bg-hover)}",
      ".agv2-row[data-missing]{opacity:.55}",
      ".agv2-scope{flex:none;width:38px;color:var(--dsw-alias-label-tertiary);font-size:11px}",
      ".agv2-label{flex:none;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}",
      ".agv2-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".agv2-size{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}",
      ".agv2-empty{color:var(--dsw-alias-label-tertiary);padding:8px 10px;font-size:12px}",
      ".agv2-editor{box-sizing:border-box;flex:1;min-height:0;min-width:0;width:100%;border:0;outline:none;background:0 0;color:inherit;font:inherit;line-height:1.6;padding:10px 14px;resize:none;tab-size:2;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;overflow-x:hidden;overflow-y:auto}",
      ".agv2-editor::placeholder{color:var(--dsw-alias-label-tertiary)}",
      ".agv2-foot{box-sizing:border-box;border-top:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:8px;min-height:36px;padding:0 10px 0 16px;display:flex}",
      ".agv2-status{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11.5px}",
      ".agv2-save{flex:none;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;padding:5px 12px}",
      ".agv2-save:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".agv2-save:disabled{opacity:.45;cursor:default}",
      ".agv3-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;vertical-align:middle;transition:color 120ms ease,background-color 120ms ease}",
      ".agv3-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
      ".agv3-btn:active{background:var(--dsw-alias-interactive-bg-hover)}",
      ".agv3-btn svg{display:block}",
    ].join("");

    if (
      typeof document !== "undefined" &&
      document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_ID) + "]") === null
    ) {
      var tag = document.createElement("style");
      tag.dataset.plugin = VIEW_ID;
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function getJson(url) {
      return fetch(url, { cache: "no-store" }).then(function (response) {
        return response.json();
      });
    }

    function postJson(url, body) {
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(function (response) {
        return response.json();
      });
    }

    function formatSize(bytes) {
      var size = Number(bytes) || 0;
      if (size < 1024) return size + " B";
      return (size / 1024).toFixed(1) + " KB";
    }

    function baseName(filePath) {
      var parts = String(filePath).split(/[\\/]/);
      return parts[parts.length - 1] || String(filePath);
    }

    // 头部按钮的显示状态在页面加载时从宿主 /ui 读一次；
    // /agents o|c 只改持久化状态，下次启动/刷新后按新状态显示。
    /**
     * Tab 正文。槽直接给 sessionId / useSessions，所以这里拿到的 cwd 是
     * 当前会话的真实工作区，不需要任何推断。
     */
    function AgentsBody(props) {
      var sessionId = props.sessionId;
      var useSessions = props.useSessions;
      var cwd = useSessions(function (sessions) {
        var row = sessions && sessions.byId ? sessions.byId[sessionId] : void 0;
        return row && row.cwd ? row.cwd : void 0;
      });

      var filesState = React.useState([]);
      var files = filesState[0];
      var setFiles = filesState[1];

      var currentState = React.useState(null);
      var current = currentState[0];
      var setCurrent = currentState[1];

      var textState = React.useState("");
      var text = textState[0];
      var setText = textState[1];

      var loadedState = React.useState("");
      var loaded = loadedState[0];
      var setLoaded = loadedState[1];

      var statusState = React.useState("");
      var status = statusState[0];
      var setStatus = statusState[1];

      var metaState = React.useState({ project: "", source: "" });
      var meta = metaState[0];
      var setMeta = metaState[1];

      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];

      var loadingState = React.useState(false);
      var loading = loadingState[0];
      var setLoading = loadingState[1];

      var listSeq = React.useRef(0);
      var readSeq = React.useRef(0);
      var dirty = text !== loaded;

      function hint() {
        return sessionId || "";
      }

      function selectFile(file) {
        var mine = ++readSeq.current;
        setCurrent(file);
        setText("");
        setLoaded("");
        setStatus("读取中…");
        getJson(
          API +
            "/read?path=" +
            encodeURIComponent(file.path) +
            "&hint=" +
            encodeURIComponent(hint()),
        )
          .then(function (res) {
            if (mine !== readSeq.current) return;
            if (!res.ok) {
              setStatus(res.error || "读取失败");
              return;
            }
            setText(res.content || "");
            setLoaded(res.content || "");
            setStatus(res.exists ? "已加载" : "新文件");
          })
          .catch(function (error) {
            if (mine === readSeq.current) setStatus("读取失败：" + error);
          });
      }

      function loadList() {
        var mine = ++listSeq.current;
        readSeq.current++;
        setLoading(true);
        setStatus("加载中…");
        getJson(API + "/list?hint=" + encodeURIComponent(hint()))
          .then(function (res) {
            if (mine !== listSeq.current) return;
            setLoading(false);
            if (!res.ok) {
              setStatus(res.error || "加载失败");
              return;
            }
            var list = res.files || [];
            setFiles(list);
            setMeta({ project: res.project || "", source: res.source || "" });
            var first = null;
            for (var i = 0; i < list.length; i++) {
              if (list[i].exists) {
                first = list[i];
                break;
              }
            }
            if (!first && list.length) first = list[0];
            if (first) selectFile(first);
            else {
              setCurrent(null);
              setStatus("没有可用文件");
            }
          })
          .catch(function (error) {
            if (mine !== listSeq.current) return;
            setLoading(false);
            setStatus("加载失败：" + error);
          });
      }

      React.useEffect(
        function () {
          loadList();
          return function () {
            listSeq.current++;
            readSeq.current++;
          };
        },
        [sessionId],
      );

      function save() {
        if (!current || busy) return;
        if (
          meta.source !== "session" &&
          !window.confirm(
            "当前项目是推断的：\n" + (meta.project || "未知") + "\n\n确定写入这个项目的 AGENTS.md？",
          )
        ) {
          return;
        }
        var payload = text;
        setBusy(true);
        setStatus("保存中…");
        postJson(API + "/write", { path: current.path, content: payload, hint: hint() })
          .then(function (res) {
            setBusy(false);
            if (!res.ok) {
              setStatus(res.error || "保存失败");
              return;
            }
            setLoaded(payload);
            setFiles(function (prev) {
              return prev.map(function (file) {
                return file.path === current.path
                  ? Object.assign({}, file, { exists: true, size: res.size || file.size })
                  : file;
              });
            });
            var d = new Date();
            var pad = function (n) {
              return ("0" + n).slice(-2);
            };
            setStatus("已保存 " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()));
          })
          .catch(function (error) {
            setBusy(false);
            setStatus("保存失败：" + error);
          });
      }

      var rows = files.map(function (file) {
        var label = file.scope === "子目录" ? file.label : "";
        return h(
          "button",
          {
            key: file.path,
            type: "button",
            className: "agv2-row",
            "data-active": current && current.path === file.path ? "1" : void 0,
            "data-missing": file.exists ? void 0 : "1",
            title: file.path,
            onClick: function () {
              selectFile(file);
            },
          },
          h("span", { className: "agv2-scope" }, file.scope || ""),
          label ? h("span", { className: "agv2-label" }, label + "/") : null,
          h("span", { className: "agv2-name" }, baseName(file.path)),
          h("span", { className: "agv2-size" }, file.exists ? formatSize(file.size) : "不存在"),
        );
      });

      return h(
        "div",
        { className: "agv2-root" },
        h(
          "div",
          { className: "agv2-head" },
          h(
            "span",
            { className: "agv2-path", title: meta.project || cwd || "" },
            meta.project || cwd || "未知项目",
          ),
          meta.source !== "session"
            ? h(
                "span",
                {
                  className: "agv2-badge",
                  title: "没有拿到精确会话，按最近工作区推断；保存前会确认",
                },
                "推断",
              )
            : null,
          h(
            "button",
            { className: "agv2-tool", type: "button", onClick: loadList, disabled: loading },
            loading ? "…" : "刷新",
          ),
        ),
        h(
          "div",
          { className: "agv2-list" },
          rows.length ? rows : h("div", { className: "agv2-empty" }, loading ? "加载中…" : "没有找到 AGENTS.md"),
        ),
        h("textarea", {
          className: "agv2-editor",
          value: text,
          spellCheck: false,
          wrap: "soft",
          placeholder: "这个文件还不存在。写入内容后点保存就会创建。",
          onChange: function (event) {
            setText(event.target.value);
            if (!busy) setStatus("");
          },
          onKeyDown: function (event) {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              save();
            }
          },
        }),
        h(
          "div",
          { className: "agv2-foot" },
          h("span", { className: "agv2-status" }, status || (dirty ? "未保存" : "")),
          h(
            "button",
            {
              className: "agv2-save",
              type: "button",
              onClick: save,
              disabled: !dirty || busy || !current,
            },
            busy ? "保存中…" : "保存",
          ),
        ),
      );
    }

    /**
     * 聊天头部的 AGENTS.md 按钮。挂在 conversation.session.header.utilities
     * （list 槽）里，位置在文件/右侧栏按钮那一簇的左边；点击直接开原生 tab。
     */
    function AgentsHeaderButton() {
      var visibleState = React.useState(true);
      var visible = visibleState[0];
      var setVisible = visibleState[1];

      // 只在加载时读一次；/agents o|c 的改动下次启动/刷新生效。
      React.useEffect(function () {
        var alive = true;
        fetch(API + "/ui", { cache: "no-store" })
          .then(function (response) {
            return response.json();
          })
          .then(function (res) {
            if (alive && res && res.ok) setVisible(res.button !== false);
          })
          .catch(function () {
            /* 读不到就按默认显示 */
          });
        return function () {
          alive = false;
        };
      }, []);

      if (!visible) return null;

      return h(
        "button",
        {
          type: "button",
          className: "agv3-btn",
          title: "AGENTS.md（点击打开）",
          "aria-label": "AGENTS.md",
          "data-agv": "header-button",
          onClick: function () {
            try {
              if (typeof openAgentsTab === "function") openAgentsTab();
            } catch (error) {
              console.error("dsh-agents-viewer: open tab failed", error);
            }
          },
        },
        h(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 15,
            height: 15,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.3,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
          },
          h("path", { d: "M4 1.8h5.2L12.2 5v9.2H4z" }),
          h("path", { d: "M9 1.8V5h3.2" }),
          h("path", { d: "M6 8h4M6 10.4h4" }),
        ),
      );
    }

    function definition() {
      return {
        id: VIEW_ID,
        kind: VIEW_KIND,
        priority: "extension",
        keepMounted: true,
        title: function () {
          return "AGENTS.md";
        },
        guide: [
          {
            id: "agents",
            order: 20,
            title: function () {
              return "AGENTS.md";
            },
            description: function () {
              return "查看并编辑全局、共享与项目级指令文件";
            },
          },
        ],
      };
    }

    var inject = ["slots", "sidebarRightTabs", "sidebarRight"];

    function apply(ctx) {
      openAgentsTab = function () {
        ctx.sidebarRight.openTab("agents");
      };

      ctx.effect(function () {
        return ctx.sidebarRightTabs.register(definition());
      }, "dsh-agents-viewer: tab type");

      ctx.effect(function () {
        return ctx.slots.inject("sidebar.right.pane.tab", function () {
          return ctx.slots.register(
            {
              name: "sidebar.right.pane.tab",
              key: VIEW_ID,
            },
            AgentsBody,
          );
        });
      }, "dsh-agents-viewer: tab body");

      ctx.effect(function () {
        return ctx.slots.inject("conversation.session.header.utilities", function () {
          return ctx.slots.register(
            {
              name: "conversation.session.header.utilities",
              id: "agents-open",
              order: -100,
            },
            AgentsHeaderButton,
          );
        });
      }, "dsh-agents-viewer: header button");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
