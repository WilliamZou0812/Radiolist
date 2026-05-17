/**
 * cloudflare-proxy.js — Cloudflare Worker
 * 台灣廣播 HTTP→HTTPS 串流代理
 *
 * ══════════════════════════════════════════════════════════════
 *  用途：將 HTTP 電台串流包成 HTTPS，解決瀏覽器混合內容阻擋問題
 *  費用：Cloudflare Workers 免費方案每天 100,000 次請求（足夠）
 * ══════════════════════════════════════════════════════════════
 *
 *  部署步驟：
 *  1. 前往 https://dash.cloudflare.com → Workers & Pages → Create
 *  2. 選「Create Worker」，貼上此程式碼，點「Deploy」
 *  3. 取得 Worker URL，例如 https://tw-radio-proxy.yourname.workers.dev
 *  4. 在 index.html 的電台資料中，將 HTTP URL 替換為代理 URL：
 *
 *     原始：http://fm929.cityfm.tw:8080/929.mp3
 *     代理：https://tw-radio-proxy.yourname.workers.dev/proxy?url=http%3A%2F%2Ffm929.cityfm.tw%3A8080%2F929.mp3
 *
 *  5. 或使用輔助函式（見下方 index.html 修改說明）
 * ══════════════════════════════════════════════════════════════
 *
 *  安全性：
 *  - 僅允許已知的台灣廣播域名（白名單）
 *  - CORS 已開放，允許你的網站域名
 * ══════════════════════════════════════════════════════════════
 */

// ── 允許的域名白名單 ─────────────────────────────────────────────
const ALLOWED_HOSTS = [
  'cityfm.tw',
  'pbs.gov.tw',
  '59.120.255',  // 微微笑高屏系列
  '59.125.',     // 微微笑台南/台中系列
  '60.248.',     // 微微笑嘉義
  '61.218.',     // 幸福廣播
  '61.219.',     // 花蓮希望之聲
  '61.220.',     // 噶瑪蘭廣播
  '211.72.',     // 微微笑桃竹金門
  '211.20.',     // 苗栗正義
  '140.136.',    // 輔大之聲
  '140.119.',    // 政大之聲
  '202.39.',     // Hit FM
  '1.34.',       // 美聲廣播
  '60.250.',     // 大樹下廣播
  '59.120.88',   // 古典音樂台
  'ndhu.edu.tw', // 東華之聲
  'mcu.edu.tw',  // 銘傳之聲
];

// ── 允許的來源 (CORS) ────────────────────────────────────────────
// 加入你的網站網址，例如 'https://your-site.com'
const ALLOWED_ORIGINS = [
  'https://williamzou0812.github.io/Radiolist/',      // ← 改成你的網站
  'http://localhost',
  'http://localhost:3000',
  'http://127.0.0.1',
  'null', // local file://
];

// ── Main handler ─────────────────────────────────────────────────
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const origin = request.headers.get('Origin') || '';

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  const reqUrl = new URL(request.url);
  const targetUrl = reqUrl.searchParams.get('url');

  // Validate
  if (!targetUrl) {
    return jsonResponse({ error: 'Missing ?url= parameter' }, 400, origin);
  }

  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { return jsonResponse({ error: 'Invalid URL' }, 400, origin); }

  // Whitelist check
  const hostOk = ALLOWED_HOSTS.some(h => parsed.hostname.includes(h) || parsed.host.includes(h));
  if (!hostOk) {
    return jsonResponse({ error: 'Domain not in allowlist: ' + parsed.hostname }, 403, origin);
  }

  // Proxy the stream
  try {
    const upstream = await fetch(targetUrl, {
      method:  request.method,
      headers: {
        'User-Agent':  'Mozilla/5.0 (compatible; TW-Radio-Proxy/1.0)',
        'Icy-MetaData': '0',
        // Forward Range header for seeking (if present)
        ...(request.headers.get('Range') ? { 'Range': request.headers.get('Range') } : {}),
      },
      // Stream body for POST (rare but safe)
      body: ['POST', 'PUT'].includes(request.method) ? request.body : undefined,
    });

    // Build response headers
    const respHeaders = new Headers();
    respHeaders.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '*');
    respHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    respHeaders.set('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Accept-Ranges');

    // Forward useful upstream headers
    const forward = ['Content-Type', 'Content-Length', 'Accept-Ranges',
                     'Content-Range', 'Transfer-Encoding', 'icy-name',
                     'icy-genre', 'icy-br', 'icy-url'];
    forward.forEach(h => {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    });

    // Default Content-Type for audio if missing
    if (!respHeaders.has('Content-Type')) {
      respHeaders.set('Content-Type', 'audio/mpeg');
    }

    return new Response(upstream.body, {
      status:  upstream.status,
      headers: respHeaders,
    });

  } catch (err) {
    return jsonResponse({ error: 'Upstream fetch failed: ' + err.message }, 502, origin);
  }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.includes(origin) ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Origin, Accept',
    'Access-Control-Max-Age':       '86400',
  };
}

function jsonResponse(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/**
 * ══════════════════════════════════════════════════════════════
 *  index.html 修改說明 — 啟用代理後，替換 HTTP 電台 URL
 *
 *  在 index.html 的 <script> 最頂部加入：
 *
 *  const PROXY = 'https://tw-radio-proxy.yourname.workers.dev/proxy?url=';
 *  function p(url) {
 *    return url.startsWith('http:') ? PROXY + encodeURIComponent(url) : url;
 *  }
 *
 *  然後在 REGIONS 電台資料中把所有 url 改為 p(url)，例如：
 *  { name: '城市廣播網 台中 FM92.9', url: p('http://fm929.cityfm.tw:8080/929.mp3'), ... }
 *
 *  或批次替換（在 buildCard 函式裡加一行）：
 *  const actualUrl = (s.url.startsWith('http:') && typeof PROXY !== 'undefined')
 *    ? PROXY + encodeURIComponent(s.url)
 *    : s.url;
 *  然後用 actualUrl 代替 s.url 傳給播放邏輯。
 * ══════════════════════════════════════════════════════════════
 */
