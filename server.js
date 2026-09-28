/**
 * Yahoo Finance 期权链代理服务
 * 用于在中国大陆访问Yahoo Finance期权链API（计算GEX净伽马敞口）
 * 
 * 部署平台：Render.com / Railway.app / 任何海外Node.js托管
 * 国内访问：onrender.com / up.railway.app 子域名均可直接访问
 * 
 * 接口：
 *   GET /options/:symbol  - 获取期权链（含Gamma, Open Interest）
 *   GET /health           - 健康检查
 *   GET /                 - 服务信息
 */

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// CORS 头 - 允许所有来源访问
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ============= Yahoo Finance Cookie & Crumb 管理 =============

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let yahooCookie = '';
let yahooCrumb = '';
let crumbExpiry = 0;
let cookieExpiry = 0;

/**
 * 获取新鲜的crumb（缓存30分钟）
 */
async function getFreshCrumb() {
  const now = Date.now();
  
  // crumb还在有效期内
  if (yahooCrumb && now < crumbExpiry && yahooCookie) {
    return yahooCrumb;
  }

  // 1. 访问 fc.yahoo.com 获取 cookie
  try {
    const fcResp = await fetch('https://fc.yahoo.com', {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    const setCookie = fcResp.headers.get('set-cookie') || fcResp.headers.get('Set-Cookie');
    if (setCookie) {
      yahooCookie = setCookie.split(';')[0];
      cookieExpiry = now + 60 * 60 * 1000; // cookie 1小时有效
    }
  } catch (e) {
    console.warn('[proxy] fc.yahoo.com cookie获取失败:', e.message);
  }

  // 2. 用cookie获取crumb
  try {
    const crumbResp = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Cookie': yahooCookie,
        'Referer': 'https://finance.yahoo.com/',
      },
    });
    const crumb = await crumbResp.text();
    if (crumb && crumb.length > 2 && crumb.indexOf('<') === -1 && crumb.indexOf('{') === -1) {
      yahooCrumb = crumb;
      crumbExpiry = now + 25 * 60 * 1000; // crumb 25分钟有效（留余量）
      console.log('[proxy] 新crumb获取成功:', crumb.substring(0, 8) + '...');
      return yahooCrumb;
    }
  } catch (e) {
    console.warn('[proxy] crumb获取失败:', e.message);
  }

  // 如果crumb获取失败，尝试不带crumb直接请求（某些情况下可行）
  return null;
}

// ============= 代理接口 =============

/**
 * 获取期权链
 * GET /options/:symbol?date=timestamp（可选，指定到期日）
 */
app.get('/options/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const date = req.query.date;
  
  // 验证symbol格式（只允许字母和数字，防止路径遍历）
  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  try {
    const crumb = await getFreshCrumb();
    
    let url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;
    const params = [];
    if (crumb) params.push(`crumb=${encodeURIComponent(crumb)}`);
    if (date) params.push(`date=${date}`);
    if (params.length) url += '?' + params.join('&');

    console.log(`[proxy] 请求期权链: ${symbol} ${date ? '(date=' + date + ')' : ''}`);

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': yahooCookie,
        'Referer': `https://finance.yahoo.com/quote/${symbol}/options/`,
      },
    });

    const text = await resp.text();
    
    // 尝试解析JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // 如果不是JSON，可能是crumb过期，强制刷新后重试一次
      console.warn('[proxy] 响应非JSON，刷新crumb重试...');
      crumbExpiry = 0;
      const newCrumb = await getFreshCrumb();
      let retryUrl = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;
      const retryParams = [];
      if (newCrumb) retryParams.push(`crumb=${encodeURIComponent(newCrumb)}`);
      if (date) retryParams.push(`date=${date}`);
      if (retryParams.length) retryUrl += '?' + retryParams.join('&');
      
      const retryResp = await fetch(retryUrl, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json',
          'Cookie': yahooCookie,
          'Referer': `https://finance.yahoo.com/quote/${symbol}/options/`,
        },
      });
      data = await retryResp.json();
    }

    // 检查Yahoo返回的错误
    if (data.optionChain && data.optionChain.error) {
      console.warn('[proxy] Yahoo错误:', data.optionChain.error);
      return res.status(502).json({ 
        error: 'Yahoo Finance API error', 
        detail: data.optionChain.error 
      });
    }

    // 缓存控制
    res.setHeader('Cache-Control', 'public, max-age=300'); // 缓存5分钟
    res.setHeader('X-Proxy-Cache', 'MISS');
    res.json(data);
    
  } catch (error) {
    console.error('[proxy] 期权链请求失败:', error.message);
    res.status(502).json({ 
      error: 'Failed to fetch options chain',
      detail: error.message,
      symbol: symbol
    });
  }
});

/**
 * 批量获取多个symbol的期权链
 * GET /options/batch?symbols=GLD,SLV
 */
app.get('/options/batch', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  
  if (!symbols.length || symbols.length > 5) {
    return res.status(400).json({ error: 'Provide 1-5 symbols separated by commas' });
  }

  try {
    const results = {};
    await Promise.all(symbols.map(async (symbol) => {
      try {
        const crumb = await getFreshCrumb();
        let url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;
        if (crumb) url += `?crumb=${encodeURIComponent(crumb)}`;
        
        const resp = await fetch(url, {
          headers: {
            'User-Agent': UA,
            'Accept': 'application/json',
            'Cookie': yahooCookie,
            'Referer': `https://finance.yahoo.com/quote/${symbol}/options/`,
          },
        });
        results[symbol] = await resp.json();
      } catch (e) {
        results[symbol] = { error: e.message };
      }
    }));

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(results);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    crumbCached: !!yahooCrumb,
    crumbExpiresIn: yahooCrumb ? Math.max(0, Math.round((crumbExpiry - Date.now()) / 1000)) : 0,
    timestamp: new Date().toISOString(),
  });
});

// 首页
app.get('/', (req, res) => {
  res.json({
    name: 'Yahoo Options Proxy',
    version: '1.0.0',
    description: 'Proxy for Yahoo Finance options chain API (GEX calculation)',
    endpoints: {
      options: '/options/:symbol',
      batch: '/options/batch?symbols=GLD,SLV',
      health: '/health',
    },
    usage: 'GET /options/GLD',
  });
});

app.listen(PORT, () => {
  console.log(`[proxy] Yahoo Options Proxy running on port ${PORT}`);
  console.log(`[proxy] 健康检查: http://localhost:${PORT}/health`);
});
