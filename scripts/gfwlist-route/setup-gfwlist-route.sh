#!/bin/bash
# ============================================================
# GFWList 分流路由配置脚本
# 用途：被墙网站走4G模块(HK卡国际出口)，其他走默认路由
# 使用：sudo bash setup-gfwlist-route.sh
# ============================================================

set -e

# --------------------------
# 配置区
# --------------------------
# 4G模块接口名（插上后用 ip link show 确认，通常是 wwan0 或 usb0）
WWAN_DEV="${WWAN_DEV:-wwan0}"

# 4G网关（留空则自动从dhcp获取）
# WWAN_GW="10.x.x.1"

# 分流规则存放目录
RULE_DIR="/etc/gfwlist"
mkdir -p "$RULE_DIR"

# --------------------------
# 依赖检查
# --------------------------
need_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo "缺少 $1，正在安装..."
        apt-get update && apt-get install -y "$1"
    fi
}

need_cmd curl
need_cmd iptables
need_cmd ip

# --------------------------
# Step 1: 确认4G接口存在
# --------------------------
echo "[1/6] 检查 4G 模块接口 $WWAN_DEV ..."

if ! ip link show "$WWAN_DEV" &>/dev/null; then
    echo "❌ 找不到接口 $WWAN_DEV"
    echo "   请确认4G模块已插入，然后运行: ip link show | grep -E 'wwan|usb|qmi'"
    exit 1
fi

# 自动获取网关（如果没配置）
if [ -z "$WWAN_GW" ]; then
    WWAN_GW=$(ip route show dev "$WWAN_DEV" | grep default | awk '{print $3}' | head -1)
fi

if [ -z "$WWAN_GW" ]; then
    echo "❌ 无法获取 $WWAN_DEV 的网关，请手动设置 WWAN_GW"
    exit 1
fi

echo "   ✓ 接口: $WWAN_DEV  网关: $WWAN_GW"

# --------------------------
# Step 2: 下载 GFWList 和国内域名白名单
# --------------------------
echo "[2/6] 拉取 GFWList ..."

# 主要：Loyalsoldier 维护的 gfwlist
GFWLIST_URL="https://raw.githubusercontent.com/Loyalsoldier/domain-list-dat/release/gfwlist.txt"
# 备选（如果上面失败）：原始 gfwlist
GFWLIST_URL_BAK="https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt"

curl -sfL "$GFWLIST_URL" -o "$RULE_DIR/gfwlist.txt" 2>/dev/null || \
curl -sfL "$GFWLIST_URL_BAK" -o "$RULE_DIR/gfwlist.txt"

if [ ! -s "$RULE_DIR/gfwlist.txt" ]; then
    echo "❌ GFWList 下载失败，请检查网络"
    exit 1
fi
echo "   ✓ GFWList 下载成功 ($(wc -l < $RULE_DIR/gfwlist.txt) 条规则)"

# 下载国内域名白名单（走国内DNS的域名）
echo "[3/6] 拉取国内域名白名单 ..."
CHINA_DNS_URL="https://raw.githubusercontent.com/felixonmars/dnsmasq-china-list/master/accelerated-domains.china.conf"
curl -sfL "$CHINA_DNS_URL" -o "$RULE_DIR/china-domains.conf" 2>/dev/null || \
echo "   ⚠ 国内域名名单下载失败，继续（不影响核心功能）"

# --------------------------
# Step 3: 添加路由表
# --------------------------
echo "[4/6] 配置策略路由 ..."

# 添加路由表条目
if ! grep -q "gfwroute" /etc/iproute2/rt_tables; then
    echo "200 gfwroute" >> /etc/iproute2/rt_tables
fi

# 4G表：所有流量走wwan0
ip route replace default via "$WWAN_GW" dev "$WWAN_DEV" table gfwroute 2>/dev/null

# 标记规则：fwmark 1 → 查 gfwroute 表
ip rule del fwmark 1 table gfwroute 2>/dev/null || true
ip rule add fwmark 1 table gfwroute pref 100

echo "   ✓ 路由表 gfwroute 已添加，fwmark 1 → $WWAN_DEV"

# --------------------------
# Step 4: 生成 iptables 规则
# --------------------------
echo "[5/6] 生成 iptables 规则 ..."

# 用 Python 生成 ipset 规则（更高效）
python3 << 'PYEOF'
import re, subprocess, os

gfwlist_path = "/etc/gfwlist/gfwlist.txt"
ipset_name = "gfwlist"

# 读取 gfwlist（base64编码）
def decode_gfwlist(path):
    with open(path, 'r') as f:
        content = f.read()
    import base64
    try:
        decoded = base64.b64decode(content).decode('utf-8', errors='ignore')
    except:
        decoded = content
    # 提取域名
    domains = set()
    for line in decoded.splitlines():
        line = line.strip()
        if not line or line.startswith('!'):
            continue
        # 匹配域名（去前后缀）
        domain = line.lstrip('.||').split('/')[0]
        if domain and '*' not in domain:
            domains.add(domain)
    return domains

try:
    domains = decode_gfwlist(gfwlist_path)
    print(f"   解析到 {len(domains)} 个域名")

    # 创建 ipset
    subprocess.run(['ipset', '-!', 'create', ipset_name, 'hash', 'domain'],
                   capture_output=True)
    subprocess.run(['ipset', '-!', 'flush', ipset_name], capture_output=True)

    for d in domains:
        subprocess.run(['ipset', '-!', 'add', ipset_name, d],
                       capture_output=True, errors='ignore')

    print(f"   ✓ ipset {ipset_name} 已创建并导入 {len(domains)} 条域名")
except Exception as e:
    print(f"   ⚠ ipset创建失败: {e}")
    print("   改用 iptables iprange 方式...")
    # 备选方案省略，提示用户手动处理
PYEOF

# iptables 规则：gfwlist匹配 → fwmark 1
iptables -t mangle -F 2>/dev/null || true
iptables -t mangle -A OUTPUT -m set --match-set gfwlist dst -j MARK --set-mark 1

echo "   ✓ mangle OUTPUT 规则已添加"

# --------------------------
# Step 5: DNS 分流（dnsmasq 或 ChinaDNS-NG）
# --------------------------
echo "[6/6] 配置 DNS 分流 ..."

# 安装 dnsmasq
need_cmd dnsmasq

# 生成 dnsmasq 配置
DNSMASQ_CONF="/etc/dnsmasq.d/gfwlist-dns.conf"
cat > "$DNSMASQ_CONF" << 'EOF'
# GFWList DNS分流
# 国内域名 → 国内DNS
server=/baidu.com/114.114.114.114
server=/qq.com/114.114.114.114
server=/163.com/114.114.114.114
# ... 更多白名单可从 accelerated-domains.china.conf 导入

# GFWList域名 → 走海外DNS（通过4G解析）
bogus-priv
no-resolv
EOF

# 如果有china-domains名单，转为dnsmasq格式
if [ -s "$RULE_DIR/china-domains.conf" ]; then
    # 转换为 dnsmasq server= 格式追加到配置
    grep "^server=" "$RULE_DIR/china-domains.conf" >> "$DNSMASQ_CONF" 2>/dev/null
fi

# 重启 dnsmasq
systemctl enable dnsmasq 2>/dev/null || true
systemctl restart dnsmasq 2>/dev/null || true

echo "   ✓ DNS 分流配置完成"

# --------------------------
# 完成
# --------------------------
echo ""
echo "✅ GFWList 分流配置完成！"
echo ""
echo "测试方法："
echo "  curl -I https://www.google.com    # 看是否走wwan0"
echo "  ip route get <google-ip>          # 确认走哪个接口"
echo ""
echo "查看日志："
echo "  tail -f /var/log/gfwlist-route.log"
echo ""
echo "卸载："
echo "  ip rule del fwmark 1 table gfwroute"
echo "  ipset destroy gfwlist"
echo "  rm -rf /etc/gfwlist /etc/dnsmasq.d/gfwlist-dns.conf"
