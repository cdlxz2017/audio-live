#!/bin/bash
# ============================================================
# 安全系统状态检查脚本 (security-check.sh)
# 基于真实系统状态 2026-04-19
#
# 检查范围：
#   [1] UFW 防火墙状态 + 关键端口规则
#   [2] OSSEC HIDS 进程 + Active Response
#   [3] fail2ban 状态 + SSH/Cowrie jails
#   [4] Cowrie 蜜罐（systemd + 端口监听）
#   [5] Honeypot 扩展（beelzebub-http / 4g-listener）
#   [6] OSSEC 告警（JSON 格式）
#   [7] 综合安全评估
#
# 使用方式:
#   bash scripts/security-check.sh
# ============================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
OK="${GREEN}✅${NC}"; WARN="${YELLOW}🟡${NC}"; FAIL="${RED}🔴${NC}"

section() { echo ""; echo "════════════════════════════════════════════════════════════════"; echo "  $1"; echo "════════════════════════════════════════════════════════════════"; }
log() { echo -e "  $1 $*"; }

# ─────────────────────────────────────────────────────────
# [1] UFW 防火墙
# ─────────────────────────────────────────────────────────
section "【1/7】UFW 防火墙"

UFW_STATUS=$(sudo ufw status 2>/dev/null | head -1)
if echo "$UFW_STATUS" | grep -q "状态： 激活\|Status: active"; then
  log "$OK" "UFW 已激活"
else
  log "$FAIL" "UFW 未激活: $UFW_STATUS"
fi

RULES=$(sudo iptables -L ufw-user-input -n 2>/dev/null | grep "ACCEPT" | wc -l || echo 0)
log "$OK" "UFW iptables ACCEPT 规则: $RULES 条"

# 检查关键放行端口（格式：dpt:18790 或 multiport dports 3001,8001）
check_port() {
  local port="$1"; local name="$2"
  if sudo iptables -L ufw-user-input -n 2>/dev/null | grep -qE "(dpt:|dports).*$port"; then
    log "$OK" "$name ($port) ✅"
  else
    log "$WARN" "$name ($port) 未找到"
  fi
}

check_port 18790 "OpenClaw Gateway"
check_port 3001 "Tailscale-lingyi-3001"
check_port 8001 "Tailscale-lingyi-8001"
check_port 2222 "Cowrie SSH"
check_port 2223 "Cowrie Telnet"
check_port 31234 "Graphify Query"
check_port 31235 "Hermes Server"
check_port 31236 "Hermes Web"
check_port 5256 "Tailscale Serve"

DROP_COUNT=$(sudo iptables -L ufw-user-input -n 2>/dev/null | grep -c "DROP" || echo 0)
log "$OK" "DROP 规则: $DROP_COUNT 条"

# ─────────────────────────────────────────────────────────
# [2] OSSEC HIDS
# ─────────────────────────────────────────────────────────
section "【2/7】OSSEC HIDS"

for proc in ossec-analysisd ossec-logcollector ossec-syscheckd ossec-maild ossec-execd; do
  if pgrep -f "$proc" > /dev/null 2>&1; then
    log "$OK" "$proc 运行中"
  else
    log "$FAIL" "$proc 未运行"
  fi
done

AR_ENABLED=$(sudo grep -c "<active-response>" /var/ossec/etc/ossec.conf 2>/dev/null || echo 0)
if [ "$AR_ENABLED" -gt 0 ]; then
  log "$OK" "Active Response 已启用 ($AR_ENABLED 条)"
else
  log "$FAIL" "Active Response 未配置"
fi

for cmd in firewall-drop host-deny; do
  if sudo test -f "/var/ossec/active-response/bin/${cmd}.sh" 2>/dev/null; then
    log "$OK" "AR 命令 $cmd.sh 存在"
  else
    log "$FAIL" "AR 命令 $cmd.sh 缺失"
  fi
done

# ─────────────────────────────────────────────────────────
# [3] fail2ban
# ─────────────────────────────────────────────────────────
section "【3/7】fail2ban"

if pgrep -f "fail2ban-server" > /dev/null 2>&1; then
  log "$OK" "fail2ban-server 运行中"

  for jail in sshd cowrie-ssh cowrie-telnet; do
    # 尝试获取 ban 数量
    BANNED=$(sudo fail2ban-client status "$jail" 2>/dev/null | grep -A5 "Currently banned" | grep "Total" | awk '{print $NF}' | tr -d ']' || echo "?")
    if [ "$BANNED" != "?" ]; then
      log "$OK" "$jail 已封禁: $BANNED IP"
    fi
  done
else
  log "$FAIL" "fail2ban-server 未运行"
fi

# ─────────────────────────────────────────────────────────
# [4] Cowrie 蜜罐
# ─────────────────────────────────────────────────────────
section "【4/7】Cowrie SSH/Telnet 蜜罐"

COWRIE_STATUS=$(systemctl is-active cowrie 2>/dev/null || echo "unknown")
if [ "$COWRIE_STATUS" = "active" ]; then
  log "$OK" "Cowrie systemd: active"
else
  log "$FAIL" "Cowrie systemd: $COWRIE_STATUS"
fi

for port in 2222 2223; do
  proto=$( [ "$port" = "2222" ] && echo "SSH" || echo "Telnet")
  if ss -tlnp 2>/dev/null | grep -q ":$port "; then
    log "$OK" "端口 $port ($proto) 监听中"
  else
    log "$FAIL" "端口 $port ($proto) 未监听"
  fi
done

COWRIE_TIANXING=$(pm2 jlist 2>/dev/null | grep -c '"name":"cowrie-tianxing"' || echo 0)
[ "$COWRIE_TIANXING" -gt 0 ] && log "$OK" "cowrie-tianxing PM2 运行中" || log "$FAIL" "cowrie-tianxing PM2 未运行"

# ─────────────────────────────────────────────────────────
# [5] Honeypot 扩展进程
# ─────────────────────────────────────────────────────────
section "【5/7】Honeypot 扩展进程"

for proc_name in beelzebub-http 4g-listener; do
  COUNT=$(pm2 jlist 2>/dev/null | grep -c "\"name\":\"$proc_name\"" || echo 0)
  if [ "$COUNT" -gt 0 ]; then
    STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; ps=json.load(sys.stdin); p=[x for x in ps if x['name']=='$proc_name']; print(p[0]['pm2_env']['status'] if p else 'unknown')" 2>/dev/null || echo "unknown")
    RESTARTS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; ps=json.load(sys.stdin); p=[x for x in ps if x['name']=='$proc_name']; print(p[0]['pm2_env']['restart_time'] if p else 0)" 2>/dev/null || echo "?")
    log "$OK" "$proc_name: $STATUS (r$RESTARTS)"
  else
    log "$WARN" "$proc_name: 未运行"
  fi
done

# beelzebub HTTP
ss -tlnp 2>/dev/null | grep -q ":8080 " && log "$OK" "beelzebub HTTP 端口 8080 监听中" || log "$WARN" "beelzebub HTTP 端口 8080 未监听"

# ─────────────────────────────────────────────────────────
# [6] OSSEC 告警（JSON 格式）
# ─────────────────────────────────────────────────────────
section "【6/7】OSSEC 告警统计（过去24h）"

OSSEC_ALERT_FILE="/var/ossec/logs/alerts/alerts.json"
if [ -f "$OSSEC_ALERT_FILE" ]; then
  TODAY_ALERTS=$(sudo grep -c "$(date '+%Y-%m-%d')" "$OSSEC_ALERT_FILE" 2>/dev/null || echo 0)
  log "$OK" "OSSEC 今日告警: $TODAY_ALERTS 条"
else
  log "$WARN" "OSSEC alerts.json 不存在（可能写到别处或已禁用）"
fi

# Cowrie 日志目录
COWRIE_LOG_DIR="/home/ai/services/honeypot/cowrie-src/var/log/cowrie"
if [ -d "$COWRIE_LOG_DIR" ]; then
  LOG_COUNT=$(sudo ls "$COWRIE_LOG_DIR/" 2>/dev/null | wc -l)
  log "$OK" "Cowrie 日志文件: $LOG_COUNT 个"
  # 尝试从 JSON 日志提取今日攻击数
  TODAY_ATTACKS=$(sudo grep -r "$(date '+%Y-%m-%d')" "$COWRIE_LOG_DIR/" 2>/dev/null | wc -l || echo 0)
  [ "$TODAY_ATTACKS" -gt 0 ] && log "$OK" "Cowrie 今日攻击记录: $TODAY_ATTACKS 条" || log "$OK" "Cowrie 今日攻击记录: 0 条"
else
  log "$WARN" "Cowrie 日志目录不存在"
fi

# ─────────────────────────────────────────────────────────
# [7] 综合安全评估
# ─────────────────────────────────────────────────────────
section "【7/7】综合安全评估"

ISSUES=0

if ! echo "$UFW_STATUS" | grep -q "状态： 激活\|Status: active"; then
  log "$FAIL" "UFW 防火墙未激活"
  ((ISSUES++))
fi

if ! pgrep -f "ossec-analysisd" > /dev/null 2>&1; then
  log "$FAIL" "OSSEC 核心进程未运行"
  ((ISSUES++))
fi

if ! pgrep -f "fail2ban-server" > /dev/null 2>&1; then
  log "$FAIL" "fail2ban 未运行"
  ((ISSUES++))
fi

if [ "$COWRIE_STATUS" != "active" ]; then
  log "$FAIL" "Cowrie 蜜罐未启动"
  ((ISSUES++))
fi

if [ "$ISSUES" -le 0 ]; then
  log "$OK" "安全系统全部正常"
else
  log "$FAIL" "发现 $ISSUES 个严重安全问题"
fi

echo ""; echo "════════════════════════════════════════════════════════════════"
echo "安全检查完成 $(date '+%Y/%m/%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════════"
