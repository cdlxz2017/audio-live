# 全局流量直连优先、代理备用的 Fallback 方案

## 1. 方案概述和架构图

### 核心目标
实现系统级网络流量智能路由：每个 TCP 连接**先尝试直连目标**，若直连失败（超时或拒绝），则自动通过指定的代理（172.16.2.2:7893，Clash 代理）重试，仅当两者均失败时才报错。

### 设计原则
- **透明拦截**：无需修改应用程序代码，所有出站 TCP 流量自动进入 fallback 逻辑。
- **连接级粒度**：每个连接独立判断直连是否可用，不是全局切换。
- **低延迟**：直连成功时无代理开销。
- **故障隔离**：单个目标地址失败不影响其他地址的直连。

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                   应用程序 (App1, App2, ...)                  │
└─────────────────┬───────────────────────────────────────────┘
                  │ (原始 socket 调用)
┌─────────────────▼───────────────────────────────────────────┐
│                Linux 内核 (netfilter/iptables)              │
│                    ┌────────────────────┐                   │
│                    │ PREROUTING (mangle)│                   │
│                    │ 标记出站 TCP 流量   │                   │
│                    └─────────┬──────────┘                   │
│                              │                              │
│                    ┌─────────▼──────────┐                   │
│                    │ OUTPUT (nat)       │                   │
│                    │ DNAT 到本地透明代理 │                   │
│                    └─────────┬──────────┘                   │
└──────────────────────────────┼──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│               透明代理 (Fallback Proxy Daemon)               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. 接受被重定向的连接                                  │  │
│  │ 2. 解析原始目标 (IP:PORT)                             │  │
│  │ 3. 尝试直连 (带超时)                                   │  │
│  │    ├─ 成功 → 转发数据                                  │  │
│  │    └─ 失败 → 通过上游代理连接                          │  │
│  │         ├─ 成功 → 转发数据                             │  │
│  │         └─ 失败 → 关闭连接，返回错误                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────┬───────────────────────────────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
┌───────▼──────┐    ┌────────▼────────┐
│  直连互联网   │    │ 上游代理        │
│              │    │ 172.16.2.2:7893 │
│              │    │ 认证: Clash      │
│              │    │ 密码: kqH3gbeA   │
└──────────────┘    └─────────────────┘
```

### 关键组件
1. **流量重定向**：使用 iptables 在 OUTPUT 链将指定流量 DNAT 到本地透明代理端口。
2. **透明代理**：自定义代理服务，实现直连/代理 fallback 逻辑。
3. **上游代理客户端**：支持 SOCKS5/HTTP 代理协议，带认证。
4. **DNS 处理**：避免 DNS 泄漏，将 DNS 查询也通过代理或直连 fallback。

## 2. 所需的代理软件或自写方案

### 方案选择：自写透明代理 + 现有代理客户端
我们选择**自写一个轻量级透明代理**，原因：
- 现有透明代理软件（如 redsocks、danted）不支持“先直连后代理”的 fallback 逻辑。
- 自定义代理可以精确控制超时、重试和错误处理。
- 代码量不大（约 200-300 行 Python/Go），易于维护。

### 技术栈
- **代理语言**：Python 3（使用 `asyncio` 异步）或 Go（性能更好）。本文以 Python 示例，便于理解。
- **上游代理协议**：SOCKS5（Clash 默认支持），需认证。
- **流量拦截**：iptables（Linux 内核支持）。
- **DNS**：dnsmasq 或使用代理的 DNS 解析。

### 依赖包
```bash
# Python 依赖
pip install pysocks aiohttp asyncio
# 或使用 Go 版本（无额外依赖）
```

## 3. Fallback 的实现逻辑

### 算法伪代码
```
function handle_connection(client_socket, original_dest):
    dest_ip, dest_port = original_dest
    
    # 第一步：尝试直连
    direct_socket = connect_with_timeout(dest_ip, dest_port, timeout=3s)
    if direct_socket.success:
        log("直连成功")
        start_bidirectional_forward(client_socket, direct_socket)
        return
    
    # 第二步：直连失败，尝试代理
    proxy_socket = connect_to_proxy("172.16.2.2", 7893, timeout=5s)
    if not proxy_socket.success:
        close(client_socket)
        log("直连和代理均失败")
        return
    
    # 代理认证
    send_socks5_auth(proxy_socket, "Clash", "kqH3gbeA")
    if auth_failed:
        close_all()
        return
    
    # 通过代理连接目标
    send_socks5_connect(proxy_socket, dest_ip, dest_port)
    if proxy_connect_failed:
        close_all()
        log("代理连接目标失败")
        return
    
    log("代理连接成功")
    start_bidirectional_forward(client_socket, proxy_socket)
```

### 超时与重试策略
- **直连超时**：3 秒（可配置）。超时或连接拒绝视为失败。
- **代理连接超时**：5 秒（网络可能较慢）。
- **无重试**：每个连接仅尝试一次直连和一次代理，避免延迟累积。
- **并发处理**：异步 I/O 同时处理多个连接。

### 连接状态跟踪
- 记录每个目标的直连成功率，可未来用于优化（例如对常失败目标跳过直连）。
- 但为保持简单，本方案不做长期状态缓存。

## 4. 如何让全局流量都走这个 fallback 代理（不修改应用代码）

### 4.1 使用 iptables 透明重定向
```bash
# 创建新的链
iptables -t nat -N FALLBACK_PROXY

# 跳过本地流量和代理自身流量（重要！）
iptables -t nat -A FALLBACK_PROXY -d 127.0.0.0/8 -j RETURN
iptables -t nat -A FALLBACK_PROXY -d 172.16.2.2/32 -j RETURN
iptables -t nat -A FALLBACK_PROXY -p tcp --dport 7893 -j RETURN

# 将目标为非本地、非代理的 TCP 流量重定向到透明代理端口（例如 12345）
iptables -t nat -A FALLBACK_PROXY -p tcp -j REDIRECT --to-ports 12345

# 将 OUTPUT 链的 TCP 流量跳转到 FALLBACK_PROXY 链
iptables -t nat -A OUTPUT -p tcp -j FALLBACK_PROXY

# 保存规则（根据发行版）
iptables-save > /etc/iptables/rules.v4
```

### 4.2 排除特定流量（可选）
如果某些应用或目标不需要 fallback，可以提前 RETURN：
```bash
# 例如：放行 SSH（22 端口）
iptables -t nat -A FALLBACK_PROXY -p tcp --dport 22 -j RETURN

# 放行 DNS（53 端口）—— 我们将用特殊处理
iptables -t nat -A FALLBACK_PROXY -p tcp --dport 53 -j RETURN
iptables -t nat -A FALLBACK_PROXY -p udp --dport 53 -j RETURN
```

### 4.3 处理 DNS 查询
DNS 泄漏问题：应用程序可能使用系统 DNS 解析，暴露真实 IP。

**解决方案 A：强制所有 DNS 通过代理**
```bash
# 将 DNS 流量重定向到本地 DNS 转发器（如 dnsmasq）
iptables -t nat -A OUTPUT -p udp --dport 53 -j REDIRECT --to-ports 5353
iptables -t nat -A OUTPUT -p tcp --dport 53 -j REDIRECT --to-ports 5353
```

然后在透明代理中处理 DNS 请求，或者运行一个本地 DNS 服务器，它自己实现 fallback 解析（先直连 DNS 服务器，失败则通过代理的 SOCKS5 DNS 解析）。

**解决方案 B：使用代理的 DNS 功能**
Clash 支持 SOCKS5 的 UDP 关联命令，可通过代理转发 DNS。但需要透明代理支持 UDP 重定向（更复杂）。

**简化方案**：在透明代理中仅处理 TCP，DNS 使用直连（假设 DNS 服务器通常可达）。如果 DNS 被污染，可配置使用 DoH（DNS over HTTPS）通过代理。

### 4.4 开机自启动
将 iptables 规则和透明代理 daemon 设为系统服务。

## 5. 具体配置步骤和代码

### 5.1 安装依赖
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install iptables python3 python3-pip
pip3 install pysocks aiohttp
```

### 5.2 透明代理 Python 代码
创建 `/usr/local/bin/fallback_proxy.py`：

```python
#!/usr/bin/env python3
"""
透明代理，实现直连优先、代理备用的 fallback 逻辑。
监听本地端口 12345，接受 iptables 重定向的连接。
"""
import asyncio
import socket
import struct
import logging
from typing import Optional, Tuple

# 配置
PROXY_HOST = '172.16.2.2'
PROXY_PORT = 7893
PROXY_USER = 'Clash'
PROXY_PASS = 'kqH3gbeA'
LISTEN_PORT = 12345
DIRECT_TIMEOUT = 3.0
PROXY_TIMEOUT = 5.0

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('fallback_proxy')

def get_original_dest(sock: socket.socket) -> Tuple[str, int]:
    """获取被重定向连接的原目标地址 (Linux SO_ORIGINAL_DST)"""
    try:
        # 对于 REDIRECT 重定向，使用 getsockopt
        # 注意：需要 CAP_NET_ADMIN 权限或 root
        dst = sock.getsockopt(socket.SOL_IP, 80, 16)  # SO_ORIGINAL_DST
        ip = socket.inet_ntoa(dst[:4])
        port = struct.unpack('!H', dst[4:6])[0]
        return ip, port
    except Exception as e:
        logger.error(f"获取原目标失败: {e}")
        # 如果失败，假设目标为某个默认（不应发生）
        return '0.0.0.0', 0

async def connect_direct(dest_ip: str, dest_port: int) -> Optional[asyncio.StreamReader]:
    """尝试直连目标"""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(dest_ip, dest_port),
            timeout=DIRECT_TIMEOUT
        )
        logger.info(f"直连成功 {dest_ip}:{dest_port}")
        return reader, writer
    except (asyncio.TimeoutError, ConnectionRefusedError, OSError) as e:
        logger.debug(f"直连失败 {dest_ip}:{dest_port}: {e}")
        return None

async def connect_via_proxy(dest_ip: str, dest_port: int) -> Optional[asyncio.StreamReader]:
    """通过 SOCKS5 代理连接目标"""
    try:
        # 连接代理服务器
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(PROXY_HOST, PROXY_PORT),
            timeout=PROXY_TIMEOUT
        )
        
        # SOCKS5 认证协商
        writer.write(b'\x05\x01\x02')  # VER, NMETHODS, METHODS (2 = user/pass)
        await writer.drain()
        response = await reader.read(2)
        if response != b'\x05\x02':
            logger.error("代理不支持用户/密码认证")
            writer.close()
            return None
        
        # 发送用户名/密码
        user_len = len(PROXY_USER.encode())
        pass_len = len(PROXY_PASS.encode())
        auth_msg = bytes([0x01, user_len]) + PROXY_USER.encode() + bytes([pass_len]) + PROXY_PASS.encode()
        writer.write(auth_msg)
        await writer.drain()
        auth_resp = await reader.read(2)
        if auth_resp != b'\x01\x00':
            logger.error("代理认证失败")
            writer.close()
            return None
        
        # 发送连接请求
        req = b'\x05\x01\x00\x01'  # VER, CMD=CONNECT, RSV, ATYP=IPv4
        req += socket.inet_aton(dest_ip)
        req += struct.pack('!H', dest_port)
        writer.write(req)
        await writer.drain()
        
        # 读取代理响应
        resp = await reader.read(10)  # 足够长的响应
        if len(resp) < 2 or resp[0] != 0x05 or resp[1] != 0x00:
            logger.error(f"代理连接失败: {resp.hex()}")
            writer.close()
            return None
        
        logger.info(f"代理连接成功 {dest_ip}:{dest_port}")
        return reader, writer
    except Exception as e:
        logger.error(f"代理连接异常: {e}")
        return None

async def forward_data(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, label: str):
    """双向转发数据"""
    try:
        while True:
            data = await reader.read(4096)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception as e:
        logger.debug(f"{label} 转发异常: {e}")
    finally:
        writer.close()

async def handle_client(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
    """处理一个客户端连接"""
    # 获取客户端 socket 对象
    client_sock = client_writer.get_extra_info('socket')
    dest_ip, dest_port = get_original_dest(client_sock)
    
    if dest_ip == '0.0.0.0':
        logger.error("无法获取原始目标，关闭连接")
        client_writer.close()
        return
    
    logger.info(f"新连接 → {dest_ip}:{dest_port}")
    
    # 第一步：尝试直连
    direct = await connect_direct(dest_ip, dest_port)
    if direct:
        target_reader, target_writer = direct
        # 启动双向转发
        await asyncio.gather(
            forward_data(client_reader, target_writer, "client→target"),
            forward_data(target_reader, client_writer, "target→client")
        )
        return
    
    # 第二步：尝试代理
    proxy = await connect_via_proxy(dest_ip, dest_port)
    if proxy:
        target_reader, target_writer = proxy
        await asyncio.gather(
            forward_data(client_reader, target_writer, "client→proxy"),
            forward_data(target_reader, client_writer, "proxy→client")
        )
        return
    
    # 两者都失败
    logger.error(f"直连和代理均失败 {dest_ip}:{dest_port}")
    client_writer.close()

async def main():
    """启动透明代理服务器"""
    server = await asyncio.start_server(handle_client, '127.0.0.1', LISTEN_PORT)
    logger.info(f"Fallback 代理监听 127.0.0.1:{LISTEN_PORT}")
    
    async with server:
        await server.serve_forever()

if __name__ == '__main__':
    asyncio.run(main())
```

### 5.3 设置权限和启动脚本
```bash
# 赋予执行权限
sudo chmod +x /usr/local/bin/fallback_proxy.py

# 创建 systemd 服务文件 /etc/systemd/system/fallback-proxy.service
sudo tee /etc/systemd/system/fallback-proxy.service <<EOF
[Unit]
Description=Fallback Proxy (Direct then Proxy)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/bin/fallback_proxy.py
Restart=on-failure
User=root
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable fallback-proxy
sudo systemctl start fallback-proxy
```

### 5.4 配置 iptables 规则脚本
创建 `/usr/local/bin/setup-fallback-rules.sh`：

```bash
#!/bin/bash
# 设置 fallback 代理的 iptables 规则

# 清空现有规则（谨慎！）
iptables -t nat -F
iptables -t nat -X FALLBACK_PROXY 2>/dev/null

# 创建新链
iptables -t nat -N FALLBACK_PROXY

# 跳过本地流量
iptables -t nat -A FALLBACK_PROXY -d 127.0.0.0/8 -j RETURN
iptables -t nat -A FALLBACK_PROXY -d 192.168.0.0/16 -j RETURN
iptables -t nat -A FALLBACK_PROXY -d 10.0.0.0/8 -j RETURN
iptables -t nat -A FALLBACK_PROXY -d 172.16.0.0/12 -j RETURN

# 跳过代理服务器自身流量
iptables -t nat -A FALLBACK_PROXY -d 172.16.2.2/32 -j RETURN
iptables -t nat -A FALLBACK_PROXY -p tcp --dport 7893 -j RETURN

# 跳过 SSH、DNS（我们单独处理 DNS）
iptables -t nat -A FALLBACK_PROXY -p tcp --dport 22 -j RETURN
iptables -t nat -A FALLBACK_PROXY -p tcp --dport 53 -j RETURN
iptables -t nat -A FALLBACK_PROXY -p udp --dport 53 -j RETURN

# 重定向所有其他 TCP 流量到透明代理端口
iptables -t nat -A FALLBACK_PROXY -p tcp -j REDIRECT --to-ports 12345

# 将 OUTPUT 链的 TCP 流量跳转到 FALLBACK_PROXY
iptables -t nat -A OUTPUT -p tcp -j FALLBACK_PROXY

# 保存规则（Debian/Ubuntu）
iptables-save > /etc/iptables/rules.v4
```

赋予执行权限并运行：
```bash
sudo chmod +x /usr/local/bin/setup-fallback-rules.sh
sudo /usr/local/bin/setup-fallback-rules.sh
```

### 5.5 DNS 配置（简化方案）
使用公共 DNS 并假设直连可用：
```bash
# 修改 /etc/resolv.conf
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
echo "nameserver 1.1.1.1" | sudo tee -a /etc/resolv.conf
```

如果需要通过代理解析 DNS，可使用 dnsmasq + SOCKS5 转发，但较复杂。这里为简化，使用直连 DNS。

## 6. 优缺点分析

### 优点
1. **完全透明**：应用程序无感知，无需任何修改。
2. **连接级智能路由**：每个连接独立决策，不会因为某个目标失败而影响其他目标。
3. **低延迟**：直连成功时无代理开销，保持最佳速度。
4. **高可用性**：直连和代理互为备份，提高网络可靠性。
5. **配置灵活**：可通过 iptables 规则排除特定流量（如本地服务、SSH）。
6. **轻量级**：代理逻辑简单，资源占用少。

### 缺点
1. **需要 root 权限**：iptables 和透明代理需要 CAP_NET_ADMIN。
2. **UDP 支持有限**：主要处理 TCP 流量，UDP 需要额外处理（DNS 除外）。
3. **DNS 泄漏风险**：简化方案中 DNS 查询可能直连，暴露查询行为。
4. **性能开销**：每个连接增加少量判断逻辑，但异步处理影响不大。
5. **透明代理复杂性**：需要维护自定义代码，可能引入 bug。
6. **与某些 VPN 冲突**：如果系统已使用 VPN，iptables 规则可能干扰。

### 适用场景
- 企业内网环境，需要访问外网但直连不稳定。
- 个人开发环境，希望优先直连 GitHub 等，仅在需要时走代理。
- 网络审查环境，对部分站点需要代理，但大部分站点直连更快。

### 不适用场景
- 需要全部流量强制走代理（无直连）。
- 对 UDP 流量有严格代理要求（如游戏、视频流）。
- 无法获取 root 权限的共享主机。

## 7. 测试与验证

### 7.1 测试直连优先
```bash
# 启动代理服务后，测试访问
curl -v https://httpbin.org/ip
# 观察日志，应显示“直连成功”

# 模拟直连失败（访问一个不存在的 IP:PORT）
curl -v --connect-timeout 10 http://192.0.2.1:80
# 应看到直连失败，然后尝试代理，最终失败（因为代理也无法连接不存在的目标）
```

### 7.2 测试代理 fallback
```bash
# 临时屏蔽一个可达的域名（如 google.com）的直连
sudo iptables -I OUTPUT -d 8.8.8.8 -j DROP

# 访问该域名
curl -v https://google.com
# 应看到直连失败，然后通过代理连接成功
```

### 7.3 监控日志
```bash
sudo journalctl -u fallback-proxy -f
```

## 8. 故障排除

### 常见问题
1. **无法获取原始目标地址**：确保代理进程有 CAP_NET_ADMIN 权限，且使用 REDIRECT 而非 TPROXY。
2. **代理认证失败**：检查 Clash 代理的用户名/密码，确保支持 SOCKS5 认证。
3. **DNS 解析慢**：考虑使用 dnsmasq 缓存，或配置代理的 DNS 功能。
4. **性能瓶颈**：对于高并发，建议使用 Go 重写代理，或增加工作进程数。

### 调试命令
```bash
# 查看 iptables 规则
iptables -t nat -L -v -n

# 查看连接状态
ss -tunap | grep 12345

# 测试代理直接连接
nc -zv 172.16.2.2 7893
```

## 9. 扩展与优化

### 9.1 多代理备份
可扩展支持多个上游代理，在第一个代理失败时尝试第二个。

### 9.2 智能路由表
根据历史成功率动态调整直连/代理策略。

### 9.3 UDP 支持
使用 TPROXY 而非 REDIRECT 支持 UDP 透明代理。

### 9.4 可视化监控
添加 Prometheus metrics 导出，监控直连/代理成功率。

## 10. 总结

本方案实现了系统级流量直连优先、代理备用的智能 fallback 逻辑。核心是利用 iptables 透明重定向和自定义代理服务，在连接级别实现决策。方案平衡了透明性、性能和可靠性，适合需要灵活网络路由的环境。

**重点提醒**：该方案需要系统级权限，部署前请在测试环境验证。生产环境建议使用 Go 重写代理以提高性能，并添加更完善的日志和监控。