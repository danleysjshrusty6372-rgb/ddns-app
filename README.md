# DDNS 动态域名解析服务

轻量级 DDNS 应用，支持 IPv4/IPv6 动态解析，兼容阿里云、腾讯云、华为云、Cloudflare 四大云厂商。内置 Web 管理面板，一键安装，开机自启，后台静默运行。

## 功能特性

### 多云厂商支持
- **阿里云 DNS** — AccessKey ID + Secret 认证
- **腾讯云 DNSPod** — SecretId + SecretKey 认证
- **华为云 DNS** — AK + SK 认证
- **Cloudflare** — API Token 认证

### IP 检测
- **IPv4 / IPv6 双栈** — 可独立开关，自动检测公网 IP
- **多 API 备选** — ipify、ident.me、ifconfig.me、icanhazip 等 8+ 个服务自动切换
- **curl 模式** — 兼容 Windows 代理和企业网络环境

### NAT 类型检测（STUN 协议）
- 自实现 STUN 客户端（RFC 5389），无需第三方库
- 10 个公共 STUN 服务器（腾讯、小米、Google、Cloudflare、Twilio 等）
- 自动判断 NAT 类型：NAT0（公网）→ NAT1（完全锥形）→ NAT4（对称型）
- 提示 DDNS 是否可用，对称型 NAT 会警告用户

### 同步机制
- 定时轮询同步，默认 5 分钟间隔（30~86400 秒可调）
- 启动后自动首次同步
- 智能比对：IP 未变则跳过，有变化才更新 DNS 记录

### Web 管理面板
- 纯原生 HTML/CSS/JS，零框架依赖
- 云厂商切换、密钥显示/隐藏、连接测试
- 域名增删改、记录类型选择（A/AAAA/自动）
- NAT 类型检测面板，STUN 服务器自选
- 实时同步结果、语法高亮日志

### 桌面客户端（Electron）
- 系统托盘常驻，关闭窗口不退出
- 双击托盘图标打开管理面板
- 右键菜单：打开面板、查看日志、打开配置目录、退出服务
- 只有点击「退出 DDNS 服务」才真正停止后台同步

## 下载安装

### 方法一：下载安装包（推荐）

前往 [Releases](https://github.com/danleysjshrusty6372-rgb/ddns-app/releases) 页面下载最新安装包：

1. 下载 `DDNS-Service-Setup-v4.2.0.exe`
2. 双击运行安装程序
3. 安装完成后自动启动，桌面出现快捷方式
4. 程序会自动注册开机自启，重启电脑后无需手动启动

### 方法二：便携版（免安装）

1. 在 Releases 页面下载 `DDNS-Service-win32-x64.zip`
2. 解压到任意目录
3. 运行 `DDNS-Service.exe`

### 方法三：从源码运行

```bash
git clone https://github.com/danleysjshrusty6372-rgb/ddns-app.git
cd ddns-app
npm install
npm start
```

浏览器访问 http://localhost:3000

## 使用教程

### 第一步：配置云厂商

打开 DDNS 管理面板，在「云厂商 API 配置」区域：

| 云厂商 | 需要填写 | 获取方式 |
|--------|----------|----------|
| 阿里云 | AccessKey ID + Secret | [阿里云控制台](https://ram.console.aliyun.com/manage/ak) |
| 腾讯云 | SecretId + SecretKey | [腾讯云控制台](https://console.cloud.tencent.com/cam/capi) |
| 华为云 | AK + SK | [华为云控制台](https://console.huaweicloud.com/iam/#/mine/accessKey) |
| Cloudflare | API Token | [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) |

填写后点击「保存配置」，再点「测试连接」确认凭证有效。

### 第二步：添加域名

在「域名管理」区域，点击「添加域名」：

- **域名**：你的顶级域名，如 `example.com`
- **主机记录（RR）**：`@` 表示根域名，`www` 表示子域名，`*` 表示泛解析
- **记录类型**：`自动` 会根据 IPv4/IPv6 设置自动选择 A 或 AAAA 记录
- **状态**：开关控制是否启用该域名

点击「保存域名」。

### 第三步：设置同步

在「IP 类型设置」区域：
- 开启 IPv4 和/或 IPv6
- 设置同步间隔（建议 300 秒即 5 分钟）

### 第四步：同步测试

点击「立即同步」按钮，查看同步结果面板。首次同步会创建 DNS 记录，后续同步只在 IP 变化时更新。

### NAT 类型检测

点击「刷新IP」会同时检测 NAT 类型：
- **NAT0（Open Internet）**：设备有公网 IP，DDNS 正常
- **NAT1（Full Cone NAT）**：最宽松的 NAT，DDNS 正常
- **NAT4（Symmetric NAT）**：对称型 NAT，DDNS 可能无法从外网访问

## 程序行为说明

### 安装版
- 安装后自动启动，桌面创建快捷方式
- 注册开机自启（写入注册表 `HKCU\...\Run`）
- 关闭窗口 → 程序最小化到系统托盘（右下角小三角里），后台继续同步
- 双击托盘图标 → 重新打开管理面板
- 右键托盘图标 → 打开面板 / 查看日志 / 打开配置目录 / 退出服务
- **只有右键托盘图标选择「退出 DDNS 服务」，程序才会真正退出**

### 便携版
- 运行 `DDNS-Service.exe` 后行为同上（无开机自启）
- 如需开机自启，手动创建快捷方式放到启动文件夹

## 防火墙配置

如果需要从外网访问 Web 管理面板，需开放 3000 端口：

```powershell
# 以管理员身份运行 PowerShell
netsh advfirewall firewall add rule name="DDNS-Web" dir=in action=allow protocol=tcp localport=3000
```

如需路由器端口映射（仅 IPv4）：
1. 登录路由器管理页面
2. 添加端口映射：外网端口 3000 → 内网 IP:3000

## 配置文件

配置存储在 `data/config.json`，日志在 `data/ddns.log`：

```json
{
  "port": 3000,
  "provider": "aliyun",
  "credentials": {
    "aliyun": { "accessKeyId": "", "accessKeySecret": "" },
    "tencent": { "secretId": "", "secretKey": "" },
    "huawei": { "ak": "", "sk": "", "region": "cn-north-1" },
    "cloudflare": { "apiToken": "" }
  },
  "domains": [
    { "domain": "example.com", "rr": "@", "type": "", "enabled": true }
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
│   ├── server.js          # Express 服务 + REST API
│   ├── config.js          # 配置读写、日志管理
│   ├── ddns.js            # IP 获取、NAT 检测、域名同步
│   ├── stun.js            # STUN 协议客户端（NAT 类型检测）
│   ├── aliyun.js          # 阿里云 DNS API 客户端
│   └── providers/
│       ├── index.js       # Provider 工厂模式
│       ├── cloudflare.js  # Cloudflare DNS API
│       ├── tencent.js     # 腾讯云 DNSPod API
│       └── huawei.js      # 华为云 DNS API
├── public/
│   └── index.html         # Web 管理面板（单页应用）
├── electron/
│   ├── main.js            # Electron 主进程（托盘常驻）
│   ├── icon.ico           # 应用图标
│   └── package.json       # Electron 打包配置
├── data/                  # 运行时数据（配置 + 日志）
├── dist/                  # 打包输出
├── scripts/
│   └── generate-icon.js   # 图标生成脚本
├── install.bat            # 依赖安装脚本
├── start.bat              # 命令行启动脚本
├── installer.iss          # Inno Setup 安装包脚本
└── package.json
```

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JS（零框架）
- **桌面**: Electron（托盘常驻模式）
- **API**: 四家云厂商均自实现签名，无 SDK 依赖
- **STUN**: 自实现 RFC 5389 协议客户端
- **IP 检测**: curl + 多服务 fallback

## License

MIT
