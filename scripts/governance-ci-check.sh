#!/bin/bash
#===============================================================================
# 牧巡 L2 CI 检查脚本
# 由 GitHub Actions 调用，全面扫描所有脚本合规性
#===============================================================================
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
GOV_JSON="${GOV_REGISTRY_JSON:-${REPO_ROOT}/governance.json}"

RED='\033[0;31m'; YELLOW='\033[0;33m'; GREEN='\033[0;32m'; NC='\033[0m'

# 颜色
info()  { echo -e "${GREEN}[牧巡 L2]${NC} $*"; }
warn()  { echo -e "${YELLOW}[牧巡 L2]${NC} ⚠ $*${NC}"; }
error() { echo -e "${RED}[牧巡 L2]${NC} ✗ $*${NC}"; }
fatal() { echo -e "${RED}[牧巡 L2]${NC} ✗ FATAL: $*${NC}"; exit 1; }

#---------------------------------------------------------------------------
# 加载 Registry（支持本地文件和 GitHub Actions Secrets）
#---------------------------------------------------------------------------
load_registry() {
    if [[ -f "$GOV_JSON" ]]; then
        info "从本地文件加载 Registry: $GOV_JSON"
        ALL_SCRIPTS=$(cat "$GOV_JSON" | jq -c '.scripts // []')
        ALL_SYSTEMS=$(cat "$GOV_JSON" | jq -c '.systems // []')
    elif [[ -n "${GOV_REGISTRY_JSON:-}" ]]; then
        info "从环境变量加载 Registry (base64)"
        ALL_SCRIPTS=$(echo "$GOV_REGISTRY_JSON" | base64 -d | jq -c '.scripts // []')
        ALL_SYSTEMS=$(echo "$GOV_REGISTRY_JSON" | base64 -d | jq -c '.systems // []')
    else
        fatal "找不到 governance.json，请确保已设置 GOV_REGISTRY_JSON 环境变量"
    fi

    if ! echo "$ALL_SCRIPTS" | jq . >/dev/null 2>&1; then
        fatal "Registry JSON 解析失败"
    fi
}

# 查找脚本 entry（按路径）
lookup_entry() {
    local path="$1"
    echo "$ALL_SCRIPTS" | jq -r ".[] | select(.path == \"$path\") | .entry" 2>/dev/null | head -1
}

# 查找脚本 entry（按文件名）
lookup_entry_by_name() {
    local name="$1"
    echo "$ALL_SCRIPTS" | jq -r ".[] | select(.id == \"$name\") | .entry" 2>/dev/null | head -1
}

#---------------------------------------------------------------------------
# 检查 1: 所有脚本都在 Registry 中登记
#---------------------------------------------------------------------------
check_all_registered() {
    info "检查 1: 所有脚本是否已登记..."
    local errors=0
    local unregistered=""

    # 扫描所有 .sh .js .py 文件（排除运行时产物和备份）
    while IFS= read -r file; do
        [[ -z "$file" || ! -f "$file" ]] && continue
        entry=$(lookup_entry "$file")
        if [[ -z "$entry" || "$entry" == "null" ]]; then
            error "未登记: $file"
            unregistered+="  - $file\n"
            errors=$((errors+1))
        fi
    done < <(find "$REPO_ROOT" -type f \( -name "*.sh" -o -name "*.js" -o -name "*.py" \) \
        | grep -vE '(health-check-[0-9]+\.txt$|\.bak$|__pycache__|node_modules|\.git/)' )

    if [[ $errors -gt 0 ]]; then
        echo -e "$unregistered"
        error "共 $errors 个脚本未登记"
        return 1
    fi
    info "  ✓ 所有脚本已登记"
    return 0
}

#---------------------------------------------------------------------------
# 检查 2: Registry 中引用的脚本都存在
#---------------------------------------------------------------------------
check_registry_refs_exist() {
    info "检查 2: Registry 引用的脚本文件是否存在..."
    local missing=0

    while IFS= read -r entry; do
        local path
        path=$(echo "$entry" | jq -r '.path' 2>/dev/null)
        local id
        id=$(echo "$entry" | jq -r '.id' 2>/dev/null)
        [[ -z "$path" || "$path" == "null" ]] && continue

        if [[ ! -f "$path" ]]; then
            error "Registry 引用文件不存在: $path (id=$id)"
            missing=$((missing+1))
        fi
    done <<< "$(echo "$ALL_SCRIPTS" | jq -c '.[]')"

    if [[ $missing -gt 0 ]]; then
        error "共 $missing 个 Registry 引用文件缺失"
        return 1
    fi
    info "  ✓ 所有 Registry 引用文件存在"
    return 0
}

#---------------------------------------------------------------------------
# 检查 3: 无硬编码凭证
#---------------------------------------------------------------------------
check_credentials() {
    info "检查 3: 硬编码凭证检测..."
    local found=0

    while IFS= read -r file; do
        [[ -z "$file" || ! -f "$file" ]] && continue

        # 凭证模式检测
        if grep -qiP "password[[:space:]]*=[[:space:]]*['\"][^$@{]{3,30}" "$file" 2>/dev/null; then
            error "凭证: $file (password=...)"
            found=$((found+1))
        fi
        if grep -qiP "api[_-]?key[[:space:]]*=[[:space:]]*['\"][a-zA-Z0-9_-]{16,}" "$file" 2>/dev/null; then
            error "凭证: $file (api_key=...)"
            found=$((found+1))
        fi
        if grep -qiP "sk-[a-zA-Z0-9]{20,}" "$file" 2>/dev/null; then
            error "凭证: $file (sk-...)"
            found=$((found+1))
        fi
        if grep -qiP "-----BEGIN.*PRIVATE KEY-----" "$file" 2>/dev/null; then
            error "凭证: $file (PRIVATE KEY)"
            found=$((found+1))
        fi
    done < <(find "$REPO_ROOT/scripts" -type f \( -name "*.sh" -o -name "*.js" -o -name "*.py" \) 2>/dev/null | \
        grep -vE '(health-check-[0-9]+\.txt$|\.bak$|__pycache__)' || true)

    if [[ $found -gt 0 ]]; then
        error "共 $found 个文件含凭证模式"
        return 1
    fi
    info "  ✓ 无硬编码凭证"
    return 0
}

#---------------------------------------------------------------------------
# 检查 4: entry 字段正确（standard/legacy/exempt）
#---------------------------------------------------------------------------
check_entry_field() {
    info "检查 4: entry 字段正确性..."
    local invalid=0

    while IFS= read -r entry; do
        local id entry_type
        id=$(echo "$entry" | jq -r '.id' 2>/dev/null)
        entry_type=$(echo "$entry" | jq -r '.entry' 2>/dev/null)
        [[ "$entry_type" == "null" ]] && continue

        if [[ "$entry_type" != "standard" && "$entry_type" != "legacy" && "$entry_type" != "exempt" ]]; then
            error "非法 entry 类型 [$entry_type] for script: $id"
            invalid=$((invalid+1))
        fi
    done <<< "$(echo "$ALL_SCRIPTS" | jq -c '.[]')"

    if [[ $invalid -gt 0 ]]; then
        error "共 $invalid 个脚本 entry 字段非法"
        return 1
    fi
    info "  ✓ entry 字段正确"
    return 0
}

#---------------------------------------------------------------------------
# 主流程
#---------------------------------------------------------------------------
info "========================================="
info "牧巡 L2 CI 脚本合规检查"
info "========================================="

load_registry

results=0

check_all_registered || results=$((results+1))
check_registry_refs_exist || results=$((results+1))
check_credentials || results=$((results+1))
check_entry_field || results=$((results+1))

echo ""
info "========================================="
if [[ $results -gt 0 ]]; then
    error "L2 检查失败 — $results 项不合格"
    exit 1
else
    info "✓ 全部检查通过！"
fi
exit 0
