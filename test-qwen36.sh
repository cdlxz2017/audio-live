#!/bin/bash
API_URL="https://aicoding.2233.ai/v1/messages"
API_KEY="sk-eet17a6aa1dcc8f8b01e2d76f98f0ff5b95cc01042c1Btsv"

call_api() {
  local prompt="$1"
  local max_tokens="${2:-2000}"
  local start=$(date +%s.%N)
  local response=$(curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg prompt "$prompt" --arg max_tokens "$max_tokens" '{
      model: "qwen3.6-plus",
      max_tokens: ($max_tokens | tonumber),
      messages: [{role: "user", content: $prompt}]
    }')")
  local end=$(date +%s.%N)
  local latency=$(echo "$end - $start" | bc)
  echo "===LATENCY:$latency==="
  echo "===RESPONSE==="
  echo "$response" | jq -r '.choices[0].message.content // .response // .error.message // .error.code // .' 2>/dev/null
  echo "===TOKENS==="
  echo "$response" | jq '.usage.output_tokens // .usage.completion_tokens // "N/A"' 2>/dev/null
  echo "===END==="
}

echo "========== TEST 1: 基础对话 =========="
call_api "用3句话介绍自己" 2000

echo ""
echo "========== TEST 2: 代码能力 =========="
call_api "写一个Python快速排序算法，并解释时间复杂度" 3000

echo ""
echo "========== TEST 3: 推理能力 =========="
call_api "小明有5个苹果，小红给了他3个，小明吃掉了2个，请问小明现在有几个苹果？请写出推理过程。" 2000

echo ""
echo "========== TEST 4: 中文理解 =========="
call_api "请解释"治大国如烹小鲜"这句话的含义，并举例说明。" 2000

echo ""
echo "========== TEST 5: 上下文记忆（上） =========="
call_api "记住这个数字：9427。第一次我说了什么数字？" 1000

echo ""
echo "========== TEST 6: 创意写作 =========="
call_api "写一首七言绝句，主题是春天的西湖。要求符合格律，平仄协调。" 1000

echo ""
echo "========== TEST 7: 技术文档生成 =========="
call_api "用Markdown格式写一份API设计规范，包含：概述、认证方式、接口列表、错误码说明" 4000
