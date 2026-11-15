import { defineConfig } from "vite";

// 资源走相对路径：根路径、子路径（GitHub Pages）、本地预览都能直接打开，不需要按部署位置改配置
export default defineConfig({
  base: "./",
  build: { chunkSizeWarningLimit: 900 },
});
