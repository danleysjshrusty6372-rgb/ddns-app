# DDNS 动态域名解析服务

轻量级 DDNS 应用，支持 IPv4 / IPv6 动态解析，兼容阿里云 DNS。

## 功能特性

- **双栈支持** — 同时支持 IPv4 (A记录) 和 IPv6 (AAAA记录)，可独立开关
- **Web 管理面板** — 可视化管理域名、配置、查看日志、手动同步
- **阿里云 DNS** — 通过阿里云 API 自动更新域名解析记录，自实现签名无需SDK
- **定时同步** — 秒数间隔设置，默认每 5 分钟检测 IP 变化并更新
- **轻量简洁** — 纯 Node.js，无需数据库，配置存储为 JSON 文件
- **多API备选** — 自动尝试多个 IP 检测服务，提高可用性
- **密钥安全** — 支持显示/隐藏密钥，自动清理格式
- **详细日志** — 语法高亮日志，同步结果面板
- **NAT 检测** — 检测是否有公网 IP，提示用户

## 快速开始（客户端安装）

### 方法一：使用安装包（推荐）

1. 下载最新版本的安装包
2. 双击运行安装程序
3. 按照提示完成安装
4. 桌面上会创建快捷方式，双击即可启动

### 方法二：使用 Electron 客户端

1. 下载 `DDNS-Service-win32-x64.zip`
2. 解压到任意目录
3. 运行 `DDNS-Service.exe`

### 方法三：命令行启动（高级用户）

```bash
git clone https://github.com/danleysjshrusty6372-rgb/ddns-app.git
cd ddns-app
npm install
npm start
```

浏览器访问 `http://localhost:3000`

## 防火墙配置

如果需要从外网访问，需要开放 3000 端口：

**Windows 防火墙：**
1. 右键点击 `配置防火墙.bat`，选择"以管理员身份运行"
2. 或手动添加规则：`netsh advfirewall firewall add rule name="DDNS-Web" dir=in action=allow protocol=tcp localport=3000`

**路由器端口映射（仅 IPv4）：**
- 登录路由器管理页面
- 添加端口映射：外网端口 3000 → 内网 IP:3000

## 使用说明

1. 打开 Web 管理面板
2. 填入阿里云 AccessKey ID 和 Secret，保存
3. 添加需要 DDNS 解析的域名（如 `example.com`，主机记录 `@` 或 `www`）
4. 选择 IPv4 / IPv6 解析类型
5. 设置同步间隔（建议 300 秒）
6. 点击「立即同步」测试

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
  "interval": 300,
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
│   ├── aliyun.js      # 阿里云 DNS API 客户端
│   └── config.js      # 配置读写、日志管理
├── public/
│   └── index.html     # Web 管理面板
├── electron/
│   └── main.js        # Electron 客户端
├── data/              # 运行时数据
├── dist/              # 打包输出
├── install.bat        # 安装脚本
├── start.bat          # 启动脚本
└── package.json
```

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JS（零框架）
- **客户端**: Electron
- **阿里云 API**: 自实现 HMAC-SHA1 签名
- **IP检测**: 使用 curl 调用多个在线服务

## License

MIT
