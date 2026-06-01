# Shellmates relay/directory 레퍼런스 서버 — 멀티스테이지.
# 서버는 런타임 외부 의존성이 0(Node 내장 모듈만 사용) → 런타임 이미지는 dist만 담는다.

# ── build stage ──────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── runtime stage (dependency-free server) ───────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TL_RELAY_HOST=0.0.0.0 \
    TL_RELAY_PORT=8787 \
    TL_SERVER_DATA=/data
# 데이터 디렉토리(봉투/카드 파일 백엔드)
RUN mkdir -p /data && chown -R node:node /data
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 8787
VOLUME ["/data"]
USER node
# 컨테이너 헬스체크: /health 200 확인
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.TL_RELAY_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 기본은 admission 잠금: 운영 시 TL_RELAY_ACCESS_TOKEN(또는 공개 시 TL_RELAY_OPEN=true) 지정 권장.
CMD ["node", "dist/src/server/server.js"]
