/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, fork } from 'child_process';
import * as url from 'url';
import { SerialManager } from './serial/SerialManager';
import { ArduinoUploader } from './drivers/platformio/ArduinoUploader';
import { PythonManager } from './pythonBackend/PythonManager';
import { join } from 'path';
import { getPioPathIfAvailable, getBundledPioEnv } from './drivers/platformio/ensurePlatformIO';
import { cleanupOldLogs } from './utils/fileLogger';
import { checkForUpdate, downloadUpdate, installUpdate } from './update/updateChecker';
import type { UpdateInfo, DownloadProgress } from './update/updateChecker';

// Suppress development security warnings in the console
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// Dev-only: bypass the Chromium HTTP disk cache entirely. In dev the cache can
// become corrupted when the process is hard-killed mid-write (Ctrl+C), after
// which every media/asset request fails with ERR_CACHE_READ_FAILURE or
// ERR_CACHE_OPERATION_NOT_SUPPORTED. The dev server is localhost, so caching
// buys nothing — disabling it removes the failure mode at the source. Must run
// before app 'ready'.
if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-http-cache');
}

// Only one LeapBlocks instance may run at a time. Without this, multiple
// instances (e.g. a leftover `npm run dev` window) fight over the same COM
// port and the loser fails to connect with "Access denied".
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL STATE & SERVICES
// ═══════════════════════════════════════════════════════════════════════════
let mainWindow: BrowserWindow | null = null;
let serialManager: SerialManager;
let arduinoUploader: ArduinoUploader;
let pythonManager: PythonManager;

// ESP32-C3 related globals
let lastESP32BinTempDir: string | null = null;
let compileServerProcess: any = null;

function getCleanupESP32Build() {
  return (tempDir: string) => {
    log('ESP32', `Cleaning up build directory: ${tempDir}`);
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      log('ESP32', `Failed to cleanup build directory: ${error}`);
    }
  };
}

const log = (category: string, msg: string, data?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [MAIN:${category}] ${msg}`, data ?? '');
};

function startCompileServer() {
  const isDev = !app.isPackaged;
  const serverDir = isDev
    ? path.join(app.getAppPath(), 'server')
    : path.join(process.resourcesPath, 'server');

  // Prefer a compiled server.js (packaged build); fall back to the TypeScript
  // source (repo layout) which is executed through tsx.
  let serverPath = path.join(serverDir, 'server.js');
  let viaTsx = false;
  if (!fs.existsSync(serverPath)) {
    const tsEntry = path.join(serverDir, 'server.ts');
    if (fs.existsSync(tsEntry)) {
      serverPath = tsEntry;
      viaTsx = true;
    }
  }

  log('COMPILE-SERVER', `Attempting to start compile server from: ${serverPath}${viaTsx ? ' (via tsx)' : ''}`);

  if (!fs.existsSync(serverPath)) {
    log('COMPILE-SERVER', `Server file not found at: ${serverPath}`);
    return;
  }

  // Check node_modules exist for the server
  const nmPath = path.join(serverDir, 'node_modules');

  if (!fs.existsSync(nmPath)) {
    log('COMPILE-SERVER', `node_modules missing at: ${nmPath} — run: cd server && bun install`);
    return;
  }

  const pioPath = getPioPathIfAvailable() || undefined;
  const pioEnv = getBundledPioEnv();

  // When running the TypeScript source, launch it through tsx:
  // node <tsx-cli.mjs> server/server.ts
  const args: string[] = [];
  if (viaTsx) {
    const tsxCandidates = [
      path.join(app.getAppPath(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(process.resourcesPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    ];
    const tsxCli = tsxCandidates.find((p) => fs.existsSync(p));
    if (!tsxCli) {
      log('COMPILE-SERVER', `tsx not found in ${tsxCandidates.join('; ')} — cannot run ${serverPath}`);
      return;
    }
    args.push(tsxCli);
  }
  args.push(serverPath);

  compileServerProcess = spawn('node', args, {
    env: {
      ...process.env,
      PORT: '3001',
      PIO_CLI_PATH: pioPath,
      ...pioEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  compileServerProcess.stdout.on('data', (data: Buffer) => {
    console.log(`[COMPILE-SERVER] ${data.toString().trim()}`);
  });

  compileServerProcess.stderr.on('data', (data: Buffer) => {
    console.error(`[COMPILE-SERVER ERROR] ${data.toString().trim()}`);
  });

  compileServerProcess.on('close', (code: number) => {
    log('COMPILE-SERVER', `Exited with code ${code}`);
    compileServerProcess = null;
  });

  log('COMPILE-SERVER', 'Started on http://localhost:3001');
}

function stopCompileServer() {
  if (compileServerProcess) {
    log('COMPILE-SERVER', 'Stopping compile server...');
    compileServerProcess.kill();
    compileServerProcess = null;
    log('COMPILE-SERVER', 'Stopped');
  }
}

console.log('[MAIN] Starting LeapBlocks main process...');
const STARTUP_TIME = Date.now();
const logTiming = (label: string) => {
  const elapsed = Date.now() - STARTUP_TIME;
  console.log(`[TIMING] ${elapsed}ms - ${label}`);
};

logTiming('Main process script loaded');

if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = (): void => {
  logTiming('createWindow() called');

  const isDev = !app.isPackaged;
  const iconPath = isDev
    ? join(__dirname, '../public/assets/leaplabicon.ico')
    : join(process.resourcesPath, 'public/assets/leaplabicon.ico');

  mainWindow = new BrowserWindow({
    height: 800,
    width: 1400,
    minHeight: 600,
    minWidth: 1000,
    title: 'LeapLab - Block Programming IDE',
    show: false, // hidden until ready-to-show fires — eliminates blank white flash
    backgroundColor: '#f8fafc', // matches app background so no flicker on show
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Allow cross-origin requests from renderer — required for ESP32 simulation
      // HTTPClient/WiFiClient to reach external APIs (ThingSpeak, etc.)
      webSecurity: false,
    },
  });

  logTiming('BrowserWindow created');

  // electron-vite: use env var for dev server URL, file path for production
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    logTiming('Started loading dev server URL');
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    logTiming('Started loading renderer HTML');
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
    logTiming('DevTools opened');

    // Belt-and-braces alongside the `disable-http-cache` switch: purges any
    // corrupted entries left on disk from an earlier hard-kill.
    mainWindow.webContents.session.clearCache()
      .then(() => log('MAIN', 'Chromium cache cleared in development mode'))
      .catch((err) => log('MAIN', `Failed to clear Chromium cache: ${err.message}`));

    // Suppress harmless DevTools autofill warnings
    mainWindow.webContents.on('console-message', (event, level, message) => {
      if (message.includes('Autofill.enable') || message.includes('Autofill.setAddresses')) {
        event.preventDefault();
      }
    });
  }

  // Track when renderer is ready
  mainWindow.webContents.on('did-finish-load', () => {
    logTiming('Renderer finished loading (did-finish-load)');
  });

  mainWindow.webContents.on('dom-ready', () => {
    logTiming('DOM ready');
  });

  mainWindow.once('ready-to-show', () => {
    logTiming('Window ready to show');
    mainWindow?.show();
  });

  // Safety fallback: show the window after 3 seconds regardless, so a stalled
  // renderer never leaves the user staring at nothing.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      logTiming('Fallback show triggered (ready-to-show did not fire in time)');
      mainWindow.show();
    }
  }, 3000);

  // Initialize service instances with current window
  logTiming('Initializing SerialManager');
  serialManager = new SerialManager(mainWindow);
  logTiming('SerialManager initialized');

  logTiming('Initializing ArduinoUploader (PlatformIO + clean-room STK500 uploader)');
  arduinoUploader = new ArduinoUploader(mainWindow);
  logTiming('ArduinoUploader initialized');

  logTiming('Initializing PythonManager');
  pythonManager = new PythonManager(mainWindow);
  logTiming('PythonManager initialized');

  mainWindow.on('closed', () => {
    mainWindow = null;
    serialManager.setWindow(null);
    arduinoUploader.setWindow(null);
    if (pythonManager) pythonManager.setWindow(null);
  });
};

// ═══════════════════════════════════════════════════════════════════════════

app.on('ready', () => {
  logTiming('Electron app ready event fired');
  cleanupOldLogs();
  createWindow();
  startCompileServer();
  logTiming('createWindow() completed');

  // Fire-and-forget update check after window loads
  setTimeout(() => {
    checkForUpdate().then((updateInfo) => {
      if (updateInfo?.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', updateInfo);
      }
    });
  }, 5000);
  // ESP32 core check removed from startup — now runs on-demand during first ESP32 compile
  // This prevents blocking the app startup with a 7+ second installation
});

app.on('window-all-closed', () => {
  logTiming('All windows closed');
  stopCompileServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  logTiming('App activated');
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  logTiming('App before-quit event');
  stopCompileServer();
  if (serialManager) {
    serialManager.disconnect();
  }
  if (pythonManager) {
    pythonManager.stopAll();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// IPC HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

ipcMain.handle('get-ports', async () => {
  return await serialManager.listPorts();
});

ipcMain.handle('connect-port', async (event, portPath: string, baudRate: number, board?: string) => {
  try {
    const result = await serialManager.connect(portPath, baudRate, board || 'arduino_uno');
    return result;
  } catch (error) {
    const msg = (error as Error).message || String(error);
    const locked = /denied|busy|in use|locked/i.test(msg);
    return {
      success: false,
      error: locked
        ? `Port ${portPath} is busy (${msg}). Another app is holding it open — close other LeapBlocks windows, the Arduino IDE serial monitor, or any other serial tool, then try again.`
        : msg,
    };
  }
});

ipcMain.handle('disconnect-port', async () => {
  return await serialManager.disconnect();
});

ipcMain.handle('send-serial', async (event, data: string) => {
  serialManager.write(data);
});

ipcMain.handle('upload-code', async (event, code: string, selectedPort: string, fqbn: string) => {
  // 1. Ensure serial port is disconnected before upload
  await serialManager.disconnect();
  // Delay to let Windows fully release the COM port handle
  await new Promise(resolve => setTimeout(resolve, 600));

  // 2. Perform upload (renderer handles reconnection via IPC)
  const result = await arduinoUploader.upload(code, selectedPort, fqbn);

  return result;
});

ipcMain.handle('compile-code', async (event, code: string, fqbn: string, libraryPath?: string) => {
  log('IPC', `compile-code request received. FQBN: ${fqbn}`);

  const isESP32 = typeof fqbn === 'string' && fqbn.startsWith('esp32:');
  log('IPC', `isESP32: ${isESP32}`);

  if (isESP32) {
    log('IPC', 'ESP32-C3 detected — passing to ArduinoUploader RISC-V compile path');
    let result = await arduinoUploader.compileESP32ForSimulation(code, fqbn);

    // Zero-GPL: local ESP32 needs Python esptool (GPL) which is not bundled.
    // Fallback to cloud compiler (Render) which is GPL-compliant SaaS (no distribution)
    // and then flash via esptool-js (MIT) in the renderer. This keeps the installer 100% GPL-free.
    const isZeroGplError = !result.success && !!result.error && (
      result.error.includes('Zero-GPL') || result.error.includes("No module named 'esptool'") || result.error.includes('esptool')
    );
    if (isZeroGplError) {
      log('IPC', `ESP32 local zero-GPL miss → falling back to cloud compiler (esptool-js MIT for flash)`);
      try {
        const cloudUrl = process.env.VITE_COMPILER_URL || 'https://leapblocks-server-6qwr.onrender.com';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        const res = await fetch(`${cloudUrl}/compile/esp32`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, board: fqbn }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data: any = await res.json();
          if (data.success && data.binBase64) {
            const tmpDir = path.join(os.tmpdir(), `forge_esp32_cloud_${Date.now()}`);
            fs.mkdirSync(tmpDir, { recursive: true });
            const binPath = path.join(tmpDir, 'firmware.bin');
            fs.writeFileSync(binPath, Buffer.from(data.binBase64, 'base64'));
            // Also write bootloader/partitions if provided (for faithful flash)
            if (data.bootloaderBase64) fs.writeFileSync(path.join(tmpDir, 'bootloader.bin'), Buffer.from(data.bootloaderBase64, 'base64'));
            if (data.partitionsBase64) fs.writeFileSync(path.join(tmpDir, 'partitions.bin'), Buffer.from(data.partitionsBase64, 'base64'));
            if (lastESP32BinTempDir && lastESP32BinTempDir !== tmpDir) getCleanupESP32Build()(lastESP32BinTempDir);
            lastESP32BinTempDir = tmpDir;
            log('IPC', `ESP32 cloud compile success — ${data.binBase64.length}b64 via ${cloudUrl}`);
            return { success: true, binPath };
          }
          log('IPC', `ESP32 cloud compile failed: ${JSON.stringify(data).slice(0, 800)}`);
        } else {
          log('IPC', `ESP32 cloud HTTP ${res.status}`);
        }
      } catch (e: any) {
        log('IPC', `ESP32 cloud fallback error: ${e.message}`);
      }
      // If cloud also fails, return original zero-GPL error with guidance
      log('IPC', `ESP32 cloud fallback unavailable — returning zero-GPL guidance`);
    }

    // We will perform temp folder cleanup here, assuming ArduinoUploader used its generated tmp path to output final result. 
    // The old temp dir cleanup handled by lastESP32BinTempDir requires tracking if it was sent back
    if (result.success && result.binPath) {
      const binDir = path.dirname(result.binPath);
      if (lastESP32BinTempDir && lastESP32BinTempDir !== binDir) {
        getCleanupESP32Build()(lastESP32BinTempDir);
      }
      lastESP32BinTempDir = binDir;
    }

    log('IPC', `compile-code ESP32 returning result from Uploader.`);
    return result;
  }

  // ── AVR path ─────────────────────────────────────────────────────────────
  log('IPC', `compile-code AVR path, FQBN: ${fqbn}`);
  const result = await arduinoUploader.compileForSimulation(code, fqbn);
  log('IPC', `compile-code completed. Result: ${result.success ? 'Success' : 'Failure'}`);
  return result;
});


ipcMain.handle('search-library', async (event, query: string) => {
  return await arduinoUploader.searchLibraries(query);
});

ipcMain.handle('install-library', async (event, libName: string) => {
  return await arduinoUploader.installLibrary(libName);
});

ipcMain.handle('remove-library', async (event, libName: string) => {
  return await arduinoUploader.uninstallLibrary(libName);
});

ipcMain.handle('get-installed-libraries', async () => {
  return await arduinoUploader.getInstalledLibraries();
});

ipcMain.handle('get-forge-lib-path', async () => {
  return arduinoUploader.getForgeLibCachePath();
});

ipcMain.handle('get-default-project-path', async () => {
  log('IPC', 'get-default-project-path request received');
  const appRoot = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : process.cwd();

  const forgeLibDir = path.join(appRoot, 'forge-lib');
  log('IPC', `Checking/Creating forge-lib dir at: ${forgeLibDir}`);

  if (!fs.existsSync(forgeLibDir)) {
    fs.mkdirSync(forgeLibDir, { recursive: true });
  }

  const libsDir = path.join(forgeLibDir, 'libs');
  if (!fs.existsSync(libsDir)) {
    fs.mkdirSync(libsDir, { recursive: true });
  }

  return forgeLibDir;
});

ipcMain.handle('forge-lib-cache-info', async () => {
  return arduinoUploader.getForgeLibCacheInfo();
});

// Python Handlers
ipcMain.handle('python-check', async () => {
  return await pythonManager.checkPython();
});
ipcMain.handle('python-run', async (event, code: string, projectFiles?: Record<string, string>) => {
  await pythonManager.runCode(code, projectFiles);
});
ipcMain.handle('python-send-input', async (event, input: string) => {
  pythonManager.sendInput(input);
});
ipcMain.handle('python-repl-start', async () => {
  await pythonManager.startRepl();
});
ipcMain.handle('python-repl-send', async (event, input: string) => {
  pythonManager.sendRepl(input);
});
ipcMain.handle('python-stop', async () => {
  pythonManager.stopAll();
});
ipcMain.handle('python-pip-install', async (event, pkg: string) => {
  await pythonManager.installPipPackage(pkg);
});

ipcMain.handle('python-shell-run', async (event, command: string) => {
  await pythonManager.runShellCommand(command);
});
ipcMain.handle('python-shell-stop', async () => {
  pythonManager.stopShell();
});

ipcMain.handle('remove-background', async (event, imagePath: string) => {
  const { exec } = require('child_process');
  const fs = require('fs');
  const crypto = require('crypto');

  let targetPath = imagePath;
  let isTempFile = false;
  let returnAsBase64 = false;

  // Handle Base64 Data URL
  if (imagePath.startsWith('data:image/')) {
    isTempFile = true;
    returnAsBase64 = true;
    const matches = imagePath.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return { success: false, error: 'Invalid base64 image data' };
    }
    const buffer = Buffer.from(matches[2], 'base64');
    const tempName = crypto.randomBytes(16).toString('hex') + '.png';
    targetPath = path.join(app.getPath('temp'), tempName);
    fs.writeFileSync(targetPath, buffer);
  }

  // Convert to absolute path if not already
  const fullPath = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(app.getAppPath(), targetPath);

  const scriptPath = path.join(app.getAppPath(), 'src', 'utils', 'remove_bg.py');
  if (!fs.existsSync(scriptPath)) {
    return Promise.resolve({ success: false, error: 'Background removal script not available in this build.' });
  }

  return new Promise((resolve) => {
    exec(`python "${scriptPath}" "${fullPath}"`, (error: any, stdout: any, stderr: any) => {
      let resultBase64;

      // If we used a temp file, the python script outputs a new file (replace extension with .png)
      // Since we forced the input to be .png, the output is the same path.
      if (returnAsBase64 && fs.existsSync(fullPath) && !error) {
        const outBuffer = fs.readFileSync(fullPath);
        resultBase64 = `data:image/png;base64,${outBuffer.toString('base64')}`;
      }

      // Cleanup temp file
      if (isTempFile && fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch (e) { }
      }

      if (error) {
        console.error(`[MAIN:BG_REMOVAL] Error: ${error}`);
        resolve({ success: false, error: error.message, stderr });
        return;
      }

      resolve({ success: true, stdout, stderr, base64: resultBase64 });
    });
  });
});

async function renderIconToPng(iconPath: string, size: number): Promise<Buffer> {
  const tempHtmlPath = path.join(app.getPath('temp'), `temp_icon_${Date.now()}_${size}.html`);
  const escapedIconPath = url.pathToFileURL(iconPath).href;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: ${size}px;
    height: ${size}px;
    overflow: hidden;
    background: #0f172a; /* Premium dark slate blue background */
    display: flex;
    align-items: center;
    justify-content: center;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
</head>
<body>
  <img src="${escapedIconPath}" />
</body>
</html>
  `;
  fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');

  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: false,
    webPreferences: {
      offscreen: true,
      webSecurity: false
    }
  });

  try {
    const fileUrl = url.pathToFileURL(tempHtmlPath).href;
    await win.loadURL(fileUrl);
    // Wait for rendering
    await new Promise(resolve => setTimeout(resolve, 800));
    const image = await win.webContents.capturePage();
    return image.toPNG();
  } finally {
    win.close();
    try {
      fs.unlinkSync(tempHtmlPath);
    } catch (_) {}
  }
}

ipcMain.handle('build-apk', async (event, appState) => {
  // Always use the c-logo-svg.svg from the creova module folder as the default app icon (uneditable)
  const defaultIconPath = path.join(app.getAppPath(), 'src', 'creova', 'apk', 'c-logo-svg.svg');
  let iconPath = defaultIconPath;
  if (!fs.existsSync(iconPath)) {
    // Absolute fallbacks
    const fallbackPath1 = 'D:\\Creoleap Company\\leapblocks\\leaplab_frontend\\src\\creova\\apk\\c-logo-svg.svg';
    const fallbackPath2 = path.join(app.getAppPath(), 'public', 'assets', 'c-logo-svg.svg');
    const fallbackPath3 = 'D:\\Creoleap Company\\leapblocks\\leaplab_frontend\\public\\assets\\c-logo-svg.svg';
    if (fs.existsSync(fallbackPath1)) {
      iconPath = fallbackPath1;
    } else if (fs.existsSync(fallbackPath2)) {
      iconPath = fallbackPath2;
    } else if (fs.existsSync(fallbackPath3)) {
      iconPath = fallbackPath3;
    }
  }

  let renderedIconsDir: string | null = null;
  if (iconPath && fs.existsSync(iconPath)) {
    try {
      log('APK_BUILD', `Pre-rendering custom launcher icon from: ${iconPath}`);
      renderedIconsDir = path.join(app.getPath('temp'), `leapblocks_icons_${Date.now()}`);
      fs.mkdirSync(renderedIconsDir, { recursive: true });

      const densities = [
        { name: 'mdpi', size: 48 },
        { name: 'hdpi', size: 72 },
        { name: 'xhdpi', size: 96 },
        { name: 'xxhdpi', size: 144 },
        { name: 'xxxhdpi', size: 192 }
      ];

      for (const d of densities) {
        const pngBuffer = await renderIconToPng(iconPath, d.size);
        fs.writeFileSync(path.join(renderedIconsDir, `${d.name}.png`), pngBuffer);
      }
      log('APK_BUILD', 'Icon pre-rendering complete');
    } catch (err: any) {
      log('APK_BUILD', `Icon pre-rendering failed: ${err.message}`, err);
      renderedIconsDir = null;
    }
  }

  appState.renderedIconsDir = renderedIconsDir;

  // Run the heavy APK build in a forked child process so the main thread
  // (and therefore the renderer) never freezes or shows "Not Responding".
  const workerPath = path.join(
    app.getAppPath(),
    'src', 'creova', 'apk', 'build-worker.js'
  );

  return new Promise((resolve) => {
    const child = fork(workerPath, [], {
      // Inside ASAR: Electron's fork handles it transparently
      silent: false,
      env: { ...process.env },
    });

    child.send({ type: 'build', appState, appRoot: app.getAppPath() });

    child.on('message', (msg: any) => {
      if (msg.type === 'log') {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send('build-log', msg.message);
          }
        } catch (_) { /* renderer may have navigated away */ }
      } else if (msg.type === 'done') {
        resolve({ success: true, outputPath: msg.outputPath });
      } else if (msg.type === 'error') {
        resolve({ success: false, error: msg.message });
      }
    });

    child.on('error', (err) => {
      console.error('[build-apk] Worker error:', err);
      resolve({ success: false, error: err.message || 'Build worker crashed' });
    });

    child.on('exit', (code) => {
      // Clean up the temporary rendered icons dir
      if (renderedIconsDir) {
        try {
          fs.rmSync(renderedIconsDir, { recursive: true, force: true });
        } catch (_) {}
      }
      // If the worker exited without sending 'done' or 'error', treat as failure
      if (code !== 0) {
        resolve({ success: false, error: `Build worker exited with code ${code}` });
      }
    });
  });
});

ipcMain.handle('show-in-folder', (_, filePath) => {
  shell.showItemInFolder(filePath);
});

// Read a compiled .bin file and return its contents as a Buffer
// Used by SimulationRunner to load ESP32-C3 firmware for the GPIO scanner
ipcMain.handle('read-bin-file', async (_, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } catch (err: any) {
    log('IPC', `read-bin-file error: ${err.message}`);
    throw err;
  }
});

ipcMain.handle('save-project', async (_, data, existingPath?: string) => {
  if (!mainWindow) return { success: false };

  let targetPath = existingPath;

  if (!targetPath) {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save LeapLab Project File',
      defaultPath: 'project.leap',
      buttonLabel: 'Save Project',
      filters: [
        { name: 'LeapLab Project', extensions: ['leap'] }
      ]
    });
    if (!filePath) return { success: false };
    targetPath = filePath;
  }

  const fsMod = require('fs');

  try {
    log('PROJECT', `Saving project file: ${targetPath}`);
    fsMod.writeFileSync(targetPath, JSON.stringify(data, null, 2));
    log('PROJECT', `Project successfully saved to: ${targetPath}`);
    return { success: true, projectPath: targetPath };
  } catch (err: any) {
    log('PROJECT', `Failed to save project: ${err.message}`, err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-project', async () => {
  if (!mainWindow) return null;

  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open LeapLab Project File',
    properties: ['openFile'],
    filters: [
      { name: 'LeapLab Project', extensions: ['leap', 'lbp'] }
    ]
  });

  if (filePaths && filePaths.length > 0) {
    const projectPath = filePaths[0];
    const fsMod = require('fs');

    try {
      const content = fsMod.readFileSync(projectPath, 'utf-8');
      const data = JSON.parse(content);
      return { data, projectPath };
    } catch (e) {
      console.error("Invalid project file", e);
      return null;
    }
  }
  return null;
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-UPDATE IPC HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

ipcMain.handle('check-for-update', async (): Promise<UpdateInfo | null> => {
  return checkForUpdate();
});

ipcMain.handle('download-update', async (event, updateInfo: UpdateInfo): Promise<{ success: boolean; installerPath?: string; error?: string }> => {
  try {
    const installerPath = await downloadUpdate(updateInfo, (progress: DownloadProgress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', progress);
      }
    });
    return { success: true, installerPath };
  } catch (err: any) {
    log('UPDATE', `Download failed: ${err.message}`, err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-update', async (_, installerPath: string): Promise<{ success: boolean; error?: string }> => {
  try {
    installUpdate(installerPath);
    return { success: true };
  } catch (err: any) {
    log('UPDATE', `Install failed: ${err.message}`, err);
    return { success: false, error: err.message };
  }
});
