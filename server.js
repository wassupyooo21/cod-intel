<script>
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.startsWith('192.168.');
const BASE = IS_LOCAL ? `http://${location.hostname}:3131` : 'https://cod-intel.onrender.com';
const API = `${BASE}/api/news`;
// COD 判斷改由後端處理（item.isCod），前後端不會再各自一套規則

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let allItems = [], allRawItems = [], activeSource = 'all', sourceList = [];

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (isNaN(s) || s < 0) return '';
  if (s < 60) return '剛剛';
  if (s < 3600) return Math.floor(s / 60) + ' 分鐘前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小時前';
  return Math.floor(s / 86400) + ' 天前';
}

async function loadAll() {
  allItems = []; allRawItems = [];
  document.getElementById('status').innerHTML = '<span class="spinner"></span>載入中...';
  document.getElementById('feed').innerHTML = '';
  document.getElementById('debugBar').className = 'debug-bar';
  document.getElementById('serverWarn').style.display = 'none';

  let results;
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    results = await res.json();
  } catch (e) {
    document.getElementById('serverWarn').style.display = 'block';
    document.getElementById('status').textContent = '無法連線到 server';
    return;
  }

  // 動態建立 source bar
  const active = results.filter(r => !r.disabled);
  sourceList = [{ id: 'all', label: 'All' }, ...active.map(r => ({ id: r.id, label: r.label }))];
  buildSourceBar();

  const debugLines = active.map(r =>
    r.error
      ? `<span class="debug-err">✗ ${esc(r.label)}：${esc(r.error)}</span>`
      : `<span class="debug-ok">✓ ${esc(r.label)}</span> COD ${r.matched} / 共 ${r.total} 篇`
  ).join('　　');
  document.getElementById('debugBar').innerHTML = debugLines;
  document.getElementById('debugBar').className = 'debug-bar show';

  active.forEach(r => {
    allItems.push(...r.items.filter(i => i.isCod));
    allRawItems.push(...r.items);
  });

  allItems.sort((a, b) => new Date(b.date) - new Date(a.date));
  allRawItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  const now = new Date();
  document.getElementById('lastUpdate').innerHTML =
    `<span class="live-dot"></span>更新於 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  render();
}

function render() {
  const filterOn = document.getElementById('filterToggle').checked;
  const pool = filterOn ? allItems : allRawItems;
  const items = activeSource === 'all' ? pool : pool.filter(i => i.source === activeSource);
  document.getElementById('status').textContent = items.length + ' 則消息';

  if (!items.length) {
    document.getElementById('feed').innerHTML = `<div class="empty"><div style="font-size:36px;margin-bottom:12px">📭</div><div>沒有找到文章</div><div style="margin-top:6px;font-size:12px">試試關閉「只看 COD」篩選</div></div>`;
    return;
  }

  document.getElementById('feed').innerHTML = items.map(renderCard).join('');
}

function buildSourceBar() {
  document.getElementById('sourceBar').innerHTML = sourceList.map(s =>
    `<button class="src-btn${s.id === 'all' ? ' active' : ''}" data-id="${s.id}" onclick="setSource('${s.id}')">${s.label}</button>`
  ).join('');
}

function setSource(id) {
  activeSource = id;
  document.querySelectorAll('.src-btn').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  render();
}

document.getElementById('filterToggle').addEventListener('change', render);

let translated = false;
let translateCache = {};

async function batchTranslate(items) {
  const toTranslate = [];
  items.forEach((item, i) => {
    if (!item.titleZH) {
      toTranslate.push({ idx: i, field: 'title', text: item.title });
      toTranslate.push({ idx: i, field: 'summary', text: item.summary });
    }
  });
  if (!toTranslate.length) return;
  try {
    const texts = toTranslate.map(t => t.text);
    const res = await fetch(`${BASE}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'translate failed');
    const { results } = data;
    toTranslate.forEach((t, i) => {
      const r = results[i+1];
      if (!r) return;
      if (t.field === 'title') items[t.idx].titleZH = r;
      else items[t.idx].summaryZH = r;
    });
  } catch(e) { console.error('[translate] error:', e); alert('翻譯失敗：' + e.message); }
}

async function toggleTranslate() {
  const btn = document.getElementById('translateBtn');
  if (translated) {
    translated = false;
    btn.textContent = '譯 中文';
    btn.disabled = false;
    render();
    return;
  }
  translated = true;
  btn.textContent = '⏳ 翻譯中...';
  btn.disabled = true;
  const filterOn = document.getElementById('filterToggle').checked;
  const pool = filterOn ? allItems : allRawItems;
  const items = (activeSource === 'all' ? pool : pool.filter(i => i.source === activeSource)).slice(0, 30);
  await batchTranslate(items);
  btn.textContent = '🌐 顯示英文';
  btn.disabled = false;
  render();
}

function renderCard(item) {
  const ts = item.tag ? `background:${item.tag.bg};color:${item.tag.color};` : 'background:#1e1e24;color:#888899;';
  const imgHtml = item.img
    ? `<img class="card-img" src="${esc(item.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=card-img-ph>▣</div>'">`
    : `<div class="card-img-ph">▣</div>`;
  const title = (translated && item.titleZH) ? item.titleZH : item.title;
  const summary = (translated && item.summaryZH) ? item.summaryZH : item.summary;
  return `<a class="card" href="${esc(item.link)}" target="_blank" rel="noopener">
    <div class="card-inner">
      <div class="card-body">
        <div class="card-top"><span class="src-tag" style="${ts}">${esc(item.sourceLabel)}</span><span class="card-time">${timeAgo(item.date)}</span></div>
        <p class="card-title">${esc(title)}</p>
        <p class="card-summary">${esc(summary)}</p>
      </div>${imgHtml}
    </div>
  </a>`;
}

loadAll();
</script>
</body>
</html>
