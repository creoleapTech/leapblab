import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import http from 'http';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { transpileArduinoToJS } from './transpiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const APK_PUBLIC_DIR = path.join(__dirname, 'public', 'apks');
const CACHE_DIR = path.join(__dirname, 'cache');
const LOGS_DIR = path.join(__dirname, 'logs');

fs.mkdirSync(APK_PUBLIC_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

// Firmware cache eviction: keep under 500 MB or 1000 files
const CACHE_MAX_SIZE = 500 * 1024 * 1024;
const CACHE_MAX_FILES = 1000;
function evictCache(): void {
  try {
    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => f.endsWith('.bin') || f.endsWith('.json'))
      .map(f => {
        const p = path.join(CACHE_DIR, f);
        try { return { name: f, path: p, size: fs.statSync(p).size, mtime: fs.statSync(p).mtimeMs }; }
        catch { return null; }
      })
      .filter((item): item is { name: string; path: string; size: number; mtime: number } => item !== null)
      .sort((a, b) => a.mtime - b.mtime);
    let totalSize = files.reduce((s, f) => s + f.size, 0);
    while ((totalSize > CACHE_MAX_SIZE || files.length > CACHE_MAX_FILES) && files.length > 2) {
      const oldest = files.shift();
      if (!oldest) break;
      try {
        const jsonPath = oldest.name.replace(/\.bin$/, '.json');
        const binPath = oldest.name;
        const jsonFull = path.join(CACHE_DIR, jsonPath);
        const binFull = path.join(CACHE_DIR, binPath);
        if (fs.existsSync(jsonFull)) { totalSize -= fs.statSync(jsonFull).size; fs.rmSync(jsonFull, { force: true }); }
        if (fs.existsSync(binFull)) { totalSize -= fs.statSync(binFull).size; fs.rmSync(binFull, { force: true }); }
      } catch {}
    }
  } catch {}
}
setInterval(evictCache, 30 * 60 * 1000).unref();

const logFilePath = path.join(LOGS_DIR, 'access.log');

// Realtime logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLine = `[${timestamp}] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} - Duration: ${duration}ms\n`;
    
    console.log(logLine.trim());
    
    try {
      if (fs.existsSync(logFilePath)) {
        const stats = fs.statSync(logFilePath);
        if (stats.size > 5 * 1024 * 1024) { // 5MB limit
          const oldLogPath = path.join(LOGS_DIR, 'access.old.log');
          if (fs.existsSync(oldLogPath)) fs.rmSync(oldLogPath, { force: true });
          fs.renameSync(logFilePath, oldLogPath);
        }
      }
      fs.appendFileSync(logFilePath, logLine);
    } catch (err) {
      console.error('[LOGGER ERROR] Failed to write to log file:', err);
    }
  });
  
  next();
});

app.use('/apks', express.static(APK_PUBLIC_DIR));

// Serve frontend build output (Vite) with correct MIME types and SPA fallback
const FRONTEND_BUILD_DIR = path.join(__dirname, '..', 'build');
if (fs.existsSync(FRONTEND_BUILD_DIR)) {
    app.use('/assets', express.static(path.join(FRONTEND_BUILD_DIR, 'assets'), {
        immutable: true,
        maxAge: '1y',
    }));
    app.use(express.static(FRONTEND_BUILD_DIR, {
        index: false,
    }));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith('/compile') || req.path.startsWith('/build') ||
            req.path.startsWith('/transpile') || req.path.startsWith('/firmware') ||
            req.path.startsWith('/libraries') || req.path.startsWith('/apks') ||
            req.path.startsWith('/relay') || req.path.startsWith('/logs') ||
            req.path.startsWith('/health') || req.path.startsWith('/status') ||
            req.path.startsWith('/download') || req.path.startsWith('/job') ||
            req.path.includes('.')) {
            return next();
        }
        const indexPath = path.join(FRONTEND_BUILD_DIR, 'index.html');
        if (fs.existsSync(indexPath)) {
            return res.sendFile(indexPath);
        }
        next();
    });
    console.log(`[SERVER] Frontend static serving enabled from ${FRONTEND_BUILD_DIR}`);
}

function sanitizeApkName(name: string): string {
  return (name || 'MyApp').replace(/[^a-zA-Z0-9]/g, '') || 'MyApp';
}

let isInitialized = true;
let esp32PlatformReady = false;
let cachedPioVersion: string | null = null;

// ═══════════════════════════════════════════════════════════════════════
// PLATFORMIO ADAPTER (Apache-2.0 — replaces the GPL-3.0 arduino-cli)
// ═══════════════════════════════════════════════════════════════════════

const PIO_BIN = process.env.PIO_CLI_PATH || 'pio';

const FQBN_TO_PIO: Record<string, { board: string; platform: string }> = {
  'arduino:avr:uno': { board: 'uno', platform: 'atmelavr' },
  'arduino:avr:nano': { board: 'nanoatmega328', platform: 'atmelavr' },
  'arduino:avr:mega': { board: 'megaatmega2560', platform: 'atmelavr' },
  'arduino:avr:leonardo': { board: 'leonardo', platform: 'atmelavr' },
  'esp32:esp32:esp32': { board: 'esp32dev', platform: 'espressif32' },
  'esp32:esp32:esp32c3': { board: 'esp32-c3-devkitm-1', platform: 'espressif32' },
  'esp32:esp32:esp32s2': { board: 'esp32-s2-saola-1', platform: 'espressif32' },
  'esp32:esp32:esp32s3': { board: 'esp32-s3-devkitc-1', platform: 'espressif32' },
  'esp32:esp32:esp32c6': { board: 'esp32-c6-devkitc-1', platform: 'espressif32' },
  'esp32:esp32:esp32h2': { board: 'esp32-h2-devkitm-1', platform: 'espressif32' },
  'esp32:esp32:esp32p4': { board: 'esp32-p4-devkitm-1', platform: 'espressif32' },
};

const ESP32_VARIANT_FALLBACK: Record<string, { board: string; platform: string }> = {
  esp32: { board: 'esp32dev', platform: 'espressif32' },
  esp32c3: { board: 'esp32-c3-devkitm-1', platform: 'espressif32' },
  esp32s2: { board: 'esp32-s2-saola-1', platform: 'espressif32' },
  esp32s3: { board: 'esp32-s3-devkitc-1', platform: 'espressif32' },
  esp32c6: { board: 'esp32-c6-devkitc-1', platform: 'espressif32' },
  esp32h2: { board: 'esp32-h2-devkitm-1', platform: 'espressif32' },
  esp32p4: { board: 'esp32-p4-devkitm-1', platform: 'espressif32' },
};

function isEsp32Board(board: string): boolean {
  return board.startsWith('esp32:');
}

/** FQBN → PlatformIO board/platform; throws for unsupported boards. */
function pioTarget(fqbn: string): { board: string; platform: string } {
  const exact = FQBN_TO_PIO[fqbn];
  if (exact) return exact;
  if (isEsp32Board(fqbn)) {
    const variant = fqbn.split(':').pop() || 'esp32';
    const hit = ESP32_VARIANT_FALLBACK[variant];
    if (hit) return hit;
  }
  throw new Error(`Unsupported board FQBN for PlatformIO: ${fqbn}`);
}

const HEADER_TO_LIB: Record<string, string> = {
  'RTClib.h': 'RTClib',
  'Adafruit_BusIO_Register.h': 'Adafruit BusIO',
  'Adafruit_I2CDevice.h': 'Adafruit BusIO',
  'Adafruit_SPIDevice.h': 'Adafruit BusIO',
  'Adafruit_GFX.h': 'Adafruit GFX Library',
  'Adafruit_GrayOLED.h': 'Adafruit GFX Library',
  'Adafruit_ILI9341.h': 'Adafruit ILI9341',
  'Adafruit_MPU6050.h': 'Adafruit MPU6050',
  'Adafruit_NeoPixel.h': 'Adafruit NeoPixel',
  'Adafruit_SH110X.h': 'Adafruit SH110X',
  'Adafruit_SSD1306.h': 'Adafruit SSD1306',
  'Adafruit_STMPE610.h': 'Adafruit STMPE610',
  'TouchScreen.h': 'Adafruit TouchScreen',
  'Adafruit_TSC2007.h': 'Adafruit TSC2007',
  'Adafruit_Sensor.h': 'Adafruit Unified Sensor',
  'DHT.h': 'DHT sensor library',
  'DHT_U.h': 'DHT sensor library',
  'HX711.h': 'HX711 Arduino Library',
  'LiquidCrystal_I2C.h': 'LiquidCrystal I2C',
  'PubSubClient.h': 'PubSubClient',
  'ArduinoJson.h': 'ArduinoJson',
  'ESP32Servo.h': 'ESP32Servo',
  'WebSocketsClient.h': 'WebSockets',
  'WebSockets.h': 'WebSockets',
  'WebSocketsServer.h': 'WebSockets',
  'MFRC522.h': 'MFRC522',
  'IRremote.h': 'IRremote',
  'Keypad.h': 'Keypad',
  'OneWire.h': 'OneWire',
  'DallasTemperature.h': 'DallasTemperature',
};

// Framework headers that must NEVER become lib_deps. See project.ts for rationale.
const BUILTIN_HEADERS_LOCAL: ReadonlySet<string> = new Set([
  'Arduino.h', 'WProgram.h', 'pins_arduino.h', 'binary.h',
  'Client.h', 'Server.h', 'Udp.h', 'Stream.h', 'Printable.h', 'Print.h',
  'WString.h', 'HardwareSerial.h', 'IPAddress.h', 'String.h',
  'SPI.h', 'Wire.h', 'EEPROM.h', 'SD.h', 'SoftwareSerial.h', 'Servo.h',
  'BluetoothSerial.h',
  'WiFi.h', 'WiFiClient.h', 'WiFiClientSecure.h', 'WiFiUdp.h', 'WiFiAP.h',
  'WiFiGeneric.h', 'WiFiMulti.h', 'WiFiScan.h', 'WiFiServer.h', 'WiFiSTA.h', 'ETH.h',
  'HTTPClient.h', 'HTTPUpdate.h', 'WebServer.h', 'ESPmDNS.h', 'DNSServer.h',
  'ArduinoOTA.h', 'Update.h', 'Preferences.h', 'SPIFFS.h', 'LittleFS.h', 'FFat.h',
  'FS.h', 'SD_MMC.h', 'Ticker.h', 'ESP.h', 'Esp.h',
  'BLEDevice.h', 'BLEUtils.h', 'BLEServer.h', 'BLEService.h', 'BLECharacteristic.h',
  'BLE2902.h', 'BLE2901.h', 'BLEAdvertising.h', 'BLEClient.h', 'BLEScan.h',
  'BLEAddress.h', 'BLEUUID.h', 'BLERemoteService.h', 'BLERemoteCharacteristic.h',
  'BLEHIDDevice.h', 'BLESecurity.h',
]);

function isBuiltinHeaderLocal(header: string): boolean {
  const base = header.split('/').pop()!.trim();
  if (BUILTIN_HEADERS_LOCAL.has(base)) return true;
  if (/^(avr|esp_|esp32|freertos|driver|soc|hal|lwip|mbedtls|nvs|spi_flash)\//i.test(header)) return true;
  if (/^BLE.*\.h$/i.test(base)) return true;
  if (/^esp_.*\.h$/i.test(base)) return true;
  return false;
}

function evalArchConditionLocal(expr: string, isESP32: boolean): boolean | null {
  const e = expr.trim();
  const hasESP32 = /ARDUINO_ARCH_ESP32|\bESP32\b|ARDUINO_ESP32/.test(e);
  const hasAVR = /ARDUINO_ARCH_AVR|__AVR__|ARDUINO_AVR_|ARDUINO_ARCH_MEGA|ARDUINO_ARCH_SAMD|__arm__/.test(e);
  const hasESP8266 = /ESP8266/.test(e);
  const negated = /!\s*defined|!\s*\(|not\b/i.test(e);
  if (hasESP32 && !hasAVR && !hasESP8266) return negated ? !isESP32 : isESP32;
  if (hasAVR && !hasESP32) return negated ? isESP32 : !isESP32;
  if (hasESP8266 && !hasESP32 && !hasAVR) return negated ? true : false;
  if (hasESP32 && hasAVR) {
    if (/\|\|/.test(e)) return true;
    if (/&&/.test(e)) return false;
    return null;
  }
  return null;
}

function stripInactiveArchBlocksLocal(code: string, isESP32: boolean): string {
  const lines = code.split('\n');
  const stack: Array<{ parentActive: boolean; taken: boolean; active: boolean }> = [];
  const cur = () => (stack.length === 0 ? true : stack[stack.length - 1].active);
  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s*ifdef\s+(\w+)/))) {
      const c = evalArchConditionLocal(`defined(${m[1]})`, isESP32);
      const holds = c === null ? true : c;
      const parent = cur();
      stack.push({ parentActive: parent, taken: parent && holds, active: parent && holds });
      out.push(''); continue;
    }
    if ((m = line.match(/^#\s*ifndef\s+(\w+)/))) {
      const c = evalArchConditionLocal(`defined(${m[1]})`, isESP32);
      const holds = c === null ? true : !c;
      const parent = cur();
      stack.push({ parentActive: parent, taken: parent && holds, active: parent && holds });
      out.push(''); continue;
    }
    if ((m = line.match(/^#\s*if\s+(.*)/))) {
      const c = evalArchConditionLocal(m[1], isESP32);
      const holds = c === null ? true : c;
      const parent = cur();
      stack.push({ parentActive: parent, taken: parent && holds, active: parent && holds });
      out.push(''); continue;
    }
    if ((m = line.match(/^#\s*elif\s+(.*)/))) {
      const top = stack[stack.length - 1];
      if (top) {
        if (!top.parentActive || top.taken) top.active = false;
        else {
          const c = evalArchConditionLocal(m[1], isESP32);
          const holds = c === null ? true : c;
          top.active = holds; top.taken = holds;
        }
      }
      out.push(''); continue;
    }
    if (/^#\s*else\b/.test(line)) {
      const top = stack[stack.length - 1];
      if (top) {
        if (!top.parentActive || top.taken) top.active = false;
        else { top.active = true; top.taken = true; }
      }
      out.push(''); continue;
    }
    if (/^#\s*endif\b/.test(line)) { stack.pop(); out.push(''); continue; }
    out.push(cur() ? rawLine : '');
  }
  return out.join('\n');
}

function extractIncludesLocal(code: string, opts?: { isESP32?: boolean }): string[] {
  const effective = opts?.isESP32 === undefined ? code : stripInactiveArchBlocksLocal(code, opts.isESP32);
  const headers: string[] = [];
  const re = /#include\s*[<"]([^>"]+)[>"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(effective)) !== null) {
    const h = m[1].trim().split('/').pop()!;
    if (h.endsWith('.h') || h.endsWith('.hpp')) headers.push(h);
  }
  return [...new Set(headers)];
}
function headerExistsLocal(header: string, libDirs: string[]): boolean {
  for (const dir of libDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const libs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
      for (const lib of libs) {
        if (fs.existsSync(path.join(dir, lib, header)) || fs.existsSync(path.join(dir, lib, 'src', header))) return true;
        const src = path.join(dir, lib, 'src');
        if (fs.existsSync(src)) {
          try { if (fs.readdirSync(src).some((f: string) => f.toLowerCase() === header.toLowerCase())) return true; } catch {}
        }
      }
    } catch {}
  }
  return false;
}
function resolveLibDepsLocal(code: string, opts: { libDirs?: string[]; libDeps?: string[]; isESP32?: boolean }): string[] {
  const base = opts.libDeps ? [...opts.libDeps] : [];
  const lower = new Set(base.map(b => b.toLowerCase()));
  const headers = extractIncludesLocal(code, opts.isESP32 === undefined ? undefined : { isESP32: opts.isESP32 });
  const libDirs = opts.libDirs || [];
  for (const h of headers) {
    if (isBuiltinHeaderLocal(h)) continue;
    if (headerExistsLocal(h, libDirs)) continue;
    const mapped = HEADER_TO_LIB[h];
    // Unknown headers: never guess `header minus .h` (that is what turned the
    // ESP32-core BluetoothSerial.h into the mbed-only registry lib).
    if (!mapped) continue;
    if (!lower.has(mapped.toLowerCase())) { base.push(mapped); lower.add(mapped.toLowerCase()); }
  }
  return base;
}
function parseMissingHeaderLocal(err: string): string | null {
  const m = err.match(/fatal error:\s*([^:\s]+\.h)\s*:\s*No such file/i) || err.match(/No such file or directory[^]*?([A-Za-z0-9_]+\.h)/i);
  return m ? m[1].split('/').pop()! : null;
}

/**
 * Write a PlatformIO project (platformio.ini + src/main.ino) into projectDir.
 */
function createPioProject(
  projectDir: string,
  code: string,
  target: { board: string; platform: string },
  opts: { libDirs?: string[]; libDeps?: string[]; mergeBinaries?: boolean; uploadPort?: string } = {},
): string {
  const srcDir = path.join(projectDir, 'src');
  // Wipe any stale sources (e.g. leftover main.cpp from an earlier mixed-language
  // build) so PlatformIO never compiles both main.ino and a duplicate main.cpp.
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'main.ino'), code, 'utf-8');

  const resolvedDeps = resolveLibDepsLocal(code, { ...opts, isESP32: target.platform === 'espressif32' });
  const effectiveDeps = resolvedDeps.length ? resolvedDeps : opts.libDeps;
  const lines = [
    `[env:${target.board}]`,
    `platform = ${target.platform}`,
    'framework = arduino',
    `board = ${target.board}`,
  ];
  if (opts.libDirs?.length) {
    lines.push('lib_extra_dirs =');
    for (const dir of opts.libDirs) lines.push(`    ${dir.replace(/\\/g, '/')}`);
  }
  if (effectiveDeps?.length || opts.libDirs?.length) {
    lines.push('lib_ldf_mode = deep+');
    lines.push('lib_compat_mode = off');
  }
  if (effectiveDeps?.length) {
    lines.push('lib_deps =');
    for (const dep of effectiveDeps) lines.push(`    ${dep}`);
  }
  if (opts.mergeBinaries) lines.push('board_build.merge_binaries = yes');
  if (opts.uploadPort) lines.push(`upload_port = ${opts.uploadPort}`);

  fs.writeFileSync(path.join(projectDir, 'platformio.ini'), lines.join('\n') + '\n', 'utf-8');
  return projectDir;
}

function getPioBuildDir(projectDir: string, board: string): string {
  return path.join(projectDir, '.pio', 'build', board);
}

function listPioBuildFiles(projectDir: string, board: string): string[] {
  const buildDir = getPioBuildDir(projectDir, board);
  if (!fs.existsSync(buildDir)) return [];
  return fs.readdirSync(buildDir);
}

function formatPioError(result: CLIResult): string {
  const stderr = (result.stderr || '').trim();
  const stdout = (result.stdout || '').trim();
  const body = stderr || stdout || `pio exited with code ${result.code}`;
  return body.length > 4000 ? body.slice(-4000) : body;
}

/**
 * Detect infrastructure failures that should NOT block transpilation.
 * These are PlatformIO/toolchain issues, not user code errors.
 * When detected, server should warn and proceed to transpile anyway.
 */
function isInfraTranspileError(msg: string): boolean {
  const infraKeywords = [
    'MissingPackageManifestError',
    'package.json',
    'platform.json',
    'library.json',
    'manifest files in the package',
    'Could not find one of',
    'MissingPackage',
    'PlatformNotInstalled',
    'UnknownPackage',
    'ToolPackageManager',
    'esptool',
    'ModuleNotFoundError',
    'No module named',
    '[TIMEOUT]',
    'Process killed',
    'platform not available',
    'ESP32 platform not available',
    'Failed to install platform',
    'ConnectionError',
    'HTTPSConnectionPool',
    'Max retries exceeded',
    'Network is unreachable',
    'Temporary failure in name resolution',
    'pio: command not found',
    'not found: pio',
    'ENOENT',
    'spawn pio',
    'Failed to spawn',
    'not recognized as an internal',
    'not recognized as the name of a cmdlet',
  ];
  const lower = msg.toLowerCase();
  return infraKeywords.some(k => lower.includes(k.toLowerCase()));
}

async function getCliVersion(): Promise<string> {
  if (cachedPioVersion) return cachedPioVersion;
  try {
    const { stdout } = await runCLI(['--version']);
    const match = stdout.match(/version\s+([^\s]+)/i);
    cachedPioVersion = match ? match[1] : stdout.trim().split('\n')[0];
  } catch (err) {
    cachedPioVersion = 'unknown';
  }
  return cachedPioVersion!;
}

/**
 * Ensure a PlatformIO platform is installed. `pio platform install` is
 * idempotent (exits 0 when already installed); `pio run` also auto-installs
 * platforms declared in platformio.ini.
 */
async function ensurePioPlatform(name: string): Promise<boolean> {
  const { code, stderr } = await runCLI(['platform', 'install', name], 1_800_000);
  if (code !== 0) console.error(`[SERVER] platform install ${name} failed:`, stderr.slice(-800));
  return code === 0;
}

async function ensureEsp32Platform(): Promise<boolean> {
  if (esp32PlatformReady) return true;
  esp32PlatformReady = await ensurePioPlatform('espressif32');
  return esp32PlatformReady;
}

// Library dir: forge-lib/libraries (shared cache). Candidates in priority order.
const FORGE_LIB_LIBRARIES = (() => {
  const bundledLocal = path.join(__dirname, 'forge-lib', 'libraries');
  if (fs.existsSync(bundledLocal)) return bundledLocal;

  const bundledParent = path.join(__dirname, '..', 'forge-lib', 'libraries');
  if (fs.existsSync(bundledParent)) return bundledParent;

  if (process.env.PIO_LIB_DIRS && fs.existsSync(process.env.PIO_LIB_DIRS)) return process.env.PIO_LIB_DIRS;

  const dockerLibs = path.join('/app/forge-lib/libraries');
  if (fs.existsSync(dockerLibs)) return dockerLibs;

  return null;
})();

console.log(`[SERVER] pio:          ${PIO_BIN}`);
console.log(`[SERVER] libraries:    ${FORGE_LIB_LIBRARIES || '(none)'}`);

export interface CLIResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCLI(args: string[], timeoutMs = 120_000): Promise<CLIResult> {
  return new Promise((resolve) => {
    const proc = spawn(PIO_BIN, args, { env: { ...process.env } });
    proc.unref();
    let stdout = '', stderr = '';
    let settled = false;
    const done = (result: CLIResult) => { if (!settled) { settled = true; resolve(result); } };
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      done({ stdout, stderr: `[TIMEOUT] Process killed after ${timeoutMs}ms\n${stderr}`, code: -1 });
    }, timeoutMs);
    timer.unref();
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => { clearTimeout(timer); done({ stdout, stderr, code: code ?? -1 }); });
    proc.on('error', err => { clearTimeout(timer); done({ stdout: '', stderr: err.message, code: -1 }); });
  });
}

function runCommand(cmd: string, timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    console.log(`[EXEC] ${cmd}`);
    const proc = spawn('cmd.exe', ['/c', cmd], {
      shell: true,
      env: { ...process.env },
    });
    proc.unref();
    let stdout = '', stderr = '';
    let settled = false;
    const done = (err: Error | null, result?: { stdout: string; stderr: string }) => {
      if (!settled) {
        settled = true;
        err ? reject(err) : resolve(result!);
      }
    };
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      done(new Error(`[TIMEOUT] Command killed after ${timeoutMs}ms\n${stderr || stdout}`));
    }, timeoutMs);
    timer.unref();
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) done(null, { stdout, stderr });
      else done(new Error(stderr || stdout || `Exit code ${code}`));
    });
    proc.on('error', err => { clearTimeout(timer); done(err); });
  });
}

async function initCores(): Promise<void> {
  console.log('[SERVER] Initializing PlatformIO platforms...');
  try {
    await getCliVersion();

    const avrOk = await ensurePioPlatform('atmelavr');
    console.log('[SERVER] atmelavr platform:', avrOk ? 'ready' : 'FAILED');

    esp32PlatformReady = await ensurePioPlatform('espressif32');
    console.log('[SERVER] espressif32 platform:', esp32PlatformReady ? 'ready' : 'FAILED');

    console.log('[SERVER] Platform initialization complete');
  } catch (e: any) {
    console.warn('[SERVER] Platform init warning:', e.message);
  }
}

async function ensureESP32Core(): Promise<boolean> {
  return ensureEsp32Platform();
}

function migrateESP32LedcAPI(code: string): string {
  const chMap = new Map<string, { freq: string; res: string; pin: string }>();
  for (const m of code.matchAll(/ledcSetup\s*\(\s*(\w+)\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/g)) {
    const [, ch, freq, res] = m;
    const e = chMap.get(ch) ?? { freq: freq.trim(), res: res.trim(), pin: '' };
    e.freq = freq.trim(); e.res = res.trim(); chMap.set(ch, e);
  }
  for (const m of code.matchAll(/ledcAttachPin\s*\(\s*([^,]+?)\s*,\s*(\w+)\s*\)/g)) {
    const [, pin, ch] = m;
    const e = chMap.get(ch) ?? { freq: '5000', res: '8', pin: '' };
    e.pin = pin.trim(); chMap.set(ch, e);
  }
  if (chMap.size === 0) return code;
  let result = code;
  result = result.replace(/[ \t]*ledcSetup\s*\([^)]*\)\s*;[ \t]*\n?/g, '');
  result = result.replace(/[ \t]*ledcAttachPin\s*\([^)]*\)\s*;[ \t]*\n?/g, '');
  const attachCalls = [...chMap.entries()]
    .filter(([, v]) => v.pin)
    .map(([, v]) => `  ledcAttach(${v.pin}, ${v.freq}, ${v.res});`)
    .join('\n');
  if (attachCalls) result = result.replace(/(void\s+setup\s*\(\s*\)\s*\{)/, `$1\n${attachCalls}`);
  result = result.replace(/ledcWrite\s*\(\s*(\w+)\s*,\s*([^)]+)\s*\)/g, (match, ch, duty) => {
    const e = chMap.get(ch);
    return e?.pin ? `ledcWrite(${e.pin}, ${duty.trim()})` : match;
  });
  return result;
}

function binToIntelHex(buf: Buffer): string {
  const RECORD_SIZE = 16;
  let hex = '';
  for (let offset = 0; offset < buf.length; offset += RECORD_SIZE) {
    const chunk = buf.slice(offset, Math.min(offset + RECORD_SIZE, buf.length));
    const len = chunk.length;
    const addr = offset & 0xFFFF;
    if (offset > 0 && (offset & 0xFFFF) === 0) {
      const seg = (offset >> 16) & 0xFFFF;
      const hi = (seg >> 8) & 0xFF, lo = seg & 0xFF;
      const ck = (0x100 - ((2 + 4 + hi + lo) & 0xFF)) & 0xFF;
      hex += `:02000004${hi.toString(16).padStart(2, '0').toUpperCase()}${lo.toString(16).padStart(2, '0').toUpperCase()}${ck.toString(16).padStart(2, '0').toUpperCase()}\n`;
    }
    let sum = len + ((addr >> 8) & 0xFF) + (addr & 0xFF);
    let data = '';
    for (let i = 0; i < len; i++) { sum += chunk[i]; data += chunk[i].toString(16).padStart(2, '0').toUpperCase(); }
    const checksum = (0x100 - (sum & 0xFF)) & 0xFF;
    hex += `:${len.toString(16).padStart(2, '0').toUpperCase()}${addr.toString(16).padStart(4, '0').toUpperCase()}00${data}${checksum.toString(16).padStart(2, '0').toUpperCase()}\n`;
  }
  hex += ':00000001FF\n';
  return hex;
}

// ─── POST /build-apk ──────────────────────────────────────────
app.post('/build-apk', async (req: Request, res: Response) => {
  const project = req.body;
  const reqTime = Date.now();
  console.log('[APK] ==================== /build-apk REQUEST ====================');
  console.log('[APK] Timestamp:', new Date().toISOString());
  console.log('[APK] appName:', project?.appName, '| packageName:', project?.packageName);
  console.log('[APK] screens:', project?.screens?.length, '| media:', project?.media?.length);
  if (!project || typeof project !== 'object') {
    console.log('[APK] ERROR: No project data');
    return res.status(400).json({ success: false, error: 'No project data provided' });
  }

  try {
    const jsPath = path.join(__dirname, '..', 'src', 'creova', 'apk', 'buildAPK.js');
    const tsPath = path.join(__dirname, '..', 'src', 'creova', 'apk', 'buildAPK.ts');
    const buildPath = fs.existsSync(jsPath) ? jsPath : (fs.existsSync(tsPath) ? tsPath : null);
    console.log('[APK] jsPath:', jsPath, 'exists:', fs.existsSync(jsPath));
    console.log('[APK] tsPath:', tsPath, 'exists:', fs.existsSync(tsPath));

    let builder: any;
    if (buildPath) {
      const ApkModule = await import(pathToFileURL(buildPath).href);
      const ApkBuilder = ApkModule.default || ApkModule;
      builder = new ApkBuilder();
      console.log('[APK] Builder instance created from:', buildPath);
    }

    if (!builder || typeof builder.build !== 'function') {
      console.log('[APK] Builder not available');
      const logs = [
        '[10%] Cloud APK builder not available on this server.',
        '[30%] APK builds require the local LeapBlocks server or Electron app.',
        '[50%] Install the desktop app or start the local server on port 3001.',
        '[100%] Build simulation complete — no APK was generated.',
      ];
      return res.json({
        success: false,
        error: 'APK building is not available on the cloud server. Use the local LeapBlocks server (port 3001) or the Electron Desktop app.',
        logs,
        cloudBuildUnsupported: true,
      });
    }

    const logs: string[] = [];
    console.log('[APK] Calling builder.build()...');
    const outputPath = await builder.build(project, ({ stage, progress, message }: { stage?: string; progress?: number; message?: string }) => {
      if (message) {
        const prefix = progress !== undefined ? `[${progress}%] ` : '';
        const entry = `${prefix}${message}`;
        logs.push(entry);
        console.log(`[APK] ${entry}`);
      }
    });

    const elapsed = ((Date.now() - reqTime) / 1000).toFixed(1);
    console.log('[APK] build() returned:', outputPath, '| elapsed:', elapsed + 's');

    const apkName = `${sanitizeApkName(project.appName)}.apk`;
    const publicPath = path.join(APK_PUBLIC_DIR, apkName);
    fs.mkdirSync(APK_PUBLIC_DIR, { recursive: true });

    if (fs.existsSync(outputPath)) {
      console.log('[APK] Copying APK to public:', publicPath);
      fs.copyFileSync(outputPath, publicPath);
    } else {
      console.log('[APK] WARNING: outputPath does not exist:', outputPath);
    }

    console.log('[APK] ==================== /build-apk COMPLETE ====================');
    return res.json({
      success: true,
      downloadUrl: `/apks/${apkName}`,
      outputPath: publicPath,
      logs,
    });
  } catch (err: any) {
    console.error('[APK] ==================== /build-apk FAILED ====================');
    console.error('[APK] Error:', err.message, '| Stack:', err.stack);
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

// ─── POST /build (APK build job) ──────────────────────────────
export interface BuildJob {
  id: string;
  status: 'queued' | 'building' | 'done' | 'error';
  progress: number;
  logs: Array<{ message: string; type: string }>;
  apkPath: string | null;
  error: string | null;
  createdAt: string;
  projectName?: string;
}

const jobs = new Map<string, BuildJob>();

const JOB_TTL_MS = 60 * 60 * 1000;
const JOB_DONE_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const age = now - new Date(job.createdAt).getTime();
    if (age > JOB_TTL_MS) {
      console.log(`[CLEANUP] Removing stale job ${id} (age ${Math.round(age / 1000)}s)`);
      jobs.delete(id);
      continue;
    }
    if ((job.status === 'done' || job.status === 'error') && age > JOB_DONE_TTL_MS) {
      console.log(`[CLEANUP] Removing completed job ${id} (age ${Math.round(age / 1000)}s)`);
      if (job.apkPath) {
        try { fs.rmSync(job.apkPath, { force: true }); } catch {}
      }
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

let builderModule: any = null;
async function getBuilder(): Promise<any> {
  if (!builderModule) {
    const jsPath = path.join(__dirname, '..', 'src', 'creova', 'apk', 'buildAPK.js');
    const tsPath = path.join(__dirname, '..', 'src', 'creova', 'apk', 'buildAPK.ts');
    const bPath = fs.existsSync(jsPath) ? jsPath : (fs.existsSync(tsPath) ? tsPath : null);
    if (bPath) {
      const mod = await import(pathToFileURL(bPath).href);
      const Builder = mod.default || mod;
      builderModule = new Builder();
      console.log('[APK-BUILDER] Loaded from:', bPath);
    }
  }
  return builderModule;
}

app.post('/build', async (req: Request, res: Response) => {
  try {
    const { project } = req.body;
    if (!project) return res.status(400).json({ error: 'No project data' });

    const jobId = uuidv4();
    const job: BuildJob = {
      id: jobId,
      status: 'queued',
      progress: 0,
      logs: [],
      apkPath: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    jobs.set(jobId, job);

    const builder = await getBuilder();
    if (builder && typeof builder.build === 'function') {
      job.status = 'building';
      const apkName = sanitizeApkName(project.appName);
      const finalPath = path.join(APK_PUBLIC_DIR, `${apkName}.apk`);

      builder.build(project, (event: { stage?: string; progress?: number; message?: string }) => {
        if (event.progress !== undefined) job.progress = event.progress;
        if (event.message) {
          job.logs.push({ message: event.message, type: event.stage === 'complete' ? 'success' : 'info' });
        }
      }).then((outputPath: string) => {
        fs.mkdirSync(APK_PUBLIC_DIR, { recursive: true });
        if (fs.existsSync(outputPath)) {
          fs.copyFileSync(outputPath, finalPath);
          try { fs.rmSync(outputPath, { force: true }); } catch {}
        }
        job.status = 'done';
        job.progress = 100;
        job.apkPath = finalPath;
        job.logs.push({ message: `Build complete: ${finalPath}`, type: 'success' });
      }).catch((err: any) => {
        job.status = 'error';
        job.error = err.message;
        job.logs.push({ message: `Build failed: ${err.message}`, type: 'error' });
      });
    } else {
      simulateBuild(job, project);
    }

    res.json({ jobId, message: 'Build started' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/status/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/download/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.apkPath) {
    return res.status(404).json({ error: 'APK not found' });
  }
  if (!fs.existsSync(job.apkPath)) {
    return res.status(404).json({ error: 'APK file missing' });
  }
  res.download(job.apkPath, `${sanitizeApkName(job.projectName || 'App')}.apk`);
});

app.delete('/job/:jobId', async (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (job && job.apkPath) {
    try { fs.rmSync(job.apkPath, { force: true }); } catch {}
  }
  jobs.delete(req.params.jobId);
  res.json({ deleted: true });
});

function simulateBuild(job: BuildJob, project: any): void {
  if (project.appName) job.projectName = project.appName;
  const steps = [
    { progress: 10, msg: 'Decoding base APK...', delay: 1000 },
    { progress: 25, msg: 'Editing AndroidManifest...', delay: 800 },
    { progress: 40, msg: 'Injecting user assets...', delay: 1200 },
    { progress: 55, msg: 'Injecting feature modules...', delay: 1500 },
    { progress: 70, msg: 'Repacking APK...', delay: 2000 },
    { progress: 85, msg: 'Signing APK...', delay: 1500 },
    { progress: 100, msg: 'Build complete!', delay: 500 },
  ];

  let i = 0;
  const next = () => {
    if (i >= steps.length) {
      job.status = 'done';
      const apkName = `${sanitizeApkName(project.appName || 'App')}.apk`;
      job.apkPath = path.join(APK_PUBLIC_DIR, apkName);
      if (!fs.existsSync(job.apkPath)) {
        const placeholder = path.join(APK_PUBLIC_DIR, 'placeholder.apk');
        fs.writeFileSync(placeholder, `Placeholder APK for ${project.appName || 'App'}`);
        if (!fs.existsSync(job.apkPath)) job.apkPath = placeholder;
      }
      return;
    }
    const step = steps[i++];
    job.progress = step.progress;
    job.logs.push({ message: step.msg, type: 'info' });
    job.status = step.progress < 100 ? 'building' : 'done';
    setTimeout(next, step.delay);
  };
  next();
}

// ─── Compile serialization ─────────────────────────────────────
// The Render instance has limited RAM: concurrent Arduino/ESP32
// compiles can OOM-kill the process. All compiles run one at a time.
let compileChain: Promise<unknown> = Promise.resolve();
function withCompileLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = compileChain.then(fn);
  compileChain = run.catch(() => undefined);
  return run;
}

// ─── POST /compile ────────────────────────────────────────────
app.post('/compile', async (req: Request, res: Response) => {
  const reqId = uuidv4().slice(0, 8);
  const startTime = Date.now();
  const { code, board = 'arduino:avr:uno', libraries = '' } = req.body;

  console.log(`[COMPILE:${reqId}] ════════════════════ /compile REQUEST ════════════════════`);
  console.log(`[COMPILE:${reqId}] Timestamp: ${new Date().toISOString()} | Board: ${board}`);
  console.log(`[COMPILE:${reqId}] Code size: ${code?.length || 0} chars, ${(code || '').split('\n').length} lines`);
  console.log(`[COMPILE:${reqId}] Libraries requested: ${JSON.stringify(libraries || 'none')}`);
  if (code) {
    const preview = code.split('\n').slice(0, 3).join(' \\ ');
    console.log(`[COMPILE:${reqId}] Code preview: ${preview}...`);
  }

  if (!code) {
    console.error(`[COMPILE:${reqId}] ❌ Rejected: No code provided`);
    return res.status(400).json({ success: false, errors: 'No code provided' });
  }

  if (!isInitialized) {
    console.warn(`[COMPILE:${reqId}] ⏳ Rejected: Server still initializing`);
    return res.status(503).json({ success: false, errors: ['Server is still initializing. Please wait.'] });
  }

  return withCompileLock(async () => {
    const lockAcquiredTime = Date.now();
    console.log(`[COMPILE:${reqId}] Lock acquired (+${lockAcquiredTime - startTime}ms from req). Resolving target...`);

    let target: { board: string; platform: string };
    try {
      target = pioTarget(board);
      console.log(`[COMPILE:${reqId}] Target resolved: board=${target.board}, platform=${target.platform}`);
    } catch (e: any) {
      console.error(`[COMPILE:${reqId}] ❌ Unknown board FQBN: ${board} (${e.message})`);
      return res.status(400).json({ success: false, errors: e.message });
    }

    const isESP32 = isEsp32Board(board);
    const tempId = uuidv4();
    const tempDir = path.join(os.tmpdir(), `electra_${tempId}`);
    const projectDir = path.join(tempDir, 'project');

    try {
      let processedCode = code;
      if (isESP32) {
        processedCode = processedCode.replace(/#include\s*[<"]Servo\.h[>"]/g, '#include <ESP32Servo.h>');
        processedCode = migrateESP32LedcAPI(processedCode);
        const coreOk = await ensureESP32Core();
        if (!coreOk) {
          console.error(`[COMPILE:${reqId}] ❌ ESP32 platform not available on this server`);
          return res.json({ success: false, errors: 'ESP32 platform not available on this server' });
        }
      }

      if (libraries) {
        const libList = Array.isArray(libraries) ? libraries : libraries.split(',').map((l: string) => l.trim());
        for (const lib of libList) {
          if (!lib) continue;
          if (FORGE_LIB_LIBRARIES) {
            const installedPath = path.join(FORGE_LIB_LIBRARIES, lib);
            if (!fs.existsSync(installedPath)) {
              console.log(`[COMPILE:${reqId}] Installing missing library: ${lib}...`);
              try { await runCLI(['pkg', 'install', '--library', lib, '--storage-dir', FORGE_LIB_LIBRARIES]); } catch (libErr: any) {
                console.warn(`[COMPILE:${reqId}] Warning installing library ${lib}:`, libErr.message);
              }
            }
          } else {
            try { await runCLI(['pkg', 'install', '--library', lib]); } catch {}
          }
        }
      }

      createPioProject(projectDir, processedCode, target, {
        libDirs: FORGE_LIB_LIBRARIES ? [FORGE_LIB_LIBRARIES] : [],
        libDeps: !isESP32 ? ['SoftwareSerial', 'Servo'] : [],
      });

      console.log(`[COMPILE:${reqId}] 🔨 Running PlatformIO build in ${projectDir}...`);
      const pioStartTime = Date.now();
      let { stdout, stderr, code: exitCode } = await runCLI(['run', '-d', projectDir, '-j', '2'], 900_000);
      let pioDuration = ((Date.now() - pioStartTime) / 1000).toFixed(2);

      if (exitCode !== 0) {
        const combined = (stderr || '') + '\n' + (stdout || '');
        const missing = parseMissingHeaderLocal(combined);
        if (missing && isBuiltinHeaderLocal(missing)) {
          console.error(`[COMPILE:${reqId}] ❌ Missing core header ${missing} — not installing a registry lib (it ships with the platform)`);
        }
        if (missing && !isBuiltinHeaderLocal(missing)) {
          const libName = HEADER_TO_LIB[missing];
          // No explicit mapping → do NOT guess (prevents BluetoothSerial→mbed etc).
          if (!libName) {
            console.error(`[COMPILE:${reqId}] ❌ Missing header ${missing} has no known library mapping — not retrying`);
          } else {
          console.warn(`[COMPILE:${reqId}] Missing header ${missing} → trying library "${libName}"`);
          try {
            if (FORGE_LIB_LIBRARIES) {
              await runCLI(['pkg', 'install', '--library', libName, '--storage-dir', FORGE_LIB_LIBRARIES], 120_000);
            } else {
              await runCLI(['pkg', 'install', '--library', libName], 120_000);
            }
          } catch {}
          const retryDeps = [...new Set([...(!isESP32 ? ['SoftwareSerial', 'Servo'] : []), libName])];
          createPioProject(projectDir, processedCode, target, {
            libDirs: FORGE_LIB_LIBRARIES ? [FORGE_LIB_LIBRARIES] : [],
            libDeps: retryDeps,
          });
          console.log(`[COMPILE:${reqId}] Retrying build with "${libName}"...`);
          const retry = await runCLI(['run', '-d', projectDir, '-j', '2'], 900_000);
          stdout = retry.stdout; stderr = retry.stderr; exitCode = retry.code;
          pioDuration = ((Date.now() - pioStartTime) / 1000).toFixed(2);
          }
        }
        if (exitCode !== 0) {
          console.error(`[COMPILE:${reqId}] ❌ Build FAILED (exit ${exitCode}) in ${pioDuration}s`);
          console.error(`[COMPILE:${reqId}] stderr:`, (stderr || '').slice(-1500));
          return res.json({ success: false, errors: formatPioError({ stdout, stderr, code: exitCode }) });
        }
      }

      console.log(`[COMPILE:${reqId}] ✓ PlatformIO build succeeded in ${pioDuration}s`);
      const files = listPioBuildFiles(projectDir, target.board);
      console.log(`[COMPILE:${reqId}] Build output files: ${files.join(', ')}`);

      if (isESP32) {
        const binFile = files.find(f => f === 'firmware.bin')
          ?? files.find(f => f.endsWith('.bin') && !f.includes('bootloader') && !f.includes('partition'));
        if (!binFile) {
          console.error(`[COMPILE:${reqId}] ❌ No .bin found. Files: ${files.join(', ')}`);
          return res.json({ success: false, errors: `No .bin found. Files: ${files.join(', ')}` });
        }
        const rawBin = fs.readFileSync(path.join(getPioBuildDir(projectDir, target.board), binFile));
        const hexContent = binToIntelHex(rawBin);
        const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[COMPILE:${reqId}] 🚀 Success! ESP32 firmware binary: ${rawBin.length} bytes (total ${totalDuration}s)`);
        return res.json({ success: true, hex: hexContent, binBase64: rawBin.toString('base64') });
      } else {
        const hexFile = files.find(f => f.endsWith('.hex'));
        if (!hexFile) {
          console.error(`[COMPILE:${reqId}] ❌ No .hex found. Files: ${files.join(', ')}`);
          return res.json({ success: false, errors: `No .hex found. Files: ${files.join(', ')}` });
        }
        const hexContent = fs.readFileSync(path.join(getPioBuildDir(projectDir, target.board), hexFile), 'utf-8');
        const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[COMPILE:${reqId}] 🚀 Success! AVR Intel HEX: ${hexContent.length} chars, ${hexContent.split('\n').length} lines (total ${totalDuration}s)`);
        return res.json({ success: true, hex: hexContent });
      }
    } catch (err: any) {
      console.error(`[COMPILE:${reqId}] ❌ Unexpected error: ${err.message}`, err.stack);
      return res.json({ success: false, errors: err.message });
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });
});

// ─── POST /compile/esp32 (with SHA-256 caching) ───────────────
app.post('/compile/esp32', async (req: Request, res: Response) => {
  const reqId = uuidv4().slice(0, 8);
  const startTime = Date.now();
  const { code, board = 'esp32:esp32:esp32c3', libraries = '' } = req.body;

  console.log(`[COMPILE-ESP32:${reqId}] ════════════════════ /compile/esp32 REQUEST ════════════════════`);
  console.log(`[COMPILE-ESP32:${reqId}] Timestamp: ${new Date().toISOString()} | Board: ${board}`);
  console.log(`[COMPILE-ESP32:${reqId}] Code size: ${code?.length || 0} chars, ${(code || '').split('\n').length} lines`);
  console.log(`[COMPILE-ESP32:${reqId}] Libraries requested: ${JSON.stringify(libraries || 'none')}`);

  if (!code) {
    console.error(`[COMPILE-ESP32:${reqId}] ❌ Rejected: No code provided`);
    return res.status(400).json({ success: false, errors: 'No code provided' });
  }

  const hash = crypto.createHash('sha256')
    .update(code + board + libraries)
    .digest('hex');

  const binPath = path.join(CACHE_DIR, `${hash}.bin`);
  const metaPath = path.join(CACHE_DIR, `${hash}.json`);

  if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const buffer = fs.readFileSync(binPath);
      const bootloaderBuffer = fs.existsSync(path.join(CACHE_DIR, `${hash}.bootloader.bin`))
        ? fs.readFileSync(path.join(CACHE_DIR, `${hash}.bootloader.bin`))
        : null;
      const partitionsBuffer = fs.existsSync(path.join(CACHE_DIR, `${hash}.partitions.bin`))
        ? fs.readFileSync(path.join(CACHE_DIR, `${hash}.partitions.bin`))
        : null;
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[COMPILE-ESP32:${reqId}] ⚡ Cache HIT for firmware ID: ${hash} (${buffer.length} bytes, returned in ${totalDuration}s)`);
      return res.json({
        success: true, id: hash, binBase64: buffer.toString('base64'),
        bootloaderBase64: bootloaderBuffer?.toString('base64') || null,
        partitionsBase64: partitionsBuffer?.toString('base64') || null,
        size: buffer.length, hash, cached: true, metadata: meta
      });
    } catch {
      console.log(`[COMPILE-ESP32:${reqId}] Cache read error, rebuilding`);
    }
  }

  console.log(`[COMPILE-ESP32:${reqId}] 🔨 Cache MISS, compiling for firmware ID: ${hash}`);
  return withCompileLock(async () => {
    const lockAcquiredTime = Date.now();
    console.log(`[COMPILE-ESP32:${reqId}] Lock acquired (+${lockAcquiredTime - startTime}ms from req). Resolving target...`);

    let target: { board: string; platform: string };
    try {
      target = pioTarget(board);
      console.log(`[COMPILE-ESP32:${reqId}] Target resolved: board=${target.board}, platform=${target.platform}`);
    } catch (e: any) {
      console.error(`[COMPILE-ESP32:${reqId}] ❌ Unknown board FQBN: ${board} (${e.message})`);
      return res.status(400).json({ success: false, errors: e.message });
    }
    const tempId = uuidv4();
    const tempDir = path.join(os.tmpdir(), `electra_${tempId}`);
    const projectDir = path.join(tempDir, 'project');

    try {
      let processedCode = code;
      processedCode = processedCode.replace(/#include\s*[<"]Servo\.h[>"]/g, '#include <ESP32Servo.h>');
      processedCode = migrateESP32LedcAPI(processedCode);

      console.log(`[COMPILE-ESP32:${reqId}] Checking ESP32 platform availability (esp32PlatformReady=${esp32PlatformReady})...`);
      const coreOk = await ensureESP32Core();
      if (!coreOk) {
        console.error(`[COMPILE-ESP32:${reqId}] ❌ ESP32 platform NOT available — rejecting request`);
        return res.json({ success: false, errors: 'ESP32 platform not available on this server' });
      }

      if (libraries) {
        const libList = Array.isArray(libraries) ? libraries : libraries.split(',').map((l: string) => l.trim());
        for (const lib of libList) {
          if (!lib) continue;
          if (FORGE_LIB_LIBRARIES) {
            const installedPath = path.join(FORGE_LIB_LIBRARIES, lib);
            if (!fs.existsSync(installedPath)) {
              console.log(`[COMPILE-ESP32:${reqId}] Installing missing library: ${lib}...`);
              try { await runCLI(['pkg', 'install', '--library', lib, '--storage-dir', FORGE_LIB_LIBRARIES]); } catch (libErr: any) {
                console.warn(`[COMPILE-ESP32:${reqId}] Warning installing library ${lib}:`, libErr.message);
              }
            }
          } else {
            try { await runCLI(['pkg', 'install', '--library', lib]); } catch {}
          }
        }
      }

      createPioProject(projectDir, processedCode, target, {
        libDirs: FORGE_LIB_LIBRARIES ? [FORGE_LIB_LIBRARIES] : [],
      });

      console.log(`[COMPILE-ESP32:${reqId}] 🔨 Running PlatformIO ESP32 build in ${projectDir}...`);
      const pioStartTime = Date.now();
      const { stdout, stderr, code: exitCode } = await runCLI(['run', '-d', projectDir, '-j', '2'], 1_800_000);
      const pioDuration = ((Date.now() - pioStartTime) / 1000).toFixed(2);

      if (exitCode !== 0) {
        console.error(`[COMPILE-ESP32:${reqId}] ❌ ESP32 compile FAILED (exit ${exitCode}) in ${pioDuration}s`);
        console.error(`[COMPILE-ESP32:${reqId}] stderr:`, (stderr || '').slice(-3000));
        return res.json({ success: false, errors: formatPioError({ stdout, stderr, code: exitCode }) });
      }

      console.log(`[COMPILE-ESP32:${reqId}] ✓ PlatformIO ESP32 build succeeded in ${pioDuration}s`);
      const buildDir = getPioBuildDir(projectDir, target.board);
      const files = listPioBuildFiles(projectDir, target.board);
      console.log(`[COMPILE-ESP32:${reqId}] Build output files: ${files.join(', ')}`);

      const binFile = files.find(f => f === 'firmware.bin')
        ?? files.find(f => f.endsWith('.bin') && !f.includes('bootloader') && !f.includes('partition'));

      if (!binFile) {
        console.error(`[COMPILE-ESP32:${reqId}] ❌ No .bin produced. Files: ${files.join(', ')}`);
        return res.json({ success: false, errors: `No .bin found. Files: ${files.join(', ')}` });
      }

      const binBuffer = fs.readFileSync(path.join(buildDir, binFile));
      const bootloaderFile = files.find(f => f === 'bootloader.bin');
      const partitionsFile = files.find(f => f === 'partitions.bin');
      const bootloaderBuffer = bootloaderFile ? fs.readFileSync(path.join(buildDir, bootloaderFile)) : null;
      const partitionsBuffer = partitionsFile ? fs.readFileSync(path.join(buildDir, partitionsFile)) : null;

      fs.writeFileSync(binPath, binBuffer);
      if (bootloaderBuffer) fs.writeFileSync(path.join(CACHE_DIR, `${hash}.bootloader.bin`), bootloaderBuffer);
      if (partitionsBuffer) fs.writeFileSync(path.join(CACHE_DIR, `${hash}.partitions.bin`), partitionsBuffer);
      const metadata = { id: hash, board, compiledAt: new Date().toISOString(), size: binBuffer.length, hash };
      fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
      evictCache();

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[COMPILE-ESP32:${reqId}] 🚀 Success! Firmware ID: ${hash}, size: ${binBuffer.length} bytes (total ${totalDuration}s)`);

      return res.json({
        success: true, id: hash, binBase64: binBuffer.toString('base64'),
        bootloaderBase64: bootloaderBuffer?.toString('base64') || null,
        partitionsBase64: partitionsBuffer?.toString('base64') || null,
        size: binBuffer.length, hash, cached: false, metadata
      });
    } catch (err: any) {
      console.error(`[COMPILE-ESP32:${reqId}] ❌ Unexpected error: ${err.message}`, err.stack);
      return res.json({ success: false, errors: err.message });
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });
});

// ─── GET /firmware/:id ────────────────────────────────────────
app.get('/firmware/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  if (!/^[a-f0-9]{64}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid firmware ID format' });
  }
  const binPath = path.join(CACHE_DIR, `${id}.bin`);
  if (!fs.existsSync(binPath)) {
    return res.status(404).json({ error: 'Firmware not found' });
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(binPath);
});

// ─── POST /transpile ──────────────────────────────────────────
app.post('/transpile', async (req: Request, res: Response) => {
  const { code, board = 'esp32:esp32:esp32c3' } = req.body;
  if (!code) return res.status(400).json({ success: false, errors: 'No code provided' });

  if (isInitialized && process.env.VALIDATE_TRANSPILE !== 'false') {
    const sketchId = `transpile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sketchDir = path.join(os.tmpdir(), 'electra', sketchId);
    try {
      fs.mkdirSync(sketchDir, { recursive: true });
      let target: { board: string; platform: string };
      try {
        target = pioTarget(board);
      } catch (e: any) {
        return res.json({ success: false, errors: (e as Error).message });
      }
      createPioProject(sketchDir, code, target, {
        libDirs: FORGE_LIB_LIBRARIES ? [FORGE_LIB_LIBRARIES] : [],
        libDeps: !isEsp32Board(board) ? ['SoftwareSerial', 'Servo'] : [],
      });
      const { code: exitCode, stdout, stderr } = await runCLI(['run', '-d', sketchDir], 60_000);
      if (exitCode !== 0) {
        const errMsg = formatPioError({ stdout, stderr, code: exitCode });
        if (isInfraTranspileError(errMsg)) {
          console.warn(`[TRANSPILE] Validation infra error ignored, proceeding to transpile: ${errMsg.slice(-600)}`);
        } else {
          return res.json({ success: false, errors: errMsg });
        }
      }
  } catch (err: any) {
    const msg = err.message || String(err);
    if (isInfraTranspileError(msg)) {
      console.warn(`[TRANSPILE] Validation exception (infra) ignored, proceeding to transpile: ${msg}`);
    } else {
      console.error('[SERVER] /transpile: EXCEPTION:', msg);
      return res.json({ success: false, errors: msg });
    }
  } finally {
      try { if (fs.existsSync(sketchDir)) fs.rmSync(sketchDir, { recursive: true, force: true }); } catch {}
    }
  }

  try {
    const jsCode = transpileArduinoToJS(code);
    console.log(`[TRANSPILE] Transpiled ${code.length} bytes → ${jsCode.length} bytes JS (board=${board})`);
    return res.json({ success: true, jsCode });
  } catch (err: any) {
    console.error('[TRANSPILE] Transpiler error:', err.message);
    return res.json({ success: false, errors: err.message });
  }
});

// ─── Library Management ───────────────────────────────────────

// GET /libraries/search
app.get('/libraries/search', async (req: Request, res: Response) => {
  const query = (req.query.q as string) || '';
  if (!query) return res.json([]);
  try {
    const url = new URL('https://api.registry.platformio.org/v3/search');
    url.searchParams.set('query', query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) throw new Error(`Registry HTTP ${response.status}`);
      const data: any = await response.json();
      const libs = (Array.isArray(data.items) ? data.items : [])
        .filter((l: any) => l.type === 'library')
        .slice(0, 20)
        .map((l: any) => ({
          name: l.name,
          author: l.owner?.username || '',
          description: l.description || '',
          version: l.version?.name || '',
        }));
      res.json(libs);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    res.json([]);
  }
});

// GET /libraries/installed
app.get('/libraries/installed', async (_req: Request, res: Response) => {
  if (!FORGE_LIB_LIBRARIES || !fs.existsSync(FORGE_LIB_LIBRARIES)) {
    return res.json([]);
  }
  try {
    const entries = fs.readdirSync(FORGE_LIB_LIBRARIES, { withFileTypes: true });
    const libs: any[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const libDir = path.join(FORGE_LIB_LIBRARIES, entry.name);
      const propFile = path.join(libDir, 'library.properties');
      if (fs.existsSync(propFile)) {
        const props: Record<string, string> = {};
        fs.readFileSync(propFile, 'utf-8').split('\n').forEach(line => {
          const [k, ...v] = line.split('=');
          if (k && v.length) props[k.trim()] = v.join('=').trim();
        });
        libs.push({ name: props.name || entry.name, version: props.version || '?', author: props.author || '', description: props.sentence || '' });
      } else {
        libs.push({ name: entry.name, version: '?', author: '', description: '' });
      }
    }
    res.json(libs);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /libraries/install
app.post('/libraries/install', async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Library name required' });

  console.log(`[SERVER] Installing library: ${name}`);
  if (FORGE_LIB_LIBRARIES) fs.mkdirSync(FORGE_LIB_LIBRARIES, { recursive: true });

  const args = FORGE_LIB_LIBRARIES
    ? ['pkg', 'install', '--library', name, '--storage-dir', FORGE_LIB_LIBRARIES]
    : ['pkg', 'install', '--library', name];
  const { stdout, stderr, code } = await runCLI(args, 300_000);
  if (code === 0) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: formatPioError({ stdout, stderr, code }) });
  }
});

// DELETE /libraries/remove
app.delete('/libraries/remove', async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Library name required' });

  console.log(`[SERVER] Removing library: ${name}`);

  // pio pkg uninstall has no --library/--storage-dir flags — the install
  // target lives in forge-lib/libraries, so remove it manually (best effort)
  // and also try a global uninstall to clean ~/.platformio.
  const { code, stderr, stdout } = await runCLI(['pkg', 'uninstall', '--global', name]);

  let manualRemoved = false;
  if (FORGE_LIB_LIBRARIES && fs.existsSync(FORGE_LIB_LIBRARIES)) {
    try {
      const entries = fs.readdirSync(FORGE_LIB_LIBRARIES, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const libDir = path.join(FORGE_LIB_LIBRARIES, entry.name);
        let match = (entry.name === name);
        if (!match) {
          const propFile = path.join(libDir, 'library.properties');
          if (fs.existsSync(propFile)) {
            const props = fs.readFileSync(propFile, 'utf-8').split('\n').reduce((acc: Record<string, string>, line) => {
              const [k, ...v] = line.split('=');
              if (k && v.length) acc[k.trim()] = v.join('=').trim();
              return acc;
            }, {});
            if (props.name === name) match = true;
          }
        }
        if (match) {
          fs.rmSync(libDir, { recursive: true, force: true });
          manualRemoved = true;
        }
      }
    } catch {}
  }

  if (code === 0 || manualRemoved) {
    res.json({ success: true, manualRemoved });
  } else {
    res.status(500).json({ success: false, error: stderr || stdout || 'Removal failed' });
  }
});

// ─── GET /logs ────────────────────────────────────────────────
app.get('/logs', (req: Request, res: Response) => {
  const logFilePath = path.join(__dirname, 'logs', 'access.log');
  
  if (req.query.download === 'true') {
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).send('No logs available yet.');
    }
    return res.download(logFilePath, 'access.log');
  }
  
  if (!fs.existsSync(logFilePath)) {
    return res.send('No logs available yet.');
  }

  try {
    const logsContent = fs.readFileSync(logFilePath, 'utf8');
    const lines = logsContent.trim().split('\n');
    const limit = parseInt(req.query.limit as string, 10) || 200;
    const lastLines = lines.slice(-limit).join('\n');
    
    res.setHeader('Content-Type', 'text/plain');
    res.send(lastLines);
  } catch (err: any) {
    res.status(500).send(`Error reading logs: ${err.message}`);
  }
});

// ─── POST /relay — HTTP relay for CORS-restricted local requests ──
app.post('/relay', async (req: Request, res: Response) => {
  const { url: targetUrl, method = 'GET', headers: reqHeaders = {}, body: reqBody } = req.body;
  if (!targetUrl) {
    return res.status(400).json({ success: false, error: 'No target URL provided' });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL' });
  }

  const host = parsed.hostname;
  const isPrivate = (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  );

  if (!isPrivate) {
    return res.status(403).json({ success: false, error: 'Relay only allowed for private/local network addresses' });
  }

  console.log(`[RELAY] ${method} ${targetUrl}`);

  try {
    const options: any = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method.toUpperCase(),
      headers: { ...reqHeaders },
      timeout: 10000,
    };

    delete options.headers['Host'];
    delete options.headers['host'];

    const proxyRes = await new Promise<any>((resolve, reject) => {
      const callback = (response: any) => {
        let data = '';
        response.on('data', (chunk: any) => { data += chunk; });
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            statusText: response.statusMessage,
            headers: response.headers,
            body: data,
          });
        });
      };
      const r = parsed.protocol === 'https:'
        ? https.request(options, callback)
        : http.request(options, callback);
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Request timed out')); });

      if (reqBody && method !== 'GET' && method !== 'HEAD') {
        r.write(typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody));
      }
      r.end();
    });

    res.json({
      success: true,
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers: proxyRes.headers,
      body: proxyRes.body,
    });
  } catch (err: any) {
    console.error(`[RELAY] Error: ${err.message}`);
    res.json({
      success: false,
      status: 0,
      error: err.message,
    });
  }
});

// ─── GET /health ──────────────────────────────────────────────
app.get('/health', async (_req: Request, res: Response) => {
  const cliVersion = await getCliVersion();

  const buildPath = path.join(__dirname, '..', 'src', 'creova', 'apk', 'buildAPK.js');
  const apkBuilderExists = fs.existsSync(buildPath);
  const toolsDir = path.join(__dirname, '..', 'tools');
  const toolsExist = fs.existsSync(toolsDir);

  res.json({
    status: 'ok',
    port: PORT,
    uptime: Math.floor(process.uptime()),
    platformio: cliVersion,
    esp32PlatformReady,
    initialized: isInitialized,
    jobCount: jobs.size,
    apkBuilderExists,
    toolsExist,
    buildPath,
    dirname: __dirname,
    endpoints: ['/compile', '/compile/esp32', '/transpile', '/build-apk', '/build', '/status/:jobId', '/download/:jobId', '/firmware/:id', '/libraries/search', '/libraries/installed', '/libraries/install', '/libraries/remove', '/job/:jobId', '/relay', '/logs', '/health'],
  });
});

// ─── Start ────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[LeapBlocks Server] Running on http://localhost:${PORT}`);
  console.log(`[LeapBlocks Server] pio: ${PIO_BIN}`);
  initCores().then(() => {
    if (!esp32PlatformReady) {
      ensureESP32Core().then(ok => {
        console.log(`[LeapBlocks Server] ESP32 platform: ${ok ? 'ready' : 'not installed'}`);
      });
    }
  });
});
