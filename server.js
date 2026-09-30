const express = require('express');
const path = require('path');
const os = require('os');
const RSSParser = require('rss-parser');
const cors = require('cors');

const app = express();
app.use(cors());

// 不同 user-agent 給不同來源
function makeParser(ua) {
  return new RSSParser({
    timeout: 15000,
    // rss-parser 預設不會解析 media:* 和 content:encoded，要手動指定，不然抓不到縮圖
    customFields: {
      item: [
        ['media:content', 'mediaContent', { keepArray: true }],
        ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
        ['media:group', 'mediaGroup'],
        ['content:encoded', 'contentEncoded'],
      ],
    },
    headers: { 'User-Agent': ua, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' }
  });
}

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CURL_UA = 'curl/7.88.1';

const SOURCES = [
  {
    id: 'dexerto', label: 'Dexerto',
    tag: { bg: '#1e1a2e', color: '#a78bfa' },
    url: 'https://www.dexerto.com/call-of-duty/feed/',
    ua: DEFAULT_UA,
    codOnly: true, // 本身就是 COD 專屬 feed，不用再過濾
  },
  {
    id: 'vgc', label: 'VGC',
    tag: { bg: '#0e2218', color: '#4acd8d' },
    url: 'https://www.videogameschronicle.com/category/news/feed/',
    ua: DEFAULT_UA,
    codOnly: false,
  },
  {
    id: 'dot', label: 'Dot Esports',
    tag: { bg: '#2a1010', color: '#f87171' },
    url: 'https://dotesports.com/feed',
    ua: DEFAULT_UA,
    codOnly: false,
    // 2026-09：Dot Esports 的 /feed 改成回傳一般網頁（HTML），RSS 已失效，先停用
    disabled: true,
  },
  {
    id: 'mp1st', label: 'MP1st',
    tag: { bg: '#221a08', color: '#fbbf24' },
    url: 'https://mp1st.com/tag/call-of-duty/feed',
    ua: DEFAULT_UA,
    codOnly: true, // 本身就是 COD 專屬 feed，不用再過濾
  },
  {
    id: 'ign', label: 'IGN',
    tag: { bg: '#1a0e0e', color: '#f0a050' },
    url: 'https://feeds.ign.com/ign/all',
    ua: DEFAULT_UA,
    codOnly: false,
  },
  {
    id: 'kotaku', label: 'Kotaku',
    tag: { bg: '#0e1a1a', color: '#2dd4bf' },
    url: 'https://kotaku.com/tag/call-of-duty/rss',
    ua: DEFAULT_UA,
    codOnly: true, // 本身就是 COD 專屬 feed，不用再過濾
  },
  {
    id: 'detonated', label: 'Detonated',
    tag: { bg: '#1a0a0a', color: '#ff6b35' },
    url: 'https://detonated.com/feed/',
    ua: DEFAULT_UA,
    codOnly: false,
  },
  {
    id: 'pcgamer', label: 'PC Gamer',
    tag: { bg: '#1a0a1a', color: '#c084fc' },
    url: 'https://www.pcgamer.com/rss/',
    ua: DEFAULT_UA,
    codOnly: false,
  },
];

// 取出 media:* 欄位裡的網址（可能是陣列、可能包在 $ 裡）
function mediaUrl(field) {
  const list = Array.isArray(field) ? field : field ? [field] : [];
  for (const m of list) {
    const a = m?.['$'] || m;
    if (!a?.url) continue;
    if (a.medium && a.medium !== 'image') continue;
    if (a.type && !a.type.startsWith('image')) continue;
    return a.url;
  }
  return '';
}

function extractImg(item) {
  const enc = item.enclosure;
  const encImg = enc?.url && (!enc.type || enc.type.startsWith('image')) ? enc.url : '';
  const fromHtml = (item.contentEncoded || item.content || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
  return (
    encImg ||
    mediaUrl(item.mediaContent) ||
    mediaUrl(item.mediaThumbnail) ||
    mediaUrl(item.mediaGroup?.['media:content']) ||
    mediaUrl(item.mediaGroup?.['media:thumbnail']) ||
    item['itunes:image']?.['$']?.href ||
    fromHtml ||
    ''
  ).replace(/&amp;/g, '&');
}

// COD 判斷：標題命中就算；內文摘要只認「一定是 COD」的關鍵字，避免誤判
// 舊版用了 ghost / operator / activision / cold war / vanguard 這類泛用字，
// 導致 Ghost Rider、Halo、MCU 之類的新聞也被當成 COD
const COD_STRONG = /call of duty|\bwarzone\b|modern warfare|black ops|\bcod\b|\bmw[2-4]\b|\bbo[1-7]\b|\bdmz\b|treyarch|infinity ward|sledgehammer games|verdansk|urzikstan|rebirth island|omnimovement|\bcdl\b|call of duty league/i;
const COD_TITLE_EXTRA = /\bgulag\b|\bmakarov\b/i;
function isCodItem(title, summary) {
  return COD_STRONG.test(title) || COD_TITLE_EXTRA.test(title) || COD_STRONG.test(summary);
}

async function fetchSource(src) {
  if (src.disabled) {
    return { id: src.id, label: src.label, total: 0, matched: 0, items: [], error: null, disabled: true };
  }
  const parser = makeParser(src.ua || DEFAULT_UA);
  try {
    const feed = await parser.parseURL(src.url);
    const items = (feed.items || []).slice(0, 30).map(item => {
      const title = (item.title || '').trim();
      const summary = (item.contentSnippet || item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return {
        source: src.id,
        sourceLabel: src.label,
        tag: src.tag,
        title,
        summary,
        img: extractImg(item),
        link: item.link || '',
        date: item.isoDate || item.pubDate || '',
        // COD 專屬 feed 全部算 COD；綜合 feed 才用關鍵字判斷
        isCod: src.codOnly || isCodItem(title, summary),
      };
    });
    // 全部回傳，交給前端的「只看 COD」切換（舊版在後端就先砍掉，勾選框等於沒作用）
    return { id: src.id, label: src.label, total: items.length, matched: items.filter(i => i.isCod).length, items, error: null };
  } catch (e) {
    const msg = /attribute without value|non-whitespace before first tag|unexpected close tag/i.test(e.message)
      ? 'feed 回傳的不是 RSS（可能被擋或網址失效）'
      : e.message;
    return { id: src.id, label: src.label, total: 0, matched: 0, items: [], error: msg };
  }
}

app.get('/api/news', async (req, res) => {
  const results = await Promise.all(SOURCES.map(fetchSource));
  res.json(results);
});

app.post('/api/translate', express.json(), async (req, res) => {
  const { texts } = req.body;
  if (!texts || !texts.length) return res.status(400).json({ error: 'missing texts' });
  try {
    const results = {};
    // MyMemory 免費 API，每次一篇，並行處理
    const promises = texts.map(async (text, i) => {
      if (!text || !text.trim()) { results[i+1] = ''; return; }
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=en|zh-TW`;
      const r = await fetch(url);
      const data = await r.json();
      results[i+1] = data.responseData?.translatedText || text;
    });
    await Promise.all(promises);
    res.json({ results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname)));

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = 3131;
app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
      }
    }
  }
  console.log(`\nCOD Intel server 啟動成功！`);
  console.log(`電腦瀏覽器：http://localhost:${PORT}/cod-news.html`);
  console.log(`手機（同WiFi）：http://${localIP}:${PORT}/cod-news.html\n`);
});
