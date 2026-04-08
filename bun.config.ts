import type { BunPlugin } from "bun";

const plugin: BunPlugin = {
  name: "claude-code-build",
  setup(build) {
    // 可以在这里添加自定义构建逻辑
    build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
      return undefined;
    });
  },
};

export default plugin;
