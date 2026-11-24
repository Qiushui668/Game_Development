# 房间服务的容器镜像（用于 Render Docker 部署 / Hugging Face Spaces / Oracle 小机器）
# 只跑 Node 服务端：WS 在 /ws，健康检查 /health，房间列表 /rooms
FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server ./server

# Render / HF Spaces 都通过 PORT 注入端口；本地 docker run 默认 8000
ENV PORT=8000
EXPOSE 8000
CMD ["node", "server/index.mjs"]
