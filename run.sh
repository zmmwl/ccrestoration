#!/bin/bash
# Claude Code 运行脚本

# 设置环境变量
export PATH="$HOME/.bun/bin:$PATH"
export NODE_ENV=production

# API 日志文件路径
LOG_FILE="/media/sf_host/dev/claude_code_src/running.log"

# 清空旧日志
> "$LOG_FILE"

# 运行 Claude Code (带 API 拦截日志)
echo "🚀 正在启动 Claude Code..."
echo "📝 API 日志: $LOG_FILE"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node --import "$SCRIPT_DIR/api_interceptor.mjs" "$SCRIPT_DIR/package/cli.js" "$@"
