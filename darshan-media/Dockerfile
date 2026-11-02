FROM livekit/livekit-server:v1.13.11@sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20 AS sfu
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
WORKDIR /app
ENV NODE_ENV=production
COPY --from=sfu /livekit-server /usr/local/bin/livekit-server
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
EXPOSE 18780/tcp 18782/tcp 18783/udp
CMD ["node", "src/supervisor.js"]
