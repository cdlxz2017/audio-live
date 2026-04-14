#!/usr/bin/env bash
# ============================================================
# web-scan.sh - Web应用漏洞扫描
# 功能：OWASP Top 10检测、XSS/SQLi/CSRF扫描、CMS识别
# 依赖工具：nikto, whatweb, wapiti, nuclei
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$PROJECT_ROOT/utils/common.sh"

# ============================================================
# run_whatweb - Web技术识别
# 参数: $1=URL $2=输出目录
# ============================================================
run_whatweb() {
    local url="$1"
    local outdir="$2"
    local safe_name
    safe_name="$(echo "$url" | sed 's/[^a-zA-Z0-9]/_/g')"

    if ! check_tool "whatweb" "apt install whatweb"; then
        return 1
    fi

    safe_run "WhatWeb 技术识别 $url" \
        whatweb "$url" \
        --log-json="$outdir/whatweb_${safe_name}.json" \
        -a 3 || true
}

# ============================================================
# run_nikto - Nikto Web扫描
# 参数: $1=URL $2=输出目录
# ============================================================
run_nikto() {
    local url="$1"
    local outdir="$2"
    local safe_name
    safe_name="$(echo "$url" | sed 's/[^a-zA-Z0-9]/_/g')"

    if ! check_tool "nikto" "apt install nikto"; then
        return 1
    fi

    safe_run "Nikto Web扫描 $url" \
        nikto -h "$url" \
        -output "$outdir/nikto_${safe_name}.txt" \
        -Format txt \
        -Tuning x 6 2 3 4 5 7 9 0 \
        -timeout "${TIMEOUT:-300}" || true
}

# ============================================================
# run_wapiti - Wapiti漏洞扫描
# 参数: $1=URL $2=输出目录
# ============================================================
run_wapiti() {
    local url="$1"
    local outdir="$2"
    local safe_name
    safe_name="$(echo "$url" | sed 's/[^a-zA-Z0-9]/_/g')"

    if ! check_tool "wapiti" "pip install wapiti3"; then
        return 1
    fi

    safe_run "Wapiti 漏洞扫描 $url" \
        wapiti -u "$url" \
        -o "$outdir/wapiti_${safe_name}" \
        -f json \
        --flush-session \
        -m "all" \
        --timeout "${TIMEOUT:-300}" || true
}

# ============================================================
# run_nuclei_web - Nuclei Web专项扫描
# 参数: $1=URL列表文件 $2=输出目录
# ============================================================
run_nuclei_web() {
    local targets_file="$1"
    local outdir="$2"

    if ! check_tool "nuclei"; then
        return 1
    fi

    # XSS检测
    safe_run "Nuclei XSS检测" \
        nuclei -l "$targets_file" \
        -tags xss \
        -severity critical,high,medium \
        -o "$outdir/nuclei_xss.txt" \
        -silent || true

    # SQLi检测
    safe_run "Nuclei SQLi检测" \
        nuclei -l "$targets_file" \
        -tags sqli \
        -severity critical,high,medium \
        -o "$outdir/nuclei_sqli.txt" \
        -silent || true

    # SSRF检测
    safe_run "Nuclei SSRF检测" \
        nuclei -l "$targets_file" \
        -tags ssrf \
        -severity critical,high,medium \
        -o "$outdir/nuclei_ssrf.txt" \
        -silent || true

    # 默认凭据检测
    safe_run "Nuclei 默认凭据检测" \
        nuclei -l "$targets_file" \
        -tags default-login \
        -o "$outdir/nuclei_default_creds.txt" \
        -silent || true
}

# ============================================================
# check_security_headers - 安全头检查
# 参数: $1=URL $2=输出目录
# ============================================================
check_security_headers() {
    local url="$1"
    local outdir="$2"
    local safe_name
    safe_name="$(echo "$url" | sed 's/[^a-zA-Z0-9]/_/g')"

    if ! check_tool "curl"; then
        return 1
    fi

    log_info "检查安全头: $url"
    local headers_file="$outdir/headers_${safe_name}.txt"
    curl -sI -L --max-time 30 "$url" > "$headers_file" 2>/dev/null || true

    if [[ ! -s "$headers_file" ]]; then
        log_warn "无法获取响应头: $url"
        return 1
    fi

    local missing_headers=()
    local required_headers=(
        "Strict-Transport-Security"
        "X-Content-Type-Options"
        "X-Frame-Options"
        "Content-Security-Policy"
        "X-XSS-Protection"
        "Referrer-Policy"
        "Permissions-Policy"
    )

    for header in "${required_headers[@]}"; do
        if ! grep -qi "$header" "$headers_file"; then
            missing_headers+=("$header")
        fi
    done

    if (( ${#missing_headers[@]} > 0 )); then
        log_warn "$url 缺少安全头: ${missing_headers[*]}"
    else
        log_result "PASS" "$url 安全头检查通过"
    fi

    # 保存结果为JSON
    python3 -c "
import json
missing = $(printf '%s\n' "${missing_headers[@]}" | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))")
result = {'url': '$url', 'missing_headers': missing, 'total_missing': len(missing)}
with open('$outdir/security_headers_${safe_name}.json', 'w') as f:
    json.dump(result, f, indent=2)
" 2>/dev/null || true
}

# ============================================================
# main - Web扫描主入口
# ============================================================
main() {
    local results_dir="${1:-}"

    if [[ -z "$results_dir" ]]; then
        load_config
        check_auth
        init_results_dir "${PROJECT_NAME:-pentest}"
        results_dir="$RESULTS_DIR"
    fi

    local web_dir="$results_dir/scan/web"
    mkdir -p "$web_dir"
    export LOG_FILE="$results_dir/logs/pentest.log"

    log_section "Web应用扫描"
    log_timer_start "Web扫描"

    check_tools whatweb nikto wapiti nuclei curl || true

    # 收集Web目标
    local web_targets_file="$web_dir/web_targets.txt"
    : > "$web_targets_file"

    # 从配置文件
    if [[ -n "${WEB_TARGETS:-}" ]]; then
        for url in $WEB_TARGETS; do
            echo "$url" >> "$web_targets_file"
        done
    fi

    # 从侦察阶段的资产清单
    if [[ -f "$results_dir/recon/final-assets.json" ]]; then
        python3 -c "
import json
data = json.load(open('$results_dir/recon/final-assets.json'))
for svc in data.get('web_services', []):
    url = svc.get('url', '')
    if url:
        print(url)
" >> "$web_targets_file" 2>/dev/null || true
    fi

    # 去重
    sort -u "$web_targets_file" -o "$web_targets_file"

    local target_count
    target_count=$(wc -l < "$web_targets_file")
    log_info "Web扫描目标: $target_count 个"

    if (( target_count == 0 )); then
        log_warn "无Web目标，跳过Web扫描"
        return 0
    fi

    # 逐个目标扫描
    local current=0
    while IFS= read -r url; do
        [[ -z "$url" ]] && continue
        (( current++ ))
        log_progress "$current" "$target_count" "扫描 $url"

        run_whatweb "$url" "$web_dir"
        run_nikto "$url" "$web_dir"
        check_security_headers "$url" "$web_dir"
    done < "$web_targets_file"

    # Nuclei Web专项扫描
    run_nuclei_web "$web_targets_file" "$web_dir"

    # Wapiti深度扫描（仅对主要目标）
    if [[ -n "${WEB_TARGETS:-}" ]]; then
        for url in $WEB_TARGETS; do
            run_wapiti "$url" "$web_dir"
        done
    fi

    log_timer_end "Web扫描"
    log_info "Web扫描完成: $web_dir"
}

main "$@"
