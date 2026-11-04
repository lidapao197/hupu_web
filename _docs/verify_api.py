import json, re, urllib.request

UA_MOBILE = "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36"

def get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA_MOBILE,
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")

def next_data(html):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else None

def p(v, n=90):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    return s[:n].replace("\n", " ")

# 1. 首页
html = get("https://m.hupu.com/")
nd = next_data(html)
res = nd["props"]["pageProps"].get("res", [])
print("HOME res count:", len(res))
if res: print("HOME[0]:", p(res[0], 400))

# 2. 热榜
html = get("https://m.hupu.com/hot")
nd = next_data(html)
hot = nd["props"]["pageProps"].get("res", [])
print("HOT count:", len(hot))
if hot: print("HOT[0]:", p(hot[0], 300))

# 3. 专区列表
html = get("https://m.hupu.com/zone")
nd = next_data(html)
cats = nd["props"]["pageProps"].get("data", [])
print("ZONE cats:", [(c.get("name"), len(c.get("topicList", []))) for c in cats][:8])
first_zone = cats[0]["topicList"][0] if cats else None
print("first zone:", p(first_zone, 200))
