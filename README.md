# DDNS 动态域名解析工具

一个轻量级的 DDNS（动态域名解析）Web 应用，支持阿里云 DNS 服务，可自动检测公网 IP 变化并更新域名解析记录。

## ✨ 功能特性

- 🌐 **双栈支持**：同时支持 IPv4 和 IPv6，可独立开关
- ☁️ **阿里云 DNS**：完美兼容阿里云域名解析服务
- ⏰ **定时检测**：可配置检测间隔，自动更新 DNS 记录
- 🎛️ **Web 管理**：简洁美观的 Web 管理界面，操作便捷
- 📝 **更新日志**：完整记录每次 IP 更新历史
- 🪶 **轻量部署**：基于 Node.js + Express，依赖少，启动快
- 💾 **本地存储**：JSON 文件存储，无需数据库

## 🚀 快速开始

### 环境要求

- Node.js >= 14.0.0
- 阿里云账号，并开通云解析 DNS 服务
- 阿里云 AccessKey（建议使用子账号，仅授予 DNS 管理权限）

### 安装部署

#### Windows 系统

1. 下载并解压安装包
2. 双击运行 `start.bat`
3. 首次运行会自动安装依赖
4. 浏览器访问 `http://localhost:3000`

#### 手动启动

```bash
# 安装依赖
npm install --production

# 启动服务
npm start
# 或
node server.js
```

### 配置说明

1. 打开 Web 管理界面，点击右上角「设置」
2. 填入阿里云 AccessKey ID 和 AccessKey Secret
3. 设置检测间隔（默认 5 分钟）
4. 选择需要启用的 IP 协议（IPv4/IPv6）
5. 保存设置

### 添加域名

1. 在「域名管理」页面点击「新增域名」
2. 填写主域名（如 example.com）
3. 填写子域名（如 @ 或 www）
4. 选择记录类型（A 记录对应 IPv4，AAAA 记录对应 IPv6）
5. 设置 TTL 值（默认 600 秒）
6. 保存后系统会自动检测 IP 并更新 DNS

## 📁 目录结构

```
ddns-app/
├── server.js          # 主服务文件
├── package.json       # 项目配置
├── start.bat          # Windows 启动脚本
├── public/            # 前端静态文件
│   ├── index.html     # 主页面
│   ├── style.css      # 样式文件
│   └── app.js         # 前端逻辑
└── data/              # 数据目录
    ├── config.json    # 系统配置
    ├── domains.json   # 域名配置
    └── logs.json      # 更新日志
```

## 🔧 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 获取当前状态 |
| GET | `/api/system-config` | 获取系统配置 |
| PUT | `/api/system-config` | 更新系统配置 |
| GET | `/api/domain-configs` | 获取域名列表 |
| POST | `/api/domain-configs` | 新增域名配置 |
| PUT | `/api/domain-configs/:id` | 更新域名配置 |
| DELETE | `/api/domain-configs/:id` | 删除域名配置 |
| POST | `/api/manual-update` | 手动触发 IP 更新 |
| GET | `/api/update-logs` | 获取更新日志 |

## ⚠️ 注意事项

1. **安全建议**：阿里云 AccessKey 请使用子账号，仅授予 `AliyunDNSFullAccess` 权限
2. **端口配置**：默认端口 3000，可通过环境变量 `PORT` 修改
3. **防火墙**：如需外网访问管理界面，请确保防火墙开放对应端口
4. **IPv6 支持**：确保你的网络环境支持 IPv6，否则 IPv6 检测会失败
5. **定时任务**：服务启动后会自动执行定时检测，无需额外配置

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
