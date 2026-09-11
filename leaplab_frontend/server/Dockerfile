FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# PlatformIO Core (Apache-2.0 — replaces the GPL-3.0 arduino-cli).
# Toolchains it downloads are GPLv3-with-runtime-exception (safe to ship).
ARG PIO_VERSION=6.1.19
RUN pip3 install --break-system-packages --no-cache-dir platformio==${PIO_VERSION}

ENV PIO_CLI_PATH=/usr/local/bin/pio
ENV PIO_LIB_DIRS=/app/forge-lib/libraries

# Preinstall platforms (idempotent; pio run also auto-installs from platformio.ini)
RUN pio platform install atmelavr && \
    pio platform install espressif32

# Preinstall the 12 bundled forge libraries into the shared cache dir
RUN mkdir -p /app/forge-lib/libraries && \
    pio pkg install --library "Adafruit SSD1306" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "Adafruit GFX Library" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "Adafruit BusIO" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "marcoschwartz/LiquidCrystal_I2C" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "DHT sensor library" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "Servo" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "ESP32Servo" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "Adafruit NeoPixel" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "MPU6050" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "IRremote" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "Keypad" --storage-dir /app/forge-lib/libraries && \
    pio pkg install --library "HX711" --storage-dir /app/forge-lib/libraries \
    || true

WORKDIR /app

COPY server/package.json /tmp/server/
RUN cd /tmp/server && bun install --production && \
    mkdir -p /app && cp -r /tmp/server/node_modules /app/node_modules

# --chmod forces BuildKit to create a unique layer hash, preventing stale cache
COPY --chmod=755 server/ ./server/
COPY src/creova/apk/ ./src/creova/apk/
COPY src/creova/apk/tools/ ./tools/

EXPOSE 3001
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["bun", "run", "server/server.ts"]