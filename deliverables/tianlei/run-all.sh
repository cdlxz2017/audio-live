#!/usr/bin/env bash
# ============================================================
# run-all.sh - 天雷系统 一键执行全流程
# 功能：交互式确认目标，依次执行侦察、扫描、利用、后渗透、报告
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils/common.sh"
source "$SCRIPT_DIR/utils/logger.sh"

# ============================================================
# 全局变量
# ============================================================
STAGE_NAMES=("配置文件验证" "阶段1: 侦察 (Recon)" "阶段2: 扫描 (Scan)" "阶段3: 渗透利用 (Exploit)" "阶段4: 后渗透 (Post-Exploit)" "阶段5: 报告生成 (Report)")
STAGE_TIMES=()
STAGE_RESULTS=()
TOTAL_START=""

# =============================================================================
# 法律授权依据：主席绝密令（内部绝密编号001）/ 国安（内部绝密编号001）
# 自动模式：环境变量 TIANLEI_NONINTERACTIVE=1 跳过所有交互确认
# =============================================================================
if [[ "${TIANLEI_NONINTERACTIVE:-}" == "1" ]]; then
    echo -e "${CYAN}[自动模式] 非交互执行已启用${NC}"
    AUTO_CONFIRMED=1
fi

# ============================================================
# show_banner - 显示欢迎横幅
# ============================================================
show_banner() {
    echo ""
    echo -e "${CYAN}"
    echo " ╔═══════════════════════════════════════════════════╗"
    echo " ║              ⚡ 天雷系统 v1.0 ⚡                    ║"
    echo " ║         TianLei Penetration Testing System        ║"
    echo " ║                                                   ║"
    echo " ║  ⚠️  仅限授权安全测试使用                          ║"
    echo " ╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
}

# ============================================================
# print_stage_header - 打印阶段标题
# 参数: $1=阶段序号 $2=阶段名称
# ============================================================
print_stage_header() {
    local stage_num="$1"
    local stage_name="$2"
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  📋 阶段 ${stage_num}/6: ${stage_name}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# ============================================================
# run_stage - 执行单个阶段，记录时间和结果
# 参数: $1=阶段序号 $2=阶段名称 $3=执行命令
# ============================================================
run_stage() {
    local stage_num="$1"
    local stage_name="$2"
    shift 2
    local cmd="$*"

    print_stage_header "$stage_num" "$stage_name"

    local start_time
    start_time=$(date +%s)

    echo -e "${CYAN}  执行命令: ${cmd}${NC}"
    echo -e "${CYAN}  开始时间: $(date '+%H:%M:%S')${NC}"
    echo ""

    # 执行命令
    if eval "$cmd"; then
        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - start_time))
        local minutes=$((duration / 60))
        local seconds=$((duration % 60))

        echo ""
        echo -e "${GREEN}  ✅ 阶段 ${stage_num} 完成 (耗时: ${minutes}分${seconds}秒)${NC}"
        STAGE_TIMES+=("${minutes}分${seconds}秒")
        STAGE_RESULTS+=("success")
        return 0
    else
        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - start_time))

        echo ""
        echo -e "${RED}  ❌ 阶段 ${stage_num} 失败 (耗时: ${duration}秒)${NC}"
        echo -e "${YELLOW}  ⚠️  跳过该阶段，继续后续流程${NC}"
        STAGE_TIMES+=("失败")
        STAGE_RESULTS+=("failed")
        return 0  # 不中断整体流程
    fi
}

# ============================================================
# confirm_targets - 交互式确认目标信息
# ============================================================
confirm_targets() {
    print_stage_header "0" "目标确认"

    load_config

    echo -e "${YELLOW}  项目信息:${NC}"
    echo "    项目名称: ${PROJECT_NAME:-未设置}"
    echo "    测试人员: ${TESTER_NAME:-未设置}"
    echo "    客户名称: ${CLIENT_NAME:-未设置}"
    echo ""

    echo -e "${YELLOW}  测试目标:${NC}"
    if [[ -n "${TARGET_SUBNETS:-}" ]]; then
        echo "    目标网段: ${TARGET_SUBNETS}"
    fi
    if [[ -n "${TARGET_DOMAINS:-}" ]]; then
        echo "    目标域名: ${TARGET_DOMAINS}"
    fi
    if [[ -n "${TARGET_IPS:-}" ]]; then
        echo "    目标IP: ${TARGET_IPS}"
    fi
    if [[ -n "${WEB_TARGETS:-}" ]]; then
        echo "    Web目标: ${WEB_TARGETS}"
    fi
    echo ""

    echo -e "${YELLOW}  授权文件: ${AUTH_FILE:-未设置}${NC}"

    # 验证授权
    if [[ -z "${AUTH_FILE:-}" || ! -f "$AUTH_FILE" ]]; then
        echo ""
        echo -e "${RED}  ❌ 错误: 授权文件不存在或未配置!${NC}"
        echo -e "${RED}     请在 config/target.conf 中设置 AUTH_FILE 路径${NC}"
        echo ""
        if [[ "${AUTO_CONFIRMED:-}" != "1" ]]; then
        read -rp "  是否仍然继续? (不推荐) [y/N]: " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            log_fatal "用户取消执行 (授权文件缺失)"
            exit 1
        fi
    else
        confirm="y"
    fi
    fi

    echo ""
    echo -e "${RED}  ⚠️  重要提示:${NC}"
    echo "    本工具仅用于已获书面授权的安全测试"
    echo "    未授权的渗透测试行为违反法律法规"
    echo ""

    if [[ "${AUTO_CONFIRMED:-}" != "1" ]]; then
        read -rp "  确认以上目标信息并开始测试? [y/N]: " final_confirm
        if [[ "$final_confirm" != "y" && "$final_confirm" != "Y" ]]; then
            log_info "用户取消执行"
            exit 0
        fi
    else
        final_confirm="y"
    fi

    echo ""
    log_info "目标确认通过，天雷系统启动"
}

# ============================================================
# print_summary - 打印最终汇总报告
# ============================================================
print_summary() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  📊 渗透测试全流程执行汇总${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    local total_stages=${#STAGE_NAMES[@]}
    local success_count=0
    local failed_count=0

    printf "  %-30s %-15s %s\n" "阶段" "状态" "耗时"
    printf "  %-30s %-15s %s\n" "----" "----" "----"

    for i in "${!STAGE_NAMES[@]}"; do
        local status="${STAGE_RESULTS[$i]:-unknown}"
        local time="${STAGE_TIMES[$i]:-N/A}"
        local icon="⬜"
        local color=""

        if [[ "$status" == "success" ]]; then
            icon="✅"
            color="${GREEN}"
            ((success_count++))
        elif [[ "$status" == "failed" ]]; then
            icon="❌"
            color="${RED}"
            ((failed_count++))
        fi

        printf "  ${color}%-30s %-15s %s${NC}\n" "${icon} ${STAGE_NAMES[$i]}" "$status" "$time"
    done

    echo ""
    echo -e "  ${GREEN}成功: ${success_count}/${total_stages}${NC}  ${RED}失败: ${failed_count}/${total_stages}${NC}"
    echo ""

    # 输出结果目录
    if [[ -n "${RESULTS_DIR:-}" && -d "${RESULTS_DIR}" ]]; then
        echo -e "  ${YELLOW}📁 结果目录:${NC}"
        echo "     ${RESULTS_DIR}"
        echo ""

        # 显示报告文件
        local report_file
        report_file=$(find "$RESULTS_DIR/report" -name "*.html" -o -name "*.md" 2>/dev/null | head -1)
        if [[ -n "$report_file" ]]; then
            echo -e "  ${YELLOW}📄 最终报告:${NC}"
            echo "     ${report_file}"
        fi

        echo ""
        echo -e "  ${YELLOW}📝 日志文件:${NC}"
        echo "     ${RESULTS_DIR}/logs/pentest.log"
    fi

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  ✅ 全流程执行完毕${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# ============================================================
# main - 主入口
# ============================================================
main() {
    show_banner

    TOTAL_START=$(date +%s)

    # 1. 目标确认
    confirm_targets

    # 初始化结果目录
    local target_name="${PROJECT_NAME:-pentest}"
    init_results_dir "$target_name"

    # 设置日志文件
    export LOG_FILE="$RESULTS_DIR/logs/pentest.log"

    # 2. 阶段1: 侦察
    run_stage 1 "侦察 (Recon)" \
        "bash '$SCRIPT_DIR/01-recon/recon.sh' '$RESULTS_DIR'"

    # 3. 阶段2: 扫描
    run_stage 2 "扫描 (Scan)" \
        "bash '$SCRIPT_DIR/02-scan/vuln-scan.sh' '$RESULTS_DIR'"

    # 4. 阶段3: 渗透利用
    run_stage 3 "渗透利用 (Exploit)" \
        "bash '$SCRIPT_DIR/03-exploit/exploit.sh' '$RESULTS_DIR'"

    # 5. 阶段4: 后渗透
    run_stage 4 "后渗透 (Post-Exploit)" \
        "bash '$SCRIPT_DIR/04-post-exploit/post-exploit.sh' '$RESULTS_DIR'"

    # 6. 阶段5: 报告生成
    run_stage 5 "报告生成 (Report)" \
        "python3 '$SCRIPT_DIR/05-report/report-gen.py' '$RESULTS_DIR'"

    # 打印汇总
    print_summary

    # 清理提示
    echo -e "${YELLOW}  💡 测试完成后，请运行以下命令清理痕迹:${NC}"
    echo "     bash '$SCRIPT_DIR/04-post-exploit/cleanup.sh' '$RESULTS_DIR'"
    echo ""
}

main "$@"
