/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { transpileArduinoToJS } from './transpiler.js';
import {
  runPio,
  resolvePioBinary,
  platformEnsure,
  pkgInstallLibrary,
  pkgUninstallLibrary,
} from '../../drivers/platformio/pio.js';
import { fqbnToPioTarget, isEsp32Fqbn } from '../../drivers/platformio/boardMap.js';
import { createPioProject, getPioBuildDir, listPioBuildFiles, parseMissingHeaderFromError, HEADER_TO_LIBRARY, isBuiltinHeader } from '../../drivers/platformio/project.js';
import { searchRegistry } from '../../drivers/platformio/registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// GET /health — used by the frontend to detect whether the local compiler
// server is up (local-first compile routing: try localhost, fall back to cloud).
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', isInitialized });
});

/**
 * PlatformIO binary (Apache-2.0 — replaces the GPL-3.0 arduino-cli).
 * Electron passes the bundled pio.exe via PIO_CLI_PATH; Docker installs
 * `platformio` via pip. NEVER uses a system Arduino install.
 */
const PIO_BIN = resolvePioBinary();

/**
 * forge-lib library cache (shared with the desktop app + cloud server).
 * Candidates in priority order; pio installs libraries here via
 * `pio pkg install --library <name> --storage-dir <dir>`.
 */
const FORGE_LIB_LIBRARIES = (() => {
  const local = path.resolve(__dirname, '..', 'forge-lib', 'libraries');
  if (fs.existsSync(local)) return local;
  const dockerLibs = '/app/forge-lib/libraries';
  if (fs.existsSync(dockerLibs)) return dockerLibs;
  if (process.env.PIO_LIB_DIRS && fs.existsSync(process.env.PIO_LIB_DIRS)) return process.env.PIO_LIB_DIRS;
  return null;
})();

let isInitialized = false;

const runCLI = (args: string[], timeoutMs = 120_000) => runPio(args, { timeoutMs });

/**
 * Detect infrastructure failures that should NOT block transpilation.
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

/**
 * Ensure necessary platforms are installed. `pio platform install` is
 * idempotent; `pio run` also auto-installs platforms from platformio.ini.
 */
const initCores = async () => {
  try {
    console.log(`[SERVER] Using pio: ${PIO_BIN}`);
    console.log('[SERVER] Ensuring atmelavr platform...');
    await platformEnsure('atmelavr');
    console.log('[SERVER] Ensuring espressif32 platform...');
    await platformEnsure('espressif32');
    isInitialized = true;
  } catch (err: any) {
    console.warn('[SERVER WARNING] Platform init skip/fail:', err.message);
    isInitialized = true; // Proceed anyway
  }
};

// POST /compile
app.post('/compile', async (req, res) => {
  if (!isInitialized) {
    return res.status(503).json({ success: false, errors: ['Server is still initializing. Please wait.'] });
  }

  const { code, board = 'arduino:avr:uno', libraries = [] } = req.body;

  if (!code) {
    return res.status(400).json({ success: false, errors: ['No code provided'] });
  }

  let target: { board: string; platform: string };
  try {
    target = fqbnToPioTarget(board);
  } catch (e: any) {
    return res.status(400).json({ success: false, errors: [e.message] });
  }

  const sketchId = `sketch_${Date.now()}`;
  const projectDir = path.join(os.tmpdir(), 'electra', sketchId);

  try {
    for (const lib of libraries) {
      try {
        await pkgInstallLibrary(lib, FORGE_LIB_LIBRARIES ?? undefined);
      } catch (e) { }
    }

    createPioProject(projectDir, code, {
      board: target.board,
      platform: target.platform,
      libDirs: FORGE_LIB_LIBRARIES ? [FORGE_LIB_LIBRARIES] : [],
      libDeps: !isEsp32Fqbn(board) ? ['SoftwareSerial', 'Servo'] : [],
    });

    let result = await runCLI(['run', '-d', projectDir]);
    if (result.code !== 0) {
      const combined = (result.stderr || '') + '\n' + (result.stdout || '');
      const missing = parseMissingHeaderFromError(combined);
      if (missing && isBuiltinHeader(missing)) {
        console.error(`[SERVER] Missing core header ${missing} — not installing a registry lib`);
      } else if (missing) {
        const libName = HEADER_TO_LIBRARY[missing];
        if (libName) {
        console.warn(`[SERVER] Missing header ${missing} → trying library "${libName}"`);
        try {
          await pkgInstallLibrary(libName, FORGE_LIB_LIBRARIES ?? undefined);
        } catch (e) { console.warn(`[SERVER] auto-install "${libName}" failed (will retry via lib_deps anyway)`); }
        const baseDeps: string[] = !isEsp32Fqbn(board) ? ['SoftwareSerial', 'Servo'] : [];
        const retryDeps = [...new Set([...baseDeps, libName])];
        createPioProject(projectDir, code, {
          board: target.board,
          platform: target.platform,
          libDirs: FORGE_LIB_LIBRARIES ? [FORGE_LIB_LIBRARIES] : [],
          libDeps: retryDeps,
        });
        result = await runCLI(['run', '-d', projectDir]);
        }
      }
      if (result.code !== 0) {
        const message = (result.stderr || result.stdout || `Exit code ${result.code}`).slice(-4000);
        return res.json({ success: false, errors: [message] });
      }
    }

    // Look for any .hex file in the build dir (names vary by platform)
    const files = listPioBuildFiles(projectDir, target.board);
    const hexFile = files.find(f => f.endsWith('.hex'));

    if (!hexFile) {
      console.error(`[BUILD ERROR] No HEX file found in ${projectDir}. Directory contents:`, files);
      return res.json({ success: false, errors: ['HEX file not generated. Check your code syntax.'] });
    }

    const hex = fs.readFileSync(path.join(getPioBuildDir(projectDir, target.board), hexFile), 'utf8');
    return res.json({ success: true, hex });

  } catch (err: any) {
    return res.json({ success: false, errors: [err.message] });
  } finally {
    try {
      if (fs.existsSync(projectDir)) fs.rmSync(projectDir, { recursive: true, force: true });
    } catch (e) { }
  }
});

// POST /transpile — Arduino C++ → JavaScript for browser-side simulation
app.post('/transpile', async (req, res) => {
  const { code, board = 'esp32:esp32:esp32c3' } = req.body;

  if (!code) {
    return res.status(400).json({ success: false, errors: ['No code provided'] });
  }

  // Step 1: Validate the sketch by compiling with pio (catches syntax errors)
  // If validation fails due to infra (package.json manifest etc), warn and proceed to transpile.
  if (isInitialized && process.env.VALIDATE_TRANSPILE !== 'false') {
    const sketchId = `transpile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const projectDir = path.join(os.tmpdir(), 'electra', sketchId);
    try {
      let target: { board: string; platform: string };
      try {
        target = fqbnToPioTarget(board);
      } catch (e: any) {
        return res.json({ success: false, errors: [e.message] });
      }
      createPioProject(projectDir, code, {
        board: target.board,
        platform: target.platform,
        libDirs: FORGE_LIB_LIBRARIES ? [FORGE_LIB_LIBRARIES] : [],
        libDeps: !isEsp32Fqbn(board) ? ['SoftwareSerial', 'Servo'] : [],
      });
      const result = await runCLI(['run', '-d', projectDir], 60_000);
      if (result.code !== 0) {
        const errMsg = (result.stderr || result.stdout || `Exit code ${result.code}`).slice(-4000);
        if (isInfraTranspileError(errMsg)) {
          console.warn(`[TRANSPILE] Validation infra error ignored, proceeding: ${errMsg.slice(-600)}`);
        } else {
          throw new Error(errMsg);
        }
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      if (isInfraTranspileError(msg)) {
        console.warn(`[TRANSPILE] Validation exception (infra) ignored: ${msg.slice(0, 600)}`);
      } else {
        try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (_) { }
        return res.json({ success: false, errors: [msg] });
      }
    } finally {
      try { if (fs.existsSync(projectDir)) fs.rmSync(projectDir, { recursive: true, force: true }); } catch (_) { }
    }
  }

  // Step 2: Transpile C++ → JavaScript
  try {
    const jsCode = transpileArduinoToJS(code);
    console.log(`[TRANSPILE] Transpiled ${code.length} bytes → ${jsCode.length} bytes JS (board=${board})`);
    return res.json({ success: true, jsCode });
  } catch (err: any) {
    console.error('[TRANSPILE] Error:', err.message);
    return res.json({ success: false, errors: [err.message] });
  }
});

// GET /libraries/search
app.get('/libraries/search', async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.json([]);
  try {
    const libs = (await searchRegistry(query, 20)).map(l => ({
      name: l.name,
      author: l.author === 'Unknown Author' ? '' : l.author,
      description: l.sentence === 'No description available.' ? '' : l.sentence,
      version: l.version === 'Unknown' ? '' : l.version,
    }));
    res.json(libs);
  } catch (err) {
    res.json([]);
  }
});

// POST /libraries/install  { name: string }
app.post('/libraries/install', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Library name required' });

  console.log(`[LIB] Installing: ${name}`);
  try {
    const ok = await pkgInstallLibrary(name, FORGE_LIB_LIBRARIES ?? undefined);
    if (!ok) {
      console.error(`[LIB] Install failed: ${name}`);
      return res.json({ success: false, error: 'Installation failed' });
    }
    console.log(`[LIB] Installed: ${name}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error(`[LIB] Install failed: ${err.message}`);
    res.json({ success: false, error: err.message });
  }
});

// GET /libraries/installed
app.get('/libraries/installed', (_req, res) => {
  const libsDir = FORGE_LIB_LIBRARIES ?? path.join('/app/forge-lib', 'libraries');
  if (!fs.existsSync(libsDir)) return res.json([]);

  try {
    const entries = fs.readdirSync(libsDir, { withFileTypes: true });
    const libs = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const propFile = path.join(libsDir, e.name, 'library.properties');
        const props: Record<string, string> = {};
        if (fs.existsSync(propFile)) {
          fs.readFileSync(propFile, 'utf8').split('\n').forEach(line => {
            const [k, ...v] = line.split('=');
            if (k && v.length) props[k.trim()] = v.join('=').trim();
          });
        }
        return {
          name: props.name || e.name,
          version: props.version || '?',
          author: props.author || '',
          description: props.sentence || '',
        };
      });
    res.json(libs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /libraries/remove  { name: string }
app.delete('/libraries/remove', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Library name required' });

  console.log(`[LIB] Removing: ${name}`);
  try {
    // pio pkg uninstall has no --library/--storage-dir flags — remove the
    // forge-lib folder manually (best effort) and try a global uninstall.
    let manualRemoved = false;
    const libsDir = FORGE_LIB_LIBRARIES ?? path.join('/app/forge-lib', 'libraries');
    if (fs.existsSync(libsDir)) {
      const entries = fs.readdirSync(libsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const libDir = path.join(libsDir, entry.name);
        let match = entry.name === name;
        if (!match) {
          const propFile = path.join(libDir, 'library.properties');
          if (fs.existsSync(propFile)) {
            const props: Record<string, string> = {};
            fs.readFileSync(propFile, 'utf8').split('\n').forEach(line => {
              const [k, ...v] = line.split('=');
              if (k && v.length) props[k.trim()] = v.join('=').trim();
            });
            if (props.name === name) match = true;
          }
        }
        if (match) {
          fs.rmSync(libDir, { recursive: true, force: true });
          manualRemoved = true;
        }
      }
    }
    await pkgUninstallLibrary(name);
    if (manualRemoved) {
      res.json({ success: true, manualRemoved });
    } else {
      res.json({ success: true });
    }
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Electra Compiler Server running on :${PORT}`);
  await initCores();
});