#!/bin/bash
# Claude Code 运行脚本

# 设置环境变量
export PATH="$HOME/.bun/bin:$PATH"
export NODE_ENV=production

# 运行 Claude Code
echo "🚀 正在启动 Claude Code..."
node package/cli.js "$@"
