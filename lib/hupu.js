/**
 * 虎扑数据层 — 服务端专用（Node 20+ 自带 fetch）
 *
 * 数据来源（参考 bidabrain/hupuX 的 API 逆向文档 _docs/*.md，已实测验证）：
 *  - m.hupu.com 系列页面为 Next.js SSR，数据嵌在 HTML 的 __NEXT_DATA__ JSON 里
 *  - 翻页走 m.hupu.com/api/v2/* 的 JSON 接口
 *  - 战报接口 games.mobileapi.hupu.com 匿名可用
 */

export const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36";

const MOBILE_HEADERS = {
  "User-Agent": MOBILE_UA,
  "Accept-Language": "zh-CN,zh;q=0.9",
};

/* ---------- 极简 TTL 缓存（替代框架级缓存，完全可控） ---------- */

const cache = new Map(); // key -> { t, v }
const MAX_CACHE = 600; // 防止长期运行内存无限增长

export async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: now, v });
  if (cache.size > MAX_CACHE) {
    // 先清过期项，仍超限就丢最早写入的一半
    for (const [k, it] of cache) if (now - it.t > 600_000) cache.delete(k);
    if (cache.size > MAX_CACHE) {
      for (const k of [...cache.keys()].slice(0, Math.floor(MAX_CACHE / 2))) cache.delete(k);
    }
  }
  return v;
}

/** 按 key 前缀清缓存（页面上的「刷新」按钮用它强制回源） */
export function cacheDelete(prefix) {
  for (const k of [...cache.keys()]) {
    if (String(k).startsWith(prefix)) cache.delete(k);
  }
}

/* ---------- 基础抓取 ---------- */

/** 上游挂起时别把整站拖死：所有出站请求统一 8s 超时 */
const FETCH_TIMEOUT = 8000;
const timeout = () => AbortSignal.timeout(FETCH_TIMEOUT);

async function fetchMobileHtml(path, ttl = 60_000) {
  return cached(`html:${path}`, ttl, async () => {
    const res = await fetch(`https://m.hupu.com${path}`, { headers: MOBILE_HEADERS, signal: timeout() });
    if (!res.ok) throw new Error(`m.hupu.com ${path} -> HTTP ${res.status}`);
    return res.text();
  });
}

function parseNextData(html) {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) throw new Error("__NEXT_DATA__ not found — 虎扑页面结构可能已变化");
  return JSON.parse(m[1]);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: MOBILE_HEADERS, signal: timeout() });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

const toInt = (v) => {
  if (typeof v === "number") return v;
  const n = parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
};

/* ---------- 首页推荐 ---------- */

export async function getHomeFeed() {
  const nd = parseNextData(await fetchMobileHtml("/"));
  const res = nd?.props?.pageProps?.res;
  if (!Array.isArray(res)) throw new Error("首页数据路径变化：props.pageProps.res 不存在");
  return res.map((r) => ({
    tid: String(r.tid ?? ""),
    title: String(r.title ?? ""),
    label: String(r.label ?? ""),
    lights: toInt(r.lights),
    replies: toInt(r.replies),
    images: Array.isArray(r.source) ? r.source.map(String) : [],
    isNews: Boolean(r.isNews),
  }));
}

/* ---------- 帖子发布时间 + 封面（一次详情页请求两用） ---------- */

/**
 * 一次详情页请求同时取发布时间与封面图：
 *  - 时间：moduleConfigList.user.moduleContent.time（当天 "08:43"，今年 "10-30 09:18"）
 *  - 封面：视频帖取 video_info.img/cover_url；图文帖取正文第一张图（data-gif > data_url > data-origin > src）
 * 专区列表接口不返回图片字段，无图帖子靠这里补。
 */
async function fetchThreadMeta(tid) {
  const html = await fetchMobileHtml(`/bbs/${tid}.html`, 60_000);
  const nd = parseNextData(html);
  const data = nd?.props?.pageProps?.threadData?.data ?? {};
  const mc = data.moduleConfigList ?? {};
  const time = String(mc.user?.moduleContent?.time ?? "");

  let cover = "";
  const vi = data.video_info;
  if (vi && typeof vi === "object") {
    cover = String(vi.img || vi.cover_url || "");
  }
  if (!cover) {
    const content = String(mc.content?.moduleContent?.content ?? "");
    const m = content.match(/(?:data-gif|data_url|data-origin|src)="(https?:\/\/[^"]+)"/i);
    if (m) cover = m[1];
  }
  return { time, cover };
}

/** 有限并发 + 整体超时：超时未返回的条目留空，不拖慢首屏 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx], idx).catch(() => "");
    }
  });
  await Promise.all(workers);
  return out;
}

/** 批量取 { time, cover }：Map<tid, meta>，超时时已进缓存的先带上 */
export async function getThreadMetas(tids, { concurrency = 5, timeout = 2500 } = {}) {
  const uniq = [...new Set(tids.map(String))];
  const map = new Map();
  if (!uniq.length) return map;

  const job = mapLimit(uniq, concurrency, (tid) =>
    cached(`pmeta:${tid}`, 600_000, () => fetchThreadMeta(tid)),
  );

  const result = await Promise.race([job, new Promise((r) => setTimeout(() => r(null), timeout))]);
  if (result) {
    uniq.forEach((tid, i) => map.set(tid, result[i] || { time: "", cover: "" }));
  } else {
    // 超时：把已经进缓存的先带上，剩下的下次请求会命中
    uniq.forEach((tid) => {
      const hit = cache.get(`pmeta:${tid}`);
      if (hit) map.set(tid, hit.v);
    });
  }
  return map;
}

/** 兼容旧签名：只要发布时间的 Map<tid, string> */
export async function getThreadTimes(tids, opts = {}) {
  const metas = await getThreadMetas(tids, opts);
  const map = new Map();
  metas.forEach((v, k) => map.set(k, v?.time || ""));
  return map;
}

/* ---------- 指定账号的帖子流 ---------- */

/** 虎扑游戏电竞资讯（官方电竞资讯号，发 LOL / CS2 / 无畏契约 等） */
export const GAME_NEWS_PUID = "94991862";
export const GAME_NEWS_NAME = "虎扑游戏电竞资讯";

const CN_OFFSET = 8 * 3600 * 1000;

/** 秒级时间戳 → 「今天 13:59」/「10-30 23:05」/「2025-09-01 20:02」 */
function fmtCnTime(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "";
  const iso = new Date(n * 1000 + CN_OFFSET).toISOString();
  const today = new Date(Date.now() + CN_OFFSET).toISOString().slice(0, 10);
  const day = iso.slice(0, 10);
  const hm = iso.slice(11, 16);
  if (day === today) return `今天 ${hm}`;
  if (day.slice(0, 4) === today.slice(0, 4)) return `${day.slice(5)} ${hm}`;
  return `${day} ${hm}`;
}

/**
 * 用户主页 SSR：props.pageProps.threadList（约 10 条，按发帖时间倒序，无分页字段）
 * 比首页推荐流好用的地方：带 create_time / replies / lights / topic_id，不用再逐条抓详情
 */
export async function getUserThreads(puid, { topicId = null } = {}) {
  const nd = parseNextData(await fetchMobileHtml(`/user/${puid}`, 60_000));
  const list = nd?.props?.pageProps?.threadList;
  if (!Array.isArray(list)) throw new Error("用户主页结构变化：props.pageProps.threadList 不存在");

  const posts = list.map((t) => {
    const pics = (Array.isArray(t.pics) ? t.pics : []).map((p) => String(p?.url ?? "")).filter(Boolean);
    const cover = pics.length ? pics : t.video?.img ? [String(t.video.img)] : [];
    const title = String(t.title ?? "").trim();
    return {
      tid: String(t.tid ?? ""),
      title: title || (t.video ? "视频帖" : "（无标题）"),
      label: String(t.topic_name ?? ""),
      topicId: toInt(t.topic_id),
      time: fmtCnTime(t.create_time),
      lights: toInt(t.lights),
      replies: toInt(t.replies),
      images: cover.slice(0, 3),
      isNews: /^\[(流言板|情报站|赛后|赛前|专访|数据)\]/.test(title),
      isVideo: Boolean(t.video) || t.type === "vt",
    };
  });

  return topicId ? posts.filter((p) => p.topicId === topicId) : posts;
}

/* ---------- 专区里按作者捞帖子（补足官方号主页的 20 条上限） ---------- */

/**
 * 用户主页 JS 里写死了 `m<=20`（thread 列表最多 20 条，之后显示「没有更多了」），
 * 也没有分页接口。但该号的帖子都发在几个电竞专区里，专区翻页可以一直翻，
 * 按 username 筛出来就能拿到主页没有的历史资讯。
 * label 不参与缓存（同一 topicId 的专区名是固定的，由调用方传入）。
 */
export async function getZoneThreadsByAuthor(
  topicId,
  username,
  { pages = 4, exclude = new Set(), label = "英雄联盟", limit = 0 } = {},
) {
  const all = await cached(`zauthor:${topicId}:${username}:${pages}`, 300_000, async () => {
    const out = [];
    const seen = new Set();
    const take = (list) => {
      for (const p of list) {
        if (p.username !== username) continue;
        const tid = String(p.tid);
        if (seen.has(tid)) continue;
        seen.add(tid);
        out.push({
          tid,
          title: p.title,
          topicId,
          author: username,
          lights: p.recommendNum,
          replies: p.replies,
          images: [],
          isNews: /^\[(流言板|情报站|赛后|赛前|专访|数据)\]/.test(p.title),
          time: "",
        });
      }
    };

    const first = await getZonePage(topicId);
    take(first.posts);
    let cursor = first.nextCursor;
    for (let page = 2; page <= pages && cursor; page++) {
      const more = await fetchZonePosts(topicId, page, cursor).catch(() => null);
      if (!more?.posts?.length) break;
      take(more.posts);
      cursor = more.nextCursor;
    }
    return out;
  });

  const filtered = all.filter((p) => !exclude.has(p.tid)).map((p) => ({ ...p, label }));
  return limit ? filtered.slice(0, limit) : filtered;
}

/* ---------- 该号的英雄联盟帖子（首屏浅取 / 深取全量） ---------- */

/**
 * deep=false：只取主页 SSR 的帖子（快，约 12 条，首屏用）
 * deep=true ：主页 + 英雄联盟专区翻 15 页按作者补（慢，约 30 条，「加载更多」用）
 * 两者都按 tid 倒序（tid 单调递增 ≈ 发帖时间倒序）
 */
export async function getAccountLolThreads({ deep = false, limit = 30 } = {}) {
  if (!deep) {
    const posts = await getUserThreads(GAME_NEWS_PUID, { topicId: 85 });
    return posts.slice(0, limit);
  }

  return cached(`acct:lol:${limit}`, 300_000, async () => {
    const base = await getUserThreads(GAME_NEWS_PUID, { topicId: 85 });
    const seen = new Set(base.map((p) => String(p.tid)));
    const extra = await getZoneThreadsByAuthor(85, GAME_NEWS_NAME, { pages: 15, exclude: seen }).catch(
      () => [],
    );
    // 专区列表没有图片字段：逐条抓详情页补时间 + 封面（并发 5、超时 2.5s、缓存 10 分钟）
    const metas = extra.length
      ? await getThreadMetas(extra.map((p) => p.tid)).catch(() => new Map())
      : new Map();
    const all = base.concat(
      extra.map((p) => {
        const m = metas.get(String(p.tid));
        return {
          ...p,
          time: m?.time || "",
          images: p.images.length ? p.images : m?.cover ? [m.cover] : [],
        };
      }),
    );
    all.sort((a, b) => Number(b.tid) - Number(a.tid));
    return all.slice(0, limit);
  });
}

/* ---------- 电竞资讯流（LOL 专属） ---------- */

const NEWS_LIST_URL = "https://games.mobileapi.hupu.com/basketballapi/news/m/newsList";

/** 电竞资讯的 publishTime 是完整 "2026-10-31 16:51:07"，卡片只留「今天 HH:mm」/「MM-DD HH:mm」 */
function fmtNewsTime(s) {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(s ?? "");
  const [, y, mo, d, h, mi] = m;
  const today = new Date(Date.now() + CN_OFFSET).toISOString().slice(0, 10);
  return `${y}-${mo}-${d}` === today ? `今天 ${h}:${mi}` : `${mo}-${d} ${h}:${mi}`;
}

/**
 * 虎扑电竞新闻列表 —— m.hupu.com/gg（电竞频道）的数据源，tagCode=lol 是 LOL 专属流。
 * tagCode：lol / kog / pubg 有效；lpl / lck / csgo / dota 等返回空。
 * 一次固定 35 条、**无分页**（offset / page / pageSize / limit 都被忽略），按发布时间倒序。
 * 相比官方号主页：每条都带封面图 img 和精确 publishTime，不用再逐条抓详情页补时间/图。
 * 匿名可用，不需要 Referer；type=VIDEO 标记视频帖，link 里的 tid 可直接跳站内 /thread。
 */
export async function getLolNews() {
  return cached("news:lol", 60_000, async () => {
    const d = await fetchJson(`${NEWS_LIST_URL}?tagCode=lol`);
    const list = d?.result?.news;
    if (!Array.isArray(list)) throw new Error("电竞资讯接口结构变化：result.news 不存在");
    return list
      // 过滤广告：推广条目没有 tid，link 是 huputiyu:// 原生活动页而不是帖子
      .filter((x) => /^\d+$/.test(String(x.tid ?? "")) && /^https?:\/\/m\.hupu\.com\/bbs\//.test(String(x.link ?? "")))
      .map((x) => {
        const title = String(x.title ?? "").trim();
        return {
          tid: String(x.tid ?? ""),
          title: title || "（无标题）",
          label: "英雄联盟",
          time: fmtNewsTime(x.publishTime),
          lights: toInt(x.lights),
          replies: toInt(x.replies),
          images: x.img ? [String(x.img)] : [],
          isNews: /^\[(流言板|情报站|赛后|赛前|专访|数据)\]/.test(title),
          isVideo: x.type === "VIDEO",
        };
      });
  });
}

/* ---------- 热榜 ---------- */
export async function getHotList() {
  const nd = parseNextData(await fetchMobileHtml("/hot"));
  const res = nd?.props?.pageProps?.res;
  if (!Array.isArray(res)) return [];
  return res.map((r) => ({
    rank: toInt(r.rank),
    tagId: toInt(r.tagId),
    tagName: String(r.tagName ?? ""),
    heat: toInt(r.heat),
    competitionType: String(r.competitionType ?? ""),
    icon: String(r.icon ?? ""),
  }));
}

/* ---------- 专区 ---------- */

export async function getZoneCategories() {
  const nd = parseNextData(await fetchMobileHtml("/zone", 600_000));
  const data = nd?.props?.pageProps?.data;
  if (!Array.isArray(data)) return [];
  return data.map((c) => ({
    categoryId: toInt(c.categoryId),
    name: String(c.name ?? ""),
    topicList: (Array.isArray(c.topicList) ? c.topicList : []).map((z) => ({
      topicId: toInt(z.topicId),
      topicName: String(z.topicName ?? ""),
      topicLogo: String(z.topicLogo ?? ""),
      count: String(z.count ?? ""),
      cateId: toInt(z.cateId),
    })),
  }));
}

/** 专区首页（SSR 前 10 条 + 翻页游标） */
export async function getZonePage(topicId) {
  const nd = parseNextData(await fetchMobileHtml(`/zone/${topicId}`));
  const pp = nd?.props?.pageProps ?? {};
  const zd = pp.zoneData ?? {};
  const pl = pp.postList ?? {};
  const zone = {
    topicId: toInt(zd.topicId) || topicId,
    name: String(zd.name ?? ""),
    desc: String(zd.desc ?? ""),
    followedUserNum: String(zd.followedUserNum ?? ""),
    allThreadNum: String(zd.allThreadNum ?? ""),
    bgColor: String(zd.bgColor ?? "#e5484d"),
    logo: String(zd.logo ?? ""),
  };
  return {
    zone,
    posts: (Array.isArray(pl.topicThreads) ? pl.topicThreads : []).map(mapZonePost),
    nextCursor: String(pl.nextCursor ?? ""),
  };
}

/** 专区翻页 JSON 接口（page 从 2 开始，不缓存） */
export async function fetchZonePosts(topicId, page, cursor) {
  const d = await fetchJson(
    `https://m.hupu.com/api/v2/bbs/topicThreads?topicId=${topicId}&page=${page}&cursor=${encodeURIComponent(cursor)}`,
  );
  const data = d?.data ?? {};
  return {
    posts: (Array.isArray(data.topicThreads) ? data.topicThreads : []).map(mapZonePost),
    nextCursor: String(data.nextCursor ?? ""),
  };
}

function mapZonePost(r) {
  return {
    tid: toInt(r.tid),
    title: String(r.title ?? ""),
    replies: toInt(r.replies),
    username: String(r.username ?? ""),
    recommendNum: toInt(r.recommendNum),
    time: String(r.time ?? ""),
    isVideo: Boolean(r.isVideo),
    isVote: Boolean(r.isVote),
  };
}

/* ---------- 专区（桌面端）：排序 tab（最新回复 / 最新发布 / 24小时榜） ---------- */

/**
 * 手机端专区页没有排序 tab，桌面端 bbs.hupu.com/{slug} 的 `window.$$data`
 * 里带 `topic.tabs`（id/title/url）与 `topic.threads.list`（50 条/页，page/total 分页）。
 * 三种排序对应不同路径：`/lol`（最新回复）、`/lol-postdate`（最新发布）、`/lol-hot`（24小时榜），
 * 第 N 页在路径后接 `-N`（如 `/lol-hot-3`）。
 */
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DESKTOP_HEADERS = {
  "User-Agent": DESKTOP_UA,
  "Accept-Language": "zh-CN,zh;q=0.9",
};

/** 抠出 `window.$$data=` 后面的整段 JSON（按括号配平，字符串里的括号不参与计数） */
function extractDollarData(html) {
  const marker = "window.$$data=";
  const at = html.indexOf(marker);
  if (at < 0) return null;
  let start = at + marker.length;
  while (start < html.length && html[start] !== "{") start += 1;

  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const c = html[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  return null;
}

async function fetchDesktopData(path, ttl = 60_000) {
  return cached(`desk:${path}`, ttl, async () => {
    const res = await fetch(`https://bbs.hupu.com${path}`, {
      headers: DESKTOP_HEADERS,
      signal: timeout(),
    });
    if (!res.ok) throw new Error(`bbs.hupu.com ${path} -> HTTP ${res.status}`);
    const data = extractDollarData(await res.text());
    if (!data) throw new Error(`bbs.hupu.com ${path} 未找到 window.$$data`);
    return data;
  });
}

/** topicId → 专区路径（如 85 → /lol），取自桌面端全站导航 /all-gambia */
export async function getZoneSlugMap() {
  const data = await fetchDesktopData("/all-gambia", 3_600_000);
  const map = new Map();
  const cats = data?.pageData?.categories;
  for (const c of Array.isArray(cats) ? cats : []) {
    for (const t of Array.isArray(c.topics) ? c.topics : []) {
      const id = String(t.topicId ?? "");
      const url = String(t.url ?? "");
      if (id && url) map.set(id, { name: String(t.name ?? ""), url, logo: String(t.logo ?? "") });
    }
  }
  return map;
}

/** 桌面端帖子的字段 → 和手机端 mapZonePost 对齐，方便共用列表行 */
function mapDesktopPost(t) {
  return {
    tid: String(t.tid ?? ""),
    title: String(t.title ?? ""),
    username: String(t.author?.puname ?? "").trim(),
    replies: toInt(t.replies),
    recommendNum: toInt(t.lights),
    time: String(t.createdAtFormat ?? ""),
    cover: String(t.cover ?? ""),
    isVideo: Boolean(t.hasVideo),
    isVote: false,
  };
}

/**
 * 专区按排序取一页（桌面端，50 条/页）。
 * sort 传 tab id（85 专区：1=最新发布、2=最新回复、4=24小时榜），留空则用专区默认排序。
 * 返回 null 表示该专区没有桌面路径，调用方回退到手机端实现。
 */
export async function getZoneSorted(topicId, { sort = "", page = 1 } = {}) {
  const slugs = await getZoneSlugMap().catch(() => null);
  const info = slugs?.get(String(topicId));
  if (!info) return null;

  // tabs 要靠默认页先拿到（其它排序的地址写在 tabs[].url 里）
  const first = await fetchDesktopData(info.url);
  const tabs = (Array.isArray(first?.topic?.tabs) ? first.topic.tabs : []).map((t) => ({
    id: String(t.id ?? ""),
    title: String(t.title ?? ""),
    url: String(t.url ?? ""),
  }));
  const tab =
    (sort && tabs.find((t) => t.id === String(sort))) ||
    tabs.find((t) => t.url === info.url) ||
    tabs[0] ||
    { id: "", title: "", url: info.url };

  const basePath = tab.url || info.url;
  const path = page > 1 ? `${basePath}-${page}` : basePath;
  const data = path === info.url ? first : await fetchDesktopData(path);

  const t = data?.topic ?? {};
  const tj = t.topic ?? {};
  const threads = t.threads ?? {};
  return {
    zone: {
      topicId: toInt(tj.topicId) || topicId,
      name: String(tj.name ?? info.name ?? ""),
      desc: String(tj.desc ?? ""),
      logo: String(tj.logo ?? info.logo ?? ""),
      countText: String(tj.countText ?? ""),
    },
    tabs,
    sortId: tab.id,
    page: toInt(t.page) || page,
    totalPages: Math.max(1, toInt(threads.total) || 1),
    posts: (Array.isArray(threads.list) ? threads.list : []).map(mapDesktopPost).filter((p) => p.tid),
  };
}

/* ---------- 帖子详情 ---------- */

/** 时长秒数 → "mm:ss" */
function fmtDuration(sec) {
  const n = Math.floor(Number(sec) || 0);
  if (n <= 0) return "";
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/**
 * 视频帖（type=vt）的播放器。视频是 createThread 的独立字段，
 * 渲染成 video_info：src=带 auth_key 的 mp4（可直连播放）、img/cover_url=封面、
 * duration/play_num=时长与播放量。非视频帖返回空串。
 */
function buildVideoHtml(vi) {
  if (!vi || typeof vi !== "object" || !vi.src) return "";
  const poster = String(vi.img || vi.cover_url || "");
  const dur = fmtDuration(vi.duration);
  const plays = toInt(vi.play_num);
  const cap = [dur ? `时长 ${dur}` : "", plays ? `${plays} 次播放` : ""].filter(Boolean).join(" · ");
  return `<figure class="thread-video">
  <video controls playsinline preload="metadata" src="${esc(vi.src)}"${poster ? ` poster="${esc(poster)}"` : ""}></video>
  ${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}
</figure>`;
}

export async function getThread(tid) {
  const nd = parseNextData(await fetchMobileHtml(`/bbs/${tid}.html`, 30_000));
  const pp = nd?.props?.pageProps ?? {};
  const data = pp.threadData?.data ?? {};
  const mc = data.moduleConfigList ?? {};

  const u = mc.user?.moduleContent ?? {};
  const author = {
    name: String(u.name ?? "虎扑网友"),
    header: String(u.header ?? ""),
    time: String(u.time ?? ""),
    view: toInt(u.view),
  };

  const rawContent = String(mc.content?.moduleContent?.content ?? "");
  // 视频帖：视频不在正文里，在独立的 video_info 字段（src 是带签名的 mp4，匿名可播）
  const videoHtml = buildVideoHtml(data.video_info);
  // 战报卡片分支不经过 sanitizeContent，这里再兜一次
  const contentHtml = withNoReferrer(videoHtml + (await resolveContent(rawContent)));

  const rd = pp.initialRepliesData ?? {};
  const lightReplies = (Array.isArray(rd.lightReplies) ? rd.lightReplies : []).map(mapComment);
  const initialReplies = (Array.isArray(rd.initialReplies) ? rd.initialReplies : []).map(mapComment);

  return {
    tid,
    title: String(mc.title?.moduleContent?.title ?? data.title ?? "帖子详情"),
    author,
    contentHtml,
    lights: toInt(data.lightNum ?? data.light ?? 0),
    replies: toInt(data.repliesNum ?? data.replies ?? 0),
    lightReplies,
    initialReplies,
  };
}

function mapComment(r) {
  const q = r.quote_info;
  return {
    pid: String(r.pid ?? ""),
    username: String(r.user?.username ?? "虎扑网友"),
    avatar: String(r.user?.header ?? ""),
    content: sanitizeContent(String(r.content ?? "")),
    light: toInt(r.light),
    subCount: toInt(r.replies),
    time: String(r.createDt ?? ""),
    location: String(r.location ?? ""),
    isLz: toInt(r.is_lz) === 1,
    quote:
      q && (q.content || q.username)
        ? { username: String(q.username ?? ""), content: sanitizeContent(String(q.content ?? "")) }
        : null,
  };
}

/** 评论翻页 JSON 接口（page 从 2 开始，不缓存） */
export async function fetchReplies(tid, page) {
  const d = await fetchJson(`https://m.hupu.com/api/v2/reply/list/${tid}?page=${page}`);
  const data = d?.data ?? {};
  return {
    replies: (Array.isArray(data.list) ? data.list : []).map(mapComment),
    count: toInt(data.count),
  };
}

/* ---------- 正文清洗 ---------- */

/**
 * 处理虎扑正文的私有节点：
 *  - <center class="hupu-img" ...> → <img>，GIF 优先取 data-gif（src 是被 OSS 压成静态图的 JPEG）
 *  - <img data-src="..."> 懒加载 → <img src>
 *  - 安全：整体移除 script/style/iframe/form/object/embed/svg/math 等可执行 / 可嵌入 / 可覆盖样式的
 *    标签（连内容），再清残留标签与 on* 事件属性、javascript: 协议
 */
export function sanitizeContent(html) {
  let s = html;

  // center.hupu-img → img，src 优先级：data-gif > data_url > data-origin > src
  s = s.replace(/<center\b[^>]*class="hupu-img"[^>]*>/gi, (tag) => {
    const attr = (name) => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
      return m ? m[1] : "";
    };
    const src = attr("data-gif") || attr("data_url") || attr("data-origin") || attr("src") || "";
    if (!src) return "";
    return `<img src="${src}" loading="lazy" alt="">`;
  });

  // 懒加载图
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!/\ssrc="/i.test(tag)) {
      const m = tag.match(/\bdata-src="([^"]*)"/i);
      if (m) return tag.replace(/^<img/i, `<img src="${m[1]}"`).replace(/\sdata-src="[^"]*"/i, "");
    }
    return tag;
  });

  // 安全：先整体移除「可执行 / 可覆盖样式 / 可钓鱼 / 可外部嵌入」的标签（连内容一起删）
  s = s.replace(
    /<(script|style|iframe|object|embed|svg|math|form|frameset)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  // 再清残留的单标签 / 自闭合标签（含上一步被截断的开闭标签）
  s = s.replace(
    /<\/?(script|style|iframe|frame|frameset|object|embed|form|input|button|textarea|select|option|link|meta|base|svg|math)\b[^>]*>/gi,
    "",
  );
  // 去 on* 事件属性 / javascript: 协议
  s = s
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");

  return withNoReferrer(s);
}

/**
 * 虎扑图片 CDN 会按 Referer 判断来源：带 `Referer: http://localhost` 一律 403，
 * 不带 Referer 才 200。评论里的表情包就是普通 <img>，不补这个属性会全部裂图。
 * 幂等：已经带 referrerpolicy 的不会重复添加。
 */
export function withNoReferrer(html) {
  return String(html ?? "").replace(/<img\b[^>]*>/gi, (tag) => {
    let t = tag;
    if (!/referrerpolicy\s*=/i.test(t)) {
      t = t.replace(/<img/i, '<img referrerpolicy="no-referrer"');
    }
    if (!/\sloading\s*=/i.test(t)) {
      t = t.replace(/<img/i, '<img loading="lazy"');
    }
    return t;
  });
}

/**
 * 正文可能不是 HTML 而是一段 JSON（嵌入赛况卡片，type=iframe-match）。
 * 走战报接口展开成简单的文字列表，失败则退回原文。
 */
async function resolveContent(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) return sanitizeContent(trimmed);

  try {
    const card = JSON.parse(trimmed);
    if (card.type === "iframe-match" && card.matchId) {
      return await expandBattleReport(card.matchId);
    }
    return `<p class="embed-fallback">[内嵌卡片：${card.type ?? "未知类型"}]</p>`;
  } catch {
    return `<p>${esc(trimmed)}</p>`;
  }
}

async function expandBattleReport(matchId) {
  const idx = matchId.indexOf("-");
  if (idx <= 0) return '<p class="embed-fallback">[赛况卡片]</p>';
  const relationId = matchId.slice(0, idx);
  const relationType = matchId.slice(idx + 1);
  try {
    const d = await cached(`battle:${matchId}`, 300_000, async () => {
      const res = await fetch(
        `https://games.mobileapi.hupu.com/1/7.5.36/basketballapi/news/battleReport?relationId=${relationId}&relationType=${relationType}`,
        { headers: MOBILE_HEADERS, signal: timeout() },
      );
      return res.json();
    });
    const r = d?.result;
    if (!r) return '<p class="embed-fallback">[赛况暂未生成]</p>';
    const events = [
      ...(Array.isArray(r.keyEvent) ? r.keyEvent : []),
      ...(Array.isArray(r.normalEvent) ? r.normalEvent : []),
    ];
    const parts = [];
    if (r.beginContent) parts.push(`<p class="battle-lead">${esc(r.beginContent)}</p>`);
    if (r.img) parts.push(`<img class="battle-img" src="${esc(r.img)}" loading="lazy" alt="">`);
    for (const e of events) {
      const gifs = (e.gifImgs ?? [])
        .map((g) => `<img src="${esc(g)}" loading="lazy" alt="">`)
        .join("");
      parts.push(
        `<div class="battle-event"><span class="battle-time">${esc(e.eventTimeStr)}</span><span class="battle-title">${esc(e.title)}</span>${gifs}</div>`,
      );
    }
    if (r.teamLineup) {
      parts.push(
        `<div class="battle-lineup">${String(r.teamLineup)
          .split("\n")
          .map((l) => `<p>${esc(l)}</p>`)
          .join("")}</div>`,
      );
    }
    return parts.join("") || '<p class="embed-fallback">[暂无赛况]</p>';
  } catch {
    return '<p class="embed-fallback">[赛况卡片加载失败]</p>';
  }
}

function esc(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c],
  );
}
