#!/usr/bin/env bash
# ============================================================
# api-scan.sh - API接口安全扫描
# 功能：API端点发现、认证测试、参数注入、速率限制检查
# 依赖工具：curl, nuclei, ffuf
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$PROJECT_ROOT/utils/common.sh"

# ============================================================
# discover_api_endpoints - API端点发现
# 参数: $1=基础URL $2=输出目录
# ============================================================
discover_api_endpoints() {
    local base_url="$1"
    local outdir="$2"
    local safe_name
    safe_name="$(echo "$base_url" | sed 's/[^a-zA-Z0-9]/_/g')"

    log_info "API端点发现: $base_url"

    # 常见API路径探测
    local api_paths=(
        "/api" "/api/v1" "/api/v2" "/api/v3"
        "/rest" "/graphql" "/graphiql"
        "/swagger" "/swagger-ui" "/swagger.json" "/swagger.yaml"
        "/openapi" "/openapi.json" "/openapi.yaml"
        "/api-docs" "/docs" "/redoc"
        "/health" "/healthz" "/status" "/info" "/version"
        "/actuator" "/actuator/health" "/actuator/env" "/actuator/beans"
        "/metrics" "/prometheus"
        "/.well-known/openid-configuration"
        "/robots.txt" "/sitemap.xml"
        "/wp-json" "/wp-json/wp/v2"
    )

    local found_file="$outdir/api_endpoints_${safe_name}.txt"
    : > "$found_file"

    for path in "${api_paths[@]}"; do
        local url="${base_url}${path}"
        local status
        status=$(curl -sI -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
        if [[ "$status" != "000" && "$status" != "404" && "$status" != "403" ]]; then
            echo "$url ($status)" >> "$found_file"
            log_debug "发现端点: $url [$status]"
        fi
    done

    local count
    count=$(wc -l < "$found_file" 2>/dev/null || echo "0")
    log_info "发现 $count 个API端点"

    # ffuf模糊测试
    if check_tool "ffuf"; then
        local wordlist="/usr/share/wordlists/dirb/common.txt"
        if [[ -f "$wordlist" ]]; then
            safe_run "ffuf API路径模糊测试" \
                ffuf -u "${base_url}/api/FUZZ" \
                -w "$wordlist" \
                -mc 200,201,301,302,401,405 \
                -o "$outdir/ffuf_api_${safe_name}.json" \
                -of json \
                -t "${THREAD_COUNT:-10}" \
                -s || true
        fi
    fi
}

# ============================================================
# test_api_auth - API认证测试
# 参数: $1=URL $2=输出目录
# ============================================================
test_api_auth() {
    local url="$1"
    local outdir="$2"
    local safe_name
    safe_name="$(echo "$url" | sed 's/[^a-zA-Z0-9]/_/g')"

    log_info "API认证测试: $url"
    local results_file="$outdir/api_auth_${safe_name}.json"
    local findings='[]'

    # 无认证访问测试
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
    if [[ "$status" == "200" || "$status" == "201" ]]; then
        log_warn "API无需认证即可访问: $url [$status]"
        findings=$(python3 -c "
import json
data = json.loads('$findings')
data.append({'test': 'no_auth', 'url': '$url', 'status': int('$status'), 'severity': 'HIGH', 'description': 'API端点无需认证即可访问'})
print(json.dumps(data))
")
    fi

    # JWT测试 - 空token
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        -H "Authorization: Bearer " "$url" 2>/dev/null || echo "000")
    if [[ "$status" == "200" || "$status" == "201" ]]; then
        log_warn "API接受空JWT: $url"
        findings=$(python3 -c "
import json
data = json.loads('$(echo "$findings" | sed "s/'/\\\\'/g")')
data.append({'test': 'empty_jwt', 'url': '$url', 'status': int('$status'), 'severity': 'CRITICAL', 'description': 'API接受空JWT Token'})
print(json.dumps(data))
")
    fi

    # JWT none算法测试
    local none_jwt="eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6InRlc3QiLCJpYXQiOjE1MTYyMzkwMjJ9."
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        -H "Authorization: Bearer $none_jwt" "$url" 2>/dev/null || echo "000")
    if [[ "$status" == "200" || "$status" == "201" ]]; then
        log_warn "API接受none算法JWT: $url"
    fi

    # CORS检查
    local cors_origin
    cors_origin=$(curl -sI --max-time 10 \
        -H "Origin: https://evil.com" "$url" 2>/dev/null | grep -i "access-control-allow-origin" || true)
    if echo "$cors_origin" | grep -qi "evil.com\|\*"; then
        log_warn "CORS配置不安全: $url → $cors_origin"
    fi

    echo "$findings" > "$results_file"
}

# ============================================================
# test_rate_limiting - 速率限制检查
# 参数: $1=URL $2=输出目录
# ============================================================
test_rate_limiting() {
    local url="$1"
    local outdir="$2"

    log_info "速率限制检查: $url"

    local success_count=0
    local total=50

    for i in $(seq 1 $total); do
        local status
        status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
        if [[ "$status" == "200" || "$status" == "201" ]]; then
            (( success_count++ ))
        elif [[ "$status" == "429" ]]; then
            log_info "速率限制在第 $i 次请求后触发"
            return 0
        fi
    done

    if (( success_count == total )); then
        log_warn "未检测到速率限制 ($total 次请求全部成功): $url"
    fi
}

# ============================================================
# run_nuclei_api - Nuclei API专项扫描
# 参数: $1=目标文件 $2=输出目录
# ============================================================
run_nuclei_api() {
    local targets_file="$1"
    local outdir="$2"

    if ! check_tool "nuclei"; then
        return 1
    fi

    safe_run "Nuclei API漏洞扫描" \
        nuclei -l "$targets_file" \
        -tags api,graphql,swagger,openapi \
        -severity critical,high,medium \
        -o "$outdir/nuclei_api.txt" \
        -silent || true
}

# ============================================================
# main - API扫描主入口
# ============================================================
main() {
    local results_dir="${1:-}"

    if [[ -z "$results_dir" ]]; then
        load_config
        check_auth
        init_results_dir "${PROJECT_NAME:-pentest}"
        results_dir="$RESULTS_DIR"
    fi

    local api_dir="$results_dir/scan/api"
    mkdir -p "$api_dir"
    export LOG_FILE="$results_dir/logs/pentest.log"

    log_section "API接口扫描"
    log_timer_start "API扫描"

    check_tools curl nuclei ffuf || true

    # 收集API目标
    local api_targets_file="$api_dir/api_targets.txt"
    : > "$api_targets_file"

    # 从配置
    if [[ -n "${API_TARGETS:-}" ]]; then
        for url in $API_TARGETS; do
            echo "$url" >> "$api_targets_file"
        done
    fi

    # 从Web目标推断API
    if [[ -n "${WEB_TARGETS:-}" ]]; then
        for url in $WEB_TARGETS; do
            echo "$url" >> "$api_targets_file"
        done
    fi

    sort -u "$api_targets_file" -o "$api_targets_file"

    local target_count
    target_count=$(wc -l < "$api_targets_file")
    log_info "API扫描目标: $target_count 个"

    if (( target_count == 0 )); then
        log_warn "无API目标，跳过API扫描"
        return 0
    fi

    # 逐个目标扫描
    while IFS= read -r url; do
        [[ -z "$url" ]] && continue
        discover_api_endpoints "$url" "$api_dir"
        test_api_auth "$url" "$api_dir"
        test_rate_limiting "$url" "$api_dir"
    done < "$api_targets_file"

    # Nuclei API扫描
    run_nuclei_api "$api_targets_file" "$api_dir"

    log_timer_end "API扫描"
    log_info "API扫描完成: $api_dir"
}

main "$@"
