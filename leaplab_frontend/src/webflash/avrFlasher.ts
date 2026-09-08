/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 *
 * AVR flasher — speaks the same protocols as avrdude's "arduino" (STK500v1,
 * optiboot) and "wiring" (STK500v2, Mega2560) programmers to the bootloaders
 * on Arduino Uno / Nano / Mega. Runs entirely in the browser over the Web
 * Serial API. No drivers needed.
 *
 * Upload sequence:
 *   1. Open the port at the bootloader baud (115200 → 57600 → 19200 fallback).
 *   2. Pulse DTR + RTS with the port open → board resets into its bootloader
 *      (avrdude-style). Clones wired through either line are covered.
 *   3. avrdude-style sync loop: keep sending the STK sync byte while watching
 *      for INSYNC — catches the bootloader anywhere in its watchdog window.
 *   4. Fallback: classic 1200-baud open/close reset for bridges that ignore
 *      DTR at higher baud.
 *   5. Sync, read signature, enter progmode, write flash page-by-page.
 */

import { parseIntelHex } from './intelHex';

// ── STK500v1 protocol constants ─────────────────────────────────────────────
const STK_GET_SYNC = 0x30;
const STK_GET_SIGN_ON = 0x31;
const STK_SET_DEVICE = 0x42;
const STK_SET_DEVICE_EXT = 0x45;
const STK_ENTER_PROGMODE = 0x50;
const STK_LEAVE_PROGMODE = 0x51;
const STK_READ_SIGN = 0x75;
const STK_LOAD_ADDRESS = 0x55;
const STK_PROG_PAGE = 0x64;
const CRC_EOP = 0x20;

const STK_INSYNC = 0x14;
const STK_OK = 0x10;
const STK_NOSYNC = 0x15;

// ── STK500v2 protocol constants (Mega2560 / Wiring bootloader) ─────────────
const V2_MESSAGE_START = 0x1b;
const V2_TOKEN = 0x0e;
const V2_STATUS_OK = 0x00;
const V2_CMD_SIGN_ON = 0x01;
const V2_CMD_LOAD_ADDRESS = 0x06;
const V2_CMD_ENTER_PROGMODE = 0x10;
const V2_CMD_LEAVE_PROGMODE = 0x11;
const V2_CMD_PROGRAM_FLASH = 0x13;
const V2_CMD_READ_SIGNATURE = 0x18;

// ── Board profiles (bootloader params used by avrdude "arduino" programmer) ─
interface AvrBoardProfile {
    fqbn: string;
    /** Bytes per flash page. */
    pageSize: number;
    /** Expected chip signature (device signature bytes). */
    signature: number[];
    /** Additional signatures that are code-compatible (e.g. 328 vs 328P). */
    alternateSignatures?: number[][];
    /** Flash size in bytes. */
    flashSize: number;
    /** Try these baud rates in order (most bootloaders auto-baud). */
    bauds: number[];
    /** Bootloader protocol: optiboot uses STK500v1, the Mega2560 uses STK500v2. */
    protocol: 'stk500v1' | 'stk500v2';
}

function signaturesEqual(a: ArrayLike<number>, b: number[]): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function isSignatureAccepted(actual: ArrayLike<number>, profile: AvrBoardProfile): boolean {
    if (signaturesEqual(actual, profile.signature)) return true;
    if (profile.alternateSignatures) {
        for (const alt of profile.alternateSignatures) {
            if (signaturesEqual(actual, alt)) return true;
        }
    }
    return false;
}

const AVR_BOARD_PROFILES: Record<string, AvrBoardProfile> = {
    'arduino:avr:uno': {
        fqbn: 'arduino:avr:uno',
        pageSize: 128,
        signature: [0x1e, 0x95, 0x0f], // ATmega328P (0x1e 0x95 0x0f = 30.149.15)
        alternateSignatures: [[0x1e, 0x95, 0x14]], // ATmega328 (non-P) is code-compatible — accept it
        flashSize: 32 * 1024,
        // 19200 covers FTDI-based Duemilanove/Diecimila clones that report as
        // USB 0403:6001 and are often (mis)selected as "Uno". Harmless for real
        // Unos — just one extra fallback pass.
        bauds: [115200, 57600, 19200],
        protocol: 'stk500v1',
    },
    'arduino:avr:nano': {
        fqbn: 'arduino:avr:nano',
        pageSize: 128,
        signature: [0x1e, 0x95, 0x0f], // ATmega328P — real Nano reports 30.149.15 (was wrongly 30.149.2)
        alternateSignatures: [[0x1e, 0x95, 0x14]], // ATmega328
        flashSize: 32 * 1024,
        bauds: [115200, 57600, 19200],
        protocol: 'stk500v1',
    },
    'arduino:avr:nano_old': {
        fqbn: 'arduino:avr:nano_old',
        pageSize: 128,
        signature: [0x1e, 0x95, 0x0f], // ATmega328P (old bootloader still same chip)
        alternateSignatures: [[0x1e, 0x95, 0x14]],
        flashSize: 32 * 1024,
        bauds: [57600, 115200, 19200],
        protocol: 'stk500v1',
    },
    'arduino:avr:mega': {
        fqbn: 'arduino:avr:mega',
        pageSize: 256,
        signature: [0x1e, 0x98, 0x01], // ATmega2560
        flashSize: 256 * 1024,
        bauds: [115200, 57600],
        protocol: 'stk500v2',
    },
};

export function getAvrBoardProfile(fqbn: string): AvrBoardProfile | undefined {
    const match = Object.values(AVR_BOARD_PROFILES).find(p => p.fqbn === fqbn);
    return match;
}

export interface AvrFlashOptions {
    hex: string;
    fqbn: string;
    onProgress?: (progress: number, message: string) => void;
    onLog?: (message: string) => void;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Minimal byte-stream wrapper over a Web Serial port with a read buffer and
 * timeouts. Only used while a single upload owns the port.
 */
class SerialStream {
    readonly port: SerialPort;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private buffer = new Uint8Array(0);
    private closed = false;

    constructor(port: SerialPort) {
        this.port = port;
    }

    async open(baudRate: number): Promise<void> {
        const t0 = Date.now();
        // The serial monitor may still hold the port open (or have just
        // released it while the OS still considers it busy). Close first so
        // port.open() below cannot throw InvalidStateError ("already open").
        const wasOpen = !!(this.port.readable || this.port.writable);
        if (wasOpen) {
            console.log(`[webflash][trace] port already open — closing first (open@${baudRate})`);
            try { await this.port.close(); } catch { /* already closed — ignore */ }
            // Settle delay: Windows + FTDI need a beat to release the COM
            // port, otherwise the next open() throws NetworkError.
            await sleep(250);
        }
        try {
            await this.port.open({ baudRate });
        } catch (err: any) {
            console.warn(`[webflash][trace] port.open@${baudRate} FAILED after ${Date.now() - t0}ms (wasOpen=${wasOpen}): ${err?.name || 'Error'}: ${err?.message || err}`);
            throw new Error(
                `Could not open the serial port at ${baudRate} baud (${err?.name || 'Error'}: ${err?.message || err}). ` +
                `Close the Serial Monitor / Arduino IDE monitor and retry.`
            );
        }
        console.log(`[webflash][trace] port.open@${baudRate} OK in ${Date.now() - t0}ms (wasOpen=${wasOpen})`);
        const readable = this.port.readable;
        const writable = this.port.writable;
        if (!readable || !writable) throw new Error('Serial port has no read/write streams.');
        this.reader = readable.getReader();
        this.writer = writable.getWriter();
        this.closed = false;
        this.buffer = new Uint8Array(0);
        this.startReading();
    }

    private startReading() {
        const pump = async () => {
            try {
                while (!this.closed && this.reader) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    if (value && value.length) this.append(value);
                }
            } catch {
                // Port closed / read error — ignore, close() is awaited elsewhere.
            }
        };
        pump();
    }

    /** Total bytes ever received on this stream (diagnostic: did the board talk at all?). */
    bytesReceived = 0;

    /** Per-arrival hook for RX timeline tracing (set per pass, cleared on close). */
    onRx: ((len: number, total: number) => void) | null = null;

    private append(chunk: Uint8Array) {
        const merged = new Uint8Array(this.buffer.length + chunk.length);
        merged.set(this.buffer, 0);
        merged.set(chunk, this.buffer.length);
        this.buffer = merged;
        this.bytesReceived += chunk.length;
        try { this.onRx?.(chunk.length, this.bytesReceived); } catch { /* diagnostics only */ }
    }

    /** Clear any leftover bytes in the receive buffer. */
    flushInput() {
        this.buffer = new Uint8Array(0);
    }

    /** Snapshot of currently buffered (unconsumed) bytes, for diagnostics. */
    peekBytes(max = 16): Uint8Array {
        return this.buffer.slice(0, max);
    }

    /** Bytes currently sitting in the buffer (unconsumed). */
    get bufferedLength(): number {
        return this.buffer.length;
    }

    /**
     * If the buffered bytes contain the target byte, consume everything up to
     * and including it and return true. Used by the avrdude-style sync loop.
     */
    consumeUntil(target: number): boolean {
        const idx = this.buffer.indexOf(target);
        if (idx < 0) return false;
        this.buffer = this.buffer.slice(idx + 1);
        return true;
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (!this.writer) throw new Error('Port is not open');
        await this.writer.write(bytes);
    }

    /** Wait until at least `count` bytes are buffered, then consume them. */
    async readBytes(count: number, timeoutMs = 2000): Promise<Uint8Array> {
        const deadline = Date.now() + timeoutMs;
        while (this.buffer.length < count) {
            if (Date.now() > deadline) {
                throw new Error(`Timed out waiting for ${count} bytes from the board (received ${this.buffer.length}).`);
            }
            await sleep(10);
        }
        const out = this.buffer.slice(0, count);
        this.buffer = this.buffer.slice(count);
        return out;
    }

    /** Send a raw STK command and consume the INSYNC … OK (or NOSYNC) envelope. */
    async stkCommand(bytes: Uint8Array, responseLength = 0, timeoutMs = 5000, clock?: PassClock, label = 'stk'): Promise<Uint8Array> {
        const tSend = Date.now();
        this.flushInput();
        await this.write(bytes);
        console.log(`[webflash][trace] ${label}: sent ${bytes.length}B${rPlus(clock, tSend)}`);
        const insync = await this.readBytes(1, timeoutMs);
        console.log(`[webflash][trace] ${label}: INSYNC 0x${insync[0].toString(16)} arrived${rPlus(clock)}`);
        if (insync[0] !== STK_INSYNC) {
            throw new Error('Board did not acknowledge the command (no sync). Is it in bootloader mode?');
        }
        const payload = responseLength > 0 ? await this.readBytes(responseLength, timeoutMs) : new Uint8Array(0);
        const status = await this.readBytes(1, timeoutMs);
        console.log(`[webflash][trace] ${label}: payload ${payload.length}B + status 0x${status[0].toString(16)}${rPlus(clock)}`);
        if (status[0] !== STK_OK) {
            throw new Error(`Board rejected the command (status 0x${status[0].toString(16)}).`);
        }
        return payload;
    }

    async close(): Promise<void> {
        this.closed = true;
        this.onRx = null;
        try {
            if (this.reader) {
                // A lost USB device never resolves cancel() — race it so one
                // dead pass can't wedge every later pass ("already open").
                await Promise.race([this.reader.cancel().catch(() => {}), sleep(500)]);
                // cancel() does not release the stream lock — release it so the
                // port can be reopened on the next upload. A locked stream
                // makes port.close() throw ("Cannot cancel a locked stream").
                try { this.reader.releaseLock(); } catch { /* already released */ }
                this.reader = null;
            }
            if (this.writer) {
                try { this.writer.releaseLock(); } catch { /* ignore */ }
                this.writer = null;
            }
            if (this.port.readable || this.port.writable) await this.port.close();
        } catch {
            // Already closed / device lost — fine.
        }
    }
}

/**
 * Set a serial control line. Modern Chrome uses dataTerminalReady /
 * requestToSend; older engines use the dtr / rts aliases and SILENTLY IGNORE
 * unknown dictionary members. Sending both names in one call lets every
 * generation apply whichever it understands without throwing.
 * Returns false when the browser refused all variants (previously swallowed
 * silently — a board that never resets looks exactly like "no bootloader").
 */
async function setSignal(port: SerialPort, modern: string, legacy: string, state: boolean): Promise<boolean> {
    const t0 = Date.now();
    try {
        await (port.setSignals as any)({ [modern]: state, [legacy]: state });
        console.log(`[webflash][trace] setSignals ${modern}/${legacy}=${state} OK in ${Date.now() - t0}ms (combined)`);
        return true;
    } catch (e1: any) {
        try {
            await (port.setSignals as any)({ [modern]: state });
            console.log(`[webflash][trace] setSignals ${modern}=${state} OK in ${Date.now() - t0}ms (modern-only; combined failed: ${e1?.message || e1})`);
            return true;
        } catch { /* unsupported */ }
        try {
            await (port.setSignals as any)({ [legacy]: state });
            console.log(`[webflash][trace] setSignals ${legacy}=${state} OK in ${Date.now() - t0}ms (legacy-only; combined failed: ${e1?.message || e1})`);
            return true;
        } catch (e3: any) {
            console.warn(`[webflash][trace] setSignals ${modern}/${legacy}=${state} REFUSED in ${Date.now() - t0}ms: ${e3?.name || 'Error'}: ${e3?.message || e3}`);
            return false;
        }
    }
}

const setDtr = (port: SerialPort, state: boolean) => setSignal(port, 'dataTerminalReady', 'dtr', state);
const setRts = (port: SerialPort, state: boolean) => setSignal(port, 'requestToSend', 'rts', state);

/**
 * Reset the board into its bootloader with the port OPEN (avrdude "arduino"
 * programmer behaviour). The Arduino auto-reset circuit fires on the FALLING
 * edge of DTR through a 0.1uF cap, so order matters: drive HIGH first (a
 * no-op if the OS already asserted it on open), then drop LOW — that falling
 * edge IS the reset and the ~1s optiboot window starts there, so the caller
 * must send sync bytes IMMEDIATELY (no trailing sleep). Both DTR and RTS are
 * driven because clones (CH340 etc.) wire auto-reset through either line.
 * Returns false when the browser refused every setSignals variant — without a
 * reset the board keeps running its sketch and sync can never succeed.
 */
async function pulseDtr(port: SerialPort, onLog?: (message: string) => void, driveRts = true, clock?: PassClock): Promise<boolean> {
    const t0 = Date.now();
    let dtrHigh = await setDtr(port, true);
    let rtsHigh = true;
    if (driveRts) rtsHigh = await setRts(port, true);
    let tHigh = Date.now() - t0;
    await sleep(50);
    let highTotal = Date.now() - t0;
    // Timer-throttle guard: a background tab stretches sleep(50) to ~1000ms,
    // holding the line HIGH so long the falling edge lands with the hunt loop
    // equally throttled — the pass is doomed. Re-fire a crisp pulse so the
    // bootloader window at least starts at a known edge.
    if (highTotal > 250) {
        console.warn(`[webflash][trace] pulse HIGH phase took ${highTotal}ms (timers throttled?) — re-firing crisp pulse`);
        onLog?.('⚠ Browser timers slowed (background tab?) — re-firing reset pulse. Keep this tab focused during upload.');
        dtrHigh = await setDtr(port, true);
        if (driveRts) rtsHigh = await setRts(port, true);
        tHigh = Date.now() - t0 - highTotal;
        await sleep(50);
        highTotal = Date.now() - t0;
    }
    const tFallStart = Date.now();
    const dtrLow = await setDtr(port, false);
    let rtsLow = true;
    if (driveRts) rtsLow = await setRts(port, false);
    const fallMs = Date.now() - tFallStart;
    const ok = dtrHigh && rtsHigh && dtrLow && rtsLow;
    if (clock) clock.t0 = Date.now(); // R+0: the ~1s bootloader window starts here
    console.log(`[webflash][trace] DTR${driveRts ? '/RTS' : '-only'} pulse: HIGH phase ${tHigh}ms (dtr=${dtrHigh} rts=${rtsHigh}), falling edge +LOW phase ${fallMs}ms (dtr=${dtrLow} rts=${rtsLow}), total ${Date.now() - t0}ms — R+0 stamped`);
    onLog?.(`Reset pulse sent (DTR ${dtrHigh && dtrLow ? 'ok' : 'REFUSED'}${driveRts ? `, RTS ${rtsHigh && rtsLow ? 'ok' : 'REFUSED'}` : ''}).`);
    if (!ok) {
        onLog?.('⚠ Browser refused serial control lines (DTR/RTS) — auto-reset cannot fire. The board never enters its bootloader; upload cannot succeed in this browser. Try Chrome/Edge 133+ or LeapBlocks Desktop.');
    }
    return ok;
}

/**
 * avrdude-style sync: send exactly one request, wait for its complete reply,
 * then retry. Some FTDI-connected bootloaders accept only one GET_SYNC while
 * starting and leave later bytes queued; flooding sync packets can make the
 * next programming command disappear behind those queued requests.
 */
/** Diagnostics for one sync hunt — drives adaptive baud focus in the retry loop. */
interface SyncResult {
    ok: boolean;
    candidates: number;
    writes: number;
    /** True when the port could not even be opened (held by another app). */
    openFailed: boolean;
    /** True when the USB device vanished mid-pass ("device has been lost"). */
    deviceLost: boolean;
}

/**
 * Reset-anchored clock for one pass: t0 is stamped at the end of the reset
 * falling edge, so every later log line can state its offset into the ~1s
 * bootloader window (R+ms). 0 = no reset has fired yet on this pass.
 */
interface PassClock {
    t0: number;
}

/** "R+123ms" suffix for trace lines, or "" when the clock is unset. */
function rPlus(clock: PassClock | undefined, now = Date.now()): string {
    if (!clock || !clock.t0) return '';
    return ` R+${now - clock.t0}ms`;
}

/** Thrown to abort all remaining passes: the USB device re-enumerated. */
class DeviceLostError extends Error {
    constructor() {
        super(
            'USB device was lost mid-upload (it disconnected and re-enumerated). ' +
            'Unplug it, wait 5s, plug it back in, click DISCONNECT then CONNECT to reselect the port, and retry. ' +
            'If it recurs, switch USB cable/port (direct, no hub) — repeated dropouts mean marginal power or signal.',
        );
        this.name = 'DeviceLostError';
    }
}

function isDeviceLostError(err: unknown): boolean {
    const msg = `${(err as any)?.name || ''} ${(err as any)?.message || err}`;
    return /has been lost|no device|device .*disconnect|not found/i.test(msg);
}

async function waitForBootloaderSync(stream: SerialStream, timeoutMs = 1500, onLog?: (message: string) => void, clock?: PassClock): Promise<SyncResult> {
    const t0 = Date.now();
    const deadline = t0 + timeoutMs;
    let candidates = 0;
    let writes = 0;
    let lastProgress = t0;
    let throttleWarned = false;
    console.log(`[webflash][trace] sync hunt start: window=${timeoutMs}ms${rPlus(clock)}`);
    while (Date.now() < deadline) {
        const iterStart = Date.now();
        // Keep the serial stream framed exactly like avrdude: no second sync
        // write is allowed until the first one has either replied or timed out.
        stream.flushInput();
        try {
            await stream.write(new Uint8Array([STK_GET_SYNC, CRC_EOP]));
        } catch (err: any) {
            if (isDeviceLostError(err)) {
                console.warn(`[webflash][trace] device lost during hunt write at T+${Date.now() - t0}ms: ${err?.message || err}`);
                return { ok: false, candidates, writes, openFailed: false, deviceLost: true };
            }
            throw err;
        }
        writes++;
        try {
            const remaining = Math.max(1, deadline - Date.now());
            const reply = await stream.readBytes(2, Math.min(300, remaining));
            if (reply[0] === STK_INSYNC) candidates++;
            console.log(`[webflash][trace] sync reply #${writes} at T+${Date.now() - t0}ms${rPlus(clock)}: 0x${reply[0].toString(16)} 0x${reply[1].toString(16)}`);
            if (reply[0] === STK_INSYNC && reply[1] === STK_OK) {
                console.log(`[webflash][trace] sync CONFIRMED after ${writes} request(s)${rPlus(clock)}`);
                return { ok: true, candidates, writes, openFailed: false, deviceLost: false };
            }
            console.warn('[webflash] sync reply did not match INSYNC/OK; retrying.');
        } catch (err: any) {
            if (isDeviceLostError(err)) {
                console.warn(`[webflash][trace] device lost while awaiting sync reply: ${err?.message || err}`);
                return { ok: false, candidates, writes, openFailed: false, deviceLost: true };
            }
        }
        // Heartbeat every ~500ms so a silent hunt is distinguishable from a
        // stuck loop: shows elapsed, writes sent, bytes heard.
        if (Date.now() - lastProgress >= 500) {
            lastProgress = Date.now();
            console.log(`[webflash][trace] sync hunting... T+${lastProgress - t0}ms writes=${writes} candidates=${candidates} bytesReceived=${stream.bytesReceived} buffered=${stream.bufferedLength}`);
        }
        await sleep(30);
        // Throttled-timer tripwire: one loop iteration should take ~40-50ms.
        // A background tab stretches it to ~1000ms, which cannot catch the 1s
        // bootloader window — say so once instead of failing silently.
        if (!throttleWarned && Date.now() - iterStart > 300) {
            throttleWarned = true;
            console.warn(`[webflash][trace] loop iteration took ${Date.now() - iterStart}ms (timers throttled?)`);
            onLog?.('⚠ Browser timers slowed (background tab?) — keep this tab focused during upload.');
        }
    }
    const total = Date.now() - t0;
    const sample = stream.peekBytes(16);
    const hex = sample.length ? Array.from(sample).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ') : '(buffer empty)';
    console.warn(`[webflash][trace] sync hunt END at T+${total}ms${rPlus(clock)}: writes=${writes} candidates=${candidates} bytesReceived=${stream.bytesReceived} leftover=[${hex}]`);
    onLog?.(`No sync here (${writes} pings, ${candidates} response(s), ${stream.bytesReceived} bytes heard).`);
    return { ok: false, candidates, writes, openFailed: false, deviceLost: false };
}

/**
 * Classic Arduino CLI reset: open at 1200 baud and close again. The DTR drop
 * on close triggers the auto-reset circuit on bridges that ignore signal
 * changes while the port is open at higher baud rates.
 */
async function classicReset(port: SerialPort, onLog?: (message: string) => void): Promise<boolean> {
    const t0 = Date.now();
    try {
        await port.open({ baudRate: 1200 });
        console.log(`[webflash][trace] classicReset: open@1200 OK in ${Date.now() - t0}ms`);
        await sleep(200);
        const dtr = await setDtr(port, false);
        console.log(`[webflash][trace] classicReset: setDtr(false)=${dtr} at T+${Date.now() - t0}ms`);
        await port.close();
        const total = Date.now() - t0;
        console.log(`[webflash][trace] classicReset: closed after ${total}ms`);
        await sleep(300);
        return true;
    } catch (err: any) {
        // Port unavailable or already in use — the open-port pulse is primary.
        console.warn(`[webflash][trace] classicReset FAILED after ${Date.now() - t0}ms: ${err?.name || 'Error'}: ${err?.message || err}`);
        onLog?.(`Classic reset skipped (port busy): ${err?.message || err}`);
        return false;
    }
}

/** Thrown when the chip signature deterministically mismatches — retries cannot fix this. */
class ChipMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ChipMismatchError';
    }
}

/**
 * Configure the target, enter programming mode, and verify its signature.
 * Older STK500-compatible bootloaders require the SET_DEVICE setup packets
 * before they accept any command other than GET_SYNC. Throws
 * ChipMismatchError for a wrong chip (do not retry) or a generic Error for
 * transient framing/timeout failures (safe to retry with a fresh reset —
 * the ~1s bootloader window may have expired mid-command, or the sync
 * detector may have false-triggered on sketch output containing 0x14).
 */
async function initializeAndVerifySignature(stream: SerialStream, profile: AvrBoardProfile, options: AvrFlashOptions, clock?: PassClock): Promise<void> {
    // The attached FTDI bootloader consistently acknowledges GET_SYNC but
    // ignores both READ_SIGN and ENTER_PROGMODE sent directly after it. That
    // is the behaviour of legacy STK500v1 variants that wait for the standard
    // target-description packets first. Optiboot accepts these packets as
    // harmless no-ops, so sending the full sequence covers both families.
    // Flush only, no settle sleep: every millisecond counts against the short
    // bootloader window.
    await sleep(10);
    stream.flushInput();
    const tryCmd = async (bytes: Uint8Array, respLen: number, timeout: number, label: string): Promise<Uint8Array> => {
        try {
            return await stream.stkCommand(bytes, respLen, timeout, clock, label);
        } catch (err: any) {
            // One immediate retry: transient framing (a late sync echo landing
            // mid-command) is common on FTDI + Windows and costs nothing when
            // the bootloader is genuinely alive.
            console.warn(`[webflash][trace] ${label} failed once, immediate retry${rPlus(clock)}: ${err?.message || err}`);
            return await stream.stkCommand(bytes, respLen, timeout, clock, `${label}#2`);
        }
    };
    const deviceParameters = new Uint8Array([
        // ATmega328(P) device descriptor, matching avrdude's STK500v1 setup.
        0x86, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x03, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    try {
        await tryCmd(new Uint8Array([STK_SET_DEVICE, ...deviceParameters, CRC_EOP]), 0, 400, 'SET_DEVICE');
        await tryCmd(new Uint8Array([STK_SET_DEVICE_EXT, 0x05, 0x04, 0xd7, 0xc2, 0x00, CRC_EOP]), 0, 400, 'SET_DEVICE_EXT');
        await tryCmd(new Uint8Array([STK_ENTER_PROGMODE, CRC_EOP]), 0, 400, 'ENTER_PROGMODE');
    } catch (err: any) {
        throw new Error(`Bootloader setup was not acknowledged (${err?.message || err}). The bootloader window may have expired — retrying with a fresh reset.`);
    }
    let signature: Uint8Array;
    try {
        signature = await tryCmd(new Uint8Array([STK_READ_SIGN, CRC_EOP]), 3, 500, 'READ_SIGN');
    } catch (err: any) {
        throw new Error(`No signature reply from the bootloader (${err?.message || err}). The bootloader window may have expired — retrying with a fresh reset.`);
    }
    const actual = Array.from(signature).join('.');
    if (!isSignatureAccepted(signature, profile)) {
        const allAccepted = [profile.signature, ...(profile.alternateSignatures ?? [])].map(s => s.join('.')).join(' or ');
        throw new ChipMismatchError(`Chip mismatch: expected signature ${allAccepted} but the board reports ${actual}. Check that the correct board is selected.`);
    }
    options.onLog?.(`Chip verified: signature ${actual} (${profile.fqbn}).`);
}

/**
 * Try to sync with the bootloader at the given baud. Never throws on open
 * failure — returns ok:false so the retry loop can try the next baud.
 * With skipOpen the already-open port is reused (fresh pulse, fresh window,
 * zero reopen cost) — the instant-retry path that avoids wedging the driver.
 */
async function syncAtBaud(stream: SerialStream, baudRate: number, reset = true, onLog?: (message: string) => void, skipOpen = false, driveRts = true, clock?: PassClock): Promise<SyncResult> {
    const t0 = Date.now();
    console.log(`[webflash][trace] ── syncAtBaud@${baudRate} reset=${reset} start${skipOpen ? ' (reusing open port)' : ''}`);
    if (!skipOpen) {
        try {
            await stream.open(baudRate);
        } catch (err: any) {
            // Rapid open/close cycling can wedge the USB driver briefly ("Failed
            // to open serial port") — one delayed retry before giving up the pass.
            console.warn(`[webflash] could not open port at ${baudRate} baud, retrying once: ${err?.message || err}`);
            await sleep(500);
            try {
                await stream.open(baudRate);
            } catch (err2: any) {
                console.warn(`[webflash] could not open port at ${baudRate} baud: ${err2?.message || err2}`);
                onLog?.(`Could not open port at ${baudRate} baud (${err2?.message || err2}).`);
                return { ok: false, candidates: 0, writes: 0, openFailed: true, deviceLost: false };
            }
        }
        // Windows + FTDI bridges need a tick after open() before setSignals takes
        // effect — pulsing DTR immediately after open is silently swallowed and the
        // board never resets (works in Arduino IDE because native serial drives DTR
        // reliably). 120ms is inside the ~1s optiboot window budget.
        await sleep(120);
    }
    // Reset into the bootloader NOW, with the port open, and sync IMMEDIATELY:
    // the ~1s optiboot window starts at the pulse's falling edge, so every
    // 100ms of sleep here burns 10% of the window (avrdude sends its first
    // sync within ~50ms of the reset for exactly this reason).
    if (reset) {
        await pulseDtr(stream.port, onLog, driveRts, clock);
    } else {
        console.log(`[webflash][trace] syncAtBaud@${baudRate}: skipping DTR pulse (post-classic-reset window)`);
    }
    const res = await waitForBootloaderSync(stream, 1500, onLog, clock);
    console.log(`[webflash][trace] ── syncAtBaud@${baudRate} reset=${reset} ${res.ok ? 'SYNCED' : 'no-sync'} in ${Date.now() - t0}ms (bytesReceived=${stream.bytesReceived})`);
    return { ...res, openFailed: false };
}

// ── STK500v2 (Mega2560 "wiring" bootloader) ─────────────────────────────────

interface Stk500v2Session {
    stream: SerialStream;
    seqNum: number;
}

/**
 * Build an STK500v2 message frame:
 * [0x1B, seq, len_hi, len_lo, 0x0E, body..., checksum] where checksum is the
 * XOR of every byte from 0x1B through the last body byte (AVR068 framing).
 */
export function buildV2Message(seqNum: number, body: Uint8Array): Uint8Array {
    const msg = new Uint8Array(5 + body.length + 1);
    msg[0] = V2_MESSAGE_START;
    msg[1] = seqNum & 0xff;
    msg[2] = (body.length >> 8) & 0xff;
    msg[3] = body.length & 0xff;
    msg[4] = V2_TOKEN;
    msg.set(body, 5);
    let checksum = 0;
    for (let i = 0; i < 5 + body.length; i++) checksum ^= msg[i];
    msg[msg.length - 1] = checksum;
    return msg;
}

/**
 * Send a v2 command and return the response body (command echo and status
 * byte stripped). The bootloader replies `[cmd, STATUS_OK, data...]` inside a
 * framed message; on any framing/status error an Error is thrown.
 */
async function v2Command(session: Stk500v2Session, command: number, body: Uint8Array, timeoutMs = 3000): Promise<Uint8Array> {
    const { stream } = session;
    const payload = new Uint8Array(1 + body.length);
    payload[0] = command;
    payload.set(body, 1);
    stream.flushInput();

    await stream.write(buildV2Message(session.seqNum++, payload));

    // Response starts with 0x1B; skip any strays (echoed bytes etc.).
    let header: Uint8Array;
    for (let tries = 0; ; tries++) {
        header = await stream.readBytes(1, timeoutMs);
        if (header[0] === V2_MESSAGE_START) break;
        if (tries > 32) throw new Error('STK500v2: no valid message start.');
    }
    const rest = await stream.readBytes(4, timeoutMs); // seq, len_hi, len_lo, token
    const length = (rest[1] << 8) | rest[2];
    if (rest[3] !== V2_TOKEN) throw new Error('STK500v2: bad token in response.');
    const data = await stream.readBytes(length + 1, timeoutMs); // body + trailing checksum
    const response = new Uint8Array([...header, ...rest, ...data]);

    let checksum = 0;
    for (let i = 0; i < response.length; i++) checksum ^= response[i];
    if (checksum !== 0) throw new Error('STK500v2: response checksum mismatch.');

    const responseBody = data.slice(0, length);
    if (responseBody[0] !== command) {
        throw new Error(`STK500v2: unexpected command echo 0x${responseBody[0].toString(16)}.`);
    }
    if (responseBody[1] !== V2_STATUS_OK) {
        throw new Error(`STK500v2: bootloader rejected the command (status 0x${responseBody[1].toString(16)}).`);
    }
    return responseBody.slice(2);
}

async function writeFlashV2(session: Stk500v2Session, data: Uint8Array, profile: AvrBoardProfile, options: AvrFlashOptions): Promise<void> {
    const pageSize = profile.pageSize;
    const pageCount = Math.ceil(data.length / pageSize);
    for (let page = 0; page < pageCount; page++) {
        const offset = page * pageSize;
        const pageBytes = data.slice(offset, Math.min(offset + pageSize, data.length));
        const padded = new Uint8Array(pageSize);
        padded.set(pageBytes);

        // LOAD_ADDRESS: 4-byte big-endian word address (stk500boot.c: b1<<24|b2<<16|b3<<8|b4 <<1).
        const wordAddress = Math.floor(offset / 2);
        await v2Command(
            session,
            V2_CMD_LOAD_ADDRESS,
            new Uint8Array([(wordAddress >>> 24) & 0xff, (wordAddress >>> 16) & 0xff, (wordAddress >>> 8) & 0xff, wordAddress & 0xff]),
            3000,
        );

        // PROGRAM_FLASH: [size_hi, size_lo, mode, delay_hi, delay_lo, 4× SPI cmd (ignored), data…].
        // The bootloader erases one page per write command, so chunks must be page-sized.
        const body = new Uint8Array(9 + padded.length);
        body[0] = (padded.length >> 8) & 0xff;
        body[1] = padded.length & 0xff;
        body[2] = 0x29; // mode: program flash
        body[3] = 0x00; // delay
        body[4] = 0x00;
        body[5] = 0x4c; // SPI: write page
        body[6] = 0x00;
        body[7] = 0x00;
        body[8] = 0x00;
        body.set(padded, 9);
        await v2Command(session, V2_CMD_PROGRAM_FLASH, body, 10000);

        if (page % 16 === 0 || page === pageCount - 1) {
            const percent = Math.round(((page + 1) / pageCount) * 100);
            options.onProgress?.(percent, `Writing flash ${page + 1}/${pageCount} pages...`);
        }
    }

    await v2Command(session, V2_CMD_LEAVE_PROGMODE, new Uint8Array(0), 3000);
    options.onProgress?.(100, 'Upload complete!');
    options.onLog?.(`✓ Firmware flashed (${data.length} bytes, ${pageCount} pages).`);
}

/** Sign on, verify the chip signature and enter programming mode (v2 sync). */
async function syncV2AtBaud(stream: SerialStream, profile: AvrBoardProfile, options: AvrFlashOptions): Promise<Stk500v2Session> {
    // Reset into the bootloader NOW, with the port open, so the sign-on below
    // lands within the ~1s bootloader watchdog window (no sleep after — the
    // window starts at the pulse's falling edge).
    await pulseDtr(stream.port, options.onLog);
    const session: Stk500v2Session = { stream, seqNum: 0 };

    // Sign-on doubles as the sync: the v2 bootloader replies framed [0x01, OK, 8, "AVRISP_2"].
    const signOn = await v2Command(session, V2_CMD_SIGN_ON, new Uint8Array(0), 3000);
    options.onLog?.(`Bootloader found (v2 sign-on: ${Array.from(signOn).map(b => String.fromCharCode(b)).join('')}).`);

    // Signature: one call per byte; stk500boot.c reads the index from the 5th
    // message byte (msgBuffer[4]), i.e. body position 3. Response: [OK, sig, OK].
    const signature = new Uint8Array(3);
    for (let i = 0; i < 3; i++) {
        const resp = await v2Command(session, V2_CMD_READ_SIGNATURE, new Uint8Array([0x30, 0x00, 0x00, i]), 3000);
        signature[i] = resp[0];
    }
    const actual = Array.from(signature).join('.');
    if (!isSignatureAccepted(signature, profile)) {
        const allAccepted = [profile.signature, ...(profile.alternateSignatures ?? [])].map(s => s.join('.')).join(' or ');
        throw new Error(`Chip mismatch: expected signature ${allAccepted} but the board reports ${actual}. Check that the correct board is selected.`);
    }
    options.onLog?.(`Chip verified: signature ${actual} (${profile.fqbn}).`);

    await v2Command(session, V2_CMD_ENTER_PROGMODE, new Uint8Array(0), 3000);
    return session;
}

export async function flashAvr(port: SerialPort, options: AvrFlashOptions): Promise<void> {
    const profile = getAvrBoardProfile(options.fqbn);
    if (!profile) {
        throw new Error(`Unsupported AVR board: ${options.fqbn}. Web upload supports Uno, Nano and Mega.`);
    }

    const { data } = parseIntelHex(options.hex);
    if (!data.length) throw new Error('Firmware hex file is empty or invalid.');
    if (data.length > profile.flashSize) {
        throw new Error(`Firmware is ${data.length} bytes but the ${profile.fqbn} flash is only ${profile.flashSize} bytes.`);
    }

    options.onLog?.(`Resetting ${options.fqbn} into bootloader...`);
    try {
        const info = (port as any)?.getInfo?.() as { usbVendorId?: number; usbProductId?: number } | undefined;
        const vidpid = info?.usbVendorId !== undefined
            ? `${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`
            : 'unknown';
        console.log(`[webflash][trace] flash start: fqbn=${options.fqbn} fw=${data.length}B profile=[${profile.bauds.join(',')}] proto=${profile.protocol} port=${vidpid} ua=${navigator.userAgent}`);
    } catch { /* getInfo optional */ }
    // Timer calibration: a background tab stretches setTimeout ~20x, which
    // silently destroys both the reset pulse and the sync cadence. Detect it
    // up front so the failure mode is a clear warning, not a mystery.
    {
        const cal0 = Date.now();
        await sleep(100);
        const calElapsed = Date.now() - cal0;
        console.log(`[webflash][trace] timer calibration: sleep(100) took ${calElapsed}ms`);
        if (calElapsed > 300) {
            options.onLog?.('⚠ Browser timers are slowed (background tab?) — keep this tab focused during upload or sync will fail.');
        }
    }

    let stream: SerialStream | null = null;
    try {
        if (profile.protocol === 'stk500v2') {
            let session: Stk500v2Session | null = null;
            // Retry the whole reset+sync cycle: the first attempt often loses
            // the ~1s bootloader window (slow port reopen, missed DTR pulse).
            for (let attempt = 1; attempt <= 3 && !session; attempt++) {
                if (attempt > 1) options.onLog?.(`Bootloader entry retry ${attempt}/3...`);
                for (const baud of profile.bauds) {
                    options.onLog?.(`Syncing with bootloader at ${baud} baud...`);
                    stream = new SerialStream(port);
                    try {
                        await stream.open(baud);
                        session = await syncV2AtBaud(stream, profile, options);
                        break;
                    } catch {
                        await stream.close();
                        stream = null;
                    }
                }
            }
            if (!session || !stream) {
                throw new Error('Could not sync with the bootloader. Check the USB cable and that the board has an Arduino bootloader.');
            }
            try {
                await writeFlashV2(session, data, profile, options);
            } finally {
                await stream.close();
            }
            return;
        }

        // The whole sync → signature → progmode sequence is retried: a sync
        // that lands at the tail of the ~1s bootloader window (or a 0x14 byte
        // from running sketch output false-triggering the sync detector)
        // fails at the signature step, and only a fresh reset opens a new
        // window. DTR-pulse reset only: the 1200-baud open/close trick is for
        // native-USB boards (Leonardo) — on FTDI/16U2 Uno clones it just burns
        // the watchdog window and wedges the driver with extra open/close
        // cycles. Bauds are adaptively reordered so a baud that showed life
        // (candidates/bytes) is retried first instead of round-robin.
        let synced = false;
        let lastSyncError: unknown = null;
        let heardBytes = 0;
        let openFails = 0;
        let totalSyncs = 0;
        let provenBaud: number | null = null;
        let firstSampleHex = '';
        const baudScore = new Map<number, number>(profile.bauds.map(b => [b, 0]));
        const orderedBauds = () => [...profile.bauds].sort((a, b) => (baudScore.get(b) ?? 0) - (baudScore.get(a) ?? 0));
        const noteHeard = (s: SerialStream) => {
            heardBytes += s.bytesReceived;
            if (!firstSampleHex && s.bytesReceived > 0) {
                try {
                    const sample = s.peekBytes(16);
                    if (sample.length) {
                        firstSampleHex = Array.from(sample).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                    }
                } catch { /* diagnostics only */ }
            }
        };
        // One full pass at a baud: a single open, then up to 3 pulse cycles on
        // the SAME open stream (fresh pulse = fresh ~1s window, zero reopen
        // cost, zero extra driver stress):
        //   1. fresh open + DTR-only pulse (RTS untouched — some FTDI boards
        //      misbehave with RTS held low),
        //   2. re-pulse DTR-only on the open port (only if cycle 1 showed life
        //      or synced-then-dropped),
        //   3. re-pulse DTR+RTS on the open port (only after a confirmed sync
        //      whose signature dropped — almost certainly the right baud).
        // Dead bauds cost exactly one open + one hunt.
        const runPass = async (baud: number): Promise<{ outcome: 'synced' | 'no-sync' | 'sig-fail'; live: SerialStream | null }> => {
            const s = new SerialStream(port);
            const syncsBefore = totalSyncs;
            // Reset-anchored timeline for this pass: stamped at each falling
            // edge, so every RX byte and command logs its offset into the ~1s
            // bootloader window.
            const clock: PassClock = { t0: 0 };
            s.onRx = (len, total) => {
                console.log(`[webflash][trace] RX ${len}B (total ${total})${rPlus(clock)}`);
            };
            const cycle = async (skipOpen: boolean, driveRts: boolean): Promise<boolean> => {
                console.log(`[webflash][trace] cycle start@${baud} (skipOpen=${skipOpen} rts=${driveRts})${rPlus(clock)}`);
                const res = await syncAtBaud(s, baud, true, options.onLog, skipOpen, driveRts, clock);
                // Score the baud for adaptive retry: any sign of life
                // (candidates or bytes) floats it to the front.
                baudScore.set(baud, (baudScore.get(baud) ?? 0) + res.candidates * 10 + Math.min(s.bytesReceived, 10));
                if (res.deviceLost) {
                    noteHeard(s);
                    await s.close();
                    throw new DeviceLostError();
                }
                if (!res.ok) {
                    if (res.openFailed) openFails++;
                    noteHeard(s);
                    return false;
                }
                totalSyncs++;
                if (provenBaud === null) {
                    provenBaud = baud;
                    console.log(`[webflash][trace] baud ${baud} proven by sync — dead bauds will be skipped on later attempts`);
                }
                try {
                    await initializeAndVerifySignature(s, profile, options, clock);
                    options.onLog?.(`Bootloader found at ${baud} baud.`);
                    return true;
                } catch (err) {
                    noteHeard(s);
                    if (err instanceof ChipMismatchError) {
                        await s.close();
                        throw err;
                    }
                    lastSyncError = err;
                    options.onLog?.(`Sync verify failed (${err instanceof Error ? err.message : String(err)})`);
                    return false;
                }
            };
            try {
                if (await cycle(false, false)) return { outcome: 'synced', live: s };
                const life = s.bytesReceived > 0;
                const sigDropped = totalSyncs > syncsBefore;
                if (sigDropped) {
                    options.onLog?.(`Retrying ${baud} baud immediately (fresh reset)...`);
                }
                if ((life || sigDropped) && await cycle(true, false)) return { outcome: 'synced', live: s };
                if (sigDropped) {
                    options.onLog?.(`Retrying ${baud} baud with full reset lines...`);
                    if (await cycle(true, true)) return { outcome: 'synced', live: s };
                }
                const outcome = sigDropped ? 'sig-fail' : 'no-sync';
                if (!sigDropped) {
                    options.onLog?.(`No sync at ${baud} — heard ${s.bytesReceived} bytes this pass, ${heardBytes} total.`);
                }
                await s.close();
                // Settle gap: back-to-back reopen wedges FTDI drivers
                // ("Failed to open serial port" tail failures).
                await sleep(150);
                return { outcome, live: null };
            } catch (err) {
                // Unexpected mid-pass failure (device lost, chip mismatch):
                // never leak the open stream (a leaked lock reads as
                // "already open" forever after).
                await s.close();
                throw err;
            }
        };
        for (let attempt = 1; attempt <= 3 && !synced; attempt++) {
            if (attempt > 1) options.onLog?.(`Bootloader entry retry ${attempt}/3...`);
            for (const baud of orderedBauds()) {
                // Once a baud has confirmed sync, dead bauds are skipped on
                // later attempts: every window spent at 57600/19200 is a
                // window stolen from the proven baud.
                if (attempt > 1 && provenBaud !== null && baud !== provenBaud && (baudScore.get(baud) ?? 0) <= 0) {
                    console.log(`[webflash][trace] skipping dead baud ${baud} (proven: ${provenBaud})`);
                    continue;
                }
                options.onLog?.(`Syncing with bootloader at ${baud} baud...`);
                const r = await runPass(baud);
                if (r.outcome === 'synced') {
                    stream = r.live;
                    synced = true;
                    break;
                }
            }
        }
        if (!synced || !stream) {
            const detail = lastSyncError instanceof Error ? ` Last error: ${lastSyncError.message}` : '';
            // The decisive diagnostic: zero bytes across all attempts means the
            // board never answered anything — the reset pulse isn't reaching it
            // (DTR refused/blocked) — versus bytes-but-no-sync (wrong baud or
            // non-optiboot bootloader). Arduino IDE working + zero bytes here
            // pins it on browser serial control lines, not the board/cable.
            let portHint = '';
            try {
                const info = (port as any)?.getInfo?.() as { usbVendorId?: number; usbProductId?: number } | undefined;
                if (info?.usbVendorId !== undefined) {
                    portHint = ` (port USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')})`;
                }
            } catch { /* getInfo optional */ }
            const totalPasses = 3 * profile.bauds.length;
            // Port-busy is its own failure mode: every open refused means an
            // exclusive lock is held elsewhere (Arduino IDE / Serial Monitor,
            // another tab, or a wedged driver) — sync was never attempted.
            if (openFails >= totalPasses) {
                throw new Error(
                    `Could not open the serial port${portHint} — every attempt (${openFails}/${totalPasses}) was refused. Something else holds it: ` +
                    `1) close Arduino IDE completely (app + Serial Monitor), 2) keep only this browser tab, 3) unplug USB, wait 5s, replug, ` +
                    `4) click DISCONNECT then CONNECT to reselect the port (or revoke it at chrome://settings/content/serialPorts), 5) retry. ` +
                    `Driver events: chrome://device-log.`,
                );
            }
            if (totalSyncs > 0) {
                throw new Error(
                    `Bootloader answered sync${portHint} (${totalSyncs}×) but stayed silent on the following command — ` +
                    `the reply window is collapsing early (marginal USB power/cable or driver latency). ` +
                    `Try another USB port/cable (direct, no hub), keep only this tab, and retry.${detail}`,
                );
            }
            const heard = heardBytes === 0
                ? ` The board did not send a single byte during any attempt${openFails > 0 ? ` (${openFails} pass(es) could not open the port at all — see above)` : ''}, so it likely never reset into its bootloader (the browser DTR pulse had no effect). Close the Arduino IDE serial monitor (only one app can hold the port), then retry — or press RESET manually just as syncing starts.`
                : ` The board sent ${heardBytes} bytes but never completed a sync${firstSampleHex ? ` (first bytes: ${firstSampleHex})` : ''}${portHint} — the auto-reset pulse likely is not reaching it in this browser. Hold RESET, click Upload, and release RESET the moment syncing starts.`;
            throw new Error(`Could not sync with the bootloader after 3 attempts.${heard}${detail}`);
        }

        // Program flash page by page (flash base address is always 0).
        const pageSize = profile.pageSize;
        const pageCount = Math.ceil(data.length / pageSize);
        for (let page = 0; page < pageCount; page++) {
            const offset = page * pageSize;
            const pageBytes = data.slice(offset, Math.min(offset + pageSize, data.length));
            const padded = new Uint8Array(pageSize);
            padded.set(pageBytes);

            // STK500v1 addresses flash in 16-bit words.
            const wordAddress = Math.floor(offset / 2);
            await stream.stkCommand(
                new Uint8Array([STK_LOAD_ADDRESS, wordAddress & 0xff, (wordAddress >> 8) & 0xff, CRC_EOP]),
                0,
                2000,
            );

            const cmd = new Uint8Array(5 + padded.length);
            cmd[0] = STK_PROG_PAGE;
            cmd[1] = (pageSize >> 8) & 0xff;
            cmd[2] = pageSize & 0xff;
            cmd[3] = 0x46; // 'F' → flash memory
            cmd.set(padded, 4);
            cmd[cmd.length - 1] = CRC_EOP;
            await stream.stkCommand(cmd, 0, 10000);

            if (page % 16 === 0 || page === pageCount - 1) {
                const percent = Math.round(((page + 1) / pageCount) * 100);
                options.onProgress?.(percent, `Writing flash ${page + 1}/${pageCount} pages...`);
            }
        }

        await stream.stkCommand(new Uint8Array([STK_LEAVE_PROGMODE, CRC_EOP]));
        options.onProgress?.(100, 'Upload complete!');
        options.onLog?.(`✓ Firmware flashed (${data.length} bytes, ${pageCount} pages).`);
    } finally {
        if (stream) await stream.close();
    }
}
