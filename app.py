"""
Yahoo Finance 期权链代理服务 (Python Flask版本)
用于PythonAnywhere等Python托管平台部署

接口:
  GET /options/<symbol>  - 获取期权链
  GET /health            - 健康检查
"""

import re
import time
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# Cookie & Crumb 缓存
_yahoo_cookie = ''
_yahoo_crumb = ''
_crumb_expiry = 0
_cookie_expiry = 0


def get_fresh_crumb():
    """获取新鲜的crumb（缓存25分钟）"""
    global _yahoo_cookie, _yahoo_crumb, _crumb_expiry, _cookie_expiry
    now = time.time()

    if _yahoo_crumb and now < _crumb_expiry and _yahoo_cookie:
        return _yahoo_crumb

    # 1. 获取cookie
    try:
        resp = requests.get('https://fc.yahoo.com', headers={
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml',
        }, timeout=10, allow_redirects=True)
        cookie = resp.headers.get('set-cookie', '')
        if cookie:
            _yahoo_cookie = cookie.split(';')[0]
            _cookie_expiry = now + 3600
    except Exception as e:
        app.logger.warning(f'fc.yahoo.com cookie失败: {e}')

    # 2. 获取crumb
    try:
        resp = requests.get('https://query2.finance.yahoo.com/v1/test/getcrumb', headers={
            'User-Agent': UA,
            'Cookie': _yahoo_cookie,
            'Referer': 'https://finance.yahoo.com/',
        }, timeout=10)
        crumb = resp.text.strip()
        if crumb and len(crumb) > 2 and '<' not in crumb and '{' not in crumb:
            _yahoo_crumb = crumb
            _crumb_expiry = now + 1500  # 25分钟
            app.logger.info(f'新crumb: {crumb[:8]}...')
            return _yahoo_crumb
    except Exception as e:
        app.logger.warning(f'crumb获取失败: {e}')

    return None


@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response


@app.route('/options/<symbol>')
def get_options(symbol):
    symbol = symbol.upper()
    if not re.match(r'^[A-Z0-9.\-]{1,10}$', symbol):
        return jsonify({'error': 'Invalid symbol'}), 400

    date = request.args.get('date')
    crumb = get_fresh_crumb()

    url = f'https://query1.finance.yahoo.com/v7/finance/options/{symbol}'
    params = {}
    if crumb:
        params['crumb'] = crumb
    if date:
        params['date'] = date

    try:
        resp = requests.get(url, params=params, headers={
            'User-Agent': UA,
            'Accept': 'application/json',
            'Cookie': _yahoo_cookie,
            'Referer': f'https://finance.yahoo.com/quote/{symbol}/options/',
        }, timeout=15)

        data = resp.json()

        if data.get('optionChain', {}).get('error'):
            return jsonify({'error': 'Yahoo API error', 'detail': data['optionChain']['error']}), 502

        response = jsonify(data)
        response.headers['Cache-Control'] = 'public, max-age=300'
        return response

    except Exception as e:
        app.logger.error(f'期权链请求失败 {symbol}: {e}')
        return jsonify({'error': 'Failed to fetch', 'detail': str(e), 'symbol': symbol}), 502


@app.route('/health')
def health():
    now = time.time()
    return jsonify({
        'status': 'ok',
        'crumb_cached': bool(_yahoo_crumb),
        'crumb_expires_in': max(0, int(_crumb_expiry - now)) if _yahoo_crumb else 0,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    })


@app.route('/')
def index():
    return jsonify({
        'name': 'Yahoo Options Proxy (Python)',
        'endpoints': {
            'options': '/options/<symbol>',
            'health': '/health',
        },
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3000, debug=False)
