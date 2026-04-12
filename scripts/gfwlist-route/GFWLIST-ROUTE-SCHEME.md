# 4G模块 GFWList 分流方案

> 方案日期：2026-04-10
> 用途：被墙网站走4G模块（香港卡国际出口），正常网站走默认路由
> 脚本位置：`/home/ai/.openclaw/workspace/scripts/gfwlist-route/setup-gfwlist-route.sh`

---

## 一、方案背景

### 现状
- 服务器在国内，默认路由访问外网受限
- 已购买 USB 4G 模块（香港卡），可直连国际互联网
- 目标：只有被墙的网站走 4G 模块，其他全部走默认路由

### 技术原理
```
访问请求
├── 目标域名不在GFWList → 国内DNS解析 → 正常路由 → 国内可达
└── 目标域名在GFWList  → 海外DNS解析 → fwmark=1 → 查gfwroute表 → 走4G模块 → 香港出口
```

---

## 二、网络架构

```
┌──────────────────────────────────────────────────────────────┐
│                      Linux 服务器                             │
│                                                              │
│  eth0/wlan0          wwan0 (4G模块)                          │
│  默认路由              香港卡国际出口                          │
│  ├─ 国内网站           ├─ google.com                        │
│  └─ 可达外网           ├─ twitter.com                       │
│                        └─ youtube.com                       │
│                                                              │
│  路由策略：                                                   │
│  ip rule: fwmark=1 → table gfwroute → 出wwan0              │
│  ip rule: (默认)    → table main    → 出eth0/wlan0        │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、技术方案

### 3.1 策略路由（iproute2）

```bash
# /etc/iproute2/rt_tables 添加路由表
200 gfwroute

# 4G模块默认路由写入 gfwroute 表
ip route add default via <4G网关> dev wwan0 table gfwroute

# fwmark 标记规则
ip rule add fwmark 1 table gfwroute pref 100
```

### 3.2 IPtables + IPSet 域名匹配

```bash
# 创建 ipset 名单（存GFWList域名）
ipset create gfwlist hash domain
# 导入 ~万个GFWList域名

# 标记规则
iptables -t mangle -A OUTPUT -m set --match-set gfwlist dst -j MARK --set-mark 1
```

### 3.3 DNS 分流（dnsmasq）

| 域名类型 | DNS 策略 |
|---------|---------|
| 国内域名（baidu.com等） | → 国内DNS 114.114.114.114 |
| GFWList域名 | → 海外DNS（走4G解析，返回IP）|

---

## 四、数据来源

| 数据 | 来源 |
|------|------|
| GFWList域名 | `Loyalsoldier/domain-list-dat`（GFWList分支）|
| 国内域名白名单 | `felixonmars/dnsmasq-china-list` |

---

## 五、脚本使用说明

### 使用前提
- 4G模块已插入，接口识别为 `wwan0`
- 4G模块已联网（dhcp获取到IP）
- 服务器有网络连接

### 一键配置
```bash
sudo bash /home/ai/.openclaw/workspace/scripts/gfwlist-route/setup-gfwlist-route.sh
```

### 手动指定接口
```bash
WWAN_DEV=wwan0 sudo bash /home/ai/.openclaw/workspace/scripts/gfwlist-route/setup-gfwlist-route.sh
```

### 测试
```bash
# 查看路由
ip route show table gfwroute
ip rule show

# 测试google是否走4G
curl -I https://www.google.com
ip route get <google-ip>

# 查看ipset名单数量
ipset list gfwlist | wc -l
```

### 卸载
```bash
ip rule del fwmark 1 table gfwroute
ipset destroy gfwlist
rm -rf /etc/gfwlist /etc/dnsmasq.d/gfwlist-dns.conf
systemctl restart dnsmasq
```

---

## 六、已知限制

1. **GitHub Raw 访问**：服务器目前无法直接访问 `raw.githubusercontent.com`，GFWList 需等4G模块插上后下载
2. **DNS缓存**：首次配置后建议清空浏览器DNS缓存
3. **IPv6**：本方案仅处理IPv4流量

---

## 七、脚本核心流程

```
1. 检查 4G 接口是否存在（ip link show）
2. 获取 4G 网关地址
3. 下载 GFWList（base64格式）→ 解码 → 提取域名
4. 下载国内域名白名单
5. 添加路由表 gfwroute
6. 创建 ipset gfwlist 并导入域名
7. 添加 iptables mangle 规则（OUTPUT链）
8. 配置 dnsmasq DNS 分流
9. 完成提示
```

---

## 八、备选方案（如脚本下载失败）

手动下载 GFWList：

```bash
# 方法1：通过npm包下载
npm install -g genpac
genpac -p "SOCKS5 127.0.0.1:1080" -o gfwlist.txt

# 方法2：等4G模块到了再下载
# 插上模块后：
curl -L https://raw.githubusercontent.com/Loyalsoldier/domain-list-dat/release/gfwlist.txt -o /etc/gfwlist/gfwlist.txt

# 方法3：用国内镜像
curl -L https://ghproxy.com/https://raw.githubusercontent.com/Loyalsoldier/domain-list-dat/release/gfwlist.txt -o /etc/gfwlist/gfwlist.txt
```

---

## 九、完整脚本

脚本完整内容见：`/home/ai/.openclaw/workspace/scripts/gfwlist-route/setup-gfwlist-route.sh`

---

*方案由 AI 辅助生成，如有疑问可随时联系。*
