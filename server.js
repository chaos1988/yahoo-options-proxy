const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'yahoo-options-proxy', port: PORT, time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Yahoo Options Proxy is running', endpoints: ['/health', '/options/GLD', '/options/SLV'] });
});

app.get('/options/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const https = require('https');
    const cookieRes = await new Promise((resolve, reject) => {
      https.get('https://fc.yahoo.com', { headers: { 'User-Agent': 'Mozilla/5.0' } }, resolve).on('error', reject);
    });
    const cookies = cookieRes.headers['set-cookie'] || [];
    const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
    
    const crumbRes = await new Promise((resolve, reject) => {
      const req = https.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'Cookie': cookieStr, 'User-Agent': 'Mozilla/5.0' }
      }, resolve);
      req.on('error', reject);
    });
    let crumb = '';
    crumbRes.on('data', d => crumb += d);
    await new Promise(r => crumbRes.on('end', r));
    
    const dataRes = await new Promise((resolve, reject) => {
      const req = https.get(`https://query1.finance.yahoo.com/v7/finance/options/${symbol}?crumb=${encodeURIComponent(crumb)}`, {
        headers: { 'Cookie': cookieStr, 'User-Agent': 'Mozilla/5.0' }
      }, resolve);
      req.on('error', reject);
    });
    let data = '';
    dataRes.on('data', d => data += d);
    await new Promise(r => dataRes.on('end', r));
    
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(500).json({ error: e.message, symbol });
  }
});

app.listen(PORT, () => {
  console.log(`[proxy] running on port ${PORT}`);
});
