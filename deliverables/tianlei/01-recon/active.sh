#!/usr/bin/env bash
# ============================================================
# active.sh - 主动扫描
# 功能：端口扫描、服务探测、目录枚举、Banner抓取
# 依赖工具：nmap, masscan, gobuster/dirsearch, curl
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$PROJECT_ROOT/utils/common.sh"

# ============================================================
# run_masscan - 快速端口发现
# 参数: $1=目标 $2=输出目录
# ============================================================
run_masscan() {
    local target="$1"
    local outdir="$2"

    if ! check_tool "masscan"; then
        log_warn "跳过 masscan 快速扫描"
        return 1
    fi

    local outfile="$outdir/masscan_${target//\//_}.txt"
    safe_run "masscan 快速端口扫描 $target" \
        masscan "$target" -p1-65535 --rate=1000 \
        --exclude "${EXCLUDE_IPS:-255.255.255.255}" \
        -oL "$outfile" 2>/dev/null || true

    if [[ -f "$outfile" ]]; then
        local port_count
        port_count=$(grep -c "^open" "$outfile" 2>/dev/null || echo "0")
        log_info "masscan 发现 $port_count 个开放端口"
    fi
}

# ============================================================
# run_nmap_discovery - Nmap主机发现
# 参数: $1=目标 $2=输出目录
# ============================================================
run_nmap_discovery() {
    local target="$1"
    local outdir="$2"

    if ! check_tool "nmap" "apt install nmap"; then
        log_error "nmap 是必需工具，无法继续"
        return 1
    fi

    local outfile="$outdir/nmap_discovery"
    safe_run "Nmap 主机发现 $target" \
        nmap -sn -PE -PP -PM "$target" \
        $(get_exclude_args) \
        -oA "$outfile" || true

    # 提取存活主机
    if [[ -f "${outfile}.gnmap" ]]; then
        grep "Status: Up" "${outfile}.gnmap" | awk '{print $2}' > "$outdir/live_hosts.txt"
        local count
        count=$(wc -l < "$outdir/live_hosts.txt")
        log_info "发现 $count 台存活主机"
    fi
}

# ============================================================
# run_nmap_portscan - Nmap端口扫描+服务探测
# 参数: $1=目标 $2=输出目录
# ============================================================
run_nmap_portscan() {
    local target="$1"
    local outdir="$2"

    if ! check_tool "nmap"; then
        return 1
    fi

    local speed="${NMAP_SPEED:-4}"
    local outfile="$outdir/nmap_portscan"

    # 全端口扫描
    safe_run "Nmap 全端口扫描 $target" \
        nmap -sS -sV -sC -O -p- \
        -T"$speed" \
        --min-rate=1000 \
        $(get_exclude_args) \
        -oA "$outfile" \
        "$target" || true

    # 解析结果
    if [[ -f "${outfile}.xml" ]]; then
        python3 "$PROJECT_ROOT/utils/nmap-parse.py" \
            "${outfile}.xml" \
            "$outdir/nmap_parsed.json"
        log_info "Nmap 结果已解析为 JSON"
    fi
}

# ============================================================
# run_nmap_vuln_scripts - Nmap漏洞脚本扫描
# 参数: $1=目标 $2=输出目录
# ============================================================
run_nmap_vuln_scripts() {
    local target="$1"
    local outdir="$2"

    if ! check_tool "nmap"; then
        return 1
    fi

    local outfile="$outdir/nmap_vuln"
    safe_run "Nmap 漏洞脚本扫描 $target" \
        nmap --script=vuln,exploit \
        -T"${NMAP_SPEED:-4}" \
        $(get_exclude_args) \
        -oA "$outfile" \
        "$target" || true
}

# ============================================================
# run_directory_enum - Web目录枚举
# 参数: $1=URL $2=输出目录
# ============================================================
run_directory_enum() {
    local url="$1"
    local outdir="$2"
    local safe_name
    safe_name="$(echo "$url" | sed 's/[^a-zA-Z0-9]/_/g')"

    if check_tool "gobuster"; then
        local wordlist="/usr/share/wordlists/dirb/common.txt"
        if [[ ! -f "$wordlist" ]]; then
            wordlist="/usr/share/dirbuster/wordlists/directory-list-2.3-medium.txt"
        fi
        if [[ -f "$wordlist" ]]; then
            safe_run "gobuster 目录枚举 $url" \
                gobuster dir -u "$url" -w "$wordlist" \
                -t "${THREAD_COUNT:-10}" \
                -o "$outdir/gobuster_${safe_name}.txt" \
                --no-error -q || true
        else
            log_warn "未找到字典文件，跳过目录枚举"
        fi
    elif check_tool "dirsearch"; then
        safe_run "dirsearch 目录枚举 $url" \
            dirsearch -u "$url" \
            -t "${THREAD_COUNT:-10}" \
            -o "$outdir/dirsearch_${safe_name}.txt" \
            --format=plain -q || true
    elif check_tool "feroxbuster"; then
        safe_run "feroxbuster 目录枚举 $url" \
            feroxbuster -u "$url" \
            -t "${THREAD_COUNT:-10}" \
            -o "$outdir/feroxbuster_${safe_name}.txt" \
            -q || true
    else
        log_warn "无目录枚举工具 (gobuster/dirsearch/feroxbuster)"
    fi
}

# ============================================================
# run_banner_grab - Banner抓取
# 参数: $1=主机列表文件 $2=输出目录
# ============================================================
run_banner_grab() {
    local hosts_file="$1"
    local outdir="$2"

    if [[ ! -f "$hosts_file" ]]; then
        log_warn "主机列表文件不存在: $hosts_file"
        return 1
    fi

    local outfile="$outdir/banners.txt"
    log_info "开始 Banner 抓取..."

    while IFS= read -r host; do
        [[ -z "$host" || "$host" =~ ^# ]] && continue
        for port in 21 22 25 80 110 143 443 3306 5432 8080; do
            local banner
            banner=$(timeout 5 bash -c "echo '' | nc -w3 $host $port 2>/dev/null" || true)
            if [[ -n "$banner" ]]; then
                echo "$host:$port - $banner" >> "$outfile"
            fi
        done
    done < "$hosts_file"

    if [[ -f "$outfile" ]]; then
        local count
        count=$(wc -l < "$outfile")
        log_info "抓取到 $count 条 Banner"
    fi
}

# ============================================================
# main - 主动扫描主入口
# 参数: $1=目标(IP/网段) $2=输出目录
# ============================================================
main() {
    if [[ $# -lt 2 ]]; then
        echo "用法: $0 <目标IP/网段> <输出目录>" >&2
        exit 1
    fi

    local target="$1"
    local outdir="$2"
    mkdir -p "$outdir"

    log_section "主动扫描: $target"

    local total_steps=5
    local step=0

    # Step 1: 主机发现
    (( step++ ))
    log_progress "$step" "$total_steps" "主机发现"
    run_nmap_discovery "$target" "$outdir"

    # Step 2: 快速端口扫描
    (( step++ ))
    log_progress "$step" "$total_steps" "快速端口扫描"
    run_masscan "$target" "$outdir"

    # Step 3: 详细端口扫描+服务探测
    (( step++ ))
    log_progress "$step" "$total_steps" "端口扫描+服务探测"
    run_nmap_portscan "$target" "$outdir"

    # Step 4: 漏洞脚本扫描
    (( step++ ))
    log_progress "$step" "$total_steps" "漏洞脚本扫描"
    run_nmap_vuln_scripts "$target" "$outdir"

    # Step 5: Banner抓取
    (( step++ ))
    log_progress "$step" "$total_steps" "Banner抓取"
    if [[ -f "$outdir/live_hosts.txt" ]]; then
        run_banner_grab "$outdir/live_hosts.txt" "$outdir"
    fi

    log_info "主动扫描完成: $outdir"
}

# 仅在直接执行时运行main
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
