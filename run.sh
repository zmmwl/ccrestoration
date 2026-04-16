#!/bin/bash
# Claude Code 运行脚本

# 设置环境变量
export PATH="$HOME/.bun/bin:$PATH"
export NODE_ENV=production

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 解析 --api-log 参数，提取日志路径并从参数列表中移除
API_LOG_ARG=""
CLI_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-log)
      API_LOG_ARG="$2"
      shift 2
      ;;
    *)
      CLI_ARGS+=("$1")
      shift
      ;;
  esac
done

# 日志路径：参数 > 环境变量 > 默认 ./prompt_log.md
if [ -n "$API_LOG_ARG" ]; then
  LOG_FILE="$API_LOG_ARG"
elif [ -n "$API_LOG_FILE" ]; then
  LOG_FILE="$API_LOG_FILE"
else
  LOG_FILE="./prompt_log.md"
fi

# 导出环境变量供拦截器使用
export API_LOG_FILE="$LOG_FILE"

# 清空旧日志
> "$LOG_FILE"

# 运行 Claude Code (带 API 拦截日志)
echo "🚀 正在启动 Claude Code..."
echo "📝 API 日志: $LOG_FILE"
node --import "$SCRIPT_DIR/api_interceptor.mjs" "$SCRIPT_DIR/package/cli.js" "${CLI_ARGS[@]}"
