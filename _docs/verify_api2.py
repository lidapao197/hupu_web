import json, re, urllib.request

UA_MOBILE = "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA_MOBILE, "Accept-Language": "zh-CN,zh;q=0.9"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")

def next_data(html):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else None

def p(v, n=90):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    return s[:n].replace("\n", " ")

# 4. 专区帖子列表 (步行街主干道 topicId=1)
nd = next_data(get("https://m.hupu.com/zone/1"))
pp = nd["props"]["pageProps"]
zd = pp.get("zoneData", {})
print("zoneData:", p({k: zd.get(k) for k in ("topicId","name","desc","followedUserNum","allThreadNum","bgColor")}, 300))
pl = pp.get("postList", {})
threads = pl.get("topicThreads", [])
print("threads:", len(threads), "nextCursor:", p(pl.get("nextCursor")))
if threads: print("post[0]:", p(threads[0], 400))

# 翻页 API
cur = pl.get("nextCursor", "")
url = f"https://m.hupu.com/api/v2/bbs/topicThreads?topicId=1&page=2&cursor={cur}"
req = urllib.request.Request(url, headers={"User-Agent": UA_MOBILE, "Accept-Language": "zh-CN,zh;q=0.9"})
d = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
print("PAGINATION code:", d.get("code"), "keys:", list(d.get("data", {}).keys()))
print("page2 count:", len(d.get("data", {}).get("topicThreads", [])), "nextCursor2:", p(d.get("data", {}).get("nextCursor")))

# 5. 帖子详情（拿热榜帖第一条非资讯帖）
nd = next_data(get("https://m.hupu.com/"))
res = nd["props"]["pageProps"]["res"]
tid = None
for r in res:
    if r.get("type") in ("text", "1_pic", "multi_pic") and r.get("replies"):
        tid = r["tid"]; break
print("Testing tid:", tid)
nd = next_data(get(f"https://m.hupu.com/bbs/{tid}.html"))
td = nd["props"]["pageProps"]["threadData"]["data"]
mc = td.get("moduleConfigList", {})
content = mc.get("content", {}).get("moduleContent", {}).get("content", "")
user = mc.get("user", {}).get("moduleContent", {})
print("user:", p(user, 250))
print("content head:", p(content, 200))
replies = nd["props"]["pageProps"].get("initialRepliesData", {})
print("reply keys:", list(replies.keys()))
lr = replies.get("lightReplies") or replies.get("initialReplies") or []
print("light replies:", len(replies.get("lightReplies", [])), "initial:", len(replies.get("initialReplies", [])), "hasMore:", replies.get("initialHasMore"))
if lr: print("reply[0]:", p(lr[0], 500))

# 6. 评论翻页
req = urllib.request.Request(f"https://m.hupu.com/api/v2/reply/list/{tid}?page=2", headers={"User-Agent": UA_MOBILE, "Accept-Language": "zh-CN,zh;q=0.9"})
d = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
print("REPLIES page2 code:", d.get("code"), "list:", len(d.get("data", {}).get("list", [])), "total:", d.get("data", {}).get("total"), "count:", d.get("data", {}).get("count"))
