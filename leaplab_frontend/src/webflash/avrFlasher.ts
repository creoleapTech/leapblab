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
const STK_GET_SIGN_ON = 0x15;
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
        bauds: [115200, 57600],
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
        // The serial monitor may still hold the port open (or have just
        // released it while the OS still considers it busy). Close first so
        // port.open() below cannot throw InvalidStateError ("already open").
        if (this.port.readable || this.port.writable) {
            try { await this.port.close(); } catch { /* already closed — ignore */ }
            // Small settle delay: Windows needs a tick to release the COM port.
            await sleep(100);
        }
        try {
            await this.port.open({ baudRate });
        } catch (err: any) {
            throw new Error(
                `Could not open the serial port at ${baudRate} baud (${err?.name || 'Error'}: ${err?.message || err}). ` +
                `Close the Serial Monitor / Arduino IDE monitor and retry.`
            );
        }
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

    private append(chunk: Uint8Array) {
        const merged = new Uint8Array(this.buffer.length + chunk.length);
        merged.set(this.buffer, 0);
        merged.set(chunk, this.buffer.length);
        this.buffer = merged;
    }

    /** Clear any leftover bytes in the receive buffer. */
    flushInput() {
        this.buffer = new Uint8Array(0);
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
    async stkCommand(bytes: Uint8Array, responseLength = 0, timeoutMs = 5000): Promise<Uint8Array> {
        this.flushInput();
        await this.write(bytes);
        const insync = await this.readBytes(1, timeoutMs);
        if (insync[0] !== STK_INSYNC) {
            throw new Error('Board did not acknowledge the command (no sync). Is it in bootloader mode?');
        }
        const payload = responseLength > 0 ? await this.readBytes(responseLength, timeoutMs) : new Uint8Array(0);
        const status = await this.readBytes(1, timeoutMs);
        if (status[0] !== STK_OK) {
            throw new Error(`Board rejected the command (status 0x${status[0].toString(16)}).`);
        }
        return payload;
    }

    async close(): Promise<void> {
        this.closed = true;
        try {
            if (this.reader) {
                await this.reader.cancel();
                // cancel() does not release the stream lock — release it so the
                // port can be reopened on the next upload.
                try { this.reader.releaseLock(); } catch { /* already released */ }
                this.reader = null;
            }
            if (this.writer) {
                try { await this.writer.releaseLock(); } catch { /* ignore */ }
                this.writer = null;
            }
            if (this.port.readable) await this.port.close();
        } catch {
            // Already closed or port disappeared — fine.
        }
    }
}

/**
 * Set a serial control line. Modern Chrome (>= 133) uses dataTerminalReady /
 * requestToSend; older engines use the dtr / rts aliases and SILENTLY IGNORE
 * unknown dictionary members. Sending both names in one call lets every
 * generation apply whichever it understands without throwing.
 */
async function setSignal(port: SerialPort, modern: string, legacy: string, state: boolean): Promise<void> {
    try {
        await (port.setSignals as any)({ [modern]: state, [legacy]: state });
    } catch {
        try { await (port.setSignals as any)({ [modern]: state }); } catch { /* unsupported */ }
        try { await (port.setSignals as any)({ [legacy]: state }); } catch { /* unsupported */ }
    }
}

const setDtr = (port: SerialPort, state: boolean) => setSignal(port, 'dataTerminalReady', 'dtr', state);
const setRts = (port: SerialPort, state: boolean) => setSignal(port, 'requestToSend', 'rts', state);

/**
 * Pulse DTR and RTS with the port OPEN — the reset edges that drop the board
 * into its bootloader (avrdude "arduino" programmer behaviour). Both lines are
 * pulsed because clones (CH340 etc.) wire the auto-reset circuit through DTR,
 * RTS, or both; both edges are produced so boards that reset on either
 * polarity re-enter the bootloader. Must be followed by sync bytes within the
 * optiboot watchdog window.
 */
async function pulseDtr(port: SerialPort): Promise<void> {
    await setDtr(port, false);
    await setRts(port, false);
    await sleep(100);
    await setDtr(port, true);
    await setRts(port, true);
    await sleep(100);
    await setDtr(port, false);
    await setRts(port, false);
    await sleep(100);
}

/**
 * avrdude-style sync: keep sending the STK sync byte every ~40ms while
 * watching for the INSYNC (0x14) reply. This catches the bootloader wherever
 * it is inside its ~1s watchdog window — a single sync byte misses it.
 */
async function waitForBootloaderSync(stream: SerialStream, timeoutMs = 1500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (stream.consumeUntil(STK_INSYNC)) return true;
        await stream.write(new Uint8Array([STK_GET_SYNC, CRC_EOP]));
        await sleep(40);
    }
    return false;
}

/**
 * Classic Arduino CLI reset: open at 1200 baud and close again. The DTR drop
 * on close triggers the auto-reset circuit on bridges that ignore signal
 * changes while the port is open at higher baud rates.
 */
async function classicReset(port: SerialPort): Promise<void> {
    try {
        await port.open({ baudRate: 1200 });
        await sleep(200);
        await setDtr(port, false);
        await port.close();
        await sleep(300);
    } catch {
        // Port unavailable or already in use — the open-port pulse is primary.
    }
}

/** Try to sync with the bootloader at the given baud. Never throws on open failure — returns false so the retry loop can try the next baud. */
async function syncAtBaud(stream: SerialStream, baudRate: number, reset = true): Promise<boolean> {
    try {
        await stream.open(baudRate);
    } catch {
        return false;
    }
    await sleep(200);
    // Reset into the bootloader NOW, with the port open: the sync loop below
    // then catches the bootloader inside its ~1s watchdog window.
    if (reset) {
        try {
            await pulseDtr(stream.port);
            await sleep(120);
        } catch {
            // No signal control on this platform — the retry cycles still fire
            // the open/close edges between baud attempts.
        }
    }
    return waitForBootloaderSync(stream, 1500);
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
    // lands within the ~1s bootloader watchdog window.
    try {
        await pulseDtr(stream.port);
        await sleep(120);
    } catch {
        // No signal control on this platform — the retry cycles still fire
        // the open/close edges between baud attempts.
    }
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

        let synced = false;
        for (let attempt = 1; attempt <= 3 && !synced; attempt++) {
            if (attempt > 1) options.onLog?.(`Bootloader entry retry ${attempt}/3...`);
            for (const baud of profile.bauds) {
                options.onLog?.(`Syncing with bootloader at ${baud} baud...`);
                stream = new SerialStream(port);
                if (await syncAtBaud(stream, baud)) {
                    synced = true;
                    options.onLog?.(`Bootloader found at ${baud} baud.`);
                    break;
                }
                await stream.close();
                stream = null;

                // Fallback for bridges that ignore DTR while the port is open:
                // the classic 1200-baud open/close reset, then sync in the new
                // watchdog window without re-pulsing.
                options.onLog?.(`Trying classic 1200-baud reset at ${baud}...`);
                await classicReset(port);
                stream = new SerialStream(port);
                if (await syncAtBaud(stream, baud, /* reset */ false)) {
                    synced = true;
                    options.onLog?.(`Bootloader found at ${baud} baud (classic reset).`);
                    break;
                }
                await stream.close();
                stream = null;
            }
        }
        if (!synced || !stream) {
            throw new Error('Could not sync with the bootloader. Check the USB cable and that the board has an Arduino bootloader.');
        }

        // Verify the chip signature matches the selected board (ATmega328P = 30.149.15, ATmega328 = 30.149.20 both accepted).
        const signature = await stream.stkCommand(new Uint8Array([STK_READ_SIGN, CRC_EOP]), 3);
        const actual = Array.from(signature).join('.');
        if (!isSignatureAccepted(signature, profile)) {
            const allAccepted = [profile.signature, ...(profile.alternateSignatures ?? [])].map(s => s.join('.')).join(' or ');
            throw new Error(`Chip mismatch: expected signature ${allAccepted} but the board reports ${actual}. Check that the correct board is selected.`);
        }
        options.onLog?.(`Chip verified: signature ${actual} (${options.fqbn}).`);

        await stream.stkCommand(new Uint8Array([STK_ENTER_PROGMODE, CRC_EOP]));

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
