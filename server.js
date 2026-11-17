import express from "express";
import dns from "node:dns";
import { gzipSync } from "node:zlib";

// 部分网络下 bbs.hupu.com 的 AAAA 记录连不通，Node 会先试 IPv6 再等超时；
// 桌面端专区页依赖这个域名，置顶 IPv4 省一次 8s 的失败等待。
dns.setDefaultResultOrder("ipv4first");
import {
  getHomeFeed,
  getZoneCategories,
  getZonePage,
  getZoneSorted,
  getThread,
  getThreadTimes,
  getLolNews,
  getAccountLolThreads,
  fetchZonePosts,
  fetchReplies,
  cacheDelete,
} from "./lib/hupu.js";
import {
  getSchedule,
  getScoreBoard,
  getScoreItemDetail,
  getScoreComments,
  getHotScoreComments,
  findMatch,
  upcomingDays,
  isBizTag,
} from "./lib/match.js";
import {
  getZhibo8Page,
  getZhibo8Article,
  getZhibo8Comments,
  resetZhibo8Stream,
} from "./lib/zhibo8.js";
import {
  homePage,
  zhibo8Page,
  zhibo8ArticlePage,
  zonesPage,
  zonePage,
  threadPage,
  matchesPage,
  matchPage,
  scoreItemPage,
  errorCard,
  layout,
} from "./lib/render.js";

const app = express();
const PORT = process.env.PORT || 9003;

app.disable("x-powered-by");

/* 基础安全头（图片已靠 meta referrer 兜底，这里再补一层） */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/**
 * gzip 压缩（不引入 compression 依赖）：首页 HTML 约 44KB → 7KB（-84%）
 * 只接管 res.send，即页面 HTML 与 /api/* 的 JSON；静态文件走 express.static 的 304/长缓存
 */
app.use((req, res, next) => {
  if (!String(req.headers["accept-encoding"] ?? "").includes("gzip")) return next();
  const send = res.send.bind(res);
  res.send = (body) => {
    // 关键：先按原始 body 类型补 Content-Type。否则转成 Buffer 后 Express 会设成
    // application/octet-stream，浏览器（Edge）会直接下载文件而不是渲染页面
    if (typeof body === "string" && !res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
    }
    const buf = Buffer.isBuffer(body) ? body : typeof body === "string" ? Buffer.from(body) : null;
    if (!buf || buf.length < 1024) return send(body);
    const gz = gzipSync(buf);
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    return send(gz);
  };
  next();
});

// 静态资源 URL 带内容版本号（lib/render.js 里按文件 mtime 生成），可以放心长缓存
app.use(express.static("public", { maxAge: "30d", immutable: true }));

/* 云端健康检查 */
app.get("/healthz", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

/* 渲染失败的兜底页 */
const fail = (res, title, msg, status = 500) =>
  res.status(status).send(layout({ title, body: errorCard(msg, true) }));

/* ---------- 页面 ---------- */

app.get("/", async (req, res) => {
  // 「刷新」按钮：先丢掉资讯缓存，再回到干净的地址重新渲染
  if (String(req.query.refresh ?? "") === "1") {
    cacheDelete("news:");
    cacheDelete("acct:lol:");
    return res.redirect(303, "/");
  }
  try {
    // 首页资讯主源：电竞新闻列表（tagCode=lol，固定 35 条，全带封面图与精确时间）
    // 一次请求拿全、直接铺开，不再需要「加载更多」
    let posts = [];
    let canMore = false;
    const news = await getLolNews().catch(() => []);
    if (news.length) {
      posts = news;
    } else {
      // 兜底一：电竞资讯接口失败时回到官方号主页 SSR（图不全、无完整时间），此时才分页
      posts = await getAccountLolThreads({ deep: false }).catch(() => []);
      canMore = posts.length > 0;
    }

    // 兜底二：账号主页也抓不到时，回到「官方推荐流过滤 + 专区最新帖」
    if (!posts.length) {
      const feed = await getHomeFeed().catch(() => []);
      posts = feed.filter((p) => /英雄联盟|LOL|电竞/i.test(p.label));
      if (posts.length < 10) {
        const zone = await getZonePage(85).catch(() => null);
        if (zone) {
          const seen = new Set(posts.map((p) => String(p.tid)));
          for (const zp of zone.posts) {
            if (seen.has(String(zp.tid))) continue;
            seen.add(String(zp.tid));
            posts.push({
              tid: String(zp.tid),
              title: zp.title,
              label: "英雄联盟",
              lights: zp.recommendNum,
              replies: zp.replies,
              images: [],
              isNews: false,
            });
          }
        }
      }
      // 推荐流没有发布时间，并发补一次（详情页 user.moduleContent.time，缓存 10 分钟）
      const times = await getThreadTimes(posts.map((p) => p.tid)).catch(() => new Map());
      posts = posts.map((p) => ({ ...p, time: times.get(String(p.tid)) || "" }));
    }

    // 记下资讯段最后一条的 tid，「加载更多」从这里往后切
    const lastTid = posts.length ? String(posts[posts.length - 1].tid) : "";

    // 右侧赛程：从锚点（今天附近）开始取最近几天，失败不影响资讯渲染
    const schedule = await getSchedule("lol").catch(() => null);
    const days = schedule ? upcomingDays(schedule, 3, 10) : [];
    res.send(homePage({ posts, schedule, days, hasMore: canMore, lastTid }));
  } catch (e) {
    fail(res, "虎扑资讯 · 虎扑网页版", `资讯获取失败：${e.message}`);
  }
});

/* ---------- 直播吧 · 电竞资讯（20 条一页，上游是游标翻页） ---------- */

app.get("/zhibo8", async (req, res) => {
  const page = Math.min(30, Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1));
  try {
    // 「刷新」按钮：重置内存流 + 丢掉上游分片缓存，再回干净地址
    if (String(req.query.refresh ?? "") === "1") {
      await resetZhibo8Stream();
      return res.redirect(303, page > 1 ? `/zhibo8?page=${page}` : "/zhibo8");
    }
    const data = await getZhibo8Page(page);
    res.send(zhibo8Page({ page, ...data }));
  } catch (e) {
    fail(res, "电竞资讯 · 直播吧", `电竞资讯获取失败：${e.message}`);
  }
});

/** 直播吧文章详情（站内阅读） */
app.get("/zhibo8/:date/:file", async (req, res) => {
  const { date, file } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[\w-]+$/.test(file)) {
    return fail(res, "电竞资讯 · 直播吧", "文章地址不合法", 400);
  }
  try {
    const article = await getZhibo8Article(date, file);
    if (!article || !article.html) {
      return fail(res, "电竞资讯 · 直播吧", "这篇文章没抓到正文，可能已下线", 404);
    }
    // 评论拿不到不影响正文
    const comments = await getZhibo8Comments(article.commentFile).catch(() => ({
      total: 0,
      hot: [],
      list: [],
    }));
    res.send(zhibo8ArticlePage({ article, comments }));
  } catch (e) {
    fail(res, "电竞资讯 · 直播吧", `文章获取失败：${e.message}`);
  }
});

/* ---------- 赛程 ---------- */

app.get("/matches", async (req, res) => {
  const biz = String(req.query.biz ?? "lol");
  const bizId = isBizTag(biz) ? biz : "lol";
  try {
    const schedule = await getSchedule(bizId);
    res.send(matchesPage({ bizId, schedule }));
  } catch (e) {
    fail(res, "赛程 · 虎扑网页版", `赛程获取失败：${e.message}`);
  }
});

app.get("/match/:matchId", async (req, res) => {
  const matchId = req.params.matchId;
  if (!/^\d+$/.test(matchId)) return fail(res, "比赛评分 · 虎扑网页版", "比赛 ID 不合法", 400);
  try {
    const found = await findMatch(matchId);
    if (!found) return fail(res, "比赛评分 · 虎扑网页版", "未找到这场比赛（可能已从赛程中移除）", 404);
    const match = found.match;
    // 评分入口由赛程的 scoreItemInfo 给出，未开始的比赛没有
    let board = null;
    if (match?.scoreItem) {
      board = await getScoreBoard(match.scoreItem.type, match.scoreItem.no).catch(() => null);
    }
    res.send(matchPage({ match, board }));
  } catch (e) {
    fail(res, "比赛评分 · 虎扑网页版", `比赛数据获取失败：${e.message}`);
  }
});

app.get("/zones", async (req, res) => {
  try {
    const categories = await getZoneCategories().catch(() => []);
    res.send(zonesPage(categories));
  } catch (e) {
    fail(res, "全部专区 · 虎扑网页版", `专区列表获取失败：${e.message}`);
  }
});

app.get("/zone/:topicId", async (req, res) => {
  const topicId = parseInt(req.params.topicId, 10);
  if (!topicId) return fail(res, "专区 · 虎扑网页版", "专区 ID 不合法", 400);
  const sort = String(req.query.sort ?? "");
  const page = Math.min(50, Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1));
  try {
    // 桌面端专区：列表 + 排序 tab（最新回复 / 最新发布 / 24小时榜）
    const desk = await getZoneSorted(topicId, { sort, page }).catch(() => null);
    if (desk) {
      // 专区头部（关注/帖子数）只有手机端 SSR 给，拿不到就用桌面端字段兜底
      const meta = await getZonePage(topicId)
        .then((d) => d.zone)
        .catch(() => ({}));
      return res.send(zonePage({ ...desk, zone: { ...desk.zone, ...meta } }));
    }

    // 没有桌面路径的专区：回退手机端（游标翻页，无排序）
    const data = await getZonePage(topicId);
    res.send(zonePage({ ...data }));
  } catch (e) {
    fail(res, "专区 · 虎扑网页版", `专区数据获取失败（topicId: ${topicId}）：${e.message}`);
  }
});

app.get("/thread/:tid", async (req, res) => {
  const tid = req.params.tid;
  if (!/^\d+$/.test(tid)) return fail(res, "帖子 · 虎扑网页版", "帖子 ID 不合法", 400);
  try {
    const t = await getThread(tid);
    res.send(threadPage(t));
  } catch (e) {
    fail(res, "帖子详情 · 虎扑网页版", `帖子获取失败（tid: ${tid}），可能已被删除或虎扑页面结构变化`);
  }
});

/* ---------- 单个评分条目（评分分布 + 评论） ---------- */

app.get("/score/:type/:no", async (req, res) => {
  const { type, no } = req.params;
  if (!/^[a-z_]+$/.test(type) || !/^\d+$/.test(no)) {
    return fail(res, "评分 · 虎扑网页版", "评分参数不合法", 400);
  }
  try {
    const [item, hot, cmt] = await Promise.all([
      getScoreItemDetail(type, no),
      getHotScoreComments(type, no).catch(() => []),
      getScoreComments(type, no).catch(() => ({ total: 0, hasMore: false, cursor: 0, comments: [] })),
    ]);
    // 热评置顶展示后，最新评论首页剔除与热评重复的条目（后续翻页由前端按 data-id 去重）
    const hotIds = new Set(hot.map((c) => c.id));
    const latest = cmt.comments.filter((c) => !hotIds.has(c.id));
    res.send(scoreItemPage({ item, hotComments: hot, comments: latest, hasMore: cmt.hasMore, cursor: cmt.cursor }));
  } catch (e) {
    fail(res, "评分 · 虎扑网页版", `评分获取失败：${e.message}`);
  }
});

/* ---------- 翻页 API（服务端请求虎扑接口，绕过浏览器 CORS） ---------- */

/** 评分评论翻页（时间游标） */
app.get("/api/score-comments", async (req, res) => {
  const type = String(req.query.type ?? "");
  const no = String(req.query.no ?? "");
  const cursor = String(req.query.cursor ?? "0");
  if (!/^[a-z_]+$/.test(type) || !/^\d+$/.test(no) || !/^\d+$/.test(cursor)) {
    return res.status(400).json({ error: "invalid params" });
  }
  try {
    res.json(await getScoreComments(type, no, Number(cursor)));
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "upstream error" });
  }
});

/** 首页「加载更多」：从 before（当前最后一条 tid）往后切下一批资讯 */
app.get("/api/home-more", async (req, res) => {
  const before = String(req.query.before ?? "");
  if (!/^\d+$/.test(before)) return res.status(400).json({ error: "invalid params" });
  try {
    // 主源（电竞资讯列表固定 35 条）：按 before 在列表里的位置切片，命中缓存后零请求
    const news = await getLolNews().catch(() => null);
    if (news?.length) {
      const idx = news.findIndex((p) => String(p.tid) === before);
      const rest = idx >= 0 ? news.slice(idx + 1) : news.filter((p) => Number(p.tid) < Number(before));
      const posts = rest.slice(0, 12);
      return res.json({ posts, done: idx < 0 || posts.length < 12 });
    }
    // 兜底：官方号主页 + 专区翻页（慢，失败时降级）
    const all = await getAccountLolThreads({ deep: true, limit: 30 });
    const posts = all.filter((p) => Number(p.tid) < Number(before)).slice(0, 12);
    res.json({ posts, done: posts.length < 12 });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "upstream error" });
  }
});

app.get("/api/zone-posts", async (req, res) => {
  const topicId = parseInt(String(req.query.topicId ?? ""), 10);
  const page = parseInt(String(req.query.page ?? "2"), 10);
  const cursor = String(req.query.cursor ?? "");
  if (!topicId || Number.isNaN(page) || !cursor) {
    return res.status(400).json({ error: "invalid params" });
  }
  try {
    res.json(await fetchZonePosts(topicId, page, cursor));
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "upstream error" });
  }
});

/** 专区桌面端翻页（排序 tab + 页码，50 条/页） */
app.get("/api/zone-posts-desk", async (req, res) => {
  const topicId = parseInt(String(req.query.topicId ?? ""), 10);
  const page = parseInt(String(req.query.page ?? "2"), 10);
  const sort = String(req.query.sort ?? "");
  if (!topicId || Number.isNaN(page) || page < 2) {
    return res.status(400).json({ error: "invalid params" });
  }
  try {
    const d = await getZoneSorted(topicId, { sort, page });
    if (!d) return res.status(404).json({ error: "zone not found" });
    res.json({ posts: d.posts, done: d.page >= d.totalPages });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "upstream error" });
  }
});

app.get("/api/replies", async (req, res) => {
  const tid = String(req.query.tid ?? "");
  const page = parseInt(String(req.query.page ?? "2"), 10);
  if (!/^\d+$/.test(tid) || Number.isNaN(page) || page < 2) {
    return res.status(400).json({ error: "invalid params" });
  }
  try {
    res.json(await fetchReplies(tid, page));
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "upstream error" });
  }
});

/* ---------- 404 ---------- */

app.use((req, res) => {
  fail(res, "404 · 虎扑网页版", "页面不存在", 404);
});

app.listen(PORT, () => {
  // 用英文输出：bat 窗口是 GBK 代码页，中文会乱码
  console.log("");
  console.log("=========================================");
  console.log("  Hupu Web started successfully!");
  console.log("");
  console.log(`  Please visit:  http://localhost:${PORT}`);
  console.log("");
  console.log("  Press Ctrl+C to stop the service.");
  console.log("=========================================");
  console.log("");
});
