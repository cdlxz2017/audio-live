#!/usr/bin/env bash
# ============================================================
# logger.sh - 统一日志模块
# 功能：提供带颜色、带时间戳的日志输出，同时写入日志文件
# ============================================================

# 颜色定义
readonly COLOR_RED='\033[0;31m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_YELLOW='\033[1;33m'
readonly COLOR_BLUE='\033[0;34m'
readonly COLOR_CYAN='\033[0;36m'
readonly COLOR_MAGENTA='\033[0;35m'
readonly COLOR_RESET='\033[0m'
readonly COLOR_BOLD='\033[1m'

# 日志级别数值
declare -A LOG_LEVELS=( [DEBUG]=0 [INFO]=1 [WARN]=2 [ERROR]=3 [FATAL]=4 )

# 默认日志级别
CURRENT_LOG_LEVEL="${LOG_LEVEL:-INFO}"

# 日志文件路径（由调用者设置）
LOG_FILE="${LOG_FILE:-/tmp/pentest.log}"

# ============================================================
# _log - 内部日志函数
# 参数: $1=级别 $2=颜色 $3=消息
# ============================================================
_log() {
    local level="$1"
    local color="$2"
    shift 2
    local message="$*"
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"

    # 检查日志级别
    local current_val="${LOG_LEVELS[$CURRENT_LOG_LEVEL]:-1}"
    local msg_val="${LOG_LEVELS[$level]:-1}"
    if (( msg_val < current_val )); then
        return 0
    fi

    # 控制台输出（带颜色）
    printf "${color}[%s] [%-5s]${COLOR_RESET} %s\n" "$timestamp" "$level" "$message" >&2

    # 文件输出（无颜色）
    if [[ -n "$LOG_FILE" ]]; then
        printf "[%s] [%-5s] %s\n" "$timestamp" "$level" "$message" >> "$LOG_FILE" 2>/dev/null
    fi
}

# ============================================================
# 公开日志函数
# ============================================================

log_debug() { _log "DEBUG" "$COLOR_CYAN" "$@"; }
log_info()  { _log "INFO"  "$COLOR_GREEN" "$@"; }
log_warn()  { _log "WARN"  "$COLOR_YELLOW" "$@"; }
log_error() { _log "ERROR" "$COLOR_RED" "$@"; }
log_fatal() { _log "FATAL" "$COLOR_RED${COLOR_BOLD}" "$@"; }

# ============================================================
# log_section - 输出分节标题
# 参数: $1=标题
# ============================================================
log_section() {
    local title="$1"
    local line
    line="$(printf '=%.0s' {1..60})"
    printf "\n${COLOR_MAGENTA}%s${COLOR_RESET}\n" "$line" >&2
    printf "${COLOR_MAGENTA}  %s${COLOR_RESET}\n" "$title" >&2
    printf "${COLOR_MAGENTA}%s${COLOR_RESET}\n\n" "$line" >&2

    if [[ -n "$LOG_FILE" ]]; then
        {
            printf "\n%s\n" "$line"
            printf "  %s\n" "$title"
            printf "%s\n\n" "$line"
        } >> "$LOG_FILE" 2>/dev/null
    fi
}

# ============================================================
# log_progress - 显示进度条
# 参数: $1=当前步骤 $2=总步骤 $3=描述
# ============================================================
log_progress() {
    local current="$1"
    local total="$2"
    local desc="$3"
    local pct=$(( current * 100 / total ))
    local filled=$(( pct / 2 ))
    local empty=$(( 50 - filled ))
    local bar
    bar="$(printf '#%.0s' $(seq 1 "$filled" 2>/dev/null) || true)"
    bar+="$(printf '-%.0s' $(seq 1 "$empty" 2>/dev/null) || true)"

    printf "\r${COLOR_BLUE}[%s] %3d%% (%d/%d) %s${COLOR_RESET}" "$bar" "$pct" "$current" "$total" "$desc" >&2

    if (( current == total )); then
        printf "\n" >&2
    fi
}

# ============================================================
# log_timer_start / log_timer_end - 计时器
# ============================================================
declare -A _TIMERS

log_timer_start() {
    local name="$1"
    _TIMERS["$name"]="$(date +%s)"
}

log_timer_end() {
    local name="$1"
    local start="${_TIMERS[$name]:-$(date +%s)}"
    local end
    end="$(date +%s)"
    local elapsed=$(( end - start ))
    local mins=$(( elapsed / 60 ))
    local secs=$(( elapsed % 60 ))
    log_info "${name} 耗时: ${mins}分${secs}秒"
    unset '_TIMERS[$name]'
}

# ============================================================
# log_result - 记录测试结果
# 参数: $1=状态(PASS/FAIL/SKIP) $2=描述
# ============================================================
log_result() {
    local status="$1"
    shift
    local desc="$*"
    case "$status" in
        PASS) printf "${COLOR_GREEN}[✓ PASS]${COLOR_RESET} %s\n" "$desc" >&2 ;;
        FAIL) printf "${COLOR_RED}[✗ FAIL]${COLOR_RESET} %s\n" "$desc" >&2 ;;
        SKIP) printf "${COLOR_YELLOW}[- SKIP]${COLOR_RESET} %s\n" "$desc" >&2 ;;
        *)    printf "[%s] %s\n" "$status" "$desc" >&2 ;;
    esac

    if [[ -n "$LOG_FILE" ]]; then
        printf "[%s] [RESULT] [%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$status" "$desc" >> "$LOG_FILE" 2>/dev/null
    fi
}
