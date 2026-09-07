import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import { log } from '../utils/log';
import { isWebSerialSupported, listPorts as webListPorts, requestPort as webRequestPort, uploadToBoard, startWebSerialMonitor, stopWebSerialMonitor, sendWebSerial, getGrantedPort, detectSketchBaud } from '../../webflash';

export function useHardwareControls(
    editorMode: string,
    selectedPort: string,
    isConnected: boolean,
    baudRate: number,
    selectedBoard: string,
    generatedCode: string,
    isUploading: boolean,
    setPorts: React.Dispatch<React.SetStateAction<any[]>>,
    setIsConnected: React.Dispatch<React.SetStateAction<boolean>>,
    setSerialMessages: React.Dispatch<React.SetStateAction<string[]>>,
    setIsUploading: React.Dispatch<React.SetStateAction<boolean>>,
    setUploadProgress: React.Dispatch<React.SetStateAction<string>>,
    setActiveTab: (tab: 'log' | 'serial') => void,
    addLog: (msg: string) => void,
    setBaudRate?: React.Dispatch<React.SetStateAction<number>>,
) {
    // Tracks the monitor baud so the post-upload restart uses the latest
    // value even when handleUpload's closure is stale.
    const baudRateRef = useRef(baudRate);
    baudRateRef.current = baudRate;

    const refreshPorts = useCallback(async () => {
        try {
            let portList: any[] = [];
            const electronAPI = (window as any).electronAPI;
            if (electronAPI?.getPorts) {
                portList = await electronAPI.getPorts();
                setPorts(portList);
            } else if (isWebSerialSupported()) {
                const webPorts = await webListPorts();
                portList = webPorts.map((p, i) => ({
                    path: p.path,
                    manufacturer: p.manufacturer || `Web Serial port ${i + 1}`,
                }));
                setPorts(portList);
            } else {
                portList = [{ path: 'WEB_DEMO', manufacturer: 'LeapBlocks Web' }];
                setPorts(portList);
            }
        } catch (e) {
            addLog('Failed to scan ports');
        }
    }, [addLog, setPorts]);

    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (editorMode === 'upload' && !selectedPort && !isConnected) {
            timer = setInterval(() => {
                const electronAPI = (window as any).electronAPI;
                if (electronAPI?.getPorts) {
                    electronAPI.getPorts().then((portList: any[]) => {
                        setPorts(portList);
                    }).catch(() => {});
                }
            }, 5000);
        }
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [editorMode, selectedPort, isConnected, setPorts]);

    const handleConnect = useCallback(async () => {
        const electronAPI = (window as any).electronAPI;

        // Web Serial needs no pre-selected port — the browser picker grants access.
        if (!selectedPort && electronAPI?.connectPort) {
            addLog('Select a port first');
            return;
        }

        if (selectedPort === 'BRIDGE_DETECTED') {
            addLog('⚠ Device detected but no COM port assigned. Please install drivers or try a different USB cable.');
            return;
        }

        if (isConnected) {
            const electronAPI = (window as any).electronAPI;
            if (electronAPI?.disconnectPort) {
                const result = await electronAPI.disconnectPort();
                if (result.success) {
                    setIsConnected(false);
                    addLog(`Disconnected from ${selectedPort}`);
                }
            } else {
                await stopWebSerialMonitor();
                setIsConnected(false);
                addLog(`Disconnected from ${selectedPort}`);
            }
        }

        try {
            const electronAPI = (window as any).electronAPI;
            if (electronAPI?.connectPort) {
                const result = await electronAPI.connectPort(selectedPort, baudRate, selectedBoard);
                if (result.success) {
                    setIsConnected(true);
                    addLog(`Connected to ${selectedPort} at ${baudRate} baud`);
                } else {
                    addLog(`Connection failed: ${result.error}`);
                }
            } else if (isWebSerialSupported()) {
                await stopWebSerialMonitor();
                const picked = await webRequestPort();
                if (picked?.port) {
                    setPorts((prev) => {
                        const next = (prev || []).filter((p) => p?.path !== picked.path);
                        return [{ path: picked.path, manufacturer: picked.manufacturer || 'Web Serial device' }, ...next];
                    });
                    setIsConnected(true);
                    addLog('Connected via Web Serial — ready to upload');
                    refreshPorts();
                    startWebSerialMonitor(
                        baudRate,
                        (line) => setSerialMessages(prev => [...prev.slice(-100), line]),
                        (msg) => addLog(msg),
                    );
                } else {
                    addLog('No board selected');
                }
            } else if (selectedPort === 'WEB_DEMO') {
                setIsConnected(true);
                addLog('Connected to LeapBlocks Web (Simulation Mode)');
            } else {
                addLog('Serial connection requires LeapBlocks Desktop');
            }
        } catch (err) {
            addLog('Connection error occurred');
            console.error(err);
        }
    }, [selectedPort, isConnected, baudRate, selectedBoard, addLog, setIsConnected, setPorts, setSerialMessages, refreshPorts]);

    // Baud change: for Web Serial just restart the monitor reader at the new
    // baud on the already-granted port. Never call handleConnect() here — it
    // opens the browser port picker, which requires a user gesture and throws
    // SecurityError when invoked from an effect (plus the old code called it
    // twice, racing two pickers/readers against each other).
    useEffect(() => {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.connectPort) return; // Electron path reconnects elsewhere.
        if (!isConnected || !isWebSerialSupported() || !getGrantedPort()) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            log.app(`Baud rate changed to ${baudRate}, restarting monitor...`);
            await stopWebSerialMonitor();
            if (cancelled) return;
            await startWebSerialMonitor(
                baudRate,
                (line) => setSerialMessages(prev => [...prev.slice(-100), line]),
                (msg) => addLog(msg),
            );
        }, 150);
        return () => { cancelled = true; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baudRate]);

    const handleSendSerial = useCallback(async (data: string) => {
        if (!isConnected) return;
        try {
            const electronAPI = (window as any).electronAPI;
            if (electronAPI?.sendSerial) {
                await electronAPI.sendSerial(data);
                setSerialMessages(prev => [...prev.slice(-100), `> ${data.trim()}`]);
            } else if (selectedPort === 'WEB_DEMO') {
                setSerialMessages(prev => [...prev.slice(-100), `> ${data.trim()}`]);
            } else if (isWebSerialSupported()) {
                const ok = await sendWebSerial(data);
                if (ok) {
                    setSerialMessages(prev => [...prev.slice(-100), `> ${data.trim()}`]);
                } else {
                    addLog('Failed to send — port is not open');
                }
            }
        } catch (e) {
            addLog('Failed to send');
        }
    }, [isConnected, selectedPort, addLog, setSerialMessages]);

    const handleUpload = useCallback(async () => {
        if (!generatedCode || isUploading) return;

        setIsUploading(true);
        setUploadProgress('Preparing upload...');

        const electronAPI = (window as any).electronAPI;

        // In Electron a COM port must be chosen first; in the browser the Web
        // Serial picker is opened automatically by uploadToBoard.
        if (!selectedPort && electronAPI?.uploadCode) {
            addLog('No port selected!');
            setIsUploading(false);
            setUploadProgress('');
            alert('⚠️ No port selected!\n\nPlease connect your board and select a COM port.');
            return;
        }

        const fqbnMap: Record<string, string> = {
            'arduino_uno': 'arduino:avr:uno',
            'arduino_mega': 'arduino:avr:mega',
            'arduino_nano': 'arduino:avr:nano',
            'arduino_nano_old': 'arduino:avr:nano_old',
            'esp32': 'esp32:esp32:esp32',
        };
        const fqbn = fqbnMap[selectedBoard] || 'arduino:avr:uno';

        // ── Web Serial upload path (no Electron) ──
        if (!electronAPI?.uploadCode) {
            if (!isWebSerialSupported()) {
                addLog('Upload requires LeapBlocks Desktop, or Chrome/Edge with Web Serial');
                setIsUploading(false);
                setUploadProgress('');
                return;
            }

            setUploadProgress('Uploading...');
            addLog('Starting upload via Web Serial...');
            await stopWebSerialMonitor();
            // Let the OS fully release the COM port before the flasher
            // reopens it at bootloader baud (Windows needs this gap).
            await new Promise(resolve => setTimeout(resolve, 300));

            const result = await uploadToBoard({
                code: generatedCode,
                fqbn,
                onProgress: (progress, message) => {
                    setUploadProgress(`${progress}%: ${message}`);
                    addLog(`${progress}%: ${message}`);
                },
                onLog: (message) => addLog(message),
            });

            if (result?.success) {
                addLog('Upload complete!');
                setUploadProgress('Upload complete!');
                setActiveTab('log');
            } else {
                const message = result?.error || 'Upload failed.';
                addLog(`Upload failed: ${message}`);
                setUploadProgress(`Failed: ${message}`);
            }
            setIsUploading(false);
            // Restart the monitor at the sketch's Serial.begin baud so the
            // output is readable. A 115200 monitor on a 9600 sketch shows up
            // as NUL / control-char floods.
            const sketchBaud = detectSketchBaud(generatedCode);
            if (sketchBaud && sketchBaud !== baudRateRef.current && setBaudRate) {
                addLog(`ℹ Sketch uses Serial.begin(${sketchBaud}) — switching monitor from ${baudRateRef.current} to ${sketchBaud} baud.`);
                setBaudRate(sketchBaud);
                // Do NOT start the monitor here: the baud-change effect
                // restarts it. Starting it here too creates two concurrent
                // readers that close/reopen the port from under each other —
                // every reopen toggles DTR and resets the board back into its
                // bootloader (the endless 0x14/0x10 flood in the logs).
                // After a failed upload the board may still sit in its ~1s
                // bootloader window, so wait it out before the effect fires.
                await new Promise(resolve => setTimeout(resolve, result?.success ? 800 : 1800));
                return;
            }
            // Same baud (or no setter): restart directly. After a failure the
            // board may still be in the bootloader window — wait it out so the
            // monitor catches sketch output instead of bootloader chatter.
            await new Promise(resolve => setTimeout(resolve, result?.success ? 500 : 1500));
            await startWebSerialMonitor(
                sketchBaud ?? baudRateRef.current,
                (line) => setSerialMessages(prev => [...prev.slice(-100), line]),
                (msg) => addLog(msg),
            );
            return;
        }

        if (isConnected) {
            addLog('Disconnecting serial for upload...');
            await window.electronAPI.disconnectPort();
            setIsConnected(false);
            await new Promise(resolve => setTimeout(resolve, 800));
        }

        addLog('Starting upload...');

        try {
            const result = await window.electronAPI.uploadCode(generatedCode, selectedPort, fqbn);

            if (result.success) {
                addLog('Upload complete!');
                setUploadProgress('Upload complete!');

                if (selectedPort) {
                    addLog('Connecting serial monitor...');
                    setActiveTab('serial');
                    setTimeout(async () => {
                        try {
                            const reconnectResult = await window.electronAPI.connectPort(selectedPort, baudRate, selectedBoard);
                            if (reconnectResult.success) {
                                setIsConnected(true);
                                addLog('Serial monitor connected — showing live data');
                            }
                        } catch (reconnectErr) {
                            console.error('Auto-reconnect failed:', reconnectErr);
                        }
                        setIsUploading(false);
                    }, 2000);
                } else {
                    setIsUploading(false);
                }
            } else {
                let errorMsg = result.error || 'Unknown error occurred';
                if (errorMsg.includes('busy') || errorMsg.includes('Access is denied')) {
                    errorMsg += "\nTIP: Close any other serial monitors or wait 2 seconds and try again.";
                }
                addLog(`Upload failed: ${errorMsg}`);
                setUploadProgress(`Failed: ${errorMsg}`);
                setIsUploading(false);
            }
        } catch (e) {
            addLog('Upload error');
            setUploadProgress('Upload error');
            setIsUploading(false);
        }
    }, [generatedCode, isUploading, addLog, selectedPort, selectedBoard, isConnected, baudRate, setIsConnected, setIsUploading, setUploadProgress, setActiveTab, setSerialMessages]);

    return { refreshPorts, handleConnect, handleSendSerial, handleUpload };
}
