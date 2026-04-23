FROM node:18-bullseye-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Shanghai

WORKDIR /app

COPY package*.json requirements.txt ./

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    dumb-init \
    fonts-wqy-microhei \
    imagemagick \
    python3 \
    python3-pip \
    tzdata \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && pip3 install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove python3-pip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /root/.cache /root/.npm /tmp/*

COPY . .

RUN chmod +x /app/docker/start.sh

EXPOSE 3000 1145 3643

ENTRYPOINT ["dumb-init", "--"]
CMD ["/app/docker/start.sh"]
