# 虎扑网页版 · 英雄联盟主题雏形

虎扑（hupu.com）第三方网页版原型，聚焦**英雄联盟**单一主题。

**技术栈：Node.js + Express + 纯 HTML**——服务端模板字符串直出，无前端框架、无构建步骤。
UI 采用（毛玻璃卡片 / 彩色模糊色块 / 10 套主题色 / 明暗切换）。

数据来自虎扑 / 直播吧公开页面接口，仅供学习交流，版权归原作者与原站所有。

## 快速开始

```bash
npm install
npm start       # http://localhost:9003
npm run dev     # 开发模式（node --watch 热重载）
```

Windows 下直接双击 `start.bat`：自动装依赖（首次）、清理端口、启动服务。
端口可用环境变量覆盖：`PORT=8080 node server.js`。

## 功能

| 页面 | 路由 | 内容 |
|---|---|---|
| 虎扑资讯（首页） | `/` | 英雄联盟电竞资讯（35 条，带封面图与发布时间）+ 右侧赛程卡片 |
| 电竞资讯 | `/zhibo8` | 直播吧电竞频道，20 条一页，游标分页转页码（`?page=N`），已剔除纯数码稿 |
| 资讯详情 | `/zhibo8/:date/:file` | 站内阅读直播吧原文（正文清洗后渲染），底部保留「原文 ↗」 |
| 英雄联盟 | `/zone/85` | 专区信息头 + 帖子列表，可按最新回复 / 最新发布 / 24小时榜排序 |
| 赛程 | `/matches` | 英雄联盟赛程，可切 `lol` / `lpl` / `lck`；今天及以后铺开，历史折叠 |
| 单场评分 | `/match/:matchId` | 按「第 N 局」分组列出双方选手（K/D/A、评分、评分人数），教练 / BP / 解说单独列出 |
| 选手评分 | `/score/:bizType/:bizNo` | 大字评分、评分分布条、热门评论 + 最新评论（游标翻页） |
| 帖子详情 | `/thread/:tid` | 正文（图片懒加载、GIF、视频播放器、战报卡片）、热评、全部回复翻页 |

其它：`/zones`（全部专区）、`/healthz`（健康检查）、`/api/zone-posts` 与 `/api/replies`（翻页代理）。

页面通用：明暗切换、10 套主题色、返回顶部悬浮按钮（右下角，滚动一屏后出现）、
帖子页左下角「返回上一页」悬浮按钮（与返回顶部对称）、响应式布局。

## 目录结构

```
server.js            Express 路由：资讯 + 赛程/评分 + 专区/详情页 + 翻页 API
lib/
├── hupu.js          数据层：抓取 + __NEXT_DATA__ / window.$$data 解析 + 正文清洗 + TTL 缓存
├── match.js         数据层：赛程 + 三层评分树（item → bo → match）+ 评分评论
├── zhibo8.js        数据层：直播吧电竞资讯（游标翻页 + 数码稿过滤 + 分页流）
└── render.js        HTML 模板：布局 / 卡片 / 页面（模板字符串，输出即 HTML）
public/
├── style.css        全部样式：主题变量 + 组件
├── app.js           唯一前端脚本：主题切换 + 返回顶部 + 加载更多
└── icon.svg
_docs/               hupuX API 逆向文档副本 + 本地实测补充
log/                 开发过程记录（不参与运行）
```

## 参考来源

- [Kanezikiiu/Huzai](https://github.com/Kanezikiiu/Huzai) —— 虎扑社区第三方 Android 客户端（Kotlin + Compose），
  参考其桌面端 `window.$$data` 解析思路与专区排序 tab（最新回复 / 最新发布 / 24小时榜）
- [bidabrain/hupuX](https://github.com/bidabrain/hupuX) —— API 逆向文档，本地副本在 `_docs/`
- 虎扑公开接口：`m.hupu.com` 系列 SSR（`__NEXT_DATA__`）、`games.mobileapi.hupu.com`（评分/评论/电竞资讯）、
  `match-api.hupu.com`（赛程）；均匿名可读，移动端 UA 即可
- 直播吧公开接口：`api.qiumibao.com`（`/news/dianjingList` 电竞资讯列表）、`news.zhibo8.com`（文章详情）

> 两个开发时常踩的坑：虎扑图片 CDN 对带 Referer 的请求返回 403（所有 `<img>` 必须
> `referrerpolicy="no-referrer"`）；帖子视频不在正文 HTML 里，而在独立的 `video_info` 字段。

## 已知限制

- 未登录功能（发帖 / 回复 / 点亮 / 打分）未实现，只做了读接口
- 虎扑无官方 API，页面结构变化会导致解析失败（数据层抛错并显示错误态）
- 服务端 TTL 缓存 30s–10 分钟，内容有延迟
