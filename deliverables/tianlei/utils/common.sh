#!/usr/bin/env bash
# ============================================================
# common.sh - 公共函数库
# 功能：配置加载、工具检查、目录初始化、授权验证等
# ============================================================

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 加载日志模块
source "$PROJECT_ROOT/utils/logger.sh"

# ============================================================
# load_config - 加载目标配置文件
# ============================================================
load_config() {
    local config_file="${1:-$PROJECT_ROOT/config/target.conf}"
    if [[ ! -f "$config_file" ]]; then
        log_fatal "配置文件不存在: $config_file"
        exit 1
    fi
    log_info "加载配置文件: $config_file"
    # shellcheck source=/dev/null
    source "$config_file"
}

# ============================================================
# check_auth - 验证授权文件存在
# ============================================================
check_auth() {
    if [[ -z "${AUTH_FILE:-}" ]]; then
        log_fatal "未配置授权文件路径 (AUTH_FILE)"
        log_error "请在 config/target.conf 中设置 AUTH_FILE"
        exit 1
    fi
    if [[ ! -f "$AUTH_FILE" ]]; then
        log_fatal "授权文件不存在: $AUTH_FILE"
        log_error "渗透测试必须在获得书面授权后进行"
        exit 1
    fi
    log_info "授权文件验证通过: $AUTH_FILE"
}

# ============================================================
# init_results_dir - 初始化结果输出目录
# 返回: 设置全局变量 RESULTS_DIR
# ============================================================
init_results_dir() {
    local target_name="${1:-default}"
    # 清理目标名称中的特殊字符
    target_name="$(echo "$target_name" | sed 's/[^a-zA-Z0-9._-]/_/g')"
    local date_str
    date_str="$(date '+%Y%m%d_%H%M%S')"
    RESULTS_DIR="${RESULTS_BASE_DIR:-./results}/${target_name}/${date_str}"

    mkdir -p "$RESULTS_DIR"/{recon,scan,exploit,post-exploit,report,logs}
    LOG_FILE="$RESULTS_DIR/logs/pentest.log"

    log_info "结果输出目录: $RESULTS_DIR"
    export RESULTS_DIR LOG_FILE
}

# ============================================================
# check_tool - 检查单个工具是否安装
# 参数: $1=工具名 $2=安装提示(可选)
# 返回: 0=存在 1=不存在
# ============================================================
check_tool() {
    local tool="$1"
    local install_hint="${2:-}"
    if command -v "$tool" &>/dev/null; then
        log_debug "工具已安装: $tool"
        return 0
    else
        if [[ -n "$install_hint" ]]; then
            log_warn "工具未安装: $tool — $install_hint"
        else
            log_warn "工具未安装: $tool"
        fi
        return 1
    fi
}

# ============================================================
# check_tools - 批量检查工具
# 参数: 工具名列表（数组）
# 返回: 缺失工具数量
# ============================================================
check_tools() {
    local -a tools=("$@")
    local missing=0
    log_section "工具依赖检查"
    for tool in "${tools[@]}"; do
        if ! check_tool "$tool"; then
            (( missing++ ))
        fi
    done
    if (( missing > 0 )); then
        log_warn "共 $missing 个工具缺失，部分功能将跳过"
    else
        log_info "所有工具检查通过"
    fi
    return "$missing"
}

# ============================================================
# run_with_timeout - 带超时执行命令
# 参数: $1=超时秒数 $2+=命令
# ============================================================
run_with_timeout() {
    local timeout_sec="$1"
    shift
    log_debug "执行命令 (超时${timeout_sec}s): $*"
    if command -v timeout &>/dev/null; then
        timeout "$timeout_sec" "$@"
    else
        "$@"
    fi
}

# ============================================================
# safe_run - 安全执行命令（失败不退出）
# 参数: $1=描述 $2+=命令
# 返回: 命令退出码
# ============================================================
safe_run() {
    local desc="$1"
    shift
    log_info "开始: $desc"
    log_timer_start "$desc"
    local rc=0
    "$@" || rc=$?
    log_timer_end "$desc"
    if (( rc == 0 )); then
        log_result "PASS" "$desc"
    else
        log_result "FAIL" "$desc (退出码: $rc)"
    fi
    return "$rc"
}

# ============================================================
# get_target_list - 获取目标IP列表
# 返回: 输出到stdout，每行一个IP/网段
# ============================================================
get_target_list() {
    local targets=()

    # 从配置的网段
    if [[ -n "${TARGET_SUBNETS:-}" ]]; then
        for subnet in $TARGET_SUBNETS; do
            targets+=("$subnet")
        done
    fi

    # 从IP列表文件
    if [[ -n "${TARGET_IP_FILE:-}" && -f "$TARGET_IP_FILE" ]]; then
        while IFS= read -r ip; do
            [[ -n "$ip" && ! "$ip" =~ ^# ]] && targets+=("$ip")
        done < "$TARGET_IP_FILE"
    fi

    if (( ${#targets[@]} == 0 )); then
        log_error "未找到任何目标，请检查配置"
        return 1
    fi

    printf '%s\n' "${targets[@]}"
}

# ============================================================
# get_exclude_args - 生成Nmap排除参数
# ============================================================
get_exclude_args() {
    if [[ -n "${EXCLUDE_IPS:-}" ]]; then
        echo "--exclude $EXCLUDE_IPS"
    fi
}

# ============================================================
# json_append - 向JSON数组文件追加对象
# 参数: $1=文件路径 $2=JSON对象字符串
# ============================================================
json_append() {
    local file="$1"
    local obj="$2"
    if [[ ! -f "$file" ]]; then
        echo "[$obj]" > "$file"
    else
        # 移除最后的 ] ，追加新对象，再加 ]
        local content
        content="$(cat "$file")"
        content="${content%]}"
        echo "${content},${obj}]" > "$file"
    fi
}

# ============================================================
# confirm_action - 交互式确认
# 参数: $1=提示信息
# 返回: 0=确认 1=取消
# ============================================================
confirm_action() {
    local prompt="$1"
    printf "${COLOR_YELLOW}[?] %s [y/N]: ${COLOR_RESET}" "$prompt" >&2
    local answer
    read -r answer
    case "$answer" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) return 1 ;;
    esac
}

# ============================================================
# print_banner - 打印工具横幅
# ============================================================
print_banner() {
    cat >&2 << 'EOF'

    ╔══════════════════════════════════════════════════════╗
    ║       Auto-PenTest Framework v1.0                   ║
    ║       Automated Penetration Testing Suite            ║
    ║                                                      ║
    ║  ⚠  仅限授权测试使用 / Authorized Use Only  ⚠       ║
    ╚══════════════════════════════════════════════════════╝

EOF
}

# ============================================================
# cleanup_on_exit - 退出时清理
# ============================================================
cleanup_on_exit() {
    log_info "清理临时文件..."
    # 可在此添加清理逻辑
}

# 注册退出钩子
trap cleanup_on_exit EXIT
