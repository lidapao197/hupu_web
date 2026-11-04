/**
 * 赛程与评分数据层 — 服务端专用（Node 20+ 自带 fetch）
 *
 * 接口来源：_docs/match-score.md（本地副本）
 *  - 赛程：match-api.hupu.com .../getScheduleListByTagForH5，businessId 按赛事划分
 *  - 评分：games.mobileapi.hupu.com .../bplcommentapi/bpl/score_tree（树状，匿名可读）
 *
 * 英雄联盟实测（2026-10）与文档的两处差异：
 *  1. businessType 是 esports，subMatchBusinessType=lol
 *  2. 评分树是三层：lol_item（选手/教练）→ lol_bo（第 N 局）→ lol_match（整场）
 *     文档里篮球足球是两层，这里必须多下钻一层才能拿到完整名单
 */

import { MOBILE_UA, cached } from "./hupu.js";

const SCHEDULE_URL =
  "https://match-api.hupu.com/1/8.2.10/matchallapi/bff/standard/getScheduleListByTagForH5";
const SCORE_BASE = "https://games.mobileapi.hupu.com/1/8.0.99/bplcommentapi/bpl/score_tree";
const COMMENT_BASE = "https://games.mobileapi.hupu.com/1/8.0.99/bplcommentapi";

const SCHEDULE_HEADERS = { "User-Agent": MOBILE_UA, Referer: "https://bbs.hupu.com/" };
const SCORE_HEADERS = { "User-Agent": MOBILE_UA, Referer: "https://m.hupu.com/" };

/** 赛程分区：lol 覆盖全球总决赛 / LPL 季后赛 / LCK / 亚运 / 德玛西亚杯，最全 */
export const BIZ_TAGS = [
  { id: "lol", name: "英雄联盟" },
  { id: "lpl", name: "LPL" },
  { id: "lck", name: "LCK" },
];

export const isBizTag = (id) => BIZ_TAGS.some((t) => t.id === id);

/* ---------- 工具 ---------- */

const CN_OFFSET = 8 * 3600 * 1000; // 虎扑时间戳是 UTC 毫秒，展示统一按北京时间

const cnIso = (ts) => new Date(Number(ts) + CN_OFFSET).toISOString();
const hm = (ts) => (Number.isFinite(Number(ts)) ? cnIso(ts).slice(11, 16) : "--:--");
const cnToday = () => new Date(Date.now() + CN_OFFSET).toISOString().slice(0, 10);

const one = (v) => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

async function getJson(url, headers) {
  // 上游挂起时别把整站拖死
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/* ---------- 赛程 ---------- */

export async function getSchedule(bizId = "lol") {
  const id = isBizTag(bizId) ? bizId : "lol";
  return cached(`schedule:${id}`, 60_000, async () => {
    const url = `${SCHEDULE_URL}?businessType=common&datasource=navigation&businessId=${id}`;
    const d = await getJson(url, SCHEDULE_HEADERS);
    const r = d?.result;
    if (!r) throw new Error("赛程接口返回为空，businessId 可能已变更");
    const days = (Array.isArray(r.dayGameData) ? r.dayGameData : []).map(mapDay);
    return {
      bizId: id,
      anchorMatchId: String(r.anchorMatchId ?? "0"),
      days,
      matches: days.flatMap((x) => x.matches),
      today: cnToday(),
    };
  });
}

function mapDay(d) {
  const dayTime = String(d.dayTime ?? "");
  return {
    dayTime,
    dateBlock: String(d.dateBlock ?? dayTime),
    isToday: dayTime === cnToday(),
    matches: (Array.isArray(d.matchData) ? d.matchData : []).map(mapMatch),
  };
}

function mapMatch(m) {
  const ai = m.againstInfo ?? {};
  const members = Array.isArray(ai.memberInfos) ? ai.memberInfos : [];
  const si = m.scoreItemInfo ?? null;
  return {
    matchId: String(m.matchId ?? ""),
    status: String(m.matchStatus ?? ""),
    statusDesc: String(m.matchStatusDesc ?? ""),
    ts: Number(m.matchStartTimeStamp ?? 0),
    date: String(m.matchStartDate ?? ""),
    time: hm(m.matchStartTimeStamp),
    league: String(m.matchIntroduction ?? ""),
    matchName: String(m.matchName ?? ""),
    liveLink: String(m.liveRoomLink ?? ""),
    scoreText: String(m.scoreCountText ?? ""),
    teams: members.map((t) => ({
      name: String(t.memberName ?? ""),
      logo: String(t.memberLogo ?? ""),
      score: String(t.memberBaseScore ?? "-"),
      win: String(t.memberId ?? "") !== "" && String(t.memberId) === String(ai.winnerMemberId ?? ""),
    })),
    scoreItem: si
      ? {
          type: String(si.scoreOutBizType ?? ""),
          no: String(si.scoreOutBizNo ?? ""),
          name: String(si.name ?? ""),
          score: String(si.scoreNum ?? ""),
          count: String(si.scoreCountText ?? ""),
          hot: String(si.hotComment ?? ""),
        }
      : null,
  };
}

/**
 * 首页侧栏用：从锚点那天开始，取最近若干天的比赛
 * （赛程一次给整个赛季，不定位会停在一两个月前）
 */
export function upcomingDays(schedule, maxDays = 3, maxMatches = 10) {
  const days = schedule?.days ?? [];
  if (!days.length) return [];

  let start = days.findIndex((d) => d.isToday);
  if (start < 0) {
    const anchor = schedule.anchorMatchId;
    start = days.findIndex((d) => d.matches.some((m) => m.matchId === anchor));
  }
  if (start < 0) start = days.findIndex((d) => d.dayTime >= cnToday());
  if (start < 0) start = days.length - 1;

  const out = [];
  let total = 0;
  for (let i = start; i < days.length && out.length < maxDays; i++) {
    const d = days[i];
    if (!d.matches.length) continue;
    const rest = maxMatches - total;
    if (rest <= 0) break;
    const matches = d.matches.slice(0, rest);
    out.push({ ...d, matches });
    total += matches.length;
  }
  return out;
}

/* ---------- 评分树 ---------- */

async function getSelf(type, no) {
  return cached(`score:self:${type}:${no}`, 300_000, async () => {
    const d = await getJson(
      `${SCORE_BASE}/getSelfByBizKey?outBizType=${encodeURIComponent(type)}&outBizNo=${encodeURIComponent(no)}`,
      SCORE_HEADERS,
    );
    if (d?.code !== 1) throw new Error(d?.msg || `评分节点 ${type}:${no} 获取失败`);
    return d.data ?? {};
  });
}

async function getChildren(type, no) {
  return cached(`score:child:${type}:${no}`, 300_000, async () => {
    const d = await getJson(
      `${SCORE_BASE}/getCurAndSubNodeByBizKey?outBizType=${encodeURIComponent(type)}&outBizNo=${encodeURIComponent(no)}&relation=CHILD&page=1&pageSize=50`,
      SCORE_HEADERS,
    );
    if (d?.code !== 1) throw new Error(d?.msg || `评分子节点 ${type}:${no} 获取失败`);
    return d.data ?? {};
  });
}

function mapScoreItem(entry) {
  const n = entry?.node ?? {};
  const info = n.infoJson ?? {};
  return {
    name: String(n.name ?? ""),
    image: String((n.image ?? [])[0] ?? ""),
    type: String(one(info.type)), // player / coach
    desc: String(one(info.desc)), // "K/D/A:1/5/2"
    score: Number(n.scoreAvg ?? 0),
    count: Number(n.scorePersonCount ?? 0),
    comments: Number(n.commentCount ?? 0),
    teamId: String(one(info.teamId)),
    champion: String(one(info.auxiliaryPic)),
    bizType: String(n.bizType ?? ""),
    bizNo: String(n.bizId ?? ""),
  };
}

/**
 * 整场评分榜
 * 入参是赛程里 scoreItemInfo 给的业务键（英雄联盟恒为 lol_item:选手）
 * 三跳：条目 → PARENT 局 → PARENT 场 → 场的子节点（各局）→ 各局的子节点（选手）
 */
export async function getScoreBoard(itemType, itemNo) {
  if (!itemType || !itemNo) return null;

  let node = { type: itemType, no: itemNo };
  let self = await getSelf(node.type, node.no);

  // 沿 PARENT 爬到最顶层（英雄联盟是 场，篮球足球直接是场）
  for (let i = 0; i < 4; i++) {
    const parent = (self.linkNodes ?? []).find((n) => n.target === "PARENT");
    const key = parent?.outBizKey;
    if (!key?.outBizType || !key?.outBizNo) break;
    node = { type: key.outBizType, no: key.outBizNo };
    self = await getSelf(node.type, node.no);
  }

  const info = self.detail?.infoJson ?? {};
  const sub = await getChildren(node.type, node.no);
  const children = Array.isArray(sub.pageResult?.data) ? sub.pageResult.data : [];

  const isBo = children.length > 0 && children.every((c) => String(c?.node?.bizType ?? "").endsWith("_bo"));
  const groups = [];

  if (isBo) {
    for (const bo of children) {
      const bizType = String(bo.node.bizType);
      const bizNo = String(bo.node.bizId);
      const ch = await getChildren(bizType, bizNo);
      groups.push({
        name: String(bo.node.name ?? ""),
        order: Number(one(bo.node.infoJson?.boNum) || 0),
        items: (ch.pageResult?.data ?? []).map(mapScoreItem),
      });
    }
    groups.sort((a, b) => a.order - b.order);
  } else {
    groups.push({ name: "全场评分", order: 0, items: children.map(mapScoreItem) });
  }

  return {
    match: {
      name: String(self.detail?.name ?? ""),
      // 整场节点自身不可打分（canScore=false），汇总人数取子节点聚合值
      count: Number(sub.self?.node?.summedScorePersonCount ?? sub.self?.summedScorePersonCount ?? 0),
      comments: Number(sub.self?.node?.summedCommentCount ?? 0),
      stage: String(one(info.competitionStageTypeCn) || ""),
      date: String(one(info.desc)),
      status: String(one(info.matchStatus)),
      home: {
        name: String(one(info.homeTeamName)),
        logo: String(one(info.homeTeamLogo)),
        score: String(one(info.homeTeamScore)),
        id: String(one(info.homeTeamId)),
      },
      away: {
        name: String(one(info.awayTeamName)),
        logo: String(one(info.awayTeamLogo)),
        score: String(one(info.awayTeamScore)),
        id: String(one(info.awayTeamId)),
      },
    },
    groups,
  };
}

/* ---------- 单个评分条目 + 评论 ---------- */

/** 条目详情：评分分布、KDA、所属比赛/局，都在这一个接口里 */
export async function getScoreItemDetail(bizType, bizNo) {
  const self = await getSelf(bizType, bizNo);
  const det = self.detail ?? {};
  const info = det.infoJson ?? {};
  return {
    bizType,
    bizNo,
    name: String(det.name ?? ""),
    image: String((det.image ?? [])[0] ?? ""),
    // 注意：这里的评分字段在 detail 里，不像 getCurAndSubNodeByBizKey 在 node 里
    score: Number(det.scoreAvg ?? 0),
    count: Number(det.scorePersonCount ?? 0),
    commentCount: Number(det.commentCount ?? 0),
    distribution: det.scoreDistribution ?? {},
    desc: String(one(info.desc)),
    type: String(one(info.type)),
    champion: String(one(info.auxiliaryPic)),
    matchName: String(one(info.lol_match)),
    boName: String(one(info.lol_bo)),
    teamId: String(one(info.teamId)),
  };
}

function mapScoreComment(c) {
  const imgs = Array.isArray(c.commentContentImages)
    ? c.commentContentImages.map((x) => String(x?.commentContent ?? x?.url ?? "")).filter(Boolean)
    : [];
  return {
    id: String(c.commentId ?? ""),
    user: String(c.commentUserName ?? "JR"),
    avatar: String(c.commentUserHeadImg ?? ""),
    content: String(c.commentContent ?? ""),
    images: imgs,
    score: Number(c.score ?? 0),
    lights: Number(c.lightCount ?? 0),
    subCount: Number(c.subCommentCount ?? 0),
    date: String(c.commentDate ?? ""),
    ip: String(c.ipLocation ?? ""),
  };
}

/**
 * 评分条目下的热门评论（官方 H5 评分页走 /hottest 独立端点）
 * 实测 2026-10：主接口的 queryType=hot 等参数会被忽略（返回值与 latest 一致），
 * 热评必须请求 .../primarySingleRow/hottest：只传业务键，data 直接是数组（无分页、无游标），
 * 大致按点亮数下发，字段与主接口一致，还附带 subCommentList（首条子回复，此处不展示）
 */
export async function getHotScoreComments(bizType, bizNo) {
  return cached(`shotcmt:${bizType}:${bizNo}`, 60_000, async () => {
    const d = await getJson(
      `${COMMENT_BASE}/bpl/comment/list/primarySingleRow/hottest?outBizType=${encodeURIComponent(bizType)}&outBizNo=${encodeURIComponent(bizNo)}&clientCode=&cid=`,
      SCORE_HEADERS,
    );
    if (d?.code !== 1) throw new Error(d?.msg || "热门评论获取失败");
    const list = Array.isArray(d.data) ? d.data : [];
    return list.map(mapScoreComment);
  });
}

/**
 * 评分条目下的评论（匿名可读）
 * 翻页用时间游标：第一页 publishTime 传当前毫秒，之后传上一页的 cursor
 */
export async function getScoreComments(bizType, bizNo, cursor = 0) {
  // 首屏用固定 key 缓存 30s（原来用 Date.now() 当 key，等于永不命中、每刷必打上游）；
  // 翻页按游标缓存 5 分钟（历史评论不会变）
  const first = !(Number(cursor) > 0);
  const publishTime = first ? Date.now() : Number(cursor);
  const key = first ? `scomment:first:${bizType}:${bizNo}` : `scomment:${bizType}:${bizNo}:${publishTime}`;
  return cached(key, first ? 30_000 : 300_000, async () => {
    const d = await getJson(
      `${COMMENT_BASE}/bpl/comment/list/primarySingleRow?outBizType=${encodeURIComponent(bizType)}&outBizNo=${encodeURIComponent(bizNo)}&order=desc&queryType=latest&publishTime=${publishTime}&page=1&pageSize=10&clientCode=&cid=`,
      SCORE_HEADERS,
    );
    if (d?.code !== 1) throw new Error(d?.msg || "评分评论获取失败");
    const data = d.data ?? {};
    return {
      total: Number(data.commentCount ?? 0),
      hasMore: Boolean(data.hasMore),
      cursor: Number(data.cursor?.publishTime ?? 0),
      comments: (data.comments ?? []).map(mapScoreComment),
    };
  });
}

/** 按 matchId 在赛程里找一场（用于 /match/:id 路由） */export async function findMatch(matchId) {
  for (const tag of BIZ_TAGS) {
    try {
      const s = await getSchedule(tag.id);
      const m = s.matches.find((x) => x.matchId === matchId);
      if (m) return { match: m, schedule: s };
    } catch {
      /* 单个分区失败不影响其它分区 */
    }
  }
  return null;
}
