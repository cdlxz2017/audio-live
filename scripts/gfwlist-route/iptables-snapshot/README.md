# GFWList iptables 方案快照 (2026-04-12)

## 当前架构

```
GFWList 域名 → dnsmasq(127.0.0.2:53) → 8.8.8.8(走ppp0) → ipset gfwlist(hash:net)
                                                    ↓ 114.114.114.114(国内)

流量路由：
  iptables mangle OUTPUT: dst ∈ gfwlist → fwmark=1
  ip rule: fwmark=1 → gfwroute表 → ppp0
  iptables nat: fwmark=1 out ppp0 → MASQUERADE
  国内流量 → 默认WiFi路由
```

## 核心组件

1. **dnsmasq**: 监听 127.0.0.2:53，GFWList域名→8.8.8.8(境外DNS)，其他→114.114.114.114
2. **ipset gfwlist**: hash:net类型，存储预解析的GFWList IP（约1400条）
3. **iptables mangle**: 匹配gfwlist ipset → MARK set 0x1
4. **gfwroute路由表**: default dev ppp0，fwmark=1的流量走ppp0
5. **iptables nat MASQUERADE**: fwmark=1出ppp0时做源地址伪装
6. **DNS静态路由**: 8.8.8.8/1.1.1.1/8.8.4.4 → ppp0（防DNS污染）

## 局限性

- 内核不支持 hash:domain，只能预解析IP到hash:net
- CDN IP变化会导致部分域名失效
- ipset在ppp0重连后需从持久化文件恢复

## ip rule 顺序

```
0:   from all lookup local
50:  from 10.51.40.41 lookup gfwroute   (ppp0回程路由)
100: from all fwmark 0x1 lookup gfwroute (gfwlist分流)
5210-5270: tailscale规则
32766: from all lookup main
32767: from all lookup default
```

## gfwroute 表

```
default dev ppp0 scope link
```

## 关键命令

```bash
# 查看gfwlist ipset
sudo ipset list gfwlist | grep -c '^[0-9]'

# 查看mangle命中
sudo iptables -t mangle -L OUTPUT -v -n

# 查看NAT命中
sudo iptables -t nat -L POSTROUTING -v -n | grep "mark match 0x1"

# 恢复ipset
sudo ipset restore -! < /etc/ipset-gfwlist.conf

# 测试DNS
dig @127.0.0.2 www.google.com A
```
