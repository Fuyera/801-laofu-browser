FROM node:22.23.2-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ xvfb x11vnc fluxbox iproute2 procps && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium
COPY tsconfig.json ./
COPY LICENSE NOTICE.md ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
COPY docs/LAOFU_BROWSER_BASELINE.json ./docs/LAOFU_BROWSER_BASELINE.json
COPY vendor ./vendor
COPY laofu-browser.png ./
RUN npm run build && mkdir -p /data /home/node/.cache && chown -R node:node /data /home/node /opt/browsers
USER node
ENV LAOFU_HOME=/data
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve", "--host", "0.0.0.0"]
