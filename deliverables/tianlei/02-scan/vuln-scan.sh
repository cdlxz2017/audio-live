#!/usr/bin/env bash
# ============================================================
# vuln-scan.sh - 漏洞扫描主脚本
# 功能：Nmap漏洞脚本、Nuclei模板扫描、常见CVE检查
# 依赖工具：nmap, nuclei, searchsploit
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$PROJECT_ROOT/utils/common.sh"

# ============================================================
# run_nmap_vuln - Nmap漏洞脚本扫描
# 参数: $1=目标 $2=输出目录
# ============================================================
run_nmap_vuln() {
    local target="$1"
    local outdir="$2"

    if ! check_tool "nmap"; then
        return 1
    fi

    local outfile="$outdir/nmap_vuln"

    # 常见漏洞脚本
    safe_run "Nmap 漏洞脚本扫描" \
        nmap -sV --script="vuln,exploit,auth" \
        -T"${NMAP_SPEED:-4}" \
        $(get_exclude_args) \
        -oA "$outfile" \
        "$target" || true

    # SMB漏洞检查 (MS17-010等)
    safe_run "Nmap SMB漏洞检查" \
        nmap -p445 --script="smb-vuln-*" \
        -T"${NMAP_SPEED:-4}" \
        $(get_exclude_args) \
        -oA "$outdir/nmap_smb_vuln" \
        "$target" || true

    # SSL/TLS检查
    safe_run "Nmap SSL/TLS检查" \
        nmap -p443,8443 --script="ssl-*" \
        -T"${NMAP_SPEED:-4}" \
        $(get_exclude_args) \
        -oA "$outdir/nmap_ssl" \
        "$target" || true
}

# ============================================================
# run_nuclei - Nuclei漏洞模板扫描
# 参数: $1=目标列表文件 $2=输出目录
# ============================================================
run_nuclei() {
    local targets_file="$1"
    local outdir="$2"

    if ! check_tool "nuclei" "go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"; then
        return 1
    fi

    # 更新模板
    log_info "更新 Nuclei 模板..."
    nuclei -update-templates 2>/dev/null || log_warn "Nuclei 模板更新失败"

    # 全模板扫描
    safe_run "Nuclei 漏洞扫描" \
        nuclei -l "$targets_file" \
        -severity critical,high,medium \
        -c "${THREAD_COUNT:-10}" \
        -o "$outdir/nuclei_results.txt" \
        -jsonl -output "$outdir/nuclei_results.jsonl" \
        -silent || true

    if [[ -f "$outdir/nuclei_results.txt" ]]; then
        local count
        count=$(wc -l < "$outdir/nuclei_results.txt")
        log_info "Nuclei 发现 $count 个漏洞"
    fi

    # CVE专项扫描
    safe_run "Nuclei CVE专项扫描" \
        nuclei -l "$targets_file" \
        -tags cve \
        -severity critical,high \
        -c "${THREAD_COUNT:-10}" \
        -o "$outdir/nuclei_cve.txt" \
        -silent || true
}

# ============================================================
# check_common_cves - 检查常见高危CVE
# 参数: $1=目标 $2=输出目录
# ============================================================
check_common_cves() {
    local target="$1"
    local outdir="$2"
    local cve_results="$outdir/common_cves.json"

    log_section "常见CVE检查"
    echo '[]' > "$cve_results"

    # MS17-010 (EternalBlue)
    if check_tool "nmap"; then
        log_info "检查 MS17-010 (EternalBlue)..."
        local ms17_out
        ms17_out=$(nmap -p445 --script=smb-vuln-ms17-010 "$target" 2>/dev/null || true)
        if echo "$ms17_out" | grep -q "VULNERABLE"; then
            log_result "FAIL" "MS17-010 (EternalBlue) - 存在漏洞!"
            python3 -c "
import json
with open('$cve_results') as f: data = json.load(f)
data.append({'cve': 'MS17-010', 'name': 'EternalBlue', 'severity': 'CRITICAL', 'cvss': 9.8, 'target': '$target', 'status': 'VULNERABLE', 'remediation': '安装MS17-010补丁，禁用SMBv1'})
with open('$cve_results', 'w') as f: json.dump(data, f, indent=2)
"
        else
            log_result "PASS" "MS17-010 (EternalBlue) - 未发现"
        fi
    fi

    # Log4j (CVE-2021-44228)
    log_info "检查 Log4j (CVE-2021-44228)..."
    if check_tool "curl"; then
        local log4j_payloads=(
            '${jndi:ldap://log4j-test.invalid/test}'
            '${jndi:dns://log4j-test.invalid/test}'
        )
        # 注意：这里只做被动检测，不发送实际payload到外部
        log_info "Log4j 检测需要配合 Nuclei 或专用工具"
        if [[ -f "$outdir/nuclei_results.txt" ]]; then
            if grep -qi "log4j\|CVE-2021-44228" "$outdir/nuclei_results.txt" 2>/dev/null; then
                log_result "FAIL" "Log4j (CVE-2021-44228) - Nuclei检测到漏洞!"
                python3 -c "
import json
with open('$cve_results') as f: data = json.load(f)
data.append({'cve': 'CVE-2021-44228', 'name': 'Log4Shell', 'severity': 'CRITICAL', 'cvss': 10.0, 'target': '$target', 'status': 'VULNERABLE', 'remediation': '升级Log4j到2.17.1+，或设置log4j2.formatMsgNoLookups=true'})
with open('$cve_results', 'w') as f: json.dump(data, f, indent=2)
"
            else
                log_result "PASS" "Log4j (CVE-2021-44228) - 未发现"
            fi
        fi
    fi

    # Shellshock (CVE-2014-6271)
    log_info "检查 Shellshock (CVE-2014-6271)..."
    if check_tool "nmap"; then
        local shellshock_out
        shellshock_out=$(nmap -p80,443,8080 --script=http-shellshock "$target" 2>/dev/null || true)
        if echo "$shellshock_out" | grep -q "VULNERABLE"; then
            log_result "FAIL" "Shellshock (CVE-2014-6271) - 存在漏洞!"
            python3 -c "
import json
with open('$cve_results') as f: data = json.load(f)
data.append({'cve': 'CVE-2014-6271', 'name': 'Shellshock', 'severity': 'CRITICAL', 'cvss': 9.8, 'target': '$target', 'status': 'VULNERABLE', 'remediation': '升级Bash到最新版本'})
with open('$cve_results', 'w') as f: json.dump(data, f, indent=2)
"
        else
            log_result "PASS" "Shellshock (CVE-2014-6271) - 未发现"
        fi
    fi

    # 汇总
    local vuln_count
    vuln_count=$(python3 -c "import json; print(len(json.load(open('$cve_results'))))" 2>/dev/null || echo "0")
    log_info "常见CVE检查完成，发现 $vuln_count 个漏洞"
}

# ============================================================
# generate_vuln_json - 汇总所有漏洞到vulns.json
# 参数: $1=输出目录
# ============================================================
generate_vuln_json() {
    local outdir="$1"
    local vulns_json="$outdir/vulns.json"

    python3 << 'PYEOF'
import json
import os
import glob
import sys

outdir = sys.argv[1] if len(sys.argv) > 1 else "."
vulns = {"scan_time": "", "vulnerabilities": [], "summary": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}}

from datetime import datetime
vulns["scan_time"] = datetime.now().isoformat()

# 读取常见CVE结果
cve_file = os.path.join(outdir, "common_cves.json")
if os.path.isfile(cve_file):
    try:
        cves = json.load(open(cve_file))
        for cve in cves:
            vulns["vulnerabilities"].append(cve)
            sev = cve.get("severity", "INFO").upper()
            if sev in vulns["summary"]:
                vulns["summary"][sev.lower()] += 1
    except:
        pass

# 读取Nuclei JSONL结果
for jf in glob.glob(os.path.join(outdir, "nuclei_results.jsonl")):
    try:
        with open(jf) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                    vuln = {
                        "cve": item.get("info", {}).get("name", ""),
                        "name": item.get("template-id", ""),
                        "severity": item.get("info", {}).get("severity", "info").upper(),
                        "target": item.get("host", ""),
                        "matched_at": item.get("matched-at", ""),
                        "description": item.get("info", {}).get("description", ""),
                        "status": "VULNERABLE",
                    }
                    vulns["vulnerabilities"].append(vuln)
                    sev = vuln["severity"].lower()
                    if sev in vulns["summary"]:
                        vulns["summary"][sev] += 1
                except json.JSONDecodeError:
                    continue
    except:
        pass

# 读取Nmap漏洞脚本结果
for xf in glob.glob(os.path.join(outdir, "nmap_vuln.xml")):
    try:
        import xml.etree.ElementTree as ET
        tree = ET.parse(xf)
        for host in tree.findall(".//host"):
            ip = ""
            for addr in host.findall("address"):
                if addr.get("addrtype") == "ipv4":
                    ip = addr.get("addr", "")
            for script in host.findall(".//script"):
                output = script.get("output", "")
                if "VULNERABLE" in output.upper():
                    vulns["vulnerabilities"].append({
                        "name": script.get("id", ""),
                        "severity": "HIGH",
                        "target": ip,
                        "description": output[:500],
                        "status": "VULNERABLE",
                    })
                    vulns["summary"]["high"] += 1
    except:
        pass

vulns_json = os.path.join(outdir, "vulns.json")
with open(vulns_json, "w") as f:
    json.dump(vulns, f, indent=2, ensure_ascii=False)

total = len(vulns["vulnerabilities"])
print(f"漏洞汇总: 共{total}个 (C:{vulns['summary']['critical']} H:{vulns['summary']['high']} M:{vulns['summary']['medium']} L:{vulns['summary']['low']})", file=sys.stderr)
PYEOF
}

# ============================================================
# main - 漏洞扫描主入口
# ============================================================
main() {
    local results_dir="${1:-}"

    if [[ -z "$results_dir" ]]; then
        # 独立运行模式
        load_config
        check_auth
        init_results_dir "${PROJECT_NAME:-pentest}"
        results_dir="$RESULTS_DIR"
    fi

    local scan_dir="$results_dir/scan"
    mkdir -p "$scan_dir"
    export LOG_FILE="$results_dir/logs/pentest.log"

    log_section "阶段 2: 漏洞扫描 (Vulnerability Scanning)"
    log_timer_start "漏洞扫描"

    check_tools nmap nuclei searchsploit || true

    # 获取目标列表
    local targets
    targets="$(get_target_list)" || {
        log_error "无法获取目标列表"
        return 1
    }

    # 准备目标文件供Nuclei使用
    local targets_file="$scan_dir/targets.txt"

    # 如果有侦察阶段的资产清单，使用它
    if [[ -f "$results_dir/recon/final-assets.txt" ]]; then
        cp "$results_dir/recon/final-assets.txt" "$targets_file"
        log_info "使用侦察阶段资产清单"
    else
        echo "$targets" > "$targets_file"
    fi

    # 添加Web目标
    if [[ -n "${WEB_TARGETS:-}" ]]; then
        for url in $WEB_TARGETS; do
            echo "$url" >> "$targets_file"
        done
    fi

    # 对每个目标执行Nmap漏洞扫描
    while IFS= read -r target; do
        [[ -z "$target" || "$target" =~ ^http ]] && continue
        run_nmap_vuln "$target" "$scan_dir"
        check_common_cves "$target" "$scan_dir"
    done <<< "$targets"

    # Nuclei扫描
    run_nuclei "$targets_file" "$scan_dir"

    # 汇总漏洞
    generate_vuln_json "$scan_dir"

    log_timer_end "漏洞扫描"
    log_info "漏洞扫描完成，结果: $scan_dir/vulns.json"
}

main "$@"
