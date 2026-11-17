/**
 * 直播吧（zhibo8）电竞资讯数据层 — 服务端专用
 *
 * 列表接口来自 news.zhibo8.com/dianjing/ 页面内联 JS（jQuery 拼列表）：
 *   https://api.qiumibao.com/application/app/index.php?_url=/news/dianjingList&lastId=<cursor>
 * 匿名可读，每次固定 20 条，**游标翻页**：返回的 data.lastId 作为下一页入参，首屏传空。
 *
 * 该频道是「电竞 + 3C 数码」混排，这里按关键词剔除纯数码稿（手机/芯片/笔记本那类），
 * 为了保住「20 条一页」，过滤后不足一页会继续往下游取片，用内存里的一条「已过滤流」做页码切分：
 *  - 流只追加不重排，所以同一进程内翻页页码稳定；超过 STREAM_TTL 后重新从最新开始拉
 *  - 每片按 lastId 缓存 2 分钟，重复翻页零上游请求
 */
import { cached, cacheDelete } from "./hupu.js";

const LIST_URL = "https://api.qiumibao.com/application/app/index.php?_url=/news/dianjingList";

/** 输出一页固定 20 条 */
export const PAGE_SIZE = 20;

/** 内存流最多保留 30 页（页数上限与路由一致） */
const MAX_ITEMS = PAGE_SIZE * 30;

/** 流存活时间：超时后下次请求重新从最新开始拉 */
const STREAM_TTL = 5 * 60_000;

/**
 * 纯数码/3C 关键词：品牌、型号、芯片、参数与硬件品类。
 * 只收低歧义词——像「荣耀」（荣耀时刻）、「发布」这类电竞稿也常见，故意不收录。
 */
const HARDWARE_RE = new RegExp(
  [
    // 品牌 / 产品线
    "iphone", "ipad", "ipados", "macbook", "imac", "airpods", "apple\\s?watch",
    "galaxy", "pixel\\s?\\d+", "redmi", "realme", "iqoo", "oppo", "vivo", "xperia",
    "小米", "红米", "魅族", "努比亚", "摩托罗拉", "诺基亚", "传音", "一加\\s?\\d", "三星电子",
    // 芯片 / 硬件规格
    "骁龙", "天玑", "麒麟", "猎户座", "酷睿", "锐龙", "英伟达", "nvidia", "geforce",
    "rtx\\s?\\d+", "gtx", "radeon", "显卡", "处理器", "芯片", "光刻", "晶圆", "台积电",
    // 形态 / 参数 / 硬件品类
    "折叠屏", "曲面屏", "直屏", "微曲", "刷新率", "快充", "毫安", "mah", "跑分",
    "笔记本", "平板电脑", "智能手表", "路由器", "固态硬盘", "内存条", "机械键盘", "显示器",
    "数码", "3c",
  ].join("|"),
  "i",
);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://news.zhibo8.com/dianjing/",
};

/** thumbnail / url 是协议相对地址（//news.zhibo8.com/...），补上 https: */
function absUrl(u) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  return s.startsWith("//") ? `https:${s}` : s;
}

/** 文章地址 → 站内路径：/game/2026-11-17/xxx.htm → /zhibo8/2026-11-17/xxx */
export function zb8Path(url) {
  const m = String(url ?? "").match(/\/game\/(\d{4}-\d{2}-\d{2})\/([\w-]+)\.htm/);
  return m ? `/zhibo8/${m[1]}/${m[2]}` : "";
}

function mapItem(x) {
  return {
    id: String(x.id ?? ""),
    title: String(x.title ?? "").trim(),
    time: String(x.createtime ?? ""),
    cover: absUrl(x.thumbnail),
    url: absUrl(x.url),
    path: zb8Path(x.url),
    type: String(x.type ?? ""),
  };
}

/** 数码稿判定（标题命中关键词即剔除） */
const isHardware = (it) => HARDWARE_RE.test(it.title);

/** 上游单片（20 条），按游标缓存 2 分钟 */
function fetchChunk(lastId) {
  return cached(`zb8:chunk:${lastId}`, 120_000, async () => {
    const res = await fetch(`${LIST_URL}&lastId=${encodeURIComponent(lastId)}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`直播吧接口 HTTP ${res.status}`);
    const d = await res.json();
    if (String(d?.status) !== "success") throw new Error(`直播吧接口返回异常：${d?.status ?? "unknown"}`);
    const list = Array.isArray(d?.data?.list) ? d.data.list : [];
    return {
      items: list.map(mapItem).filter((it) => it.title && it.url),
      lastId: String(d?.data?.lastId ?? ""),
    };
  });
}

/* ---------- 已过滤的资讯流（只追加，页码切片就稳） ---------- */

let stream = { items: [], lastId: "", exhausted: false, startedAt: Date.now() };
const seen = new Set();
/** 串行队列：并发请求排队补齐，避免重复打上游 */
let queue = Promise.resolve();

async function fillInner(need) {
  while (!stream.exhausted && stream.items.length < need && stream.items.length < MAX_ITEMS) {
    const chunk = await fetchChunk(stream.lastId);
    if (!chunk.items.length) {
      stream.exhausted = true;
      break;
    }
    for (const it of chunk.items) {
      if (isHardware(it) || seen.has(it.id)) continue;
      seen.add(it.id);
      stream.items.push(it);
    }
    stream.lastId = chunk.lastId;
    if (!chunk.lastId) stream.exhausted = true;
  }
}

function fill(need) {
  const run = queue.then(async () => {
    if (Date.now() - stream.startedAt > STREAM_TTL) {
      stream = { items: [], lastId: "", exhausted: false, startedAt: Date.now() };
      seen.clear();
    }
    await fillInner(need);
  });
  // 队列本身吞掉异常，保证后续请求还能继续；错误照常抛给当前调用方
  queue = run.catch(() => {});
  return run;
}

/**
 * 页面「刷新」：丢掉内存流与上游分片缓存，下次请求重新从最新开始拉。
 * 走队列执行，避免和正在进行的补齐互相踩。
 */
export function resetZhibo8Stream() {
  const run = queue.then(() => {
    stream = { items: [], lastId: "", exhausted: false, startedAt: Date.now() };
    seen.clear();
    cacheDelete("zb8:chunk:");
  });
  queue = run.catch(() => {});
  return run;
}

/** 第 page 页（1 起），每页 20 条（已剔除纯数码稿） */
export async function getZhibo8Page(page = 1) {
  const target = Math.max(1, Math.trunc(page) || 1);
  const offset = (target - 1) * PAGE_SIZE;
  if (offset >= MAX_ITEMS) return { items: [], hasMore: false };

  await fill(offset + PAGE_SIZE);

  const items = stream.items.slice(offset, offset + PAGE_SIZE);
  const hasMore = stream.items.length > offset + PAGE_SIZE || !stream.exhausted;
  return { items, hasMore };
}

/* ---------- 文章详情（站内阅读，正文在 #signals 里） ---------- */

const ARTICLE_BASE = "https://news.zhibo8.com";

const stripTags = (s) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** 取 `<div id="signals" ...>` 的内部 HTML（按 <div>/</div> 配平，避免截断嵌套块） */
function sliceBlock(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return "";
  const tagEnd = html.indexOf(">", at);
  if (tagEnd < 0) return "";

  let depth = 1;
  let i = tagEnd + 1;
  while (i < html.length) {
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div>", i);
    if (nextClose < 0) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(tagEnd + 1, nextClose);
      i = nextClose + 6;
    }
  }
  return "";
}

/** 上游正文过一遍：去脚本/内联事件/播放器，协议相对地址补 https */
function cleanArticleHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+="[^"]*"/gi, "")
    .replace(/\son[a-z]+='[^']*'/gi, "")
    .replace(/(src|href)="\/\//gi, '$1="https://')
    .replace(/(src|href)='\/\//gi, "$1='https://")
    .replace(/href="javascript:[^"]*"/gi, 'href="#"')
    .replace(/<p>(\s|&nbsp;)*<\/p>/gi, "")
    .trim();
}

/**
 * 单篇文章：https://news.zhibo8.com/game/{date}/{file}.htm
 * 详情节是静态 HTML，正文在 `<div id="signals" class="content">`，标题在 <h1>。
 */
export async function getZhibo8Article(date, file) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^[\w-]+$/.test(String(file))) return null;
  const url = `${ARTICLE_BASE}/game/${date}/${file}.htm`;
  return cached(`zb8:art:${date}:${file}`, 600_000, async () => {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 404) return null; // 文章下线/日期不存在，交给路由出 404 页
    if (!res.ok) throw new Error(`直播吧文章 HTTP ${res.status}`);
    const html = await res.text();

    const h1 = stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "");
    const pageTitle = stripTags((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").replace(
      /-直播吧$/,
      "",
    );
    const time = (html.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/) || [])[1] || "";
    const body = sliceBlock(html, '<div id="signals"');
    // 评论容器：<div id="pl_box" file="2026_11_17-news-game-xxxxnative">
    const commentFile = (html.match(/<div[^>]*id="pl_box"[^>]*\bfile="([^"]+)"/i) || [])[1] || "";

    return {
      url,
      title: h1 || pageTitle,
      time,
      html: cleanArticleHtml(body),
      commentFile,
    };
  });
}

/* ---------- 文章评论（cache.zhibo8.cc 的静态 JSON） ---------- */

const COMMENT_BASE = "https://cache.zhibo8.cc/json";

const escHtml = (s) =>
  String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

/** 表情表：[中文名] → 图片地址（一天一次） */
function getEmojiMap() {
  return cached("zb8:emoji", 86_400_000, async () => {
    const map = new Map();
    try {
      const res = await fetch("https://m.zhibo8.com/json/emoji/index.php", { headers: HEADERS });
      if (!res.ok) return map;
      const groups = await res.json();
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const e of Array.isArray(g?.list) ? g.list : []) {
          if (e?.name_cn && e?.src) map.set(String(e.name_cn), String(e.src));
        }
      }
    } catch {
      // 表情拿不到就不替换，纯文本照常显示
    }
    return map;
  });
}

/** 评论正文是纯文本（表情写作 [xxx]），转义后再把表情换成小图 */
function commentHtml(text, emoji) {
  return escHtml(text)
    .replace(/\[[^[\]\s]{1,10}\]/g, (token) => {
      const src = emoji.get(token);
      return src
        ? `<img class="zb8-emoji" src="${escHtml(src)}" alt="${escHtml(token)}" loading="lazy" referrerpolicy="no-referrer">`
        : escHtml(token);
    })
    .replace(/\r?\n/g, "<br>");
}

/** 评论时间：2026-11-17 16:26:18 → 今天 16:26 / 11-17 16:26 */
function commentTime(s) {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(s ?? "");
  const [, y, mo, d, hh, mi] = m;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${y}-${mo}-${d}` === today ? `今天 ${hh}:${mi}` : `${mo}-${d} ${hh}:${mi}`;
}

function mapComment(c, emoji) {
  const kids = Array.isArray(c?.children) ? c.children : [];
  return {
    id: String(c?.id ?? ""),
    user: String(c?.username ?? "").trim(),
    avatar: absUrl(c?.figureurl).replace(/^http:\/\//i, "https://"),
    time: commentTime(c?.createtime),
    up: Number(c?.up ?? 0) || 0,
    html: commentHtml(c?.content, emoji),
    children: kids.slice(0, 3).map((k) => ({
      id: String(k?.id ?? ""),
      user: String(k?.username ?? "").trim(),
      html: commentHtml(k?.content, emoji),
    })),
    moreChildren: Math.max(0, kids.length - 3),
  };
}

/** 静态 JSON 取一次，404/坏数据都当空 */
async function fetchCommentJson(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 文章评论：count + 热评 + 最新一页（每页最多 100 条，_0 是最新页）。
 * file 形如 `2026_11_17-news-game-6afc06a19d055native`，转成 2026_11_17/news/game/...
 */
export async function getZhibo8Comments(file) {
  const m = String(file ?? "").match(/^(\d{4}_\d{2}_\d{2})-([\w]+)-([\w]+)-(.+)$/);
  if (!m) return { total: 0, hot: [], list: [] };
  const path = `${m[1]}/${m[2]}/${m[3]}/${m[4]}`;

  return cached(`zb8:cmt:${file}`, 120_000, async () => {
    const [count, hotRaw, listRaw, emoji] = await Promise.all([
      fetchCommentJson(`${COMMENT_BASE}/${path}_count.htm`),
      fetchCommentJson(`${COMMENT_BASE}/${path}_hot.htm`),
      fetchCommentJson(`${COMMENT_BASE}/${path}_0.htm`),
      getEmojiMap(),
    ]);

    const hotList = Array.isArray(hotRaw) ? hotRaw : [];
    const latest = Array.isArray(listRaw) ? listRaw : [];
    const hotIds = new Set(hotList.map((c) => String(c?.id ?? "")));

    return {
      total: Number(count?.all_num ?? count?.root_num ?? latest.length) || 0,
      hot: hotList.map((c) => mapComment(c, emoji)),
      list: latest.filter((c) => !hotIds.has(String(c?.id ?? ""))).map((c) => mapComment(c, emoji)),
    };
  });
}
