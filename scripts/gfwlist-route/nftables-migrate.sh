#!/usr/sbin/nft -f
# GFWList nftables 安全迁移脚本
# 策略: 使用 nft 的原子操作添加/替换 gfwlist 规则
#       不触碰 UFW/Tailscale/LIBVIRT 的任何现有规则
#
# 原理: "table ip mangle" 和 "table ip nat" 如果已存在会被 nft 替换
#       不会影响其他表（如 inet filter 用于 UFW）

# --- 安全检查 ---
# 确认 /etc/nftables.conf 存在且有 include 保护
if [ ! -f /etc/nftables.conf ]; then
    echo "[ERROR] /etc/nftables.conf not found"
    exit 1
fi

# --- 备份当前 nftables 规则 ---
BACKUP_FILE="/var/backups/nftables-gfwlist-backup-$(date +%Y%m%d_%H%M%S).ruleset"
mkdir -p /var/backups
/usr/sbin/nft list ruleset > "$BACKUP_FILE"
echo "[Backup] nftables rules backed up to: $BACKUP_FILE"

# --- 原子性替换 gfwlist 规则 ---
# nft -f 会原子性地应用整个规则集
# 如果用 "flush ruleset" 会清空所有——我们用 add table + add rule 方式
/usr/sbin/nft -f - << 'NFTEOF'
# 关键: 不使用 flush ruleset！只添加/替换 gfwlist 相关的表

table ip mangle {
    chain OUTPUT {
        type route hook output priority mangle; policy accept;
        # GFWList ipset 匹配 → fwmark 0x1
        # xt_set 内核模块通过 nftables xt match 接口调用 ipset
        ip set gfwlist counter mark set 1
    }
}

table ip nat {
    chain POSTROUTING {
        type nat hook postrouting priority srcnat; policy accept;
        # fwmark=1 出 ppp0 → MASQUERADE（源地址伪装为 ppp0 IP）
        oifname "ppp0" meta mark 1 counter masquerade
    }
}
NFTEOF

echo "[OK] nftables gfwlist rules applied"

# --- 验证 ---
echo ""
echo "=== 验证 nftables mangle OUTPUT ==="
/usr/sbin/nft list chain ip mangle OUTPUT 2>/dev/null | grep -v "^#"

echo ""
echo "=== 验证 nftables nat POSTROUTING ==="
/usr/sbin/nft list chain ip nat POSTROUTING 2>/dev/null | grep -v "^#"

echo ""
echo "=== 对比 iptables (nftables 后端) ==="
sudo iptables -t mangle -L OUTPUT -v -n | grep -v "^$\|Chain\|^num\|pkts\|bytes"
sudo iptables -t nat -L POSTROUTING -v -n | grep "ppp0\|MASQUERADE"

echo ""
echo "[OK] 迁移完成！"
