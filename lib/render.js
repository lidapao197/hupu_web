/**
 * 纯 HTML 模板层 — 全部为模板字符串，输出即所见的 HTML
 * 类名与 public/style.css（移植自 simple_web 视觉系统）一一对应
 */

import { statSync } from "node:fs";
import { BIZ_TAGS } from "./match.js";

/**
 * 静态资源版本号 = 文件 mtime（36 进制），改文件自动失效，不用手动 bump
 * （配合 server.js 的 30 天 immutable 缓存）
 */
const ASSET_VER = new Map();
function assetVer(file) {
  let v = ASSET_VER.get(file);
  if (!v) {
    try {
      v = Math.floor(statSync(new URL(`../public/${file}`, import.meta.url)).mtimeMs).toString(36);
    } catch {
      v = "0";
    }
    ASSET_VER.set(file, v);
  }
  return v;
}

const THEME_INIT = `(function(){try{
var t=localStorage.getItem("hp-theme");
var theme=t||(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");
document.documentElement.dataset.theme=theme;
var a=localStorage.getItem("hp-accent");
if(a)document.documentElement.dataset.accent=a;
}catch(e){}})();`;

/** 顶部导航：资讯 / 电竞资讯 / 赛程 / 英雄联盟（activeNav 用于高亮当前页） */
const NAV_ITEMS = [
  ["/", "虎扑", "news"],
  ["/zhibo8", "直播吧", "esports"],
  ["/zone/85", "英雄联盟", "lol"],
  ["/matches", "赛程", "match"],
];

const ACCENTS = [
  ["red", "#e5484d"], ["green", "#00a76e"], ["blue", "#2f7cf6"], ["purple", "#7c5cff"],
  ["orange", "#ef8a3c"], ["pink", "#ec4899"], ["cyan", "#0891b2"], ["indigo", "#5b5bd6"],
  ["lime", "#65a30d"], ["teal", "#0d9488"],
];

/* ---------- 基础工具 ---------- */

export function esc(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c],
  );
}

export function fmtNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.]/g, ""));
  if (Number.isNaN(n)) return String(v);
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

const LIGHT_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3zm0 0 4.2-7.4a1.8 1.8 0 0 1 3.3 1.2L13.8 8H19a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.6 19H7"/></svg>';

const REFRESH_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/></svg>';

const REPLY_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z"/></svg>';

function avatar(src, name) {
  if (src) {
    return `<img class="avatar" src="${esc(src)}" alt="${esc(name)}" loading="lazy" referrerpolicy="no-referrer">`;
  }
  return `<span class="avatar" style="display:grid;place-items:center;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-light));font-size:14px">${esc((name || "虎")[0])}</span>`;
}

/* ---------- 全局布局 ---------- */

export function layout({ title, body, activeNav = null }) {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light" data-accent="red">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<!-- 虎扑 CDN 拒绝 Referer=localhost（403），全站外链图片一律不带 Referer -->
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg?v=${assetVer("icon.svg")}">
<link rel="stylesheet" href="/style.css?v=${assetVer("style.css")}">
<script>${THEME_INIT}</script>
</head>
<body>

<div class="bg-blob blob-a" aria-hidden="true"></div>
<div class="bg-blob blob-b" aria-hidden="true"></div>
<div class="bg-blob blob-c" aria-hidden="true"></div>

<nav class="topnav">
  <div class="topnav-inner">
    <a class="logo" href="/">
      <span class="logo-badge">虎</span>
      <span>虎扑 <em>网页版</em></span>
    </a>
    <div class="nav-zones" role="navigation" aria-label="导航">
      ${NAV_ITEMS.map(
        ([href, name, key]) =>
          `<a class="nav-chip${activeNav === key ? " active" : ""}" href="${href}">${esc(name)}</a>`,
      ).join("")}
    </div>
    <div class="topbar" id="topbar">
      <button class="theme-btn" id="themeBtn" type="button" aria-haspopup="dialog" aria-expanded="false" title="主题与颜色">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="8.4"/><circle cx="9.1" cy="9.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="14.8" cy="9" r="1.35" fill="currentColor" stroke="none"/><circle cx="8.6" cy="14.6" r="1.35" fill="currentColor" stroke="none"/></svg>
      </button>
      <div class="theme-panel" id="themePanel" role="dialog" aria-label="主题与颜色" hidden>
        <p class="panel-title">主题颜色</p>
        <div class="swatches" id="swatches">
          ${ACCENTS.map(([key, color]) => `<button class="swatch" type="button" data-accent="${key}" style="background:${color};color:${color}" title="${key}" aria-label="主题色 ${key}"></button>`).join("")}
        </div>
        <div class="panel-divider"></div>
        <button class="mode-row" id="modeBtn" type="button" role="switch" aria-checked="false">
          <span>深色模式</span>
          <span class="switch" aria-hidden="true"><span class="knob"></span></span>
        </button>
      </div>
    </div>
  </div>
</nav>

${body}

<p class="foot-note">虎扑网页版雏形 · 数据来自虎扑公开页面接口 · 仅供学习交流，内容版权归虎扑及原作者所有</p>

<button class="back-top" id="backTopBtn" type="button" aria-label="返回顶部" title="返回顶部">
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
</button>

<script src="/app.js?v=${assetVer("app.js")}"></script>
</body>
</html>`;
}

/* ---------- 卡片组件（服务端初始渲染；客户端加载更多在 app.js 有对应模板） ---------- */

/** 虎扑详情页的时间只给「当天 HH:mm」，补上「今天」避免误读成跨天 */
export function fmtPostTime(t) {
  const s = String(t ?? "").trim();
  if (!s) return "";
  if (/^\d{1,2}:\d{2}$/.test(s)) return `今天 ${s}`;
  return s;
}

export function feedCard(post) {
  const thumbs = post.images.slice(0, 3);
  const labelHtml = post.label && post.isHot ? `<span class="post-label hot">${esc(post.label)}</span>` : "";
  const srcHtml = post.isNews
    ? '<span class="post-src">虎扑资讯</span>'
    : post.author
      ? `<span class="post-src">${esc(post.author)}</span>`
      : "";
  const topHtml = labelHtml || srcHtml ? `<div class="post-top">${labelHtml}${srcHtml}</div>` : "";
  return `<a class="post" href="/thread/${esc(post.tid)}">
  ${topHtml}
  <div class="post-title">${esc(post.title)}</div>
  ${
    thumbs.length
      ? `<div class="post-thumbs${thumbs.length === 1 ? " single" : ""}">${thumbs
          .map((src) => `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`)
          .join("")}</div>`
      : ""
  }
  <div class="post-meta">
    ${post.time ? `<span class="m time">${esc(fmtPostTime(post.time))}</span>` : ""}
    ${post.isVideo ? '<span class="m">视频</span>' : ""}
    <span class="m light">${LIGHT_ICON}${fmtNum(post.lights)}</span>
    <span class="m">${REPLY_ICON}${fmtNum(post.replies)}</span>
  </div>
</a>`;
}

export function zonePostRow(post) {
  // 手机端专区的 time 恒为「刚刚」，没有信息量，只有桌面端的 createdAtFormat 才显示
  const time = post.time && post.time !== "刚刚" ? `<span class="m time">${esc(post.time)}</span>` : "";
  return `<a class="post post-row" href="/thread/${post.tid}">
  <div class="post-title">${esc(post.title)}</div>
  <div class="post-meta">
    <span class="m">${esc(post.username)}</span>
    ${time}
    ${post.isVideo ? '<span class="m">视频</span>' : ""}
    ${post.isVote ? '<span class="m">投票</span>' : ""}
    <span class="m light">${REPLY_ICON}${fmtNum(post.replies)}</span>
    <span class="m light">${LIGHT_ICON}${fmtNum(post.recommendNum)}</span>
  </div>
</a>`;
}

export function commentView(c) {
  const lightOn = c.light > 0;
  return `<div class="comment">
  ${avatar(c.avatar, c.username)}
  <div class="comment-body">
    <div class="comment-head">
      <span class="c-name">${esc(c.username)}</span>
      ${c.isLz ? '<span class="tag-lz">楼主</span>' : ""}
      <span class="c-sub">${esc(c.time)}${c.location ? ` · ${esc(c.location)}` : ""}</span>
      <span class="c-light${lightOn ? " on" : ""}">${LIGHT_ICON}${lightOn ? c.light : "亮了"}</span>
    </div>
    ${
      c.quote
        ? `<div class="c-quote">${c.quote.username ? `<span class="q-name">${esc(c.quote.username)}：</span>` : ""}<span>${c.quote.content || ""}</span></div>`
        : ""
    }
    <div class="comment-content">${c.content}</div>
  </div>
</div>`;
}

function errorCard(msg, withHome) {
  return `<main class="stage">
  <div class="main-col" style="grid-column:1/-1">
    <section class="card">
      <p class="error-tip">${esc(msg)}</p>
      ${withHome ? '<p style="text-align:center;margin-top:10px"><a class="nav-chip" href="/">← 回首页</a></p>' : ""}
    </section>
  </div>
</main>`;
}

/* ---------- 赛程与评分组件 ---------- */

const STATUS_CLS = { COMPLETED: "ended", NOTSTARTED: "todo", PENDING: "todo" };

function scoreCls(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 8) return " hi";
  if (n <= 3) return " lo";
  return " mid";
}

const hasScore = (t) => t.score !== "" && t.score !== "-";

function logoImg(src, cls) {
  return src
    ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="${cls} ph" aria-hidden="true"></span>`;
}

/** 卡片底部只显示「多少人参与评分」：比赛级 scoreCountText（如「91.4万人评分」）优先 */
function scoreCountText(m) {
  return String(m.scoreText || (m.scoreItem?.count ?? "")).trim();
}

/** 侧栏用：一行「队标 队名 比分 : 比分 队名 队标」 */
export function matchRow(m) {
  const [a, b] = m.teams;
  const mid =
    a && b && hasScore(a) && hasScore(b)
      ? `<span class="ml-score"><b class="${a.win ? "win" : ""}">${esc(a.score)}</b><i>:</i><b class="${b.win ? "win" : ""}">${esc(b.score)}</b></span>`
      : '<span class="ml-score vs">VS</span>';

  return `<a class="match-row" href="/match/${esc(m.matchId)}">
  <div class="mr-head">
    <span class="mr-time">${esc(m.time)}</span>
    <span class="mr-league">${esc(m.league)}</span>
    <span class="mr-status ${STATUS_CLS[m.status] ?? "todo"}">${esc(m.statusDesc)}</span>
  </div>
  <div class="mr-line">
    <span class="ml-team">${logoImg(a?.logo, "ml-logo")}<span class="ml-name">${esc(a?.name || "待定")}</span></span>
    ${mid}
    <span class="ml-team away"><span class="ml-name">${esc(b?.name || "待定")}</span>${logoImg(b?.logo, "ml-logo")}</span>
  </div>
  ${scoreCountText(m) ? `<div class="mr-foot"><span>${esc(scoreCountText(m))}</span></div>` : ""}
</a>`;
}

/** 赛程页用：横向一行「图标 战队 比分 : 比分 战队 图标」（客队镜像排列） */
export function matchRowWide(m) {
  const [a, b] = m.teams;
  const both = a && b && hasScore(a) && hasScore(b);
  const ti = (t, away) => {
    if (!t) return "";
    const logo = logoImg(t.logo, "ti-logo");
    const name = `<span class="ti-name">${esc(t.name)}</span>`;
    const score = hasScore(t) ? `<b class="ti-score${t.win ? " win" : ""}">${esc(t.score)}</b>` : "";
    const inner = away ? score + name + logo : logo + name + score;
    return `<span class="ti${away ? " away" : ""}">${inner}</span>`;
  };

  return `<a class="match-row wide" href="/match/${esc(m.matchId)}">
  <span class="mr-time">${esc(m.time)}</span>
  <span class="mr-teams-inline">${ti(a, false)}<span class="ti-vs">${both ? ":" : "VS"}</span>${ti(b, true)}</span>
  <span class="mr-league">${esc(m.league)}</span>
  <span class="mr-status ${STATUS_CLS[m.status] ?? "todo"}">${esc(m.statusDesc)}</span>
  ${scoreCountText(m) ? `<span class="mr-score"><span class="ms-cnt">${esc(scoreCountText(m))}</span></span>` : '<span class="mr-score mr-none">—</span>'}
</a>`;
}

export function scheduleCard({ days }) {
  const body = days.length
    ? days
        .map(
          (d) => `<div class="sched-day">
    <div class="sd-date">${esc(d.dateBlock)}</div>
    ${d.matches.map(matchRow).join("")}
  </div>`,
        )
        .join("")
    : '<p class="error-tip">赛程获取失败，请稍后刷新重试</p>';

  return `<section class="card side-card">
  <header class="card-head">
    <span class="card-title">赛程 · 英雄联盟</span>
    <a class="card-more" href="/matches">全部 →</a>
  </header>
  ${body}
</section>`;
}

function scoreRow(item) {
  const kda = item.desc ? `<span class="sr-sub">${esc(item.desc)}</span>` : "";
  return `<a class="score-row" href="/score/${esc(item.bizType)}/${esc(item.bizNo)}">
  ${item.image ? logoImg(item.image, "sr-ava") : '<span class="sr-ava ph" aria-hidden="true"></span>'}
  <div class="sr-main">
    <span class="sr-name">${esc(item.name)}</span>
    ${kda}
  </div>
  ${item.champion ? logoImg(item.champion, "sr-champ") : ""}
  <span class="sr-score${scoreCls(item.score)}">${item.score > 0 ? item.score.toFixed(1) : "—"}</span>
  <span class="sr-cnt">${item.count > 0 ? fmtNum(item.count) : ""}</span>
</a>`;
}

function boBlock(g, match) {
  const byTeam = (id) => g.items.filter((i) => i.teamId && i.teamId === id);
  const home = byTeam(match.home.id);
  const away = byTeam(match.away.id);
  const other = g.items.filter((i) => !i.teamId || (i.teamId !== match.home.id && i.teamId !== match.away.id));

  const column = (team, items) =>
    items.length
      ? `<div class="bo-team">
    <div class="bt-head">
      ${logoImg(team.logo, "bt-logo")}
      <span class="bt-name">${esc(team.name)}</span>
      ${team.score ? `<b class="bt-score">${esc(team.score)}</b>` : ""}
    </div>
    ${items.map(scoreRow).join("")}
  </div>`
      : "";

  return `<section class="card bo-block">
  <header class="card-head">
    <span class="card-title">${esc(g.name)}</span>
    <span class="card-count">${g.items.length}</span>
  </header>
  <div class="bo-teams">${column(match.home, home)}${column(match.away, away)}</div>
  ${
    other.length
      ? `<div class="bo-other">
    <p class="bo-other-title">解说 / BP / 其他</p>
    ${other.map(scoreRow).join("")}
  </div>`
      : ""
  }
</section>`;
}

/* ---------- 单个评分条目页（评分分布 + 评论） ---------- */

export function scoreCommentView(c) {
  const badge = c.score > 0 ? `<span class="cmt-score">${c.score} 分</span>` : "";
  return `<div class="cmt" data-id="${esc(c.id)}">
  ${avatar(c.avatar, c.user)}
  <div class="cmt-body">
    <div class="cmt-head">
      <span class="c-name">${esc(c.user)}</span>
      ${badge}
      <span class="c-sub">${esc(c.date)}${c.ip ? ` · ${esc(c.ip)}` : ""}</span>
    </div>
    <div class="comment-content">${esc(c.content)}</div>
    ${
      c.images.length
        ? `<div class="cmt-imgs">${c.images
            .map((s) => `<img src="${esc(s)}" alt="" loading="lazy" referrerpolicy="no-referrer">`)
            .join("")}</div>`
        : ""
    }
    <div class="cmt-foot">
      <span class="m light">${LIGHT_ICON}${fmtNum(c.lights)}</span>
      ${c.subCount ? `<span class="m">${REPLY_ICON}${fmtNum(c.subCount)}</span>` : ""}
    </div>
  </div>
</div>`;
}

export function scoreItemPage({ item, hotComments = [], comments, hasMore, cursor }) {
  const dist = item.distribution || {};
  const sum = [2, 4, 6, 8, 10].reduce((n, k) => n + Number(dist[k] || 0), 0) || item.count || 1;
  const bars = [2, 4, 6, 8, 10]
    .map((k) => {
      const pct = Math.round((Number(dist[k] || 0) / sum) * 100);
      return `<div class="dist-row">
      <span class="dist-k">${k} 分</span>
      <span class="dist-bar"><i style="width:${pct}%"></i></span>
      <span class="dist-n">${pct}%</span>
    </div>`;
    })
    .join("");

  const hero = `<section class="card score-hero">
  <div class="sh-main">
    ${logoImg(item.image, "sh-ava")}
    <div class="sh-info">
      <div class="sh-name">${esc(item.name)}</div>
      <div class="sh-sub">${esc(item.matchName)}${item.boName ? ` · ${esc(item.boName)}` : ""}${item.desc ? ` · ${esc(item.desc)}` : ""}</div>
    </div>
    <div class="sh-score">
      <b class="${scoreCls(item.score).trim()}">${item.score > 0 ? item.score.toFixed(1) : "—"}</b>
      <span>${fmtNum(item.count)} 人评分</span>
    </div>
  </div>
  <div class="sh-dist">${bars}</div>
</section>`;

  const hotSection = hotComments.length
    ? `<section class="card">
  <header class="card-head">
    <span class="comments-title"><span class="hot-ico">${LIGHT_ICON}</span>热门评论</span>
  </header>
  <div id="hotCommentList">${hotComments.map(scoreCommentView).join("")}</div>
</section>`
    : "";

  const list = comments.length
    ? comments.map(scoreCommentView).join("")
    : hotComments.length
      ? ""
      : '<p class="empty">还没有评论</p>';

  const more = hasMore
    ? `<button class="load-more" id="scoreMoreBtn" type="button" data-kind="score" data-type="${esc(item.bizType)}" data-no="${esc(item.bizNo)}" data-cursor="${esc(String(cursor || 0))}">加载更多评论</button>`
    : "";

  const body = `<main class="stage">
  <div class="main-col" style="grid-column:1/-1">
    <div class="thread-back">
      <button class="nav-chip" type="button" onclick="history.back()">← 返回上一页</button>
      <a class="nav-chip" href="/">首页</a>
      <a class="nav-chip" href="/matches">赛程</a>
    </div>
    ${hero}
    ${hotSection}
    <section class="card">
      <header class="card-head">
        <span class="comments-title">最新评论 <span class="card-count">${fmtNum(item.commentCount)}</span></span>
      </header>
      <div id="scoreCommentList">${list}</div>
      ${more}
    </section>
  </div>
</main>`;

  return layout({ title: `${item.name} · 评分 · 虎扑网页版`, body, activeNav: "match" });
}

/** 赛程列表页 */
export function matchesPage({ bizId, schedule }) {
  const today = schedule.today;
  const upcoming = schedule.days.filter((d) => d.dayTime >= today);
  const past = schedule.days.filter((d) => d.dayTime < today).slice().reverse();

  const dayBlock = (d) => `<div class="sched-day wide"${d.dayTime === today ? ' id="today"' : ""}>
  <div class="sd-date">${esc(d.dateBlock)}</div>
  ${d.matches.map(matchRowWide).join("")}
</div>`;

  const chips = BIZ_TAGS.map(
    (t) => `<a class="nav-chip${t.id === bizId ? " active" : ""}" href="/matches?biz=${t.id}">${esc(t.name)}</a>`,
  ).join("");

  const body = `<main class="stage">
  <div class="main-col" style="grid-column:1/-1">
    <section class="card">
      <header class="card-head">
        <span class="card-title">赛程</span>
        <span class="card-count">${schedule.matches.length}</span>
      </header>
      <div class="sched-chips">${chips}</div>
      ${upcoming.length ? upcoming.map(dayBlock).join("") : '<p class="error-tip">暂无赛程数据</p>'}
      ${
        past.length
          ? `<details class="sched-past">
        <summary>查看历史赛程（${past.length} 天）</summary>
        ${past.map(dayBlock).join("")}
      </details>`
          : ""
      }
    </section>
  </div>
</main>`;

  return layout({ title: "赛程 · 虎扑网页版", body, activeNav: "match" });
}

/** 单场评分页 */
export function matchPage({ match, board }) {
  const head = board?.match ?? null;
  const home = head?.home ?? match?.teams?.[0] ?? null;
  const away = head?.away ?? match?.teams?.[1] ?? null;

  const teamBox = (t, score, win, side) =>
    t
      ? `<div class="mh-team ${side}${win ? " win" : ""}">
    ${logoImg(t.logo, "mh-logo")}
    <span class="mh-name">${esc(t.name)}</span>
    ${score && score !== "-" ? `<b class="mh-score">${esc(score)}</b>` : ""}
  </div>`
      : `<div class="mh-team ${side}"></div>`;

  const homeWin = home && away && Number(home.score) > Number(away.score);
  const awayWin = home && away && Number(away.score) > Number(home.score);

  const hero = `<section class="card match-hero">
  <div class="mh-top">
    <span class="mh-stage">${esc(head?.stage || match?.league || "")}</span>
    <span class="mh-date">${esc(match ? `${match.date} ${match.time}` : head?.date || "")}</span>
  </div>
  <div class="mh-main">
    ${teamBox(home, home?.score, homeWin, "home")}
    <div class="mh-vs">VS</div>
    ${teamBox(away, away?.score, awayWin, "away")}
  </div>
  <div class="mh-foot">
    <span>${esc(match?.statusDesc || (head?.status === "COMPLETED" ? "已结束" : "未开始"))}</span>
    ${head?.count ? `<span>${fmtNum(head.count)} 人参与评分</span>` : ""}
    ${match?.scoreItem ? `<span>当场最高分 ${esc(match.scoreItem.name)} ${esc(match.scoreItem.score)}</span>` : ""}
  </div>
</section>`;

  const boards = board?.groups?.length
    ? board.groups.map((g) => boBlock(g, board.match)).join("")
    : '<section class="card"><p class="error-tip">这场比赛的评分暂未开放</p></section>';

  const body = `<main class="stage">
  <div class="main-col" style="grid-column:1/-1">
    <div class="thread-back">
      <button class="nav-chip" type="button" onclick="history.back()">← 返回上一页</button>
      <a class="nav-chip" href="/">首页</a>
      <a class="nav-chip" href="/matches">赛程</a>
    </div>
    ${hero}
    ${boards}
  </div>
</main>`;

  return layout({
    title: `${head?.name || "比赛评分"} · 虎扑网页版`,
    body,
    activeNav: "match",
  });
}

/* ---------- 页面 ---------- */

/** 虎扑资讯首页：左侧资讯流 + 右侧赛程 */
export function homePage({ posts, schedule, days, hasMore = false, lastTid = "" }) {
  const feedHtml =
    posts.length === 0
      ? '<p class="error-tip">暂时获取不到游戏电竞资讯，请稍后刷新重试</p>'
      : `<div class="feed" id="homeFeed">${posts.map(feedCard).join("")}</div>`;

  const moreBtn =
    hasMore && lastTid && posts.length
      ? `<button class="load-more" id="homeMoreBtn" type="button" data-kind="home" data-before="${esc(lastTid)}">加载更多</button>`
      : "";

  const body = `<main class="stage">
  <div class="main-col">
    <section class="card">
      <header class="card-head">
        <span class="card-title">虎扑 · 电竞资讯</span>
        <span class="card-actions">
          <span class="card-count">${posts.length}</span>
          <a class="card-refresh" href="/?refresh=1" title="重新获取最新资讯" aria-label="刷新">${REFRESH_ICON}<span>刷新</span></a>
        </span>
      </header>
      ${feedHtml}
      ${moreBtn}
    </section>
  </div>
  <aside class="side-col">${schedule ? scheduleCard({ days }) : ""}</aside>
</main>`;

  return layout({ title: "虎扑资讯 · 虎扑网页版", body, activeNav: "news" });
}

/* ---------- 直播吧 · 电竞资讯（外链列表，20 条一页） ---------- */

/** 直播吧时间：2026-11-17 15:50:37 → 今天 15:50 / 11-17 15:50 */
function zb8Time(s) {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(s ?? "");
  const [, y, mo, d, hh, mi] = m;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${y}-${mo}-${d}` === today ? `今天 ${hh}:${mi}` : `${mo}-${d} ${hh}:${mi}`;
}

/** 单条资讯：和首页资讯卡同款——标题 → 封面图 → 时间（不显示来源/作者） */
function zb8Row(it) {
  // 有站内路径就在本站读，解析不出路径的老数据才回退外链
  const external = it.path ? "" : ' target="_blank" rel="noopener noreferrer"';
  return `<a class="post" href="${esc(it.path || it.url)}"${external}>
  <div class="post-title">${esc(it.title)}</div>
  ${
    it.cover
      ? `<div class="post-thumbs single"><img src="${esc(it.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`
      : ""
  }
  <div class="post-meta"><span class="m time">${esc(zb8Time(it.time))}</span></div>
</a>`;
}

export function zhibo8Page({ page, items, hasMore }) {
  const list = items.length
    ? `<div class="feed">${items.map(zb8Row).join("")}</div>`
    : '<p class="empty">没有更多了，回第一页看看</p>';

  const prev =
    page > 1
      ? `<a class="pg" href="/zhibo8${page === 2 ? "" : `?page=${page - 1}`}">← 上一页</a>`
      : '<span class="pg off">← 上一页</span>';
  const next = hasMore
    ? `<a class="pg" href="/zhibo8?page=${page + 1}">下一页 →</a>`
    : '<span class="pg off">下一页 →</span>';

  const body = `<main class="stage">
  <div class="main-col" style="grid-column:1/-1">
    <section class="card">
      <header class="card-head">
        <span class="card-title">直播吧 · 电竞资讯</span>
        <span class="card-actions">
          <span class="card-count">${items.length}</span>
          <a class="card-refresh" href="/zhibo8${page > 1 ? `?page=${page}&amp;refresh=1` : "?refresh=1"}" title="重新获取最新资讯" aria-label="刷新">${REFRESH_ICON}<span>刷新</span></a>
        </span>
      </header>
      ${list}
      <nav class="pager" aria-label="分页">${prev}<span class="pg cur">第 ${page} 页</span>${next}</nav>
    </section>
  </div>
</main>`;

  return layout({ title: "电竞资讯 · 直播吧", body, activeNav: "esports" });
}

/** 直播吧评论（正文已在数据层转义，表情已换成小图） */
function zb8CommentView(c) {
  const kids = c.children
    .map((k) => `<div class="zb8-kid"><span class="k-name">${esc(k.user)}</span>${k.html}</div>`)
    .join("");
  const moreKid = c.moreChildren > 0 ? `<div class="zb8-kid more">还有 ${c.moreChildren} 条回复</div>` : "";
  return `<div class="comment">
  ${avatar(c.avatar, c.user)}
  <div class="comment-body">
    <div class="comment-head">
      <span class="c-name">${esc(c.user)}</span>
      <span class="c-sub">${esc(c.time)}</span>
      <span class="c-light${c.up > 0 ? " on" : ""}">${LIGHT_ICON}${c.up > 0 ? c.up : "亮了"}</span>
    </div>
    <div class="comment-content">${c.html}</div>
    ${kids || moreKid ? `<div class="zb8-kids">${kids}${moreKid}</div>` : ""}
  </div>
</div>`;
}

/** 直播吧文章详情：站内阅读 + 评论，底部保留「原文」入口 */
export function zhibo8ArticlePage({ article, comments = { total: 0, hot: [], list: [] } }) {
  const hotSection = comments.hot.length
    ? `<div class="zb8-cmt-sub">热门评论</div>${comments.hot.map(zb8CommentView).join("")}`
    : "";
  const latestSection = comments.list.length
    ? `${comments.hot.length ? '<div class="zb8-cmt-sub">最新评论</div>' : ""}${comments.list
        .map(zb8CommentView)
        .join("")}`
    : comments.hot.length
      ? ""
      : '<p class="empty">还没有评论</p>';

  const body = `<main class="stage">
  <div class="main-col" style="grid-column:1/-1">
    <div class="thread-back">
      <button class="nav-chip" type="button" onclick="history.back()">← 返回上一页</button>
      <a class="nav-chip" href="/zhibo8">电竞资讯</a>
    </div>
    <section class="card">
      <h1 class="thread-title">${esc(article.title)}</h1>
      <div class="article-meta">直播吧${article.time ? ` · ${esc(article.time)}` : ""}</div>
      <div class="thread-content">${article.html}</div>
      <div class="thread-stats">
        <span class="m">来源：直播吧</span>
        <span style="margin-left:auto"><a href="${esc(article.url)}" target="_blank" rel="noreferrer">原文 ↗</a></span>
      </div>
    </section>
    <section class="card">
      <header class="card-head">
        <span class="comments-title">评论 <span class="card-count">${comments.total}</span></span>
      </header>
      ${hotSection}
      ${latestSection}
    </section>
  </div>
</main>`;

  return layout({ title: `${article.title} · 直播吧`, body, activeNav: "esports" });
}

export function zonesPage(categories) {
  const total = categories.reduce((n, c) => n + c.topicList.length, 0);
  const grid = categories.length
    ? `<div class="zone-grid">${categories
        .map(
          (c) => `<section>
  <h3 class="zone-cat-title">${esc(c.name)}</h3>
  <div class="zone-cells">${c.topicList
    .map(
      (z) => `<a class="zone-cell" href="/zone/${z.topicId}">
    <img src="${esc(z.topicLogo)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    <span class="zname">${esc(z.topicName)}</span>
    <span class="zcount">${esc(z.count)}</span>
  </a>`,
    )
    .join("")}</div>
</section>`,
        )
        .join("")}</div>`
    : '<p class="error-tip">专区列表获取失败，请稍后刷新重试</p>';

  const body = `<main class="stage">
  <div class="main-col" style="grid-column:1/-1">
    <section class="card">
      <header class="card-head">
        <span class="card-title">全部专区</span>
        <span class="card-count">${total}</span>
      </header>
      ${grid}
    </section>
  </div>
</main>`;

  return layout({ title: "全部专区 · 虎扑网页版", body });
}

export function zonePage({
  zone,
  posts,
  nextCursor,
  tabs = [],
  sortId = "",
  page = 1,
  totalPages = 1,
}) {
  const rows = posts.map(zonePostRow).join("");
  /** 桌面端专区：有 tab 就按页码翻（手机端才用游标） */
  const paged = tabs.length > 0;

  /** 桌面端专区自带排序 tab：最新回复 / 最新发布 / 24小时榜 */
  const sortBar =
    tabs.length > 1
      ? `<div class="zone-sorts">${tabs
          .map(
            (t) =>
              `<a class="nav-chip${t.id === sortId ? " active" : ""}" href="/zone/${zone.topicId}?sort=${esc(t.id)}">${esc(t.title)}</a>`,
          )
          .join("")}</div>`
      : "";

  const moreBtn =
    paged
      ? page < totalPages
        ? `<button class="load-more" id="loadMoreBtn" type="button"
        data-kind="zone-desk" data-topic-id="${zone.topicId}" data-sort="${esc(sortId)}"
        data-page="${page}">加载更多</button>`
        : '<p class="empty">已经到底啦</p>'
      : nextCursor
        ? `<button class="load-more" id="loadMoreBtn" type="button"
        data-kind="zone" data-topic-id="${zone.topicId}"
        data-cursor="${esc(nextCursor)}" data-page="1">加载更多</button>`
        : '<p class="empty">已经到底啦</p>';

  const body = `<main class="stage">
  <div class="main-col" style="grid-column:1/-1">
    <section class="card zone-hero">
      ${zone.logo ? `<img src="${esc(zone.logo)}" alt="${esc(zone.name)}" referrerpolicy="no-referrer">` : ""}
      <div>
        <div class="zh-name"${zone.bgColor ? ` style="color:${esc(zone.bgColor)}"` : ""}>${esc(zone.name)}</div>
        ${zone.desc ? `<div class="zh-desc">${esc(zone.desc)}</div>` : ""}
        <div class="zh-stats">
          <span>关注 <b>${esc(zone.followedUserNum)}</b></span>
          <span>帖子 <b>${esc(zone.allThreadNum)}</b></span>
        </div>
      </div>
    </section>
    <section class="card">
      ${sortBar}
      <div class="feed" id="feed">${rows}</div>
      ${moreBtn}
    </section>
  </div>
</main>`;

  return layout({
    title: `${zone.name} · 虎扑网页版`,
    body,
    activeNav: zone.topicId === 85 ? "lol" : null,
  });
}

export function threadPage(t) {
  const totalReplies = Math.max(t.replies, t.initialReplies.length);

  const hotSection =
    t.lightReplies.length > 0
      ? `<section class="card">
  <header class="card-head">
    <span class="comments-title">热评 <span class="card-count">${Math.min(t.lightReplies.length, 10)}</span></span>
  </header>
  ${t.lightReplies.slice(0, 10).map(commentView).join("")}
</section>`
      : "";

  const initialHtml =
    t.initialReplies.length === 0
      ? '<p class="empty">还没有回复</p>'
      : `<div id="commentList">${t.initialReplies.map(commentView).join("")}</div>
<button class="load-more" id="loadRepliesBtn" type="button"
  data-kind="replies" data-tid="${esc(t.tid)}" data-known-count="${totalReplies}" data-page="1">加载更多回复</button>`;

  const body = `<main class="stage">
  <div class="main-col" style="grid-column:1/-1">
    <section class="card">
      <div class="thread-head">
        ${avatar(t.author.header, t.author.name)}
        <div class="thread-author">
          <div class="ta-name">${esc(t.author.name)}</div>
          <div class="ta-sub">${esc(fmtPostTime(t.author.time))}${t.author.view > 0 ? ` · ${t.author.view} 浏览` : ""}</div>
        </div>
      </div>
      <h1 class="thread-title">${esc(t.title)}</h1>
      <div class="thread-content">${t.contentHtml}</div>
      <div class="thread-stats">
        ${t.lights > 0 ? `<span class="m light">${LIGHT_ICON} 亮了 <b>${t.lights}</b></span>` : ""}
        <span class="m">${REPLY_ICON} 回复 <b>${totalReplies || "—"}</b></span>
        <span style="margin-left:auto"><a href="https://bbs.hupu.com/${esc(t.tid)}.html" target="_blank" rel="noreferrer">查看原帖 ↗</a></span>
      </div>
    </section>
    ${hotSection}
    <section class="card">
      <header class="card-head">
        <span class="comments-title">全部回复 <span class="card-count">${totalReplies}</span></span>
      </header>
      ${initialHtml}
    </section>
  </div>
</main>

<button class="back-prev" id="backPrevBtn" type="button" aria-label="返回上一页" title="返回上一页">
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
</button>`;

  return layout({ title: `${t.title} · 虎扑网页版`, body });
}

export { errorCard };
