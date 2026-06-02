# Build the TypeScript relay from source.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Runtime image for the Shellmates relay.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TL_RELAY_HOST=0.0.0.0 \
    TL_RELAY_PORT=8787 \
    TL_RELAY_BASE_PATH=/relay \
    TL_SERVER_DATA=/data
RUN mkdir -p /data && chown -R node:node /data
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 8787
VOLUME ["/data"]
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s \
  CMD node -e "const base=(process.env.TL_RELAY_BASE_PATH||'').replace(/\\/+$/,''); fetch('http://127.0.0.1:'+(process.env.TL_RELAY_PORT||8787)+base+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server/server.js"]
