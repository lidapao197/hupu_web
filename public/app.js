/* 虎扑网页版 · 前端脚本：主题切换 + 加载更多（其余全部由服务端渲染） */
(function () {
  "use strict";

  /* ============ 主题切换 ============ */

  var root = document.documentElement;
  var themeBtn = document.getElementById("themeBtn");
  var themePanel = document.getElementById("themePanel");
  var modeBtn = document.getElementById("modeBtn");
  var topbar = document.getElementById("topbar");

  function syncThemePanel() {
    if (!themePanel) return;
    var accent = root.dataset.accent || "red";
    themePanel.querySelectorAll(".swatch").forEach(function (sw) {
      sw.classList.toggle("active", sw.dataset.accent === accent);
    });
    var dark = root.dataset.theme === "dark";
    if (modeBtn) modeBtn.setAttribute("aria-checked", dark ? "true" : "false");
  }
  syncThemePanel();

  function store(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* 隐私模式下忽略 */ }
  }

  if (themeBtn && themePanel) {
    themeBtn.addEventListener("click", function () {
      var open = themePanel.hidden;
      themePanel.hidden = !open;
      themeBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("mousedown", function (e) {
      if (themePanel.hidden || !topbar) return;
      if (!topbar.contains(e.target)) {
        themePanel.hidden = true;
        themeBtn.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !themePanel.hidden) {
        themePanel.hidden = true;
        themeBtn.setAttribute("aria-expanded", "false");
      }
    });

    themePanel.addEventListener("click", function (e) {
      var sw = e.target.closest(".swatch");
      if (sw) {
        root.dataset.accent = sw.dataset.accent;
        store("hp-accent", sw.dataset.accent);
        syncThemePanel();
        return;
      }
      if (e.target.closest("#modeBtn")) {
        var dark = root.dataset.theme !== "dark";
        root.dataset.theme = dark ? "dark" : "light";
        store("hp-theme", dark ? "dark" : "light");
        syncThemePanel();
      }
    });
  }

  /* ============ 返回顶部 ============ */

  var backTopBtn = document.getElementById("backTopBtn");
  if (backTopBtn) {
    var syncBackTop = function () {
      backTopBtn.classList.toggle("show", window.scrollY > 480);
    };
    window.addEventListener("scroll", syncBackTop, { passive: true });
    syncBackTop();
    backTopBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ============ 返回上一页（帖子页左下角） ============ */

  var backPrevBtn = document.getElementById("backPrevBtn");
  if (backPrevBtn) {
    backPrevBtn.addEventListener("click", function () {
      // 直接打开链接（没有站内历史）时退回首页，避免点了没反应
      if (window.history.length > 1) window.history.back();
      else window.location.href = "/";
    });
  }

  /* ============ 加载更多 ============ */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c];
    });
  }

  var LIGHT_ICON =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3zm0 0 4.2-7.4a1.8 1.8 0 0 1 3.3 1.2L13.8 8H19a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.6 19H7"/></svg>';
  var REPLY_ICON =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z"/></svg>';

  /* 与服务端 lib/render.js 的同名模板保持一致 */
  function fmtNum(v) {
    var n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[^\d.]/g, ""));
    if (isNaN(n)) return String(v == null ? "" : v);
    if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
    if (n >= 10000) return (n / 10000).toFixed(1) + "万";
    return String(n);
  }

  function fmtPostTime(t) {
    var s = String(t == null ? "" : t).trim();
    if (!s) return "";
    return /^\d{1,2}:\d{2}$/.test(s) ? "今天 " + s : s;
  }

  function feedCardHtml(p) {
    var thumbs = (p.images || []).slice(0, 3);
    var labelHtml = p.label && p.isHot ? '<span class="post-label hot">' + esc(p.label) + "</span>" : "";
    var srcHtml = p.isNews ? '<span class="post-src">虎扑资讯</span>' : p.author ? '<span class="post-src">' + esc(p.author) + "</span>" : "";
    return '<a class="post" href="/thread/' + p.tid + '">' +
      (labelHtml || srcHtml ? '<div class="post-top">' + labelHtml + srcHtml + "</div>" : "") +
      '<div class="post-title">' + esc(p.title) + "</div>" +
      (thumbs.length
        ? '<div class="post-thumbs' + (thumbs.length === 1 ? " single" : "") + '">' +
          thumbs.map(function (s) {
            return '<img src="' + esc(s) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
          }).join("") + "</div>"
        : "") +
      '<div class="post-meta">' +
      (p.time ? '<span class="m time">' + esc(fmtPostTime(p.time)) + "</span>" : "") +
      (p.isVideo ? '<span class="m">视频</span>' : "") +
      '<span class="m light">' + LIGHT_ICON + fmtNum(p.lights) + "</span>" +
      '<span class="m">' + REPLY_ICON + fmtNum(p.replies) + "</span>" +
      "</div></a>";
  }

  function zonePostRowHtml(p) {
    return '<a class="post post-row" href="/thread/' + p.tid + '">' +
      '<div class="post-title">' + esc(p.title) + "</div>" +
      '<div class="post-meta">' +
      '<span class="m">' + esc(p.username) + "</span>" +
      (p.time && p.time !== "刚刚" ? '<span class="m time">' + esc(p.time) + "</span>" : "") +
      (p.isVideo ? '<span class="m">视频</span>' : "") +
      (p.isVote ? '<span class="m">投票</span>' : "") +
      '<span class="m light">' + REPLY_ICON + esc(p.replies) + "</span>" +
      '<span class="m light">' + LIGHT_ICON + esc(p.recommendNum) + "</span>" +
      "</div></a>";
  }

  function commentHtml(c) {
    var av = c.avatar
      ? '<img class="avatar" src="' + esc(c.avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="avatar" style="display:grid;place-items:center;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-light));font-size:14px">' + esc((c.username || "虎")[0]) + "</span>";
    var lightOn = c.light > 0;
    return '<div class="comment">' + av +
      '<div class="comment-body"><div class="comment-head">' +
      '<span class="c-name">' + esc(c.username) + "</span>" +
      (c.isLz ? '<span class="tag-lz">楼主</span>' : "") +
      '<span class="c-sub">' + esc(c.time) + (c.location ? " · " + esc(c.location) : "") + "</span>" +
      '<span class="c-light' + (lightOn ? " on" : "") + '">' + LIGHT_ICON + (lightOn ? esc(c.light) : "亮了") + "</span>" +
      "</div>" +
      (c.quote
        ? '<div class="c-quote">' +
          (c.quote.username ? '<span class="q-name">' + esc(c.quote.username) + "：</span>" : "") +
          "<span>" + (c.quote.content || "") + "</span></div>"
        : "") +
      '<div class="comment-content">' + c.content + "</div>" +
      "</div></div>";
  }

  function scoreCommentHtml(c) {
    var av = c.avatar
      ? '<img class="avatar" src="' + esc(c.avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="avatar" style="display:grid;place-items:center;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-light));font-size:14px">' + esc((c.user || "J")[0]) + "</span>";
    return '<div class="cmt" data-id="' + esc(c.id) + '">' + av +
      '<div class="cmt-body">' +
      '<div class="cmt-head">' +
      '<span class="c-name">' + esc(c.user) + "</span>" +
      (c.score > 0 ? '<span class="cmt-score">' + esc(c.score) + " 分</span>" : "") +
      '<span class="c-sub">' + esc(c.date) + (c.ip ? " · " + esc(c.ip) : "") + "</span>" +
      "</div>" +
      '<div class="comment-content">' + esc(c.content) + "</div>" +
      (c.images && c.images.length
        ? '<div class="cmt-imgs">' + c.images.map(function (s) {
            return '<img src="' + esc(s) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
          }).join("") + "</div>"
        : "") +
      '<div class="cmt-foot">' +
      '<span class="m light">' + LIGHT_ICON + fmtNum(c.lights) + "</span>" +
      (c.subCount ? '<span class="m">' + REPLY_ICON + fmtNum(c.subCount) + "</span>" : "") +
      "</div></div></div>";
  }

  function bindLoadMore(btn, getListContainer) {
    if (!btn) return;
    var kind = btn.dataset.kind;
    var page = parseInt(btn.dataset.page || "1", 10);
    var loading = false;

    btn.addEventListener("click", function () {
      if (loading) return;
      loading = true;
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = "加载中…";

      var url;
      if (kind === "zone") {
        url = "/api/zone-posts?topicId=" + btn.dataset.topicId +
          "&page=" + (page + 1) + "&cursor=" + encodeURIComponent(btn.dataset.cursor || "");
      } else if (kind === "zone-desk") {
        url = "/api/zone-posts-desk?topicId=" + btn.dataset.topicId +
          "&sort=" + encodeURIComponent(btn.dataset.sort || "") +
          "&page=" + (page + 1);
      } else if (kind === "home") {
        url = "/api/home-more?before=" + encodeURIComponent(btn.dataset.before || "");
      } else if (kind === "score") {
        url = "/api/score-comments?type=" + encodeURIComponent(btn.dataset.type || "") +
          "&no=" + encodeURIComponent(btn.dataset.no || "") +
          "&cursor=" + encodeURIComponent(btn.dataset.cursor || "0");
      } else {
        url = "/api/replies?tid=" + btn.dataset.tid + "&page=" + (page + 1);
      }

      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var container = getListContainer();
          var items = kind === "replies" ? d.replies || [] : d.comments || d.posts || [];
          var rawCount = items.length;
          if (kind === "score") {
            // 去重：热评已置顶展示，翻页时跳过页面上已有的评论（热门区 + 最新区）
            var seen = {};
            var els = document.querySelectorAll(".cmt[data-id]");
            for (var i = 0; i < els.length; i++) seen[els[i].getAttribute("data-id")] = 1;
            items = items.filter(function (c) { return !seen[c.id]; });
          }
          var render = kind === "zone" || kind === "zone-desk" ? zonePostRowHtml
            : kind === "home" ? feedCardHtml
            : kind === "score" ? scoreCommentHtml
            : commentHtml;
          var html = items.map(render).join("");
          container.insertAdjacentHTML("beforeend", html);
          page += 1;
          btn.dataset.page = String(page);
          btn.dataset.cursor = d.nextCursor || "";
          if (kind === "home" && items.length) {
            btn.dataset.before = String(items[items.length - 1].tid);
          }
          if (kind === "score") {
            btn.dataset.cursor = String(d.cursor || 0);
          }

          var done;
          if (kind === "zone") {
            done = !d.nextCursor;
          } else if (kind === "zone-desk") {
            done = !!d.done || items.length === 0;
          } else if (kind === "home") {
            done = !!d.done || items.length === 0;
          } else if (kind === "score") {
            // 用去重前的条数判断，整页恰好都与热评重复时不误报「到底」
            done = !d.hasMore || rawCount === 0;
          } else {
            var known = parseInt(btn.dataset.knownCount || "0", 10);
            done = items.length < 20 || page * 20 >= known;
          }

          if (done) {
            var tip = document.createElement("p");
            tip.className = "empty";
            tip.textContent = "已经到底啦";
            btn.replaceWith(tip);
          } else {
            btn.textContent = label;
            btn.disabled = false;
          }
          loading = false;
        })
        .catch(function () {
          btn.textContent = label;
          btn.disabled = false;
          loading = false;
        });
    });
  }

  bindLoadMore(document.getElementById("loadMoreBtn"), function () {
    return document.getElementById("feed");
  });
  bindLoadMore(document.getElementById("homeMoreBtn"), function () {
    return document.getElementById("homeFeed");
  });
  bindLoadMore(document.getElementById("scoreMoreBtn"), function () {
    return document.getElementById("scoreCommentList");
  });
  bindLoadMore(document.getElementById("loadRepliesBtn"), function () {
    return document.getElementById("commentList");
  });
})();
