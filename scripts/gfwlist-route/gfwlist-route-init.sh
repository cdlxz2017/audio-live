#!/bin/bash
# GFWList 分流开机初始化脚本

WWAN_DEV="ppp0"

# 等待 ppp0 上线
for i in $(seq 1 30); do
    ip link show ppp0 2>/dev/null | grep -q UP && break
    sleep 2
done

# 路由表
grep -q "gfwroute" /etc/iproute2/rt_tables || echo "200 gfwroute" >> /etc/iproute2/rt_tables
ip route replace default dev ppp0 table gfwroute 2>/dev/null

# ip rule
ip rule del fwmark 1 table gfwroute 2>/dev/null || true
ip rule add fwmark 1 table gfwroute pref 100
ip rule del from 10.51.40.41 table gfwroute 2>/dev/null || true
ip rule add from 10.51.40.41 table gfwroute pref 50

# ipset 恢复
ipset create gfwlist hash:net counters maxelem 100000 2>/dev/null || true
[ -f /etc/ipset-gfwlist.conf ] && ipset restore -! < /etc/ipset-gfwlist.conf

# iptables
iptables -t mangle -C OUTPUT -m set --match-set gfwlist dst -j MARK --set-mark 1 2>/dev/null || \
    iptables -t mangle -A OUTPUT -m set --match-set gfwlist dst -j MARK --set-mark 1
iptables -t nat -C POSTROUTING -m mark --mark 1 -o ppp0 -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -m mark --mark 1 -o ppp0 -j MASQUERADE

# 启动 dnsmasq
pkill -f "dnsmasq.*gfwlist" 2>/dev/null || true
sleep 1
/usr/sbin/dnsmasq --conf-file=/etc/gfwlist/dnsmasq-gfwlist.conf

ip route flush cache
echo "[gfwlist-route] 初始化完成"
