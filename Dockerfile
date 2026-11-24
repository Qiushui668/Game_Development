# 整站镜像：一个容器同时提供前端（dist/ 静态）与房间服务（/ws + /health + /rooms）
# build: docker build -t ppr .
# run:   docker run -p 8000:8000 ppr   →  http://localhost:8000
# 用于 Oracle 小机器 / 任意支持容器的平台；页面与 /ws 同源，前端无需 VITE_ROOM_SERVER。

# ---- 构建前端 ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# ---- 运行：只带生产依赖 + dist + server ----
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist

# Render / HF Spaces 通过 PORT 注入端口；本地 docker run 默认 8000
ENV PORT=8000
EXPOSE 8000
CMD ["node", "server/index.mjs"]
