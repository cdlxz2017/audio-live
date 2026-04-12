# nftables 迁移分析报告

## 关键发现

### 当前系统有两套 iptables 并存

| 命令 | 后端 | 用途 |
|------|------|------|
| `iptables` | **nf_tables 内核** (nftables) | gfwlist 规则、Tailscale、LIBVIRT |
| `iptables-legacy` | **x_tables 内核** (旧) | Tailscale 特定规则 |
| `nft` | **nf_tables 内核** | 查询/管理同一套规则 |

### gfwlist 规则已在 nftables 中运行

当前 nftables 规则（`ip mangle OUTPUT`）：
```
xt match "set" counter packets 18767 bytes 6584616 meta mark set 0x1
```
- `xt match "set"` = nftables 原生语法（不是 xtables-legacy 的 iptables 兼容语法）
- 等价于 `iptables -t mangle -A OUTPUT -m set --match-set gfwlist dst -j MARK --set-mark 1`
- 由 iptables-nft 自动维护

当前 nftables NAT 规则（`ip nat POSTROUTING`）：
```
oifname "ppp0" meta mark 0x00000001 counter packets 370 masquerade
```
- 由 iptables-nft 自动维护
- 等价于 `iptables -t nat -A POSTROUTING -m mark --mark 1 -o ppp0 -j MASQUERADE`

## 迁移状态

**结论：迁移已完成，无需额外操作。**

gfwlist 规则已由 iptables-nft 托管，底层运行在 nftables (nf_tables 内核) 上。

## 验证方法

```bash
# 查看 gfwlist MARK 规则（nftables 格式）
sudo nft list chain ip mangle OUTPUT

# 查看 MASQUERADE 规则（nftables 格式）
sudo nft list chain ip nat POSTROUTING

# 查看计数器（验证规则在工作）
sudo iptables -t mangle -L OUTPUT -v -n | grep MARK
sudo iptables -t nat -L POSTROUTING -v -n | grep MASQUERADE
```

## nftables vs iptables-legacy 真实关系

```
用户: iptables -t mangle -A OUTPUT ...
           ↓
   iptables-nft 工具
           ↓
   nf_tables 内核 API
           ↓
   nftables 规则被创建
           ↓
   nft list 可以看到完全相同的规则
```

## 真正的问题是什么？

nftables 迁移并不解决 GFW 间歇性封锁问题。

gfwlist 规则已经在用 nftables，但：
1. ipset (hash:net) 需要预解析域名 → IP，CDN IP 变化会导致漏匹配
2. ppp0 重连后 ipset 需恢复 → 已通过 systemd + pppd scripts 修复
3. GFW 对澳门 4G 出口的实时封锁 → 需要代理方案才能根本解决
