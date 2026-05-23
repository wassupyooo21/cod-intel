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
    codOnly: true,
  },
  {
    id: 'vgc', label: 'VGC',
    tag: { bg: '#0e2218', color: '#4acd8d' },
    url: 'https://www.videogameschronicle.com/category/news/feed/',
    ua: DEFAULT_UA,
    codOnly: true,
  },
  {
    id: 'dot', label: 'Dot Esports',
    tag: { bg: '#2a1010', color: '#f87171' },
    url: 'https://dotesports.com/feed',
    ua: DEFAULT_UA,
    codOnly: true,
  },
  {
    id: 'mp1st', label: 'MP1st',
    tag: { bg: '#221a08', color: '#fbbf24' },
    url: 'https://mp1st.com/tag/call-of-duty/feed',
    ua: DEFAULT_UA,
    codOnly: true,
  },
  {
    id: 'ign', label: 'IGN',
    tag: { bg: '#1a0e0e', color: '#f0a050' },
    url: 'https://feeds.ign.com/ign/all',
    ua: DEFAULT_UA,
    codOnly: true,
  },
  {
    id: 'sportskeeda', label: 'Sportskeeda',
    tag: { bg: '#0e1a1a', color: '#2dd4bf' },
    url: 'https://www.sportskeeda.com/call-of-duty/feed',
    ua: 'Mozilla/5.0 (compatible; Feedfetcher-Google; +http://www.google.com/feedfetcher.html)',
    codOnly: true,
  },
  {
    id: 'pcgamer', label: 'PC Gamer',
    tag: { bg: '#1a0a1a', color: '#c084fc' },
    url: 'https://www.pcgamer.com/rss/',
    ua: DEFAULT_UA,
    codOnly: true,
  },
];

function extractImg(item) {
  return (
    item.enclosure?.url ||
    item['media:thumbnail']?.['$']?.url ||
    item['media:content']?.['$']?.url ||
    item['itunes:image']?.['$']?.href ||
    ''
  );
}

async function fetchSource(src) {
  const parser = makeParser(src.ua || DEFAULT_UA);
  try {
    const feed = await parser.parseURL(src.url);
    const COD_RE = /call of duty|warzone|cod\b|modern warfare|black ops|mw[0-9]|bo[0-9]|dmz|activision|infinity ward|treyarch|sledgehammer|blackout|cold war|vanguard|ghost|makarov|operator|gulag|verdansk|rebirth|urzikstan|omnimovement/i;
    const allItems = (feed.items || []).slice(0, 30).map(item => ({
      source: src.id,
      sourceLabel: src.label,
      tag: src.tag,
      title: item.title || '',
      summary: (item.contentSnippet || item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      img: extractImg(item),
      link: item.link || '',
      date: item.pubDate || item.isoDate || '',
    }));
    // COD 專屬 feed 全部顯示；綜合 feed 才過濾
    const items = src.codOnly ? allItems : allItems.filter(i => COD_RE.test(i.title + ' ' + i.summary));
    return { id: src.id, label: src.label, total: allItems.length, matched: items.length, items, error: null };
  } catch (e) {
    return { id: src.id, label: src.label, total: 0, items: [], error: e.message };
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
