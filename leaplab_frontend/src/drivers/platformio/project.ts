/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 *
 * Generates a PlatformIO project (platformio.ini + src/main.ino) on disk.
 * Replaces arduino-cli's sketch + --config-file workflow.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface PioProjectOptions {
    /** PlatformIO board id, e.g. `uno`, `esp32-c3-devkitm-1`. */
    board: string;
    /** PlatformIO platform name, e.g. `atmelavr`, `espressif32`. */
    platform: string;
    /** Extra library directories (forge-lib/libraries). */
    libDirs?: string[];
    /** Extra lib_deps entries (e.g. `SoftwareSerial`). */
    libDeps?: string[];
    /** Merge bootloader+partitions+app into firmware.merged.bin (ESP32 simulation). */
    mergeBinaries?: boolean;
    /** Serial port for `-t upload`. */
    uploadPort?: string;
    /** Extra [env] lines, e.g. `build_flags = ...`. */
    extraEnv?: string[];
}

// ── Header → PlatformIO library name map (covers all bundled libs + common community libs) ─
// NOTE: Arduino / ESP32 core headers (WiFi.h, BluetoothSerial.h, HTTPClient.h,
// SPI.h, Wire.h, Servo.h, SoftwareSerial.h, …) are deliberately NOT mapped here.
// They ship with the platform framework — adding them to lib_deps would make
// PlatformIO fetch a wrong same-named library from the registry (e.g. the mbed
// "BluetoothSerial" lib, which needs mbed.h and breaks AVR builds).
export const HEADER_TO_LIBRARY: Record<string, string> = {
    'RTClib.h': 'RTClib',
    'Adafruit_BusIO_Register.h': 'Adafruit BusIO',
    'Adafruit_I2CDevice.h': 'Adafruit BusIO',
    'Adafruit_SPIDevice.h': 'Adafruit BusIO',
    'Adafruit_GFX.h': 'Adafruit GFX Library',
    'Adafruit_GrayOLED.h': 'Adafruit GFX Library',
    'Adafruit_SPITFT.h': 'Adafruit GFX Library',
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
    'HX711.h': 'bogde/HX711',
    'LiquidCrystal_I2C.h': 'marcoschwartz/LiquidCrystal_I2C',
    // Common community libs (not bundled but auto-resolved via lib_deps)
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
    // Verified installable via `pio pkg install` (owner-qualified where the
    // bare name is ambiguous or missing from the registry).
    'NewPing.h': 'teckel12/NewPing',
    'Adafruit_FT6206.h': 'adafruit/Adafruit FT6206 Library',
    'TFT_eSPI.h': 'bodmer/TFT_eSPI',
    'XPT2046_Touchscreen.h': 'paulstoffregen/XPT2046_Touchscreen',
    'U8g2lib.h': 'olikraus/U8g2',
    'AccelStepper.h': 'waspinator/AccelStepper',
    'MPU6050.h': 'electroniccats/MPU6050',
    'Encoder.h': 'paulstoffregen/Encoder',
};

/**
 * Headers that must only resolve to a registry library on AVR targets.
 * - `SD.h` ships with the ESP32 Arduino core: adding a lib_dep there would
 *   shadow the framework copy with an AVR-only library and break ESP32 builds.
 * - `LiquidCrystal.h` (fmalpartida) / `SevSeg.h`: ESP32 support is unverified;
 *   keep ESP32 behaviour unchanged (clean compiler error) while fixing AVR.
 */
export const AVR_ONLY_HEADER_TO_LIBRARY: Record<string, string> = {
    'SD.h': 'arduino-libraries/SD',
    'LiquidCrystal.h': 'fmalpartida/LiquidCrystal',
    'SevSeg.h': 'deanisme/SevSeg',
};

/** Headers that must only resolve on ESP32 targets (ESP-specific libs). */
export const ESP32_ONLY_HEADER_TO_LIBRARY: Record<string, string> = {
    'DHTesp.h': 'beegee-tokyo/DHT sensor library for ESPx',
};

/**
 * Target-aware header → library lookup. Centralises the AVR-only / ESP32-only
 * guards so the initial resolve AND the missing-header retry agree.
 */
export function lookupLibraryForHeader(header: string, isESP32: boolean): string | undefined {
    const base = header.split('/').pop()!.trim();
    return HEADER_TO_LIBRARY[base]
        ?? (isESP32 ? ESP32_ONLY_HEADER_TO_LIBRARY[base] : AVR_ONLY_HEADER_TO_LIBRARY[base]);
}

/**
 * Headers that ship with the Arduino-AVR / ESP32 Arduino cores and must NEVER
 * be turned into lib_deps. Without this guard, `#include "BluetoothSerial.h"`
 * (ESP32 core) resolves to the PlatformIO registry lib "BluetoothSerial"
 * (an mbed-OS lib needing mbed.h) and breaks every AVR build — even when the
 * include sits inside `#ifdef ARDUINO_ARCH_ESP32`.
 */
export const BUILTIN_HEADERS: ReadonlySet<string> = new Set([
    // Arduino core (all platforms)
    'Arduino.h', 'WProgram.h', 'pins_arduino.h', 'binary.h',
    'Client.h', 'Server.h', 'Udp.h', 'Stream.h', 'Printable.h', 'Print.h',
    'WString.h', 'HardwareSerial.h', 'IPAddress.h', 'String.h',
    'SPI.h', 'Wire.h', 'EEPROM.h', 'SoftwareSerial.h', 'Servo.h',
    // NOTE: `SD.h` is deliberately NOT here — it ships with the ESP32 core
    // but NOT with the AVR framework (verified by build test), so AVR builds
    // resolve it via AVR_ONLY_HEADER_TO_LIBRARY instead.
    // ESP32 Arduino core — networking / BT / BLE / HTTP / FS / system
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

export function isBuiltinHeader(header: string): boolean {
    const base = header.split('/').pop()!.trim();
    if (BUILTIN_HEADERS.has(base)) return true;
    // Framework-internal paths are always builtin.
    if (/^(avr|esp_|esp32|freertos|driver|soc|hal|lwip|mbedtls|nvs|spi_flash)\//i.test(header)) return true;
    if (/^BLE.*\.h$/i.test(base)) return true;
    if (/^esp_.*\.h$/i.test(base)) return true;
    if (/^soc\/.*|^hal\/.*|^driver\/.*|^freertos\/.*/i.test(header)) return true;
    return false;
}

/**
 * Evaluate an `#if`/`#ifdef` condition for a known target.
 * Returns true/false when the condition is a recognised architecture guard,
 * otherwise null (unknown macro → caller must assume the branch is active).
 */
function evalArchCondition(expr: string, isESP32: boolean): boolean | null {
    const e = expr.trim();
    const hasESP32 = /ARDUINO_ARCH_ESP32|\bESP32\b|ARDUINO_ESP32/.test(e);
    const hasAVR = /ARDUINO_ARCH_AVR|__AVR__|ARDUINO_AVR_|ARDUINO_ARCH_MEGA|ARDUINO_ARCH_SAMD|__arm__/.test(e);
    const hasESP8266 = /ESP8266/.test(e);
    const negated = /!\s*defined|!\s*\(|not\b/i.test(e);
    if (hasESP32 && !hasAVR && !hasESP8266) return negated ? !isESP32 : isESP32;
    if (hasAVR && !hasESP32) return negated ? isESP32 : !isESP32;
    if (hasESP8266 && !hasESP32 && !hasAVR) return negated ? true : false;
    if (hasESP32 && hasAVR) {
        // e.g. `#if defined(ESP32) || defined(__AVR__)` → active on both our targets.
        if (/\|\|/.test(e)) return true;
        if (/&&/.test(e)) return false;
        return null;
    }
    return null;
}

interface CondFrame { parentActive: boolean; taken: boolean; active: boolean; }

function currentActive(stack: CondFrame[]): boolean {
    return stack.length === 0 ? true : stack[stack.length - 1].active;
}

/**
 * Keep only the lines that are compiled for the given target, dropping
 * `#include`s hidden inside inactive `#ifdef ARDUINO_ARCH_*` branches.
 * Unknown macros are treated as active (safe default — never drop code we
 * cannot prove is inactive). Used before scanning for library headers.
 */
export function stripInactiveArchBlocks(code: string, isESP32: boolean): string {
    const lines = code.split('\n');
    const stack: CondFrame[] = [];
    const out: string[] = [];
    for (const rawLine of lines) {
        const line = rawLine.trim();
        let m: RegExpMatchArray | null;
        if ((m = line.match(/^#\s*ifdef\s+(\w+)/))) {
            const cond = evalArchCondition(`defined(${m[1]})`, isESP32);
            const holds = cond === null ? true : cond;
            const parent = currentActive(stack);
            stack.push({ parentActive: parent, taken: parent && holds, active: parent && holds });
            out.push('');
            continue;
        }
        if ((m = line.match(/^#\s*ifndef\s+(\w+)/))) {
            const cond = evalArchCondition(`defined(${m[1]})`, isESP32);
            const holds = cond === null ? true : !cond;
            const parent = currentActive(stack);
            stack.push({ parentActive: parent, taken: parent && holds, active: parent && holds });
            out.push('');
            continue;
        }
        if ((m = line.match(/^#\s*if\s+(.*)/))) {
            const cond = evalArchCondition(m[1], isESP32);
            const holds = cond === null ? true : cond;
            const parent = currentActive(stack);
            stack.push({ parentActive: parent, taken: parent && holds, active: parent && holds });
            out.push('');
            continue;
        }
        if ((m = line.match(/^#\s*elif\s+(.*)/))) {
            const top = stack[stack.length - 1];
            if (top) {
                if (!top.parentActive || top.taken) {
                    top.active = false;
                } else {
                    const cond = evalArchCondition(m[1], isESP32);
                    const holds = cond === null ? true : cond;
                    top.active = holds;
                    top.taken = holds;
                }
            }
            out.push('');
            continue;
        }
        if (/^#\s*else\b/.test(line)) {
            const top = stack[stack.length - 1];
            if (top) {
                if (!top.parentActive || top.taken) top.active = false;
                else { top.active = true; top.taken = true; }
            }
            out.push('');
            continue;
        }
        if (/^#\s*endif\b/.test(line)) {
            stack.pop();
            out.push('');
            continue;
        }
        out.push(currentActive(stack) ? rawLine : '');
    }
    return out.join('\n');
}

export function isEsp32PioTarget(opts: { board: string; platform: string }): boolean {
    return opts.platform === 'espressif32' || opts.board.startsWith('esp32');
}

export function extractIncludes(code: string, opts?: { isESP32?: boolean }): string[] {
    const effective = opts?.isESP32 === undefined ? code : stripInactiveArchBlocks(code, opts.isESP32);
    const headers: string[] = [];
    const re = /#include\s*[<"]([^>"]+)[>"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(effective)) !== null) {
        const h = m[1].trim();
        if (h.endsWith('.h') || h.endsWith('.hpp')) {
            const base = h.split('/').pop()!;
            headers.push(base);
        }
    }
    return [...new Set(headers)];
}

function headerExistsInLibDirs(header: string, libDirs: string[]): boolean {
    for (const dir of libDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            const libs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
            for (const lib of libs) {
                const candidates = [
                    path.join(dir, lib, header),
                    path.join(dir, lib, 'src', header),
                    path.join(dir, lib, 'src', header.toLowerCase()),
                ];
                for (const c of candidates) if (fs.existsSync(c)) return true;
                // Also check any .h under src recursively for case-insensitive match (cheap: top-level only)
                const libSrc = path.join(dir, lib, 'src');
                if (fs.existsSync(libSrc)) {
                    try {
                        const srcFiles = fs.readdirSync(libSrc);
                        if (srcFiles.some(f => f.toLowerCase() === header.toLowerCase())) return true;
                    } catch { /* ignore */ }
                }
            }
        } catch { /* ignore */ }
    }
    return false;
}

export function resolveLibDepsFromCode(code: string, opts: PioProjectOptions): string[] {
    const base = opts.libDeps ? [...opts.libDeps] : [];
    const baseLower = new Set(base.map(b => b.toLowerCase()));
    const isESP32 = isEsp32PioTarget({ board: opts.board, platform: opts.platform });
    // Only scan includes that are actually compiled for this target — guarded
    // `#ifdef ARDUINO_ARCH_ESP32` blocks must not pull ESP32-only libs into AVR builds.
    const headers = extractIncludes(code, { isESP32 });
    const libDirs = opts.libDirs || [];

    for (const header of headers) {
        // Core / framework headers never need lib_deps (prevents the
        // BluetoothSerial→mbed / WiFi→external-WiFi breakage on AVR).
        if (isBuiltinHeader(header)) continue;
        if (headerExistsInLibDirs(header, libDirs)) continue;
        const mapped = lookupLibraryForHeader(header, isESP32);
        // Unknown headers: do NOT guess `header minus .h` — that is what turned
        // BluetoothSerial.h into the mbed-only "BluetoothSerial" registry lib.
        // Only auto-add headers we have an explicit mapping for; anything else
        // surfaces as a real compiler error or via the missing-header retry.
        if (!mapped) continue;
        if (baseLower.has(mapped.toLowerCase())) continue;
        base.push(mapped);
        baseLower.add(mapped.toLowerCase());
    }
    return base;
}

export function parseMissingHeaderFromError(errorOutput: string): string | null {
    const m = errorOutput.match(/fatal error:\s*([^:\s]+\.h)\s*:\s*No such file/i)
        || errorOutput.match(/No such file or directory[^]*?([A-Za-z0-9_]+\.h)/i);
    return m ? m[1].split('/').pop()! : null;
}

/**
 * Write a complete PlatformIO project into `projectDir` and return it.
 * The sketch always lands at <projectDir>/src/main.ino.
 */
export function createPioProject(projectDir: string, code: string, opts: PioProjectOptions): string {
    const srcDir = path.join(projectDir, 'src');
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'main.ino'), code, 'utf-8');

    // Auto-resolve lib_deps from #includes (prevents "No such file or directory" for known headers)
    const resolvedDeps = resolveLibDepsFromCode(code, opts);
    const effectiveLibDeps = resolvedDeps.length ? resolvedDeps : opts.libDeps;

    const lines: string[] = [
        `[env:${opts.board}]`,
        `platform = ${opts.platform}`,
        'framework = arduino',
        `board = ${opts.board}`,
    ];

    if (opts.libDirs?.length) {
        lines.push('lib_extra_dirs =');
        for (const dir of opts.libDirs) {
            lines.push(`    ${dir.replace(/\\/g, '/')}`);
        }
    }

    // Always enable deep LDF + compat-off when libraries are involved so PlatformIO
    // finds headers in lib_extra_dirs transitively (e.g. RTClib → Adafruit BusIO).
    if (effectiveLibDeps?.length || opts.libDirs?.length) {
        lines.push('lib_ldf_mode = deep+');
        lines.push('lib_compat_mode = off');
    }

    if (effectiveLibDeps?.length) {
        lines.push('lib_deps =');
        for (const dep of effectiveLibDeps) {
            lines.push(`    ${dep}`);
        }
    }

    if (opts.mergeBinaries) {
        lines.push('board_build.merge_binaries = yes');
    }

    if (opts.uploadPort) {
        lines.push(`upload_port = ${opts.uploadPort}`);
    }

    if (opts.extraEnv?.length) {
        lines.push(...opts.extraEnv);
    }

    fs.writeFileSync(path.join(projectDir, 'platformio.ini'), lines.join('\n') + '\n', 'utf-8');
    return projectDir;
}

/** Standard build output dir for a board env: <projectDir>/.pio/build/<board> */
export function getPioBuildDir(projectDir: string, board: string): string {
    return path.join(projectDir, '.pio', 'build', board);
}

/** List files in the build dir (empty array when the build never ran). */
export function listPioBuildFiles(projectDir: string, board: string): string[] {
    const buildDir = getPioBuildDir(projectDir, board);
    if (!fs.existsSync(buildDir)) return [];
    return fs.readdirSync(buildDir);
}