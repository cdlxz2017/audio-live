# 4G模块 GFWList 分流方案 v2

> 方案日期：2026-04-10
> 版本：v2（大幅完善，补充大量边界情况）
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
│                        ├─ youtube.com                       │
│                        └─ github.com                        │
│                                                              │
│  路由策略：                                                   │
│  ip rule: fwmark=1 → table gfwroute → 出wwan0              │
│  ip rule: (默认)  → table main     → 出eth0/wlan0         │
│                                                              │
│  DNS策略：                                                    │
│  dnsmasq: 国内域名→114.114.114.114 / GFWList→4G口DNS       │
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

# fwmark 标记规则（优先级100，优先于默认lookup）
ip rule add fwmark 1 table gfwroute pref 100
```

### 3.2 IPtables + IPSet 域名匹配

```bash
# 创建 ipset 名单（存GFWList域名）
ipset create gfwlist hash domain maxelem 2000000
# 导入 ~万级GFWList域名

# 标记规则（OUTPUT链：本机发起的连接）
iptables -t mangle -A OUTPUT -m set --match-set gfwlist dst -j MARK --set-mark 1
```

### 3.3 DNS 分流（dnsmasq + 国产白名单）

| 域名类型 | DNS 策略 |
|---------|---------|
| 国内域名（china-list白名单） | → 国内DNS 114.114.114.114 / 223.6.6.6 |
| GFWList域名 | → 海外DNS（通过4G模块解析，返回IP）|
| 其他未匹配域名 | → dnsmasq 上游默认（建议国内DNS）|

---

## 四、已知问题与 v2 补充（必读）

### 4.1 DNS-over-HTTPS / DNS-over-TLS（最大漏洞）

**问题**：Chrome、Firefox、系统dtered等默认使用 DoH/DoT，直接跳过 dnsmasq，无法分流。

**影响**：即便dnsmasq正确配置，浏览器访问GFWList域名时仍用DoH解析，得到国内污染IP，然后连接根本不走4G模块。

**解决方案**：
1. **在系统层封锁 DoH/DoT**（推荐）：
   ```bash
   # 屏蔽 Firefox DoH 配置
   echo 'user_pref("network.trr.mode", 5);' >> /etc/firefox/syspref.js

   # 屏蔽 Chrome DoH（通过阻止DNS-over-HTTPS域名）
   iptables -t mangle -A OUTPUT -d dns.google -j MARK --set-mark 1
   iptables -t mangle -A OUTPUT -d cloudflare-dns.com -j MARK --set-mark 1
   iptables -t mangle -A OUTPUT -d family.cloudflare-dns.com -j MARK --set-mark 1

   # 屏蔽 1.1.1.1 (Cloudflare DoH)
   iptables -t mangle -A OUTPUT -d 1.1.1.1 -j MARK --set-mark 1
   iptables -t mangle -A OUTPUT -d 1.0.0.1 -j MARK --set-mark 1

   # 屏蔽国内DoH域名（阿里、腾讯等）
   iptables -t mangle -A OUTPUT -d 'dns.alidns.com' -j MARK --set-mark 1
   iptables -t mangle -A OUTPUT -d 'dot.pub' -j MARK --set-mark 1
   ```

2. **拦截 DoH bootstrap 流量**：
   ```bash
   # 阻止 443/853 端口的DNS伪装流量（按需）
   # 注意：不要误杀正常的HTTPS流量
   iptables -A OUTPUT -p udp --dport 53 -m mark --mark 0x1 -j ACCEPT
   iptables -A OUTPUT -p tcp --dport 53 -m mark --mark 0x1 -j ACCEPT
   ```

3. **Firefox 用户**：在 `about:config` 设置 `network.trr.mode=5`（完全禁用TRR）

### 4.2 4G模块断开/重连应对

**问题**：4G模块可能断线（信号问题、SIM问题、驱动问题），重连后网关IP通常会变，静态路由失效。

**解决方案——Watchdog 脚本**：
```bash
# /usr/local/bin/gfwlist-watchdog.sh
#!/bin/bash
WWAN_DEV="${WWAN_DEV:-wwan0}"
LOG_FILE="/var/log/gfwlist-watchdog.log"

check_connectivity() {
    # 通过4G模块检测是否能访问被墙资源
    curl -sf --interface "$WWAN_DEV" --connect-timeout 5 https://www.google.com > /dev/null 2>&1
    return $?
}

update_route() {
    NEW_GW=$(ip route show dev "$WWAN_DEV" | grep default | awk '{print $3}' | head -1)
    if [ -z "$NEW_GW" ]; then
        echo "$(date) - 无法获取 $WWAN_DEV 网关" >> "$LOG_FILE"
        return 1
    fi
    ip route replace default via "$NEW_GW" dev "$WWAN_DEV" table gfwroute
    echo "$(date) - 路由已更新，新网关: $NEW_GW" >> "$LOG_FILE"
}

if ! check_connectivity; then
    echo "$(date) - 4G连接异常，尝试修复..." >> "$LOG_FILE"
    # 可选：重启 ModemManager / qmi-network
    # systemctl restart ModemManager
    sleep 5
    update_route
fi
```
```bash
# 添加 crontab，每分钟检查
* * * * * /usr/local/bin/gfwlist-watchdog.sh
```

**方案v2补充**：`setup-gfwlist-route.sh` 脚本应内置上述 watchdog 逻辑，或提供 `--watchdog` 选项。

### 4.3 UDP流量处理

**问题**：GFW对很多服务的封锁是UDP层面的（如QUIC/HTTP3、WireGuard、OpenVPN over UDP）。4G CGNAT对UDP支持有限，很多香港4G卡无法做UDP穿透。

**诊断**：
```bash
# 查看4G模块是否支持UDP
# 部分USB 4G模块的驱动不支持UDP，或运营商封锁了非53/443端口的UDP

# 测试UDP可达性
nc -u -p 12345 8.8.8.8 53  # 简单测试DNS UDP是否通
```

**解决方案**：
1. **明确告知用户**：4G模块适合TCP（HTTP/HTTPS），UDP应用（VoIP、视频流、VPN）可能不稳定
2. **对于必须UDP的场景**（如VoIP、视频）：建议额外配置proxy，脚本中注明限制
3. **对DNS**：使用TCP查询做兜底（dnsmasq 配置 `proxy-dns-pr` 或 `all-servers`）
   ```bash
   # dnsmasq 强制TCP（防止UDP投毒）
   echo "proxy-dns-pr" >> /etc/dnsmasq.d/gfwlist-dns.conf
   ```

### 4.4 IPv6流量处理

**问题**：方案v1明确写了"仅处理IPv4"，但IPv6 GFWList域名（如 ipv6.google.com）会直接通过默认路由（国内），导致无法访问。

**解决方案v2——IPv6处理**：
```bash
# 如果不需要IPv6（推荐）：完全禁用IPv6
sysctl -w net.ipv6.conf.all.disable_ipv6=1
sysctl -w net.ipv6.conf.default.disable_ipv6=1

# 如果需要IPv6：同样用ip6tables标记
ip6tables -t mangle -A OUTPUT -m set --match-set gfwlist6 dst -j MARK --set-mark 1

# 创建IPv6 ipset
ipset create gfwlist6 hash:ip6 family inet6 maxelem 2000000

# 路由表添加IPv6默认路由（通过4G）
ip -6 route add default dev wwan0 table gfwroute

# ip6 rule
ip -6 rule add fwmark 1 table gfwroute pref 100
```

**注意**：IPv6 ipset需要GFWList的IPv6地址列表（非域名）， Loyalsoldier/domain-list-dat 提供 `ipv6` 文件可下载，需额外处理。

### 4.5 与VPN共存的场景

**问题**：如果服务器同时运行VPN服务端/客户端，冲突会发生在：
1. VPN客户端分流规则（tun0）与gfwlist规则竞争
2. VPN的 `redirect-gateway` 可能覆盖我们的 fwmark 规则
3. VPN interface != wwan0，路由优先级混乱

**解决方案**：
```bash
# 方案A：VPN客户端不走4G（默认路由正常）
# 确保VPN不设置 redirect-gateway，或设置 exclude route

# 方案B：VPN流量单独处理（推荐）
# 只在 wwan0 上处理被墙流量，不影响tun0
iptables -t mangle -A OUTPUT -m set --match-set gfwlist dst -m owner ! --uid-owner vpnuser -j MARK --set-mark 1

# 方案C：使用 fwmark 优先级高于VPN
# 我们的 pref=100 优先于大部分VPN的路由
# 确认：ip rule show | grep fwmark

# 方案D：禁用VPN的 redirect-gateway
# WireGuard: AllowedIPs = 0.0.0.0/0 但配合 Table = off 在用户侧处理
```

**脚本v2应检测VPN接口并给出警告**：
```bash
# 检测常见VPN接口
for vpn_if in tun tap wireguard wg0 wg1; do
    if ip link show "$vpn_if" &>/dev/null; then
        echo "⚠ 检测到 $vpn_if，VPN与GFWList分流可能冲突，请检查路由表"
    fi
done
```

### 4.6 开机自启和持久化

**问题**：当前脚本手动执行后重启会失效，iptables规则、ipset、路由表都需要恢复。

**解决方案——systemd 服务**：
```bash
# /etc/systemd/system/gfwlist-route.service
[Unit]
Description=GFWList Policy Routing via 4G Module
After=network.target NetworkManager.service
Wants=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/gfwlist-route-init.sh
RemainAfterExit=yes
ExecStop=/usr/local/bin/gfwlist-route-cleanup.sh
StandardOutput=journal
ExecStartPre=/bin/sleep 10

[Install]
WantedBy=multi-user.target
```

**gfwlist-route-init.sh** 应包含：
- 等待 wwan0 接口上线
- 恢复 ipset 规则
- 恢复 iptables mangle 规则
- 设置 ip route 和 ip rule

**ipset 持久化**：
```bash
# 关机前保存
ipset save > /etc/ipset-gfwlist.conf

# 开机恢复
ipset restore < /etc/ipset-gfwlist.conf
```

**iptables 持久化**：
```bash
# 安装 iptables-persistent
apt-get install -y iptables-persistent
netfilter-persistent save
```

### 4.7 流量统计和日志

**补充统计脚本**：
```bash
# 查看通过4G模块的流量
iptables -t mangle -L OUTPUT -v -n | grep gfwlist

# 查看 fwmark 1 的流量统计
iptables -t mangle -L -v -n | grep MARK

# ipset 匹配统计（需要 ipset 扩展）
# 启用计数器：ipset create gfwlist hash domain counters

# 流量日志（调试用，慎用，会刷日志）
iptables -t mangle -A OUTPUT -m mark --mark 1 -j LOG --log-prefix "GFWLIST: "
```

**推荐日志位置**：`/var/log/gfwlist-route.log`

### 4.8 DNS污染问题

**问题**：通过4G模块去海外DNS（UDP 53）查询，理论上返回的是真实IP（香港出口），但：
1. 部分GFW封锁是UDP层面的投毒（即便走4G也可能被污染）
2. 如果4G模块经过国内关口（少数情况），DNS查询仍可能被拦截

**解决方案**：
1. **DNS-over-TLS (DoT)**：用 `stubby` 或 `cloudflare-watcher` 替代明文DNS
   ```bash
   # 用stubby做DoT，通过4G模块查询
   # stubby.yml 中设置 upstream：1.1.1.1, 8.8.8.8 (DoT)
   # 配合 fwmark=1 让 stubby 出站走 wwan0
   ```

2. **DNSSEC验证**：
   ```bash
   # dnsmasq 启用 DNSSEC
   echo "dnssec" >> /etc/dnsmasq.d/gfwlist-dns.conf
   # 配合 --trust-anchor= 选项
   ```

3. **nslookup 兜底**：某些被严重污染的域名，用 `nslookup -type=A domain 8.8.8.8` 验证

### 4.9 其他边界情况补充

#### 4.9.1 接口命名不确定性
USB 4G模块可能生成多种接口名：`wwan0`, `usb0`, `eth1`, `qmimuxxx`

**应对**：
```bash
# 方法：优先通过设备路径匹配
for dev in /sys/class/net/wwan* /sys/class/net/usb*; do
    iface=$(basename "$dev")
    # 检查是否是4G设备（通过 /sys/class/net/$iface/device 路径）
    if [ -d "/sys/class/net/$iface/device" ]; then
        WWAN_DEV="$iface"
        break
    fi
done

# 也可通过 ModemManager 查询
mmcli -L 2>/dev/null | grep -i modem
```

#### 4.9.2 DNSSEC 验证（重要）
国内DNS（114.114.114.114）通常不支持DNSSEC验证，海外DoT可以。

**建议**：
```bash
# 在dnsmasq中启用DNSSEC
echo "dnssec" >> /etc/dnsmasq.d/gfwlist-dns.conf
echo "trust-anchor=.,20326,8,2,E06D44B80B8F1D39A95C0B0D7C65D08458E880409BBC683457104237C7F8EC8D" >> /etc/dnsmasq.d/gfwlist-dns.conf
```

#### 4.9.3 mangle OUTPUT链的限制
**重要**：mangle OUTPUT 只影响本机发起的连接。如果服务器同时做路由器（NAT网关），其他机器的流量走 FORWARD 链，不受 OUTPUT 规则影响。

```bash
# 如果服务器同时做网关，需要额外规则
iptables -t mangle -A FORWARD -m set --match-set gfwlist dst -j MARK --set-mark 1
```

#### 4.9.4 GFWList base64 解码细节
gfwlist.txt 是 base64 编码，但其中包含多行 `||domain.com^` 格式，解码后需要正确提取域名：

```python
# 正确的解码逻辑（脚本中Python部分应如下）：
import base64, re
decoded = base64.b64decode(content).decode('utf-8', errors='ignore')
# 支持多种格式：
# ||example.com^
# |https://example.com|
# .example.com
# @@||example.com^  (白名单格式)
domains = set()
for line in decoded.splitlines():
    line = line.strip()
    if not line or line.startswith('!'):
        continue
    # 白名单（@@）开头的跳过
    if line.startswith('@@'):
        continue
    # 提取域名：去掉 || | . @@ /^ 等前缀后缀
    d = re.sub(r"^\|\||^\||^\.\.|^@@\|\|", "", line.split('/')[0])
    d = d.strip('.')
    if d and '*' not in d and re.match(r"^[\w.-]+$", d):
        domains.add(d)
```

#### 4.9.5 与 NetworkManager 共存
如果服务器用 NetworkManager 管理网络，4G模块可能由它接管。需要排除：
```bash
# /etc/NetworkManager/NetworkManager.conf
# 在 [main] 添加：
# unmanaged-devices=interface-name:wwan0
```

然后 `systemctl restart NetworkManager`。

---

## 五、v2 脚本关键改进点

相比 v1，setup-gfwlist-route.sh 需要做以下改进：

| 改进项 | v1 | v2 |
|--------|----|----|
| DoH/DoT 屏蔽 | ❌ | ✅ iptables 拦截主流DoH域名 |
| 4G断线Watchdog | ❌ | ✅ 建议用systemd timer |
| IPv6支持 | ❌ | ✅ 可选启用 |
| VPN共存检测 | ❌ | ✅ 警告检测 |
| systemd服务 | ❌ | ✅ 提供服务文件模板 |
| ipset持久化 | ❌ | ✅ ipset save/restore |
| DNSSEC | ❌ | ✅ 可选启用 |
| 接口自动检测 | ❌ | ✅ 优先设备路径匹配 |
| FORWARD链 | ❌ | ✅ 服务器做网关时补充 |
| GFWList解码 | 简单 | ✅ 正确处理白名单格式 |

---

## 六、完整 systemd 服务模板

**/etc/systemd/system/gfwlist-route.service**：
```ini
[Unit]
Description=GFWList Policy Routing via 4G Module
After=network-online.target ModemManager.service
Wants=network-online.target
After=iptables-persistent.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/gfwlist-route-init.sh
ExecStop=/usr/local/bin/gfwlist-route-cleanup.sh
RemainAfterExit=yes
StandardOutput=journal
StandardError=journal
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
```

**/usr/local/bin/gfwlist-route-init.sh**（开机执行）：
```bash
#!/bin/bash
set -e

WWAN_DEV="${WWAN_DEV:-$(ls /sys/class/net/wwan* 2>/dev/null | head -1 | xargs basename)}"
[ -z "$WWAN_DEV" ] && exit 1

# 等待4G网络就绪
timeout 30 bash -c 'until ip link show "$0" | grep -q UP; do sleep 1; done' "$WWAN_DEV"

# 恢复 ipset
ipset restore -! < /etc/ipset-gfwlist.conf 2>/dev/null || true

# 恢复路由
WWAN_GW=$(ip route show dev "$WWAN_DEV" | grep default | awk '{print $3}' | head -1)
[ -n "$WWAN_GW" ] && ip route replace default via "$WWAN_GW" dev "$WWAN_DEV" table gfwroute

# 添加规则（如果不存在）
grep -q "gfwroute" /etc/iproute2/rt_tables || echo "200 gfwroute" >> /etc/iproute2/rt_tables
ip rule add fwmark 1 table gfwroute pref 100 2>/dev/null || true
```

---

## 七、数据来源

| 数据 | 来源 |
|------|------|
| GFWList域名 | `Loyalsoldier/domain-list-dat`（gfwlist分支）|
| 国内域名白名单 | `felixonmars/dnsmasq-china-list` |
| GFWList IPv6地址 | `Loyalsoldier/domain-list-dat`（ipv6分支，可选） |

---

## 八、脚本使用说明（v2）

### 快速开始
```bash
# 基本配置
sudo bash /home/ai/.openclaw/workspace/scripts/gfwlist-route/setup-gfwlist-route.sh

# 启用完整功能（含DoH屏蔽、Watchdog）
sudo WWAN_DEV=wwan0 DOH_BLOCK=1 WATCHDOG=1 bash setup-gfwlist-route.sh

# 启用IPv6支持
sudo bash setup-gfwlist-route.sh --ipv6
```

### 开机自启
```bash
sudo cp gfwlist-route.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gfwlist-route.service
```

### 测试
```bash
# 查看路由
ip route show table gfwroute
ip rule show

# 测试google是否走4G
curl -I https://www.google.com
ip route get $(nslookup www.google.com | grep Address | tail -1 | awk '{print $2}')

# 查看ipset域名数量
ipset list gfwlist | wc -l

# 查看哪些IP走了4G
iptables -t mangle -L OUTPUT -v -n | grep "gfwlist"

# 查看watchdog日志
journalctl -u gfwlist-watchdog -f
```

### 卸载
```bash
sudo systemctl disable --now gfwlist-route.service
ip rule del fwmark 1 table gfwroute
ipset destroy gfwlist
ipset destroy gfwlist6 2>/dev/null || true
rm -rf /etc/gfwlist /etc/dnsmasq.d/gfwlist-dns.conf /etc/ipset-gfwlist.conf
systemctl restart dnsmasq
```

---

## 九、方案整体评价

**v1方案核心思路正确**，策略路由+ipset+dnsmasq的组合是成熟方案。

**v2需要重点关注的改进**：
1. **DoH/DoT屏蔽**是最大的漏洞，v1完全未处理
2. **4G断线无Watchdog**是稳定性隐患，必须补充
3. **IPv6明确禁用**比留空好，应在sysctl中显式关闭
4. **systemd服务**是持久化的唯一可靠方案
5. **VPN共存**需明确文档警告

---

## 十、已知限制（v2仍存在）

1. **GitHub Raw 访问**：服务器目前无法直接访问 `raw.githubusercontent.com`，GFWList需等4G模块插上后下载
2. **UDP应用**：4G CGNAT限制，部分UDP应用可能不稳定
3. **本机路由器模式**：如果服务器同时做NAT网关，需额外配置FORWARD链
4. **域名匹配粒度**：ipset hash:domain 只能匹配整个域名，不支持路径级分流

---

*方案 v2 由 AI 审查并补充，2026-04-10*
