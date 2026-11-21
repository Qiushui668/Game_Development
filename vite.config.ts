import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 局域网联机：绑定 0.0.0.0，同网段的手机/别的电脑用本机 IP 访问
    host: true,
    watch: {
      // Python 环境与产物目录不进 HMR 监听，避免 pip 写文件触发整页刷新
      ignored: ['**/.venv/**', '**/backend/**', '**/dist/**', '**/原始任务书/**'],
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
