# Yahoo Finance 期权链代理服务

用于在中国大陆访问 Yahoo Finance 期权链 API（计算 GEX 净伽马敞口）。
代理运行在海外服务器，国内浏览器通过代理域名访问，绕过 Yahoo Finance 的大陆封锁。

## 为什么需要这个代理？

Yahoo Finance 从 2021 年 11 月起对中国大陆 IP 封锁，直接访问返回"无法从中国大陆使用"页面。
本代理部署在海外，国内浏览器访问代理域名即可获取期权链数据。

## 接口

| 接口 | 说明 |
|------|------|
| `GET /options/:symbol` | 获取单只股票/ETF期权链（含Gamma, Open Interest） |
| `GET /options/batch?symbols=GLD,SLV` | 批量获取 |
| `GET /health` | 健康检查 |
| `GET /` | 服务信息 |

示例：`https://your-app.onrender.com/options/GLD`

## 部署方案（二选一）

### 方案A：Render.com（推荐，免费，稳定）

Render 是海外 PaaS 平台，`onrender.com` 子域名国内可直接访问（约1秒响应）。
免费层每月 750 小时，代理服务完全够用。

**前置条件**：需要 GitHub 账号（Render 从 GitHub 导入代码）

**步骤**：

1. **把本目录代码推送到 GitHub**
   - 在 GitHub 创建新仓库 `yahoo-options-proxy`
   - 把 `server.js`、`package.json` 推送到仓库

2. **注册 Render**
   - 访问 https://render.com，用 GitHub 账号登录
   - 无需绑信用卡

3. **创建 Web Service**
   - 点击 "New +" → "Web Service"
   - 选择刚才的 GitHub 仓库
   - 配置：
     - Name: `yahoo-options-proxy`（或任意名字）
     - Region: 选 `Oregon` 或 `Virginia`（美国节点）
     - Runtime: `Node`
     - Build Command: `npm install`
     - Start Command: `npm start`
     - Instance Type: `Free`
   - 点击 "Create Web Service"

4. **等待部署完成**（约2-3分钟）
   - 部署成功后会显示域名：`https://yahoo-options-proxy.onrender.com`

5. **测试**
   - 浏览器访问 `https://yahoo-options-proxy.onrender.com/health`
   - 应返回 `{"status":"ok",...}`
   - 访问 `https://yahoo-options-proxy.onrender.com/options/GLD`
   - 应返回期权链JSON数据

### 方案B：PythonAnywhere（免费，无需GitHub）

PythonAnywhere 是海外 Python 托管平台，国内可直接访问（约1.3秒响应）。
免费层无需绑卡，但每天需登录续期。

**步骤**：

1. **注册 PythonAnywhere**
   - 访问 https://www.pythonanywhere.com，注册免费账号
   - 无需绑信用卡

2. **创建 Web App**
   - Dashboard → "Web" → "Add a new web app"
   - 选择 "Flask" → Python 3.10
   - 项目路径默认即可

3. **上传代码**
   - Dashboard → "Files"
   - 进入 `/home/你的用户名/mysite/`
   - 把 `app.py` 内容粘贴覆盖 `flask_app.py`
   - 在 `/home/你的用户名/` 创建 `requirements.txt`，内容：
     ```
     flask
     requests
     ```
   - 打开 "Consoles" → "Bash"，执行：
     ```bash
     pip install -r requirements.txt --user
     ```

4. **配置 WSGI**
   - Dashboard → "Web" → 点击 WSGI configuration file
   - 修改 `from flask_app import app as application` 为实际文件名
   - 保存

5. **Reload**
   - 点击 "Reload 你的用户名.pythonanywhere.com"

6. **测试**
   - 访问 `https://你的用户名.pythonanywhere.com/health`

## 部署后配置面板

拿到代理 URL 后（如 `https://yahoo-options-proxy.onrender.com`），
修改监控面板 `panels/gold.html` 中的 GEX 模块：

1. 找到 `fetchOptionsChain` 函数
2. 将 API 地址从 `https://query1.finance.yahoo.com/v7/finance/options/` 改为代理地址
3. 移除浏览器端 `getYahooCrumb()` 调用（代理端已处理 crumb）

修改后的代码：
```javascript
async function fetchOptionsChain(symbol){
  var url = 'https://你的代理域名/options/' + symbol
  try {
    var resp = await fetch(url)
    var data = await resp.json()
    var result = data.optionChain && data.optionChain.result
    if(result && result.length > 0) return result[0]
  } catch(e){ console.warn('[GEX]', symbol, '获取失败:', e.message) }
  return null
}
```

## 注意事项

- Render 免费层 15 分钟无请求会休眠，首次请求需约 30 秒唤醒。面板加载时会自动唤醒。
- 代理已内置 crumb 缓存（25分钟）和自动重试，无需浏览器端处理 cookie。
- 期权链数据缓存 5 分钟，减少 Yahoo API 调用。
- 如遇 Yahoo API 变更，更新 `server.js` 中的请求头即可。
