#!/usr/bin/env bash
# ============================================================
# recon.sh - 侦察阶段主入口
# 功能：协调被动收集和主动扫描，合并最终资产清单
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$PROJECT_ROOT/utils/common.sh"

# ============================================================
# run_passive_recon - 执行被动信息收集
# ============================================================
run_passive_recon() {
    local passive_dir="$RESULTS_DIR/recon/passive"
    mkdir -p "$passive_dir"

    if [[ -z "${TARGET_DOMAINS:-}" ]]; then
        log_warn "未配置目标域名，跳过被动收集"
        return 0
    fi

    local domains_csv
    domains_csv="$(echo "$TARGET_DOMAINS" | tr ' ' ',')"

    log_section "阶段 1a: 被动信息收集"
    safe_run "被动信息收集" \
        python3 "$SCRIPT_DIR/passive.py" "$domains_csv" "$passive_dir" || true

    # 收集被动发现的子域名
    if [[ -f "$passive_dir/all_subdomains.txt" ]]; then
        local count
        count=$(wc -l < "$passive_dir/all_subdomains.txt")
        log_info "被动收集发现 $count 个子域名"
    fi
}

# ============================================================
# run_active_recon - 执行主动扫描
# ============================================================
run_active_recon() {
    local active_dir="$RESULTS_DIR/recon/active"
    mkdir -p "$active_dir"

    log_section "阶段 1b: 主动扫描"

    # 对每个目标网段执行扫描
    local targets
    targets="$(get_target_list)" || {
        log_error "无法获取目标列表"
        return 1
    }

    while IFS= read -r target; do
        [[ -z "$target" ]] && continue
        local safe_target
        safe_target="$(echo "$target" | sed 's/[^a-zA-Z0-9._-]/_/g')"
        local target_dir="$active_dir/$safe_target"
        mkdir -p "$target_dir"

        bash "$SCRIPT_DIR/active.sh" "$target" "$target_dir"
    done <<< "$targets"
}

# ============================================================
# merge_assets - 合并所有发现的资产
# ============================================================
merge_assets() {
    log_section "合并资产清单"

    local final_assets="$RESULTS_DIR/recon/final-assets.txt"
    local final_json="$RESULTS_DIR/recon/final-assets.json"
    local temp_file
    temp_file="$(mktemp)"

    # 收集所有发现的IP
    find "$RESULTS_DIR/recon" -name "live_hosts.txt" -exec cat {} \; >> "$temp_file" 2>/dev/null || true

    # 收集子域名
    find "$RESULTS_DIR/recon" -name "all_subdomains.txt" -exec cat {} \; >> "$temp_file" 2>/dev/null || true

    # 从Nmap解析结果中提取IP
    find "$RESULTS_DIR/recon" -name "nmap_parsed.json" -exec \
        python3 -c "
import json, sys
for f in sys.argv[1:]:
    try:
        data = json.load(open(f))
        for h in data.get('hosts', []):
            if h.get('status') == 'up':
                print(h.get('ip', ''))
    except: pass
" {} + >> "$temp_file" 2>/dev/null || true

    # 去重排序
    sort -u "$temp_file" | grep -v '^$' > "$final_assets"
    rm -f "$temp_file"

    local asset_count
    asset_count=$(wc -l < "$final_assets")
    log_info "最终资产清单: $asset_count 个目标 → $final_assets"

    # 生成JSON格式的资产清单
    python3 -c "
import json, os, glob

assets = {'hosts': [], 'subdomains': [], 'web_services': [], 'db_services': []}

# 读取存活主机
asset_file = '$final_assets'
if os.path.isfile(asset_file):
    with open(asset_file) as f:
        for line in f:
            line = line.strip()
            if line:
                assets['hosts'].append(line)

# 读取Nmap解析结果中的Web和DB服务
for jf in glob.glob('$RESULTS_DIR/recon/**/nmap_parsed.json', recursive=True):
    try:
        data = json.load(open(jf))
        for host in data.get('hosts', []):
            if host.get('status') != 'up':
                continue
            for port in host.get('open_ports', []):
                svc = port.get('service', '').lower()
                entry = {'ip': host['ip'], 'port': port['port'], 'service': svc, 'product': port.get('product', ''), 'version': port.get('version', '')}
                if svc in ('http', 'https', 'http-proxy', 'http-alt') or port['port'] in (80, 443, 8080, 8443):
                    proto = 'https' if 'ssl' in svc or 'https' in svc or port['port'] in (443, 8443) else 'http'
                    entry['url'] = f\"{proto}://{host['ip']}:{port['port']}\"
                    assets['web_services'].append(entry)
                if svc in ('mysql', 'postgresql', 'ms-sql-s', 'oracle-tns', 'mongodb', 'redis') or port['port'] in (3306, 5432, 1433, 1521, 27017, 6379):
                    assets['db_services'].append(entry)
    except:
        pass

with open('$final_json', 'w') as f:
    json.dump(assets, f, indent=2, ensure_ascii=False)
print(f'Web服务: {len(assets[\"web_services\"])}个, 数据库服务: {len(assets[\"db_services\"])}个')
" 2>/dev/null || log_warn "JSON资产清单生成失败"
}

# ============================================================
# main - 侦察阶段主入口
# ============================================================
main() {
    print_banner
    load_config
    check_auth

    # 初始化结果目录
    local target_name="${PROJECT_NAME:-pentest}"
    init_results_dir "$target_name"

    log_section "阶段 1: 侦察 (Reconnaissance)"
    log_timer_start "侦察阶段"

    # 检查依赖工具
    check_tools nmap python3 curl dig whois || true

    # 被动收集
    run_passive_recon

    # 主动扫描
    run_active_recon

    # 合并资产
    merge_assets

    log_timer_end "侦察阶段"
    log_info "侦察阶段完成，结果目录: $RESULTS_DIR/recon/"

    # 输出结果目录路径供后续阶段使用
    echo "$RESULTS_DIR"
}

main "$@"
