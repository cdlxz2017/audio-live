#!/usr/bin/env bash
# ============================================================
# db-scan.sh - 数据库安全扫描
# 功能：数据库服务发现、弱口令检测、配置审计
# 依赖工具：nmap, hydra, mysql/psql客户端
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$PROJECT_ROOT/utils/common.sh"

# 数据库默认端口映射
declare -A DB_PORTS=(
    [mysql]=3306
    [postgresql]=5432
    [mssql]=1433
    [oracle]=1521
    [mongodb]=27017
    [redis]=6379
    [memcached]=11211
    [elasticsearch]=9200
    [couchdb]=5984
)

# 数据库默认用户名
declare -A DB_USERS=(
    [mysql]="root,admin,mysql,test,dba"
    [postgresql]="postgres,admin,root,test"
    [mssql]="sa,admin,test"
    [oracle]="sys,system,scott,admin"
    [mongodb]="admin,root,test"
    [redis]=""
    [elasticsearch]="elastic,admin"
)

# ============================================================
# scan_db_ports - 扫描数据库端口
# 参数: $1=目标 $2=输出目录
# ============================================================
scan_db_ports() {
    local target="$1"
    local outdir="$2"

    if ! check_tool "nmap"; then
        return 1
    fi

    local ports
    ports=$(printf '%s,' "${DB_PORTS[@]}")
    ports="${ports%,}"

    safe_run "数据库端口扫描" \
        nmap -sV -p"$ports" \
        --script="banner,mysql-info,ms-sql-info,mongodb-info,redis-info,memcached-info" \
        -T"${NMAP_SPEED:-4}" \
        -oA "$outdir/db_portscan" \
        "$target" || true

    # 解析结果
    if [[ -f "$outdir/db_portscan.xml" ]]; then
        python3 "$PROJECT_ROOT/utils/nmap-parse.py" \
            "$outdir/db_portscan.xml" \
            "$outdir/db_services.json"
    fi
}

# ============================================================
# test_mysql - MySQL安全检查
# 参数: $1=主机 $2=端口 $3=输出目录
# ============================================================
test_mysql() {
    local host="$1"
    local port="${2:-3306}"
    local outdir="$3"

    log_info "MySQL安全检查: $host:$port"

    # 匿名登录测试
    if check_tool "mysql"; then
        local anon_result
        anon_result=$(timeout 10 mysql -h "$host" -P "$port" -u root --connect-timeout=5 -e "SELECT VERSION();" 2>&1 || true)
        if echo "$anon_result" | grep -qv "Access denied\|ERROR"; then
            log_result "FAIL" "MySQL 允许root无密码登录: $host:$port"
            echo "VULNERABLE: MySQL root无密码 $host:$port" >> "$outdir/db_vulns.txt"
        fi
    fi

    # Nmap MySQL脚本
    if check_tool "nmap"; then
        safe_run "Nmap MySQL审计 $host:$port" \
            nmap -p"$port" \
            --script="mysql-audit,mysql-brute,mysql-databases,mysql-dump-hashes,mysql-empty-password,mysql-enum,mysql-info,mysql-query,mysql-users,mysql-variables,mysql-vuln-cve2012-2122" \
            "$host" \
            -oA "$outdir/nmap_mysql_${host}" || true
    fi

    # Hydra弱口令
    if check_tool "hydra"; then
        local userlist="${BRUTE_USERLIST:-/usr/share/wordlists/usernames.txt}"
        local passlist="${BRUTE_PASSLIST:-/usr/share/wordlists/rockyou.txt}"
        if [[ -f "$userlist" && -f "$passlist" ]]; then
            safe_run "Hydra MySQL弱口令 $host:$port" \
                hydra -L "$userlist" -P "$passlist" \
                -s "$port" -t "${BRUTE_THREADS:-4}" \
                -w "${BRUTE_TIMEOUT:-30}" \
                -o "$outdir/hydra_mysql_${host}.txt" \
                "$host" mysql || true
        fi
    fi
}

# ============================================================
# test_postgresql - PostgreSQL安全检查
# 参数: $1=主机 $2=端口 $3=输出目录
# ============================================================
test_postgresql() {
    local host="$1"
    local port="${2:-5432}"
    local outdir="$3"

    log_info "PostgreSQL安全检查: $host:$port"

    # 信任认证测试
    if check_tool "psql"; then
        local pg_result
        pg_result=$(timeout 10 psql -h "$host" -p "$port" -U postgres -c "SELECT version();" 2>&1 || true)
        if echo "$pg_result" | grep -q "PostgreSQL"; then
            log_result "FAIL" "PostgreSQL 允许postgres无密码登录: $host:$port"
            echo "VULNERABLE: PostgreSQL trust auth $host:$port" >> "$outdir/db_vulns.txt"
        fi
    fi

    # Nmap PostgreSQL脚本
    if check_tool "nmap"; then
        safe_run "Nmap PostgreSQL审计 $host:$port" \
            nmap -p"$port" \
            --script="pgsql-brute" \
            "$host" \
            -oA "$outdir/nmap_pgsql_${host}" || true
    fi

    # Hydra弱口令
    if check_tool "hydra"; then
        local userlist="${BRUTE_USERLIST:-/usr/share/wordlists/usernames.txt}"
        local passlist="${BRUTE_PASSLIST:-/usr/share/wordlists/rockyou.txt}"
        if [[ -f "$userlist" && -f "$passlist" ]]; then
            safe_run "Hydra PostgreSQL弱口令 $host:$port" \
                hydra -L "$userlist" -P "$passlist" \
                -s "$port" -t "${BRUTE_THREADS:-4}" \
                -o "$outdir/hydra_pgsql_${host}.txt" \
                "$host" postgres || true
        fi
    fi
}

# ============================================================
# test_redis - Redis安全检查
# 参数: $1=主机 $2=端口 $3=输出目录
# ============================================================
test_redis() {
    local host="$1"
    local port="${2:-6379}"
    local outdir="$3"

    log_info "Redis安全检查: $host:$port"

    # 无认证访问测试
    local redis_info
    redis_info=$(timeout 5 bash -c "echo 'INFO' | nc -w3 $host $port" 2>/dev/null || true)
    if echo "$redis_info" | grep -q "redis_version"; then
        log_result "FAIL" "Redis 无需认证: $host:$port"
        echo "VULNERABLE: Redis无认证 $host:$port" >> "$outdir/db_vulns.txt"

        # 提取版本信息
        local version
        version=$(echo "$redis_info" | grep "redis_version:" | cut -d: -f2 | tr -d '\r')
        log_info "Redis版本: $version"
    fi

    # Nmap Redis脚本
    if check_tool "nmap"; then
        safe_run "Nmap Redis审计 $host:$port" \
            nmap -p"$port" \
            --script="redis-info,redis-brute" \
            "$host" \
            -oA "$outdir/nmap_redis_${host}" || true
    fi
}

# ============================================================
# test_mongodb - MongoDB安全检查
# 参数: $1=主机 $2=端口 $3=输出目录
# ============================================================
test_mongodb() {
    local host="$1"
    local port="${2:-27017}"
    local outdir="$3"

    log_info "MongoDB安全检查: $host:$port"

    # 无认证访问测试
    if check_tool "mongosh" || check_tool "mongo"; then
        local mongo_cmd
        mongo_cmd=$(command -v mongosh || command -v mongo)
        local mongo_result
        mongo_result=$(timeout 10 "$mongo_cmd" --host "$host" --port "$port" --eval "db.adminCommand('listDatabases')" 2>&1 || true)
        if echo "$mongo_result" | grep -q "databases"; then
            log_result "FAIL" "MongoDB 无需认证: $host:$port"
            echo "VULNERABLE: MongoDB无认证 $host:$port" >> "$outdir/db_vulns.txt"
        fi
    fi

    # Nmap MongoDB脚本
    if check_tool "nmap"; then
        safe_run "Nmap MongoDB审计 $host:$port" \
            nmap -p"$port" \
            --script="mongodb-info,mongodb-brute,mongodb-databases" \
            "$host" \
            -oA "$outdir/nmap_mongodb_${host}" || true
    fi
}

# ============================================================
# main - 数据库扫描主入口
# ============================================================
main() {
    local results_dir="${1:-}"

    if [[ -z "$results_dir" ]]; then
        load_config
        check_auth
        init_results_dir "${PROJECT_NAME:-pentest}"
        results_dir="$RESULTS_DIR"
    fi

    local db_dir="$results_dir/scan/db"
    mkdir -p "$db_dir"
    export LOG_FILE="$results_dir/logs/pentest.log"

    log_section "数据库安全扫描"
    log_timer_start "数据库扫描"

    check_tools nmap hydra mysql psql || true

    : > "$db_dir/db_vulns.txt"

    # 收集数据库目标
    local db_targets=()

    # 从配置
    if [[ -n "${DB_TARGETS:-}" ]]; then
        for target in $DB_TARGETS; do
            db_targets+=("$target")
        done
    fi

    # 从侦察阶段发现的数据库服务
    if [[ -f "$results_dir/recon/final-assets.json" ]]; then
        while IFS= read -r line; do
            [[ -n "$line" ]] && db_targets+=("$line")
        done < <(python3 -c "
import json
data = json.load(open('$results_dir/recon/final-assets.json'))
for svc in data.get('db_services', []):
    print(f\"{svc['ip']}:{svc['port']}\")
" 2>/dev/null || true)
    fi

    # 对所有目标网段扫描数据库端口
    local targets
    targets="$(get_target_list 2>/dev/null)" || targets=""
    while IFS= read -r target; do
        [[ -z "$target" ]] && continue
        scan_db_ports "$target" "$db_dir"
    done <<< "$targets"

    # 对发现的数据库服务进行安全检查
    for target in "${db_targets[@]}"; do
        local host="${target%%:*}"
        local port="${target##*:}"

        case "$port" in
            3306)  test_mysql "$host" "$port" "$db_dir" ;;
            5432)  test_postgresql "$host" "$port" "$db_dir" ;;
            6379)  test_redis "$host" "$port" "$db_dir" ;;
            27017) test_mongodb "$host" "$port" "$db_dir" ;;
            *)     log_info "未知数据库端口 $port，跳过专项检查" ;;
        esac
    done

    # 汇总
    if [[ -s "$db_dir/db_vulns.txt" ]]; then
        local vuln_count
        vuln_count=$(wc -l < "$db_dir/db_vulns.txt")
        log_warn "数据库漏洞: $vuln_count 个"
    else
        log_info "未发现数据库漏洞"
    fi

    log_timer_end "数据库扫描"
    log_info "数据库扫描完成: $db_dir"
}

main "$@"
