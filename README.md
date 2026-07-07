# DDNS 动态域名解析服务

轻量级 DDNS 应用，支持 IPv4 / IPv6 动态解析，兼容阿里云 DNS。

## 功能特性

- 🚀 **轻量简洁** — 纯 Node.js，无需数据库，配置存储为 JSON 文件
- 🌐 **双栈支持** — 同时支持 IPv4 (A记录) 和 IPv6 (AAAA记录)，可独立开关
- ☁️ **阿里云 DNS** — 通过阿里云 API 自动更新域名解析记录
- 🖥️ **Web 管理面板** — 可视化管理域名、配置、查看日志、手动同步
- ⏰ **定时同步** — 基于 cron 表达式，默认每 5 分钟检测 IP 变化并更新

## 快速开始

### 环境要求

- Node.js >= 16
- 阿里云 AccessKey（需 DNS 权限）

### 安装

```bash
# 双击运行 install.bat
# 或手动执行：
npm install
```

### 运行

```bash
# 双击 start.bat
# 或
npm start
```

浏览器访问 `http://localhost:3000`

## 使用说明

1. 打开 Web 管理面板
2. 填入阿里云 AccessKey ID 和 Secret，保存
3. 添加需要 DDNS 解析的域名（如 `example.com`，主机记录 `@` 或 `www`）
4. 选择 IPv4 / IPv6 解析类型
5. 点击「立即同步」测试，或等待定时任务自动执行

## 配置说明

配置文件存储在 `data/config.json`：

```json
{
  "port": 3000,
  "aliyun": {
    "accessKeyId": "你的AccessKey ID",
    "accessKeySecret": "你的AccessKey Secret",
    "regionId": "cn-hangzhou"
  },
  "domains": [
    {
      "domain": "example.com",
      "rr": "@",
      "type": "A",
      "enabled": true
    }
  ],
  "cron": "*/5 * * * *",
  "ipv4": true,
  "ipv6": false
}
```

## 项目结构

```
ddns-app/
├── src/
│   ├── server.js      # Express 服务 + REST API
│   ├── ddns.js        # DDNS 核心逻辑（IP检测、更新）
│   ├── aliyun.js      # 阿里云 DNS API 客户端（自签名，零SDK依赖）
│   └── config.js      # 配置读写、日志管理
├── public/
│   └── index.html     # Web 管理面板
├── data/              # 运行时数据（config.json, ddns.log）
├── install.bat        # Windows 安装脚本
├── start.bat          # Windows 启动脚本
└── package.json
```

## 技术栈

- **后端**: Node.js + Express
- **定时任务**: node-cron
- **前端**: 原生 HTML/CSS/JS（零框架）
- **阿里云 API**: 自实现 HMAC-SHA1 签名，无需 SDK

## License

MIT
