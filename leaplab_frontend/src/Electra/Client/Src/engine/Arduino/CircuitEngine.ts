/* Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
* All rights reserved. Proprietary and confidential.
* Unauthorized copying, distribution, or modification is strictly prohibited.
*/
import { useForgeStore } from '../../../utils/store/useForgeStore';
import { simulationRunner, PinState } from './SimulationRunner';
import { HD44780 } from './HD44780';
import { I2CBusManager } from './I2CBusManager';
import { PCF8574 } from './PCF8574';
import { DHT } from './DHT';
import { NeoPixelEmulator } from './NeoPixelEmulator';
import { StepperEmulator } from './StepperEmulator';
import { StepperEmulator as UnifiedStepperEmulator, type StepperModel } from '../../simulation/components/StepperEmulator';
import { SSD1306I2CSlave } from './SSD1306I2CSlave';
import { ILI9341SPISlave } from './ILI9341SPISlave';
import { FT6206I2CSlave } from './FT6206I2CSlave';
import { enqueueTouchPoint } from './touchQueue';
import { MPU6050I2CSlave } from './MPU6050I2CSlave';
import { DS1307Emulator } from './DS1307Emulator';
import { KeypadEmulator } from './KeypadEmulator';
import { RotaryDialerEmulator } from './RotaryDialerEmulator';
import { TiltSwitchEmulator } from './TiltSwitchEmulator';
import { RotaryEncoderEmulator } from './RotaryEncoderEmulator';
import { IRReceiverEmulator } from './IRReceiverEmulator';
import { HX711Emulator } from './HX711Emulator';
import { ESP32_BOARD_CONFIG, ESP32_BOARDS, type ESP32PinInfo } from './ESP32BoardConfig.js';
import { createIRremoteClass } from '../esp32c3/ArduinoLibraries';

/** Simplified ECG pulse shape used by the heart-beat sensor emulator. Returns -1..+1 for phase 0..1 */
function heartEcgPulse(phase: number): number {
  if (phase < 0.15) return 0.3 * Math.sin(Math.PI * phase / 0.15);
  if (phase < 0.25) return 0;
  if (phase < 0.28) return -0.3 * (phase - 0.25) / 0.03;
  if (phase < 0.32) return 1.0 * (phase - 0.28) / 0.04;
  if (phase < 0.36) return 1.0 - 1.3 * (phase - 0.32) / 0.04;
  if (phase < 0.40) return -0.3 + 0.3 * (phase - 0.36) / 0.04;
  if (phase < 0.55) return 0;
  if (phase < 0.75) return 0.4 * Math.sin(Math.PI * (phase - 0.55) / 0.20);
  return 0;
}

/**
 * Real PulseSensor.com ADC output model.
 * Returns a raw ADC value (0–1023) that matches what analogRead() sees:
 *   - Baseline between beats: ~512 (mid-supply, 2.5V)
 *   - Slow breathing oscillation: ±50 ADC
 *   - Beat peak (QRS): spikes to ~750–900
 *   - Post-beat dip: drops to ~350–450
 *   - Noise: ±10 ADC
 */
function pulseSensorADC(phase: number): number {
  // Slow baseline drift from breathing (~0.2 Hz, much slower than heartbeat)
  const breathingDrift = 40 * Math.sin(2 * Math.PI * phase * 0.15);

  // Beat waveform — sharp systolic peak followed by diastolic notch
  let beat = 0;
  if (phase < 0.05) {
    // Rising edge of QRS
    beat = 380 * (phase / 0.05);
  } else if (phase < 0.10) {
    // Peak and falling edge
    beat = 380 * (1 - (phase - 0.05) / 0.05);
  } else if (phase < 0.18) {
    // Diastolic notch (dip below baseline)
    beat = -80 * Math.sin(Math.PI * (phase - 0.10) / 0.08);
  } else if (phase < 0.35) {
    // T-wave: gentle positive bump
    beat = 60 * Math.sin(Math.PI * (phase - 0.18) / 0.17);
  }
  // else: diastole — flat at baseline

  // Small random noise (deterministic pseudo-noise based on phase)
  const noise = 8 * Math.sin(phase * 137.5) + 5 * Math.sin(phase * 251.3);

  return Math.round(512 + breathingDrift + beat + noise);
}

/**
 * CircuitEngine
 * Bridges the abstract ReactFlow graph (nodes/edges) with the low-level AVR SimulationRunner.
 * Handles signal propagation across wires.
 */
class CircuitEngine {
  private activeSubscriptions = new Map<string, () => void>();
  private lcdEmulators = new Map<string, HD44780>();
  private peripheralPinBuffers = new Map<string, Record<string, any>>();
  private i2cBusManager = new I2CBusManager();
  private dhtEmulators = new Map<string, DHT>();
  private neoPixelEmulators = new Map<string, NeoPixelEmulator>();
  private stepperEmulators = new Map<string, StepperEmulator>();
  private unifiedStepperEmulators = new Map<string, UnifiedStepperEmulator>();
  private ili9341Slaves = new Map<string, ILI9341SPISlave>();
  private ft6206Slaves = new Map<string, FT6206I2CSlave>();
  private mpu6050Slaves = new Map<string, MPU6050I2CSlave>();
  private ssd1306Slaves = new Map<string, SSD1306I2CSlave>();
  private keypadEmulators = new Map<string, KeypadEmulator>();
  private rotaryDialerEmulators = new Map<string, RotaryDialerEmulator>();
  private tiltSwitchEmulators = new Map<string, TiltSwitchEmulator>();
  private rotaryEncoderEmulators = new Map<string, RotaryEncoderEmulator>();
  private irReceiverEmulators = new Map<string, IRReceiverEmulator>();
  private hx711Emulators = new Map<string, HX711Emulator>();
  private _pendingLibraryClasses = new Map<string, any>();
  public _displayElements = new Map<string, any>();
  private heartBeatTimers = new Map<string, number>(); // nodeId → requestAnimationFrame id
  private stepperIdleRaf: number | null = null;
  private isInitialized = false;
  private touchQueues = new Map<string, Array<{ touched: boolean, x: number, y: number }>>();

  /**
   * Validates if a component has proper GND connection.
   * Components need GND to complete the circuit and function properly.
   * Returns true if GND is connected, false otherwise.
   */
  private hasGroundConnection(nodeId: string): boolean {
    const { nodes, edges } = useForgeStore.getState();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return false;

    // Find all edges connected to this component
    const connectedEdges = edges.filter(e => e.source === nodeId || e.target === nodeId);

    // Check if any edge connects to a GND pin
    for (const edge of connectedEdges) {
      const pinName = (edge.source === nodeId ? edge.sourceHandle : edge.targetHandle)?.replace(/__target$/, '');

      // Common GND pin names
      const gndPins = ['GND', 'GROUND', 'V-', 'VSS', 'C', 'Cathode', 'NEG', '-', 'BLACK'];
      if (!pinName || gndPins.some(gnd => pinName.toUpperCase().includes(gnd.toUpperCase()))) {
        // Verify the other end connects to a board GND or battery GND
        const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
        const otherNode = nodes.find(n => n.id === otherNodeId);

        if (otherNode) {
          const otherPinName = (edge.source === nodeId ? edge.targetHandle : edge.sourceHandle)?.replace(/__target$/, '');
          const otherType = otherNode.data?.type || '';
          if (['arduino-uno', 'esp32-c3', 'esp32', 'arduino-nano', 'arduino-mega', 'battery-12v', 'battery'].includes(otherType)) {
            if (!otherPinName || gndPins.some(gnd => otherPinName.toUpperCase().includes(gnd.toUpperCase()))) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Evaluates speed, running state, and direction for DC Motors and Water Pumps.
   * Handles both High-Side Switching (Relay on POS) and Low-Side Switching (Relay on NEG).
   */
  private checkMotorPower(
    motorNodeId: string,
    currentPinStates: Record<string, any>,
    targetPinName?: string,
    activeSignal?: boolean
  ): { speed: number; running: boolean; direction: string } {
    let posPowered = false;
    let negGrounded = false;

    // Check POS pin state or trace to power (12V Battery POS / Board 5V / 3V3)
    if (targetPinName && ['POS', 'VCC', '1'].includes(targetPinName) && activeSignal !== undefined) {
      posPowered = activeSignal;
    } else if (currentPinStates['pin_POS'] || currentPinStates['pin_VCC'] || currentPinStates['pin_1']) {
      posPowered = true;
    } else {
      const posTargets = this.traceNet(motorNodeId, 'POS');
      posPowered = posTargets.some(t =>
        (t.type.includes('battery') && (t.pinName.includes('POS') || t.pinName === '12V' || t.pinName === 'VCC' || t.pinName === '+' || t.pinName === '1')) ||
        (['arduino-uno', 'esp32-c3', 'esp32'].includes(t.type) && ['5V', '3V3', '3.3V', 'VCC', 'VIN'].includes(t.pinName))
      );
    }

    // Check NEG pin state or trace to ground (12V Battery NEG / Board GND)
    if (targetPinName && ['NEG', 'GND', '2'].includes(targetPinName) && activeSignal !== undefined) {
      negGrounded = activeSignal;
    } else if (currentPinStates['pin_NEG'] || currentPinStates['pin_GND'] || currentPinStates['pin_2']) {
      negGrounded = true;
    } else {
      const negTargets = this.traceNet(motorNodeId, 'NEG');
      negGrounded = negTargets.some(t =>
        (t.type.includes('battery') && (t.pinName.includes('NEG') || t.pinName === 'GND' || t.pinName === 'V-' || t.pinName === '-' || t.pinName === '2')) ||
        (['arduino-uno', 'esp32-c3', 'esp32'].includes(t.type) && ['GND', 'GROUND', 'V-', 'VSS'].includes(t.pinName))
      );
    }

    let speed = 0;
    let running = false;
    let direction = 'cw';

    // Motor runs if both terminals form a closed circuit OR if activeSignal is passed on POS or NEG
    if ((posPowered && negGrounded) || (targetPinName && activeSignal)) {
      speed = 1.0;
      running = true;
      direction = 'cw';
    }

    return { speed, running, direction };
  }

  /**
   * Validates if a component has proper VCC/power connection.
   * Returns true if power is connected, false otherwise.
   */
  private hasPowerConnection(nodeId: string): boolean {
    const { nodes, edges } = useForgeStore.getState();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return false;

    // Find all edges connected to this component
    const connectedEdges = edges.filter(e => e.source === nodeId || e.target === nodeId);

    // Check if any edge connects to a VCC/power pin
    for (const edge of connectedEdges) {
      const pinName = (edge.source === nodeId ? edge.sourceHandle : edge.targetHandle)?.replace(/__target$/, '');

      // Common power pin names
      const powerPins = ['VCC', '5V', '3V3', '3.3V', 'VIN', 'POWER', 'V+', 'A', 'Anode', 'POS', '+'];
      if (pinName && powerPins.some(pwr => pinName.toUpperCase().includes(pwr.toUpperCase()))) {
        // Verify the other end connects to a board power pin
        const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
        const otherNode = nodes.find(n => n.id === otherNodeId);

        if (otherNode) {
          const otherPinName = (edge.source === nodeId ? edge.targetHandle : edge.sourceHandle)?.replace(/__target$/, '');
          // Check if connected to board power
          if (otherPinName && powerPins.some(pwr => otherPinName.toUpperCase().includes(pwr.toUpperCase()))) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Traces an electrical net from a starting point (board pin) and returns all 
   * reachable endpoints (LEDs, Buzzers, etc.) along with the total resistance in the path.
   */
  private traceNet(startNodeId: string, startPin: string): { nodeId: string, pinName: string, resistance: number, type: string }[] {
    const { nodes, edges } = useForgeStore.getState();
    const targets: { nodeId: string, pinName: string, resistance: number, type: string }[] = [];
    const queue = [{ id: startNodeId, pin: startPin, resistance: 0 }];
    const visited = new Set<string>();

    const targetTypes = ['led', 'buzzer', 'rgb-led', 'neopixel', 'neopixel-matrix', 'led-ring', 'dc-motor', 'water-pump', 'water-level-float-sensor', 'l298n', 'battery-12v', 'led-bar-graph'];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const cleanStartPin = current.pin.replace(/__target$/, '');
      const key = `${current.id}-${cleanStartPin}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const node = nodes.find(n => n.id === current.id);
      if (!node) continue;
      const nodeType = node.data?.type;

      // 1. If this is a target component (and not where we started), record it
      if (current.id !== startNodeId && targetTypes.includes(nodeType)) {
        targets.push({ nodeId: current.id, pinName: cleanStartPin, resistance: current.resistance, type: nodeType });
        // Stop tracing "through" simple terminal components
        if (['led', 'buzzer', 'rgb-led', 'neopixel', 'neopixel-matrix', 'led-ring', 'dc-motor', 'water-pump', 'water-level-float-sensor', 'battery-12v', 'led-bar-graph'].includes(nodeType)) {
          continue;
        }
      }

      // Also include the start node itself if it's a target (preserving legacy behavior for simple components)
      if (current.id === startNodeId && targetTypes.includes(nodeType)) {
        targets.push({ nodeId: current.id, pinName: cleanStartPin, resistance: current.resistance, type: nodeType });
      }

      // 2. Follow internal/specialized routing
      if (nodeType === 'ks2e-m-dc5') {
        const energized = node.data?.relayEnergized ?? false;
        const contactMap: Record<string, string> = energized
          ? { 'P1': 'NO1', 'P2': 'NO2', 'NO1': 'P1', 'NO2': 'P2' }
          : { 'P1': 'NC1', 'P2': 'NC2', 'NC1': 'P1', 'NC2': 'P2' };
        const exitPin = contactMap[cleanStartPin];
        if (exitPin) {
          const outEdges = edges.filter(e =>
            (e.source === current.id && e.sourceHandle?.replace(/__target$/, '') === exitPin) ||
            (e.target === current.id && e.targetHandle?.replace(/__target$/, '') === exitPin)
          );
          for (const edge of outEdges) {
            const nextId = edge.source === current.id ? edge.target : edge.source;
            const nextPin = (edge.source === current.id ? edge.targetHandle : edge.sourceHandle) || '';
            queue.push({ id: nextId, pin: nextPin, resistance: current.resistance });
          }
        }
      } else if (nodeType === 'relay-module') {
        const energized = node.data?.relayEnergized ?? false;
        const activeContact = energized ? 'NO' : 'NC';
        let exitPin = '';
        if (cleanStartPin === 'COM') exitPin = activeContact;
        else if (cleanStartPin === activeContact) exitPin = 'COM';

        if (exitPin) {
          const outEdges = edges.filter(e =>
            (e.source === current.id && e.sourceHandle?.replace(/__target$/, '') === exitPin) ||
            (e.target === current.id && e.targetHandle?.replace(/__target$/, '') === exitPin)
          );
          for (const edge of outEdges) {
            const nextId = edge.source === current.id ? edge.target : edge.source;
            const nextPin = (edge.source === current.id ? edge.targetHandle : edge.sourceHandle) || '';
            queue.push({ id: nextId, pin: nextPin, resistance: current.resistance });
          }
        }
      } else if (nodeType === 'resistor') {
        const rValue = Number(node.data?.sensorValues?.value ?? 0);
        let exitPin = '';
        if (cleanStartPin === '1' || cleanStartPin === 'pin_1' || cleanStartPin === 'IN') exitPin = node.data?.pinOUT ? 'OUT' : '2';
        else exitPin = node.data?.pinIN ? 'IN' : '1';

        const outEdges = edges.filter(e =>
          (e.source === current.id && e.sourceHandle?.replace(/__target$/, '') === exitPin) ||
          (e.target === current.id && e.targetHandle?.replace(/__target$/, '') === exitPin)
        );
        for (const edge of outEdges) {
          const nextId = edge.source === current.id ? edge.target : edge.source;
          const nextPin = (edge.source === current.id ? edge.targetHandle : edge.sourceHandle) || '';
          queue.push({ id: nextId, pin: nextPin, resistance: current.resistance + rValue });
        }
      }

      // 3. Always follow the wire connected to the CURRENT pin externally
      // This is critical for the start node and for nodes that aren't terminal components.
      const isTerminal = ['led', 'buzzer', 'rgb-led', 'dc-motor', 'water-pump', 'battery-12v'].includes(nodeType);
      if (current.id === startNodeId || !isTerminal) {
        const outEdges = edges.filter(e =>
          (e.source === current.id && e.sourceHandle?.replace(/__target$/, '') === cleanStartPin) ||
          (e.target === current.id && e.targetHandle?.replace(/__target$/, '') === cleanStartPin)
        );
        for (const edge of outEdges) {
          const nextId = edge.source === current.id ? edge.target : edge.source;
          const nextPin = (edge.source === current.id ? edge.targetHandle : edge.sourceHandle) || '';
          queue.push({ id: nextId, pin: nextPin, resistance: current.resistance });
        }
      }
    }
    return targets;
  }

  constructor() { }

  /**
   * Resolve an Arduino-label pin (e.g. "21", "32") to its ESP32PinInfo using
   * ESP32_BOARD_CONFIG.  Throws if the label is not in the GPIO map.
   * Used by syncCircuitGraph to wire ESP32-C3 RISC-V GPIO/ADC listeners.
   */
  public convertESP32Pin(label: string): ESP32PinInfo {
    const gpioNum = ESP32_BOARD_CONFIG.gpio[label];
    if (gpioNum === undefined) {
      throw new Error(`[CircuitEngine] Unknown ESP32-C3 pin label: "${label}"`);
    }
    const adcChannel = ESP32_BOARD_CONFIG.adc[label];
    const i2c = ESP32_BOARD_CONFIG.i2c;
    return {
      gpioNum,
      avrPin: 'ESP' + gpioNum,
      adcChannel,
      isI2CSDA: gpioNum === i2c.sda,
      isI2CSCL: gpioNum === i2c.scl,
    };
  }

  public init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    console.log('[FORGE CIRCUIT] Engine connected (Version: Ideal Mode - Indestructible)');

    // Listen to changes in the visual circuit board
    let previousEdgesCount = -1;
    let previousIsSimulating = false;
    useForgeStore.subscribe((state) => {
      // Re-sync only when edges change while already simulating (not on the start transition)
      const edgesChanged = state.edges.length !== previousEdgesCount;
      const wasAlreadySimulating = previousIsSimulating && state.isSimulating;
      previousEdgesCount = state.edges.length;
      previousIsSimulating = state.isSimulating;
      if (edgesChanged && wasAlreadySimulating) {
        this.syncCircuitGraph();
      }
    });
  }

  /**
   * Re-applies the I2C bus bridge to ArduinoRuntime after initTranspiled() creates it.
   * Called by SimulationRunner.start() on the transpiled path.
   */
  public syncI2CBridge() {
    const esp32Runtime = simulationRunner.ESP32C3Runner?.runtime;
    console.log(`[OLED BRIDGE] syncI2CBridge() called. Runtime exists: ${!!esp32Runtime}, ssd1306Slaves: ${this.ssd1306Slaves.size}`);

    // ── Always register the Adafruit_SSD1306 class for injection ─────────────
    // This is stored on CircuitEngine and pulled by initTranspiled() before
    // loadTranspiledCode() runs, so the class is available as a parameter.
    const ssd1306Slaves = this.ssd1306Slaves;

    const RealAdafruitSSD1306 = class {
      private _w: number;
      private _h: number;
      private _addr: number;
      private _slave: SSD1306I2CSlave | null = null;
      private _buf: Uint8Array;
      private _cursor_x = 0;
      private _cursor_y = 0;
      private _textsize = 1;
      private _textcolor = 1;
      private _displayOn = false;

      private static readonly FONT5X7: number[][] = [
        [0x00, 0x00, 0x00, 0x00, 0x00], [0x00, 0x00, 0x5F, 0x00, 0x00], [0x00, 0x07, 0x00, 0x07, 0x00], [0x14, 0x7F, 0x14, 0x7F, 0x14],
        [0x24, 0x2A, 0x7F, 0x2A, 0x12], [0x23, 0x13, 0x08, 0x64, 0x62], [0x36, 0x49, 0x55, 0x22, 0x50], [0x00, 0x05, 0x03, 0x00, 0x00],
        [0x00, 0x1C, 0x22, 0x41, 0x00], [0x00, 0x41, 0x22, 0x1C, 0x00], [0x14, 0x08, 0x3E, 0x08, 0x14], [0x08, 0x08, 0x3E, 0x08, 0x08],
        [0x00, 0x50, 0x30, 0x00, 0x00], [0x08, 0x08, 0x08, 0x08, 0x08], [0x00, 0x60, 0x60, 0x00, 0x00], [0x20, 0x10, 0x08, 0x04, 0x02],
        [0x3E, 0x51, 0x49, 0x45, 0x3E], [0x00, 0x42, 0x7F, 0x40, 0x00], [0x42, 0x61, 0x51, 0x49, 0x46], [0x21, 0x41, 0x45, 0x4B, 0x31],
        [0x18, 0x14, 0x12, 0x7F, 0x10], [0x27, 0x45, 0x45, 0x45, 0x39], [0x3C, 0x4A, 0x49, 0x49, 0x30], [0x01, 0x71, 0x09, 0x05, 0x03],
        [0x36, 0x49, 0x49, 0x49, 0x36], [0x06, 0x49, 0x49, 0x29, 0x1E], [0x00, 0x36, 0x36, 0x00, 0x00], [0x00, 0x56, 0x36, 0x00, 0x00],
        [0x08, 0x14, 0x22, 0x41, 0x00], [0x14, 0x14, 0x14, 0x14, 0x14], [0x00, 0x41, 0x22, 0x14, 0x08], [0x02, 0x01, 0x51, 0x09, 0x06],
        [0x32, 0x49, 0x79, 0x41, 0x3E], [0x7E, 0x11, 0x11, 0x11, 0x7E], [0x7F, 0x49, 0x49, 0x49, 0x36], [0x3E, 0x41, 0x41, 0x41, 0x22],
        [0x7F, 0x41, 0x41, 0x22, 0x1C], [0x7F, 0x49, 0x49, 0x49, 0x41], [0x7F, 0x09, 0x09, 0x09, 0x01], [0x3E, 0x41, 0x49, 0x49, 0x7A],
        [0x7F, 0x08, 0x08, 0x08, 0x7F], [0x00, 0x41, 0x7F, 0x41, 0x00], [0x20, 0x40, 0x41, 0x3F, 0x01], [0x7F, 0x08, 0x14, 0x22, 0x41],
        [0x7F, 0x40, 0x40, 0x40, 0x40], [0x7F, 0x02, 0x0C, 0x02, 0x7F], [0x7F, 0x04, 0x08, 0x10, 0x7F], [0x3E, 0x41, 0x41, 0x41, 0x3E],
        [0x7F, 0x09, 0x09, 0x09, 0x06], [0x3E, 0x41, 0x51, 0x21, 0x5E], [0x7F, 0x09, 0x19, 0x29, 0x46], [0x46, 0x49, 0x49, 0x49, 0x31],
        [0x01, 0x01, 0x7F, 0x01, 0x01], [0x3F, 0x40, 0x40, 0x40, 0x3F], [0x1F, 0x20, 0x40, 0x20, 0x1F], [0x3F, 0x40, 0x38, 0x40, 0x3F],
        [0x63, 0x14, 0x08, 0x14, 0x63], [0x07, 0x08, 0x70, 0x08, 0x07], [0x61, 0x51, 0x49, 0x45, 0x43], [0x00, 0x7F, 0x41, 0x41, 0x00],
        [0x02, 0x04, 0x08, 0x10, 0x20], [0x00, 0x41, 0x41, 0x7F, 0x00], [0x04, 0x02, 0x01, 0x02, 0x04], [0x40, 0x40, 0x40, 0x40, 0x40],
        [0x00, 0x01, 0x02, 0x04, 0x00], [0x20, 0x54, 0x54, 0x54, 0x78], [0x7F, 0x48, 0x44, 0x44, 0x38], [0x38, 0x44, 0x44, 0x44, 0x20],
        [0x38, 0x44, 0x44, 0x48, 0x7F], [0x38, 0x54, 0x54, 0x54, 0x18], [0x08, 0x7E, 0x09, 0x01, 0x02], [0x0C, 0x52, 0x52, 0x52, 0x3E],
        [0x7F, 0x08, 0x04, 0x04, 0x78], [0x00, 0x44, 0x7D, 0x40, 0x00], [0x20, 0x40, 0x44, 0x3D, 0x00], [0x7F, 0x10, 0x28, 0x44, 0x00],
        [0x00, 0x41, 0x7F, 0x40, 0x00], [0x7C, 0x04, 0x18, 0x04, 0x78], [0x7C, 0x08, 0x04, 0x04, 0x78], [0x38, 0x44, 0x44, 0x44, 0x38],
        [0x7C, 0x14, 0x14, 0x14, 0x08], [0x08, 0x14, 0x14, 0x18, 0x7C], [0x7C, 0x08, 0x04, 0x04, 0x08], [0x48, 0x54, 0x54, 0x54, 0x20],
        [0x04, 0x3F, 0x44, 0x40, 0x20], [0x3C, 0x40, 0x40, 0x40, 0x3C], [0x1C, 0x20, 0x40, 0x20, 0x1C], [0x3C, 0x40, 0x30, 0x40, 0x3C],
        [0x44, 0x28, 0x10, 0x28, 0x44], [0x0C, 0x50, 0x50, 0x50, 0x3C], [0x44, 0x64, 0x54, 0x4C, 0x44], [0x00, 0x08, 0x36, 0x41, 0x00],
        [0x00, 0x00, 0x7F, 0x00, 0x00], [0x00, 0x41, 0x36, 0x08, 0x00], [0x10, 0x08, 0x08, 0x10, 0x08],
      ];

      constructor(w: number, h: number, _wire?: any, _rst?: number) {
        this._w = w || 128; this._h = h || 64; this._addr = 0x3C;
        this._buf = new Uint8Array(Math.ceil((this._w * this._h) / 8));
      }

      begin(_vcc?: number, addr?: number): boolean {
        this._addr = addr || 0x3C;
        // console.log(`[OLED] begin() called: addr=0x${this._addr.toString(16)}, ssd1306Slaves.size=${ssd1306Slaves.size}`);

        // Find the matching slave by address
        for (const [nodeId, slave] of ssd1306Slaves) {
          console.log(`[OLED] Checking slave: nodeId=${nodeId}, i2cAddress=0x${slave.i2cAddress.toString(16)}`);
          if (slave.i2cAddress === this._addr) {
            this._slave = slave;
            console.log(`[OLED] ✓ Found matching slave by address 0x${this._addr.toString(16)}`);
            break;
          }
        }

        // If only one OLED on canvas, use it regardless of address
        if (!this._slave && ssd1306Slaves.size > 0) {
          this._slave = ssd1306Slaves.values().next().value ?? null;
          console.log(`[OLED] Using first available slave (fallback)`);
        }

        if (!this._slave) {
          console.warn(`[OLED] ⚠ No physical OLED on canvas — running in virtual mode (display calls will be no-ops).`);
        }

        this._displayOn = true;
        this._buf.fill(0);
        console.log(`[OLED] Buffer initialized: ${this._buf.length} bytes`);
        this._flush();
        console.log(`[OLED] begin() complete`);
        return true;
      }
      clearDisplay() {
        this._buf.fill(0);
        // console.log(`[OLED] clearDisplay()`);
      }
      display() {
        // console.log(`[OLED] display() called — flushing ${this._buf.length} bytes to emulator`);
        this._flush();
      }
      setTextSize(s: number) { this._textsize = Math.max(1, s | 0); }
      setTextColor(c: number) { this._textcolor = c; }
      setCursor(x: number, y: number) { this._cursor_x = x | 0; this._cursor_y = y | 0; }
      setRotation(_r: number) { } invertDisplay(_i: boolean) { }
      startscrollright(_s: number, _e: number) { } stopscroll() { } dim(_d: boolean) { }
      width() { return this._w; } height() { return this._h; }

      drawPixel(x: number, y: number, color: number) {
        x = x | 0; y = y | 0;
        if (x < 0 || x >= this._w || y < 0 || y >= this._h) return;
        const idx = Math.floor(y / 8) * this._w + x;
        if (color) this._buf[idx] |= (1 << (y & 7));
        else this._buf[idx] &= ~(1 << (y & 7));
      }
      fillScreen(c: number) { this._buf.fill(c ? 0xFF : 0x00); }
      fillRect(x: number, y: number, w: number, h: number, c: number) {
        for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) this.drawPixel(i, j, c);
      }
      drawRect(x: number, y: number, w: number, h: number, c: number) {
        for (let i = x; i < x + w; i++) { this.drawPixel(i, y, c); this.drawPixel(i, y + h - 1, c); }
        for (let j = y + 1; j < y + h - 1; j++) { this.drawPixel(x, j, c); this.drawPixel(x + w - 1, j, c); }
      }
      drawCircle(x0: number, y0: number, r: number, c: number) {
        let x = r, y = 0, err = 0;
        while (x >= y) {
          [x0 + x, x0 + y, x0 - y, x0 - x].forEach((px, i) => this.drawPixel(px, y0 + [y, x, x, y][i], c));
          [x0 - x, x0 - y, x0 + y, x0 + x].forEach((px, i) => this.drawPixel(px, y0 - [y, x, x, y][i], c));
          y++; err += 1 + 2 * y;
          if (2 * (err - x) + 1 > 0) { x--; err += 1 - 2 * x; }
        }
      }
      fillCircle(x0: number, y0: number, r: number, c: number) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) this.drawPixel(x0 + dx, y0 + dy, c);
      }
      drawLine(x0: number, y0: number, x1: number, y1: number, c: number) {
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        for (; ;) { this.drawPixel(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (e2 < dx) { err += dx; y0 += sy; } }
      }
      drawBitmap(x: number, y: number, bmp: number[], w: number, h: number, c: number) {
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (bmp[Math.floor((j * w + i) / 8)] & (0x80 >> ((j * w + i) % 8))) this.drawPixel(x + i, y + j, c);
      }
      print(v: any, base?: number) {
        const s = (typeof v === 'number' && base !== undefined && base !== 10) ? (v >>> 0).toString(base).toUpperCase() : String(v);
        // console.log(`[OLED] print("${s}")`);
        this._writeStr(s);
      }
      println(v: any = '', base?: number) {
        const s = (typeof v === 'number' && base !== undefined && base !== 10) ? (v >>> 0).toString(base).toUpperCase() : String(v);
        // console.log(`[OLED] println("${s}")`);
        this._writeStr(s + '\n');
      }
      write(c: number) { this._writeChar(c); }

      private _writeStr(s: string) {
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          if (c === 10) { this._cursor_x = 0; this._cursor_y += 8 * this._textsize; }
          else this._writeChar(c);
        }
      }
      private _writeChar(c: number) {
        if (c < 32 || c > 126) return;
        const g = (RealAdafruitSSD1306 as any).FONT5X7[c - 32];
        if (!g) return;
        for (let col = 0; col < 5; col++) {
          let line = g[col];
          for (let row = 0; row < 8; row++) {
            if (line & 1) for (let sy = 0; sy < this._textsize; sy++) for (let sx = 0; sx < this._textsize; sx++)
              this.drawPixel(this._cursor_x + col * this._textsize + sx, this._cursor_y + row * this._textsize + sy, this._textcolor);
            line >>= 1;
          }
        }
        this._cursor_x += 6 * this._textsize;
        if (this._cursor_x > this._w - 6 * this._textsize) { this._cursor_x = 0; this._cursor_y += 8 * this._textsize; }
      }
      private _flush() {
        if (!this._slave) {
          return; // Virtual mode — no physical OLED to flush to
        }
        const em = this._slave.getEmulator();
        const pixBuf = em.getPixelBuffer();
        pixBuf.set(this._buf);

        // Count non-zero bytes to verify pixels were written
        let nonZero = 0;
        for (let i = 0; i < this._buf.length; i++) if (this._buf[i] !== 0) nonZero++;
        // console.log(`[OLED] _flush(): ${nonZero}/${this._buf.length} non-zero bytes → calling forceFlush(true)`);

        em.forceFlush(true);
        console.log(`[OLED] _flush() complete`);
      }
    };

    // Store for use by initTranspiled (called after syncI2CBridge)
    this._pendingLibraryClasses.set('Adafruit_SSD1306', RealAdafruitSSD1306);
    console.log(`[OLED BRIDGE] RealAdafruitSSD1306 stored in _pendingLibraryClasses`);

    // ── Inject real Keypad class ──────────────────────────────────────────────
    // Reads from KeypadEmulator which is driven by pushKeypadKey() from the UI.
    // Fixes: auto-repeat, double-print, stops after first press.
    const keypadEmulators = this.keypadEmulators;

    const RealKeypad = class {
      private _keymap: string[][];
      private _lastKey: string | null = null;
      private _emulator: any = null;

      constructor(keymap: any, _rowPins?: any, _colPins?: any, _rows?: number, _cols?: number) {
        // keymap may be a 2D array from makeKeymap or the keys array directly
        this._keymap = Array.isArray(keymap) ? keymap : [
          ['1', '2', '3', 'A'], ['4', '5', '6', 'B'], ['7', '8', '9', 'C'], ['*', '0', '#', 'D']
        ];
        // Find the first registered keypad emulator
        if (keypadEmulators.size > 0) {
          this._emulator = keypadEmulators.values().next().value;
        }
      }

      getKey(): string | null {
        // Re-find emulator if not set yet (lazy init)
        if (!this._emulator && keypadEmulators.size > 0) {
          this._emulator = keypadEmulators.values().next().value;
        }

        // Read current pressed key from emulator
        const current = this._emulator?.currentKey ?? null;
        // Edge-triggered: only return key on the transition from null → key
        // This prevents auto-repeat on every loop() frame
        if (current !== null && current !== this._lastKey) {
          this._lastKey = current;
          return current;
        }
        // Key released: reset so next press is detected
        if (current === null) {
          this._lastKey = null;
        }
        return null;
      }

      isPressed(key: string): boolean {
        const current = this._emulator?.currentKey ?? null;
        return current === key;
      }

      getState(): number { return 0; }
      addEventListener(): void { }
    };

    // makeKeymap should just return the keymap array, matching the real Arduino library
    const RealMakeKeymap = function (keymap: any) {
      return Array.isArray(keymap) ? keymap : [
        ['1', '2', '3', 'A'], ['4', '5', '6', 'B'], ['7', '8', '9', 'C'], ['*', '0', '#', 'D']
      ];
    };

    this._pendingLibraryClasses.set('Keypad', RealKeypad);
    this._pendingLibraryClasses.set('makeKeymap', RealMakeKeymap);

    // ── ILI9341 TFT emulator class ──────────────────────────────────────────────
    // Captures Adafruit_ILI9341 API calls and renders to a 240×320 RGBA buffer,
    // pushed to the component via updateNodeData — same pattern as the SSD1306 above.
    const RealAdafruitILI9341 = class {
      private _w = 240;
      private _h = 320;
      private _rotation = 0;
      private _pixels: Uint8ClampedArray;  // RGBA flat buffer (240*320*4)
      private _cursor_x = 0;
      private _cursor_y = 0;
      private _textsize = 1;
      private _textcolor = 0xFFFF; // white RGB565
      private _nodeId: string | null = null;
      private _pendingFlushFrame: number | null = null;


      private static readonly FONT5X7: number[][] = [
        [0x00, 0x00, 0x00, 0x00, 0x00], [0x00, 0x00, 0x5F, 0x00, 0x00], [0x00, 0x07, 0x00, 0x07, 0x00], [0x14, 0x7F, 0x14, 0x7F, 0x14],
        [0x24, 0x2A, 0x7F, 0x2A, 0x12], [0x23, 0x13, 0x08, 0x64, 0x62], [0x36, 0x49, 0x55, 0x22, 0x50], [0x00, 0x05, 0x03, 0x00, 0x00],
        [0x00, 0x1C, 0x22, 0x41, 0x00], [0x00, 0x41, 0x22, 0x1C, 0x00], [0x14, 0x08, 0x3E, 0x08, 0x14], [0x08, 0x08, 0x3E, 0x08, 0x08],
        [0x00, 0x50, 0x30, 0x00, 0x00], [0x08, 0x08, 0x08, 0x08, 0x08], [0x00, 0x60, 0x60, 0x00, 0x00], [0x20, 0x10, 0x08, 0x04, 0x02],
        [0x3E, 0x51, 0x49, 0x45, 0x3E], [0x00, 0x42, 0x7F, 0x40, 0x00], [0x42, 0x61, 0x51, 0x49, 0x46], [0x21, 0x41, 0x45, 0x4B, 0x31],
        [0x18, 0x14, 0x12, 0x7F, 0x10], [0x27, 0x45, 0x45, 0x45, 0x39], [0x3C, 0x4A, 0x49, 0x49, 0x30], [0x01, 0x71, 0x09, 0x05, 0x03],
        [0x36, 0x49, 0x49, 0x49, 0x36], [0x06, 0x49, 0x49, 0x29, 0x1E], [0x00, 0x36, 0x36, 0x00, 0x00], [0x00, 0x56, 0x36, 0x00, 0x00],
        [0x08, 0x14, 0x22, 0x41, 0x00], [0x14, 0x14, 0x14, 0x14, 0x14], [0x00, 0x41, 0x22, 0x14, 0x08], [0x02, 0x01, 0x51, 0x09, 0x06],
        [0x32, 0x49, 0x79, 0x41, 0x3E], [0x7E, 0x11, 0x11, 0x11, 0x7E], [0x7F, 0x49, 0x49, 0x49, 0x36], [0x3E, 0x41, 0x41, 0x41, 0x22],
        [0x7F, 0x41, 0x41, 0x22, 0x1C], [0x7F, 0x49, 0x49, 0x49, 0x41], [0x7F, 0x09, 0x09, 0x09, 0x01], [0x3E, 0x41, 0x49, 0x49, 0x7A],
        [0x7F, 0x08, 0x08, 0x08, 0x7F], [0x00, 0x41, 0x7F, 0x41, 0x00], [0x20, 0x40, 0x41, 0x3F, 0x01], [0x7F, 0x08, 0x14, 0x22, 0x41],
        [0x7F, 0x40, 0x40, 0x40, 0x40], [0x7F, 0x02, 0x0C, 0x02, 0x7F], [0x7F, 0x04, 0x08, 0x10, 0x7F], [0x3E, 0x41, 0x41, 0x41, 0x3E],
        [0x7F, 0x09, 0x09, 0x09, 0x06], [0x3E, 0x41, 0x51, 0x21, 0x5E], [0x7F, 0x09, 0x19, 0x29, 0x46], [0x46, 0x49, 0x49, 0x49, 0x31],
        [0x01, 0x01, 0x7F, 0x01, 0x01], [0x3F, 0x40, 0x40, 0x40, 0x3F], [0x1F, 0x20, 0x40, 0x20, 0x1F], [0x3F, 0x40, 0x38, 0x40, 0x3F],
        [0x63, 0x14, 0x08, 0x14, 0x63], [0x07, 0x08, 0x70, 0x08, 0x07], [0x61, 0x51, 0x49, 0x45, 0x43], [0x00, 0x7F, 0x41, 0x41, 0x00],
        [0x02, 0x04, 0x08, 0x10, 0x20], [0x00, 0x41, 0x41, 0x7F, 0x00], [0x04, 0x02, 0x01, 0x02, 0x04], [0x40, 0x40, 0x40, 0x40, 0x40],
        [0x00, 0x01, 0x02, 0x04, 0x00], [0x20, 0x54, 0x54, 0x54, 0x78], [0x7F, 0x48, 0x44, 0x44, 0x38], [0x38, 0x44, 0x44, 0x44, 0x20],
        [0x38, 0x44, 0x44, 0x48, 0x7F], [0x38, 0x54, 0x54, 0x54, 0x18], [0x08, 0x7E, 0x09, 0x01, 0x02], [0x0C, 0x52, 0x52, 0x52, 0x3E],
        [0x7F, 0x08, 0x04, 0x04, 0x78], [0x00, 0x44, 0x7D, 0x40, 0x00], [0x20, 0x40, 0x44, 0x3D, 0x00], [0x7F, 0x10, 0x28, 0x44, 0x00],
        [0x00, 0x41, 0x7F, 0x40, 0x00], [0x7C, 0x04, 0x18, 0x04, 0x78], [0x7C, 0x08, 0x04, 0x04, 0x78], [0x38, 0x44, 0x44, 0x44, 0x38],
        [0x7C, 0x14, 0x14, 0x14, 0x08], [0x08, 0x14, 0x14, 0x18, 0x7C], [0x7C, 0x08, 0x04, 0x04, 0x08], [0x48, 0x54, 0x54, 0x54, 0x20],
        [0x04, 0x3F, 0x44, 0x40, 0x20], [0x3C, 0x40, 0x40, 0x40, 0x3C], [0x1C, 0x20, 0x40, 0x20, 0x1C], [0x3C, 0x40, 0x30, 0x40, 0x3C],
        [0x44, 0x28, 0x10, 0x28, 0x44], [0x0C, 0x50, 0x50, 0x50, 0x3C], [0x44, 0x64, 0x54, 0x4C, 0x44], [0x00, 0x08, 0x36, 0x41, 0x00],
        [0x00, 0x00, 0x7F, 0x00, 0x00], [0x00, 0x41, 0x36, 0x08, 0x00], [0x10, 0x08, 0x08, 0x10, 0x08],
      ];

      // Arduino-style value-to-string formatting (handles HEX, OCT, BIN, DEC bases)
      private static _formatValue(v: any, base?: number): string {
        if (typeof v === 'number' && base !== undefined && base !== 10) {
          return (v >>> 0).toString(base).toUpperCase();
        }
        return String(v);
      }

      constructor(_cs?: number, _dc?: number, _mosi?: number, _sck?: number, _rst?: number, _miso?: number) {
        this._pixels = new Uint8ClampedArray(240 * 320 * 4);
        for (let i = 3; i < this._pixels.length; i += 4) this._pixels[i] = 255;

        try {
          const { nodes } = useForgeStore.getState();
          for (const n of nodes) {
            if (n.data?.type === 'ili9341' || n.data?.type === 'ili9341-touch') {
              this._nodeId = n.id;
              console.log(`[TFT] constructor: found ILI9341 node ${this._nodeId}`);
              break;
            }
          }
        } catch (e) { /* store not available */ }
      }

      begin(_freq?: number) {
        console.log(`[TFT] begin()`);
        this.fillScreen(0x0000);
      }

      // setRotation stores rotation value and adjusts width()/height() return values
      // for API compatibility, but all pixel rendering always uses 240×320 native buffer.
      setRotation(r: number) {
        this._rotation = r & 3;
        // width()/height() report rotated dimensions to the sketch
        // but internal drawing always uses native 240×320
      }

      width() { return (this._rotation & 1) ? 320 : 240; }
      height() { return (this._rotation & 1) ? 240 : 320; }
      invertDisplay(_i: boolean) { }

      private _rgb565toRGBA(c: number): [number, number, number] {
        const r = ((c >> 11) & 0x1F) * 255 / 31;
        const g = ((c >> 5) & 0x3F) * 255 / 63;
        const b = (c & 0x1F) * 255 / 31;
        return [r | 0, g | 0, b | 0];
      }

      // Always draw in native 240×320 portrait coordinates — no rotation mapping.
      // This ensures characters render upright and text flows left-to-right.
      drawPixel(x: number, y: number, color: number) {
        x = x | 0; y = y | 0;
        if (x < 0 || x >= 240 || y < 0 || y >= 320) return;
        const [r, g, b] = this._rgb565toRGBA(color);
        const idx = (y * 240 + x) * 4;
        this._pixels[idx] = r; this._pixels[idx + 1] = g; this._pixels[idx + 2] = b; this._pixels[idx + 3] = 255;
      }

      fillScreen(color: number) {
        const [r, g, b] = this._rgb565toRGBA(color);
        for (let i = 0; i < this._pixels.length; i += 4) {
          this._pixels[i] = r; this._pixels[i + 1] = g; this._pixels[i + 2] = b; this._pixels[i + 3] = 255;
        }
        this._flush();
      }

      fillRect(x: number, y: number, w: number, h: number, c: number) {
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.drawPixel(i, j, c);
        this._flush();
      }
      drawRect(x: number, y: number, w: number, h: number, c: number) {
        this.drawLine(x, y, x + w - 1, y, c);
        this.drawLine(x, y + h - 1, x + w - 1, y + h - 1, c);
        this.drawLine(x, y, x, y + h - 1, c);
        this.drawLine(x + w - 1, y, x + w - 1, y + h - 1, c);
      }
      drawLine(x0: number, y0: number, x1: number, y1: number, c: number) {
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        for (; ;) { this.drawPixel(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (e2 < dx) { err += dx; y0 += sy; } }
      }
      drawCircle(x0: number, y0: number, r: number, c: number) {
        let x = r, y = 0, err = 0;
        while (x >= y) {
          this.drawPixel(x0 + x, y0 + y, c); this.drawPixel(x0 + y, y0 + x, c);
          this.drawPixel(x0 - y, y0 + x, c); this.drawPixel(x0 - x, y0 + y, c);
          this.drawPixel(x0 - x, y0 - y, c); this.drawPixel(x0 - y, y0 - x, c);
          this.drawPixel(x0 + y, y0 - x, c); this.drawPixel(x0 + x, y0 - y, c);
          y++; err += 1 + 2 * y;
          if (2 * (err - x) + 1 > 0) { x--; err += 1 - 2 * x; }
        }
      }
      fillCircle(x0: number, y0: number, r: number, c: number) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) this.drawPixel(x0 + dx, y0 + dy, c);
        this._flush();
      }
      drawTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number) {
        this.drawLine(x0, y0, x1, y1, c); this.drawLine(x1, y1, x2, y2, c); this.drawLine(x2, y2, x0, y0, c);
      }
      fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number) {
        const pts = [[x0, y0], [x1, y1], [x2, y2]].sort((a, b) => a[1] - b[1]);
        for (let y = pts[0][1]; y <= pts[2][1]; y++) {
          let xa = pts[0][1] !== pts[2][1] ? pts[0][0] + (y - pts[0][1]) * (pts[2][0] - pts[0][0]) / (pts[2][1] - pts[0][1]) : pts[0][0];
          let xb: number;
          if (y < pts[1][1]) xb = pts[0][1] !== pts[1][1] ? pts[0][0] + (y - pts[0][1]) * (pts[1][0] - pts[0][0]) / (pts[1][1] - pts[0][1]) : pts[0][0];
          else xb = pts[1][1] !== pts[2][1] ? pts[1][0] + (y - pts[1][1]) * (pts[2][0] - pts[1][0]) / (pts[2][1] - pts[1][1]) : pts[1][0];
          if (xa > xb) { const t = xa; xa = xb; xb = t; }
          for (let x = Math.ceil(xa); x <= Math.floor(xb); x++) this.drawPixel(x, y, c);
        }
        this._flush();
      }
      drawRoundRect(x: number, y: number, w: number, h: number, _r: number, c: number) { this.drawRect(x, y, w, h, c); }
      fillRoundRect(x: number, y: number, w: number, h: number, _r: number, c: number) { this.fillRect(x, y, w, h, c); }

      // ── Text rendering ───────────────────────────────────────────────
      setCursor(x: number, y: number) { this._cursor_x = x | 0; this._cursor_y = y | 0; }
      setTextColor(c: number, _bg?: number) { this._textcolor = c; }
      setTextSize(s: number) { this._textsize = Math.max(1, s | 0); }

      print(v: any, base?: number) {
        this._writeStr((RealAdafruitILI9341 as any)._formatValue(v, base));
        this._flush();
      }
      println(v: any = '', base?: number) {
        this._writeStr((RealAdafruitILI9341 as any)._formatValue(v, base) + '\n');
        this._flush();
      }

      private _writeStr(s: string) {
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          if (c === 10) { this._cursor_x = 0; this._cursor_y += 8 * this._textsize; }
          else this._writeChar(c);
        }
      }
      private _writeChar(c: number) {
        if (c < 32 || c > 126) return;
        const g = (RealAdafruitILI9341 as any).FONT5X7[c - 32];
        if (!g) return;
        for (let col = 0; col < 5; col++) {
          let line = g[col];
          for (let row = 0; row < 8; row++) {
            if (line & 1) for (let sy = 0; sy < this._textsize; sy++) for (let sx = 0; sx < this._textsize; sx++)
              this.drawPixel(this._cursor_x + col * this._textsize + sx, this._cursor_y + row * this._textsize + sy, this._textcolor);
            line >>= 1;
          }
        }
        this._cursor_x += 6 * this._textsize;
        if (this._cursor_x > this._w - 6 * this._textsize) { this._cursor_x = 0; this._cursor_y += 8 * this._textsize; }
      }

      private _flush() {
        if (!this._nodeId) return;

        // Try direct DOM rendering to completely bypass React Flow & Zustand state updates
        const directEl = (circuitEngine as any)._displayElements?.get(this._nodeId);
        if (directEl) {
          try {
            if (directEl.imageData) {
              // Write raw pixel buffer directly into the Web Component's canvas image buffer in place
              const targetData = directEl.imageData.data;
              targetData.set(this._pixels);
              directEl.redraw();
            } else {
              directEl.imageData = new ImageData(new Uint8ClampedArray(this._pixels), 240, 320);
            }
          } catch (e) {
            console.warn('[TFT] direct draw failed:', e);
          }
          return;
        }

        if (this._pendingFlushFrame !== null) return;
        this._pendingFlushFrame = requestAnimationFrame(() => {
          this._pendingFlushFrame = null;
          try {
            const imageData = new ImageData(new Uint8ClampedArray(this._pixels), 240, 320);
            const { updateNodeData } = useForgeStore.getState();
            updateNodeData(this._nodeId!, { tftImageData: imageData, tftRotation: this._rotation });
          } catch (e) {
            console.warn('[TFT] _flush failed:', e);
          }
        });
      }


    };

    const RealTS_Point = class {
      x: number;
      y: number;
      z: number;
      constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
    };

    const RealAdafruit_FT6206 = class {
      private _nodeId: string | null = null;
      private _threshold = 128;
      private _lastPoint: any = null;

      constructor() {
        this._lastPoint = new RealTS_Point(0, 0, 0);
        this._ensureNodeId();
      }

      private _ensureNodeId() {
        if (this._nodeId) return;
        try {
          const { nodes } = useForgeStore.getState();
          for (const n of nodes) {
            if (n.data?.type === 'ili9341-touch') {
              this._nodeId = n.id;
              console.log(`[FT6206] constructor/lazy: found touch display node ${this._nodeId}`);
              break;
            }
          }
        } catch (e) { }
      }

      begin(thresh = 128) {
        this._ensureNodeId();
        this._threshold = thresh;
        console.log(`[FT6206] begin(threshold=${this._threshold}) nodeId=${this._nodeId}`);
        return true;
      }

      touched(): number {
        this._ensureNodeId();
        if (!this._nodeId) return 0;

        // Check if there are points in the queue
        const queue = (circuitEngine as any).touchQueues?.get(this._nodeId);
        if (queue && queue.length > 0) {
          if (!queue[0].touched) {
            queue.shift(); // Remove release event so subsequent touch drags can be processed
            return 0;
          }
          return 1;
        }

        try {
          const { nodes } = useForgeStore.getState();
          const node = nodes.find(n => n.id === this._nodeId);
          return node?.data?.sensorValues?.touched ? 1 : 0;
        } catch (e) {
          return 0;
        }
      }

      getPoint() {
        this._ensureNodeId();
        if (!this._nodeId) return new RealTS_Point(0, 0, 0);

        // Consume from the queue if available
        const queue = (circuitEngine as any).touchQueues?.get(this._nodeId);
        if (queue && queue.length > 0) {
          const pt = queue.shift()!;
          if (!pt.touched) {
            return new RealTS_Point(0, 0, 0);
          }
          const rawX = 239 - pt.x;
          const rawY = 319 - pt.y;
          this._lastPoint = new RealTS_Point(rawX, rawY, 1);
          return this._lastPoint;
        }

        try {
          const { nodes } = useForgeStore.getState();
          const node = nodes.find(n => n.id === this._nodeId);
          if (!node || !node.data?.sensorValues?.touched) {
            return new RealTS_Point(0, 0, 0);
          }

          const tx = node.data.sensorValues.touchX ?? 0;
          const ty = node.data.sensorValues.touchY ?? 0;

          // Map raw coordinates to bottom-right origin (0-239, 0-319)
          const rawX = 239 - tx;
          const rawY = 319 - ty;

          this._lastPoint = new RealTS_Point(rawX, rawY, 1);
          return this._lastPoint;
        } catch (e) {
          return new RealTS_Point(0, 0, 0);
        }
      }
    };

    const RealTFT_eSPI = class extends RealAdafruitILI9341 {
      init() {
        this.begin();
      }

      drawString(str: any, x: number, y: number, font?: number) {
        const prevX = (this as any)._cursor_x;
        const prevY = (this as any)._cursor_y;
        const prevSize = (this as any)._textsize;

        (this as any)._cursor_x = x | 0;
        (this as any)._cursor_y = y | 0;
        if (font !== undefined) {
          (this as any)._textsize = Math.max(1, font | 0);
        }

        (this as any)._writeStr(String(str));
        (this as any)._flush();

        (this as any)._cursor_x = prevX;
        (this as any)._cursor_y = prevY;
        (this as any)._textsize = prevSize;
      }

      drawCentreString(str: any, x: number, y: number, font?: number) {
        const s = String(str);
        const size = font !== undefined ? Math.max(1, font | 0) : (this as any)._textsize;
        const w = s.length * 6 * size;
        this.drawString(s, x - (w / 2), y, font);
      }

      drawRightString(str: any, x: number, y: number, font?: number) {
        const s = String(str);
        const size = font !== undefined ? Math.max(1, font | 0) : (this as any)._textsize;
        const w = s.length * 6 * size;
        this.drawString(s, x - w, y, font);
      }

      drawNumber(num: number, x: number, y: number, font?: number) {
        this.drawString(String(num), x, y, font);
      }

      drawFloat(val: number, decimal: number, x: number, y: number, font?: number) {
        this.drawString(val.toFixed(decimal), x, y, font);
      }
    };

    this._pendingLibraryClasses.set('Adafruit_ILI9341', RealAdafruitILI9341);
    this._pendingLibraryClasses.set('TFT_eSPI', RealTFT_eSPI);
    this._pendingLibraryClasses.set('Adafruit_FT6206', RealAdafruit_FT6206);
    this._pendingLibraryClasses.set('TS_Point', RealTS_Point);
    console.log(`[TFT BRIDGE] RealAdafruitILI9341 + RealTFT_eSPI + FT6206 stored in _pendingLibraryClasses`);


    // ── LiquidCrystal_I2C ────────────────────────────────────────────────────────
    // IMPORTANT: We write directly to the HD44780 emulator's internal fields
    // (displayMemory, ddramAddress) instead of going through processPulse(),
    // because processPulse uses 4-bit nibble collection mode which garbles
    // raw 8-bit character codes sent from the transpiled JS path.
    const lcdEmulatorsMap = this.lcdEmulators;
    const RealLiquidCrystal_I2C = class {
      private _nodeId: string | null = null;
      private _addr: number = 0x27;
      private _cols: number = 16;

      constructor(addr?: number, cols?: number, rows?: number) {
        this._addr = addr || 0x27;
        this._cols = cols || 16;
        try {
          const { nodes } = useForgeStore.getState();
          for (const n of nodes) {
            if (n.data?.type === 'lcd1602-i2c' || n.data?.type === 'lcd2004-i2c') {
              if ((n.data?.i2cAddress || 0x27) === this._addr) {
                this._nodeId = n.id;
                // Detect cols from the node type
                if (n.data?.type === 'lcd2004-i2c') this._cols = 20;
                break;
              }
            }
          }
        } catch (e) { }
      }

      private _getEmulator(): import('./HD44780').HD44780 | undefined {
        return this._nodeId ? lcdEmulatorsMap.get(this._nodeId) : undefined;
      }

      private _push() {
        if (!this._nodeId) return;
        const emu = this._getEmulator();
        if (emu) {
          useForgeStore.getState().updateNodeData(this._nodeId, { lcdState: emu.getState() });
        }
      }

      init() { this.begin(); }
      begin() {
        const emu = this._getEmulator();
        if (emu) {
          emu.displayOn = true;
          emu.backlight = true;
          emu.displayMemory.fill(32);
          (emu as any).ddramAddress = 0;
          emu.cursorX = 0;
          emu.cursorY = 0;
          this._push();
        }
      }

      print(str: any) {
        const emu = this._getEmulator();
        if (!emu) return;
        const s = String(str);
        const cols = this._cols;
        for (let i = 0; i < s.length; i++) {
          const addr = (emu as any).ddramAddress as number;
          // Map DDRAM address → row/col → memory index
          let row: number, col: number;
          if (addr < 0x40) {
            if (addr < cols) { row = 0; col = addr; }
            else { row = 2; col = addr - cols; }
          } else {
            const off = addr - 0x40;
            if (off < cols) { row = 1; col = off; }
            else { row = 3; col = off - cols; }
          }
          const memIdx = row * cols + col;
          if (memIdx >= 0 && memIdx < emu.displayMemory.length) {
            emu.displayMemory[memIdx] = s.charCodeAt(i);
          }
          // Auto-increment DDRAM address
          (emu as any).ddramAddress = addr + 1;
        }
        // Update cursor coords
        const finalAddr = (emu as any).ddramAddress as number;
        if (finalAddr < 0x40) {
          emu.cursorX = finalAddr < cols ? finalAddr : finalAddr - cols;
          emu.cursorY = finalAddr < cols ? 0 : 2;
        } else {
          const off = finalAddr - 0x40;
          emu.cursorX = off < cols ? off : off - cols;
          emu.cursorY = off < cols ? 1 : 3;
        }
        this._push();
      }

      println(str: any) {
        this.print(String(str));
      }

      setCursor(col: number, row: number) {
        const emu = this._getEmulator();
        if (!emu) return;
        const rowOffsets = [0x00, 0x40, 0x14, 0x54];
        (emu as any).ddramAddress = col + (rowOffsets[row] || 0);
        emu.cursorX = col;
        emu.cursorY = row;
        this._push();
      }

      clear() {
        const emu = this._getEmulator();
        if (!emu) return;
        emu.displayMemory.fill(32);
        (emu as any).ddramAddress = 0;
        emu.cursorX = 0;
        emu.cursorY = 0;
        this._push();
      }

      backlight() {
        const emu = this._getEmulator();
        if (emu) { emu.backlight = true; this._push(); }
      }

      noBacklight() {
        const emu = this._getEmulator();
        if (emu) { emu.backlight = false; this._push(); }
      }
    };

    this._pendingLibraryClasses.set('LiquidCrystal_I2C', RealLiquidCrystal_I2C);
    console.log(`[LCD BRIDGE] RealLiquidCrystal_I2C stored in _pendingLibraryClasses`);

    const irRemote = createIRremoteClass(this);
    this._pendingLibraryClasses.set('IRrecv', irRemote.IRrecv);
    this._pendingLibraryClasses.set('decode_results', irRemote.decode_results);
    this._pendingLibraryClasses.set('IrReceiver', irRemote.IrReceiver);


    // If runtime already exists (re-sync case), inject immediately
    if (esp32Runtime) {
      esp32Runtime.injectLibraryClass('Adafruit_SSD1306', RealAdafruitSSD1306);
      esp32Runtime.injectLibraryClass('Adafruit_ILI9341', RealAdafruitILI9341);
      esp32Runtime.injectLibraryClass('TFT_eSPI', RealTFT_eSPI);
      esp32Runtime.injectLibraryClass('LiquidCrystal_I2C', RealLiquidCrystal_I2C);
      esp32Runtime.injectLibraryClass('Adafruit_FT6206', RealAdafruit_FT6206);
      esp32Runtime.injectLibraryClass('TS_Point', RealTS_Point);
      esp32Runtime.injectLibraryClass('IRrecv', irRemote.IRrecv);
      esp32Runtime.injectLibraryClass('decode_results', irRemote.decode_results);
      esp32Runtime.injectLibraryClass('IrReceiver', irRemote.IrReceiver);
      this._wireI2CBus(esp32Runtime);
      console.log('[OLED/LCD BRIDGE] ✓ Runtime exists — injected SSD1306 + ILI9341 + TFT_eSPI + Touch + LCD_I2C + IRremote + wired I2C bus');

    } else {
      console.log('[OLED/LCD BRIDGE] Runtime not yet created — classes queued for initTranspiled()');
    }
  }

  /** Called by ESP32C3SimulationRunner.initTranspiled() to get pending library classes */
  public getPendingLibraryClasses(): Map<string, any> {
    return this._pendingLibraryClasses;
  }

  /** Wire the I2C bus to an ArduinoRuntime instance */
  private _wireI2CBus(runtime: import('../esp32c3/ArduinoRuntime').ArduinoRuntime) {
    const bus = this.i2cBusManager;
    let _rxBuf: number[] = [], _rxPos = 0;
    console.log(`[OLED BRIDGE] _wireI2CBus: wiring I2C bus. Registered slaves: ${[...bus['slaves']?.keys() ?? []].map((a: number) => '0x' + a.toString(16)).join(', ')}`);
    runtime.setI2CBus({
      startTransmission(addr: number) {
        console.log(`[I2C WIRE] beginTransmission(0x${addr.toString(16)})`);
        bus['activeSlave'] = null;
        const slave = bus['slaves']?.get(addr) ?? null;
        if (slave) {
          slave.onStart(false);
          slave.onConnect(true);
          bus['activeSlave'] = slave;
          console.log(`[I2C WIRE] ✓ Connected to slave at 0x${addr.toString(16)}`);
        } else {
          console.warn(`[I2C WIRE] ✗ No slave at 0x${addr.toString(16)}`);
        }
      },
      write(val: number) { const s = bus['activeSlave']; if (s) s.onWrite(val & 0xFF); },
      endTransmission() {
        const s = bus['activeSlave'];
        if (s) s.onStop();
        bus['activeSlave'] = null;
      },
      requestFrom(addr: number, qty: number) {
        _rxBuf = []; _rxPos = 0;
        const slave = bus['slaves']?.get(addr) ?? null;
        if (slave) { slave.onStart(false); slave.onConnect(false); for (let i = 0; i < qty; i++) _rxBuf.push(slave.onRead(i < qty - 1)); slave.onStop(); }
      },
      available() { return _rxBuf.length - _rxPos; },
      read() { return _rxPos < _rxBuf.length ? _rxBuf[_rxPos++] : 0; },
    });
    console.log('[OLED BRIDGE] ✓ Wire → I2CBusManager connected');
  }

  /**
   * Called whenever wires are drawn/removed. Rebuilds the routing table.
   */
  public syncCircuitGraph() {
    console.log('[FORGE CIRCUIT] syncCircuitGraph triggered. Re-evaluating electrical routing table...');
    // 1. Clear all old AVR listeners hooked by the circuit engine
    this.activeSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.activeSubscriptions.clear();
    this.lcdEmulators.clear();
    this.peripheralPinBuffers.clear();
    this.i2cBusManager.clear();
    this.dhtEmulators.clear();
    this.neoPixelEmulators.clear();
    this.stepperEmulators.forEach(e => e.destroy());
    this.stepperEmulators.clear();
    this.unifiedStepperEmulators.clear();
    this.ili9341Slaves.forEach(s => s.detach());
    this.ili9341Slaves.clear();

    this.ft6206Slaves.clear();
    this.mpu6050Slaves.clear();
    this.ssd1306Slaves.clear();
    this.keypadEmulators.clear();
    this.rotaryDialerEmulators.clear();
    this.tiltSwitchEmulators.clear();
    this.rotaryEncoderEmulators.clear();
    this.hx711Emulators.clear();
    this.touchQueues.clear();
    if (this.stepperIdleRaf !== null) {
      cancelAnimationFrame(this.stepperIdleRaf);
      this.stepperIdleRaf = null;
    }
    // Cancel all heart-beat animation timers
    this.heartBeatTimers.forEach(id => cancelAnimationFrame(id));
    this.heartBeatTimers.clear();

    const { nodes, edges, updateNodeData } = useForgeStore.getState();
    const currentStateStore = useForgeStore.getState();

    // 2.1 Register I2C Slaves and Reset States
    nodes.forEach(node => {
      // Reset damaged/visual states on sync (e.g. simulation start)
      if (node.data?.damaged || node.data?.pinStates) {
        updateNodeData(node.id, { damaged: false, pinStates: {} });
      }

      // Skip emulator registration for peripherals with no wiring
      // Components must be wired to the ESP32/board to function
      const boardTypes = ['arduino-uno', 'esp32-c3', 'esp32', 'arduino-nano', 'arduino-mega', 'attiny85'];
      const isBoard = boardTypes.includes(node.data?.type);
      const isPowerSource = node.data?.type === 'battery-12v';
      if (!isBoard && !isPowerSource && !edges.some(e => e.source === node.id || e.target === node.id)) return;

      if (node.data?.type === 'lcd1602' || node.data?.type === 'lcd2004' ||
        node.data?.type === 'lcd1602-i2c' || node.data?.type === 'lcd2004-i2c') {
        // Create an emulator for the display
        const isWide = node.data?.type === 'lcd2004' || node.data?.type === 'lcd2004-i2c';
        const cols = isWide ? 20 : 16;
        const rows = isWide ? 4 : 2;
        const emulator = new HD44780(cols, rows);
        this.lcdEmulators.set(node.id, emulator);

        // I2C variants always use the PCF8574 backpack at 0x27
        const isI2C = node.data?.type === 'lcd1602-i2c' || node.data?.type === 'lcd2004-i2c';
        const i2cAddr = isI2C ? (node.data?.i2cAddress ?? 0x27) : node.data?.i2cAddress;
        if (i2cAddr) {
          const backpack = new PCF8574(i2cAddr, emulator, (state) => {
            updateNodeData(node.id, { lcdState: state });
          });
          this.i2cBusManager.registerSlave(backpack);
        }
      }

      // Register SSD1306 OLED as I2C slave (default address 0x3C)
      if (node.data?.type === 'ssd1306') {
        const i2cAddr = node.data?.i2cAddress ?? 0x3C;
        console.log(`[OLED] Registering SSD1306 slave: nodeId=${node.id}, addr=0x${i2cAddr.toString(16)}`);
        const slave = new SSD1306I2CSlave(i2cAddr, (pixels, displayOn) => {
          console.log(`[OLED] onUpdate callback fired! displayOn=${displayOn}, pixels.length=${pixels.length}`);
          // Convert the page-addressed pixel buffer to RGBA ImageData
          const imageData = new ImageData(128, 64);
          let litPixels = 0;
          for (let page = 0; page < 8; page++) {
            for (let col = 0; col < 128; col++) {
              const byte = pixels[page * 128 + col];
              for (let bit = 0; bit < 8; bit++) {
                const row = page * 8 + bit;
                const idx = (row * 128 + col) * 4;
                const on = displayOn && ((byte >> bit) & 1) === 1;
                if (on) litPixels++;
                imageData.data[idx] = on ? 255 : 0;   // R
                imageData.data[idx + 1] = on ? 255 : 0;   // G
                imageData.data[idx + 2] = on ? 255 : 0;   // B
                imageData.data[idx + 3] = 255;             // A
              }
            }
          }
          console.log(`[OLED] ImageData created: ${litPixels} lit pixels → calling updateNodeData for node ${node.id}`);
          updateNodeData(node.id, { oledImageData: imageData });
          console.log(`[OLED] updateNodeData called ✓`);
        });
        this.i2cBusManager.registerSlave(slave);
        this.ssd1306Slaves.set(node.id, slave);
        console.log(`[OLED] SSD1306 slave registered. Total slaves: ${this.ssd1306Slaves.size}`);
      }

      // Register membrane-keypad emulator
      if (node.data?.type === 'membrane-keypad') {
        const nodeId = node.id;

        // Find row and column pins from connections
        const keypadEdges = edges.filter(e => e.source === nodeId || e.target === nodeId);

        const rowPins: string[] = new Array(4).fill('');
        const colPins: string[] = new Array(4).fill('');

        keypadEdges.forEach(edge => {
          const isOutput = edge.source === nodeId;
          const keypadPin = isOutput ? edge.sourceHandle : edge.targetHandle;
          const boardPin = (isOutput ? edge.targetHandle : edge.sourceHandle)?.replace(/__target$/, '') ?? '';

          if (!keypadPin || !boardPin) return;
          const cleanKeypadPin = keypadPin.replace(/__target$/, '');

          // Map board pin to appropriate pin name (AVR or ESP32)
          const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
          const otherNode = nodes.find(n => n.id === otherNodeId);
          const isESP32 = otherNode?.data?.type === 'esp32-c3' || otherNode?.data?.type === 'esp32';
          const mapping = simulationRunner.convertPin(boardPin, isESP32);
          if (!mapping) return;
          const avrPin = mapping.avrPin;

          if (cleanKeypadPin.startsWith('R')) {
            const rowIdx = parseInt(cleanKeypadPin.replace('R', ''), 10) - 1;
            if (rowIdx >= 0 && rowIdx < 4) {
              rowPins[rowIdx] = avrPin;
            }
          } else if (cleanKeypadPin.startsWith('C')) {
            const colIdx = parseInt(cleanKeypadPin.replace('C', ''), 10) - 1;
            if (colIdx >= 0 && colIdx < 4) {
              colPins[colIdx] = avrPin;
            }
          }
        });

        const emulator = new KeypadEmulator(
          rowPins, colPins,
          (pin: string, high: boolean) => {
            simulationRunner.setVirtualInput(pin, high);
          },
          (pin: string) => simulationRunner.isPinOutput(pin),
          (pin: string) => simulationRunner.getPinState(pin),
          () => simulationRunner.getCycles(),
          () => simulationRunner.getFrequency()
        );
        emulator.pressKey(null); // Initialize columns to HIGH (pull-up)
        this.keypadEmulators.set(nodeId, emulator);
      }

      // Register rotary-dialer emulator
      if (node.data?.type === 'rotary-dialer') {
        const nodeId = node.id;
        const emulator = new RotaryDialerEmulator(
          'DIAL', 'PULSE',
          (pin: string, high: boolean) => {
            this.pushInputSignal(nodeId, pin, high);
          }
        );
        this.rotaryDialerEmulators.set(nodeId, emulator);
        console.log(`[ROTARY] Registered rotary-dialer emulator: nodeId=${nodeId}`);
      }

      // Register tilt-switch emulator
      if (node.data?.type === 'tilt-switch') {
        const nodeId = node.id;
        const emulator = new TiltSwitchEmulator(
          'OUT',
          (pin: string, high: boolean) => {
            this.pushInputSignal(nodeId, pin, high);
          }
        );
        this.tiltSwitchEmulators.set(nodeId, emulator);

        // Set initial tilt state from node data
        const initialTilted = node.data?.sensorValues?.tilted ?? false;
        emulator.setTilted(initialTilted);

        console.log(`[TILT] Registered tilt-switch emulator: nodeId=${nodeId}, initial state=${initialTilted ? 'TILTED' : 'UPRIGHT'}`);
      }

      // Register KY-040 rotary encoder emulator
      if (node.data?.type === 'ky-040') {
        const nodeId = node.id;
        const emulator = new RotaryEncoderEmulator(
          'CLK', 'DT',
          (pin: string, high: boolean) => {
            this.pushInputSignal(nodeId, pin, high);
          }
        );
        this.rotaryEncoderEmulators.set(nodeId, emulator);

        // Initialize SW button pin to HIGH (pull-up state) immediately
        this.pushInputSignal(nodeId, 'SW', true);
        console.log(`[KY-040] Registered rotary encoder emulator: nodeId=${nodeId}, SW initialized to HIGH`);
      }

      // Register ILI9341 TFT as SPI peripheral
      // The slave is created here; pin listeners (D/C, CS) are wired in the edge-scan loop below.
      if (node.data?.type === 'ili9341') {
        const nodeId = node.id;
        const spi = simulationRunner.SPI;
        if (spi) {
          const slave = new ILI9341SPISlave(spi, (pixels, displayOn) => {
            // Build an ImageData from the RGBA pixel buffer and push to the node
            const imageData = new ImageData(new Uint8ClampedArray(pixels), 240, 320);
            updateNodeData(nodeId, { tftImageData: imageData, tftDisplayOn: displayOn });
          });
          slave.attach();
          this.ili9341Slaves.set(nodeId, slave);
          console.log(`[FORGE CIRCUIT] ILI9341 (${nodeId}) registered on SPI bus`);
        } else {
          console.warn(`[FORGE CIRCUIT] ILI9341 (${nodeId}): SPI bus not available on this board`);
        }
      }

      // Register ILI9341 TFT + FT6206 Touch display SPI part
      if (node.data?.type === 'ili9341-touch') {
        const nodeId = node.id;
        const spi = simulationRunner.SPI;
        if (spi) {
          const slave = new ILI9341SPISlave(spi, (pixels, displayOn) => {
            const imageData = new ImageData(new Uint8ClampedArray(pixels), 240, 320);
            updateNodeData(nodeId, { tftImageData: imageData, tftDisplayOn: displayOn });
          });
          slave.attach();
          this.ili9341Slaves.set(nodeId, slave);
          console.log(`[FORGE CIRCUIT] ILI9341-touch display (${nodeId}) registered on SPI bus`);
        } else {
          console.warn(`[FORGE CIRCUIT] ILI9341-touch (${nodeId}): SPI bus not available on this board`);
        }

        // Register FT6206 touch controller on I2C bus (address 0x38)
        const i2cAddr = 0x38;
        const touchSlave = new FT6206I2CSlave(i2cAddr, nodeId);
        this.i2cBusManager.registerSlave(touchSlave);
        this.ft6206Slaves.set(nodeId, touchSlave);
        console.log(`[FORGE CIRCUIT] FT6206 Touch (${nodeId}) registered at I2C 0x${i2cAddr.toString(16)}`);
      }

      // Register MPU6050 as I2C slave (default address 0x68, AD0=LOW)
      if (node.data?.type === 'mpu6050') {
        const nodeId = node.id;
        const i2cAddr = node.data?.i2cAddress ?? 0x68;
        const slave = new MPU6050I2CSlave(i2cAddr);

        // Push current sensor values from store into the emulator immediately
        const sv = node.data?.sensorValues;
        if (sv) {
          slave.setSensorValues({
            accelX: sv.accelX ?? 0,
            accelY: sv.accelY ?? 0,
            accelZ: sv.accelZ ?? 1,
            gyroX: sv.gyroX ?? 0,
            gyroY: sv.gyroY ?? 0,
            gyroZ: sv.gyroZ ?? 0,
            temp: sv.temp ?? 25,
          });
        }

        this.i2cBusManager.registerSlave(slave);
        this.mpu6050Slaves.set(nodeId, slave);
        console.log(`[FORGE CIRCUIT] MPU6050 (${nodeId}) registered at I2C 0x${i2cAddr.toString(16)}`);
      }

      // Register DS1307 RTC as I2C slave (default address 0x68)
      if (node.data?.type === 'ds1307') {
        const nodeId = node.id;
        const slave = new DS1307Emulator();
        this.i2cBusManager.registerSlave(slave);
        console.log(`[FORGE CIRCUIT] DS1307 (${nodeId}) registered at I2C 0x68`);
      }

      // Register HX711 Load Cell Emulator
      if (node.data?.type === 'hx711') {
        const nodeId = node.id;
        const sckWire = edges.find(e => {
          const s = e.source === nodeId && (e.sourceHandle === 'SCK' || e.sourceHandle === 'SCK__target');
          const t = e.target === nodeId && (e.targetHandle === 'SCK' || e.targetHandle === 'SCK__target');
          return s || t;
        });
        const dtWire = edges.find(e => {
          const s = e.source === nodeId && (e.sourceHandle === 'DT' || e.sourceHandle === 'DT__target');
          const t = e.target === nodeId && (e.targetHandle === 'DT' || e.targetHandle === 'DT__target');
          return s || t;
        });

        if (sckWire && dtWire) {
          const sckBoardPin = ((sckWire.source === nodeId ? sckWire.targetHandle : sckWire.sourceHandle) ?? '').replace(/__target$/, '');
          const dtBoardPin = ((dtWire.source === nodeId ? dtWire.targetHandle : dtWire.sourceHandle) ?? '').replace(/__target$/, '');

          const board = nodes.find(n =>
            n.data?.type === 'arduino-uno' ||
            n.data?.type === 'esp32-c3' ||
            n.data?.type === 'esp32'
          );
          const isESP32Board = board?.data?.type === 'esp32-c3' || board?.data?.type === 'esp32';

          const sckMapping = isESP32Board
            ? simulationRunner.convertESP32Pin(sckBoardPin)
            : simulationRunner.convertArduinoPin(sckBoardPin);
          const dtMapping = isESP32Board
            ? simulationRunner.convertESP32Pin(dtBoardPin)
            : simulationRunner.convertArduinoPin(dtBoardPin);

          if (sckMapping && dtMapping) {
            const emulator = new HX711Emulator(
              sckMapping.avrPin,
              dtMapping.avrPin,
              nodeId,
              (pin: string, high: boolean) => simulationRunner.setVirtualInput(pin, high)
            );
            this.hx711Emulators.set(nodeId, emulator);
            console.log(`[HX711] Registered emulator during syncCircuitGraph: nodeId=${nodeId}, SCK=${sckMapping.avrPin}, DT=${dtMapping.avrPin}`);
          }
        }
      }

      // Register PIR motion sensor
      if (node.data?.type === 'pir-motion-sensor') {
        const motion = node.data?.sensorValues?.motionDetected ?? false;
        this.pushInputSignal(node.id, 'OUT', motion);
        console.log(`[PIR] Registered pir-motion-sensor during syncCircuitGraph: nodeId=${node.id}, initial motionDetected=${motion}`);
      }

      // Register IR obstacle sensor (Active-LOW: HIGH when clear, LOW when obstacle detected)
      if (node.data?.type === 'ir-obstacle-sensor') {
        const obstacle = node.data?.sensorValues?.obstacleDetected ?? false;
        this.pushInputSignal(node.id, 'OUT', !obstacle);
        console.log(`[IR-OBSTACLE] Registered ir-obstacle-sensor during syncCircuitGraph: nodeId=${node.id}, initial obstacleDetected=${obstacle}`);
      }

      // Register Proximity sensor (Active-LOW)
      if (node.data?.type === 'proximity-sensor') {
        const objectDet = node.data?.sensorValues?.obstacleDetected ?? false;
        this.pushInputSignal(node.id, 'OUT', !objectDet);
        console.log(`[PROXIMITY] Registered proximity-sensor during syncCircuitGraph: nodeId=${node.id}, initial objectDetected=${objectDet}`);
      }

      // Register heart-beat sensor — drives OUT ADC channel with a time-varying pulse voltage
      if (node.data?.type === 'heart-beat-sensor') {
        const nodeId = node.id;
        let phase = 0;
        let lastTime = performance.now();

        const tick = () => {
          const now = performance.now();
          const dt = (now - lastTime) / 1000; // seconds
          lastTime = now;

          // Read current BPM from store (slider may have changed)
          const currentNode = useForgeStore.getState().nodes.find(n => n.id === nodeId);
          if (!currentNode) return;

          const bpm = currentNode.data?.sensorValues?.bpm ?? 72;
          const freq = bpm / 60; // beats per second

          // Advance phase
          phase = (phase + freq * dt) % 1;

          // Compute pulse sensor ADC value matching real PulseSensor.com output:
          // Baseline ~512, beat peak ~750–900, diastolic dip ~350–450
          const adcValue = Math.max(0, Math.min(1023, pulseSensorADC(phase)));
          const voltage = (adcValue / 1023) * 5.0;

          // Push to ADC — find the OUT wire
          const { edges } = useForgeStore.getState();
          const outWire = edges.find(e => {
            const srcMatch = e.source === nodeId && (e.sourceHandle === 'OUT' || e.sourceHandle === 'OUT__target');
            const tgtMatch = e.target === nodeId && (e.targetHandle === 'OUT' || e.targetHandle === 'OUT__target');
            return srcMatch || tgtMatch;
          });

          if (outWire) {
            const boardPin = (outWire.source === nodeId ? outWire.targetHandle : outWire.sourceHandle) ?? '';
            const cleanPin = boardPin.replace(/__target$/, '');

            // Try ESP32-C3 RISC-V runner first, then AVR
            if (simulationRunner.isESP32C3Board) {
              const esp32Mapping = simulationRunner.convertESP32Pin(cleanPin);
              if (esp32Mapping && esp32Mapping.adcChannel !== undefined) {
                const gpioNum = parseInt(esp32Mapping.avrPin.replace('ESP', ''), 10);
                const scaledVoltage = (adcValue / 1023) * 3.3;
                simulationRunner.setESP32C3AnalogInput(gpioNum, scaledVoltage);
              }
            } else {
              const mapping = simulationRunner.convertArduinoPin(cleanPin);
              if (mapping && mapping.adcChannel !== undefined) {
                simulationRunner.setAnalogInput(mapping.adcChannel, voltage);
              }
            }
          }

          // Update beatPhase and current ADC value in store for visual element
          updateNodeData(nodeId, {
            sensorValues: {
              ...useForgeStore.getState().nodes.find(n => n.id === nodeId)?.data?.sensorValues,
              beatPhase: phase,
              adcValue,
            },
          });

          // Schedule next tick
          const rafId = requestAnimationFrame(tick);
          this.heartBeatTimers.set(nodeId, rafId);
        };

        const rafId = requestAnimationFrame(tick);
        this.heartBeatTimers.set(nodeId, rafId);
        console.log(`[FORGE CIRCUIT] Heart-beat sensor (${nodeId}) timer started`);
      }
    });

    // 2.2 Attach Bus Manager to Master
    if (simulationRunner.TWI) {
      // Arduino/AVR: attach via hardware TWI
      simulationRunner.TWI.eventHandler = this.i2cBusManager;
    }

    // 2.3 Wire I2CBusManager into ArduinoRuntime (ESP32 transpiled path)
    // Applied via syncI2CBridge() called from SimulationRunner.start() after initTranspiled()
    this.syncI2CBridge();

    const tickUnifiedSteppers = () => {
      this.unifiedStepperEmulators.forEach((emulator, nodeId) => {
        emulator.checkIdle();
        updateNodeData(nodeId, emulator.getState());
      });
      this.stepperIdleRaf = requestAnimationFrame(tickUnifiedSteppers);
    };
    this.stepperIdleRaf = requestAnimationFrame(tickUnifiedSteppers);

    // 2. Map board nodes (Arduino/ESP32) and their connected peripherals
    const boardNodes = nodes.filter(n =>
      n.data?.type === 'arduino-uno' ||
      n.data?.type === 'esp32-c3' ||
      n.data?.type === 'esp32'
    );

    console.log(`[CIRCUIT ENGINE] Found ${boardNodes.length} board(s) to wire:`, boardNodes.map(b => `${b.id} (${b.data?.type})`));

    boardNodes.forEach(board => {
      // Find all wires connected to this Arduino
      const connectedEdges = edges.filter(e => e.source === board.id || e.target === board.id);
      console.log(`[CIRCUIT ENGINE] Board ${board.id} (${board.data?.type}) has ${connectedEdges.length} connected edges`);

      connectedEdges.forEach(edge => {
        // Determine the flow direction (Assuming Board -> Peripheral for now, Phase 3 propagation)
        // If the Arduino is the source of the edge (e.g., standard digital output)
        const isOutput = edge.source === board.id;
        // Strip ReactFlow's __target suffix — handles are stored as "PIN" or "PIN__target"
        const arduinoPinName = (isOutput ? edge.sourceHandle : edge.targetHandle)?.replace(/__target$/, '');
        const peripheralId = isOutput ? edge.target : edge.source;
        const peripheralPinName = (isOutput ? edge.targetHandle : edge.sourceHandle)?.replace(/__target$/, '');

        if (!arduinoPinName || !peripheralPinName) return;

        // For ESP32: GPIO numbers map directly to ESP{n} pin IDs.
        // For AVR boards: convert Arduino pin number to AVR port pin (e.g. "13" → "PB5").
        const isESP32Board = board.data?.type === 'esp32-c3' || board.data?.type === 'esp32';
        let pinId: string;

        if (isESP32Board) {
          // Use the full ESP32 pin map — handles D{n}, VP, VN, RX2, TX2 etc.
          // Power/GND pins return null and are silently skipped.
          const esp32Mapping = simulationRunner.convertESP32Pin(arduinoPinName);
          if (!esp32Mapping) {
            console.warn(`[ESP32 CIRCUIT] ⚠ Failed to map ESP32 pin: "${arduinoPinName}" - skipping wire`);
            return;
          }
          pinId = esp32Mapping.avrPin;
          console.log(`[ESP32 CIRCUIT] ✓ Wired: Board[${arduinoPinName}→${pinId}] <==> Peripheral[${peripheralId}/${peripheralPinName}]`);
        } else {
          const mapping = simulationRunner.convertArduinoPin(arduinoPinName);
          if (!mapping) return;
          pinId = mapping.avrPin;
          console.log(`[FORGE CIRCUIT] Wired Logic Route: Board[${arduinoPinName}] <==> ${pinId} <==> Peripheral[${peripheralPinName}]`);
        }

        // Keep avrPin as an alias for the rest of the listener body (DHT, NeoPixel etc.)
        const avrPin = pinId;

        // --- Custom Peripheral Emulation ---
        let trigStartCycles = 0;
        let pwmStartCycles = 0;

        // Ensure buffers exist for this peripheral
        if (!this.peripheralPinBuffers.has(peripheralId)) {
          this.peripheralPinBuffers.set(peripheralId, {});
        }

        // Create a dedicated listener that pushes the HIGH/LOW state across the wire to the target node
        const listener = (state: PinState) => {
          const buf = this.peripheralPinBuffers.get(peripheralId)!;
          // ESP32 transpiled path sends numeric states for analog/PWM (0-255) and servo (0-180)
          const isAnalogState = typeof state === 'number';
          const analogValue = isAnalogState ? (state as number) : 0;
          const isHigh = isAnalogState ? analogValue > 0 : state === 'HIGH';
          const currentStateStore = useForgeStore.getState();

          // Identify peripheral node and type once for listener scope
          const peripheralNode = currentStateStore.nodes.find(n => n.id === peripheralId);
          const pType = peripheralNode?.data?.type;

          // ── ESP32 Servo: when Servo.write(angle) fires, state is the angle (0-180)
          if (isAnalogState && pType === 'servo') {
            const angle = Math.max(0, Math.min(180, analogValue));
            const currentAngle = currentStateStore.nodes.find(n => n.id === peripheralId)?.data?.angle ?? 0;
            if (Math.abs(currentAngle - angle) >= 0.5) {
              console.log(`[ESP32 CIRCUIT] Servo ${peripheralId} angle: ${angle}°`);
              updateNodeData(peripheralId, { angle });
            }
            return; // Servo handled — skip normal pin logic
          }

          // ── ESP32 PWM brightness for LEDs/buzzers: map 0-255 to 0.0-1.0
          const pwmIntensity = isAnalogState ? Math.min(1.0, analogValue / 255) : (isHigh ? 1.0 : 0.0);
          if (isAnalogState && (pType === 'led' || pType === 'buzzer')) {
            console.log(`[ESP32 CIRCUIT] ${pType} ${peripheralId} PWM: ${analogValue}/255 (intensity: ${pwmIntensity.toFixed(2)})`);
          }

          // Log 7-segment related activity
          /* if (pType === '7segment') {
            console.log(`[CIRCUIT 7SEG] Listener triggered: ${avrPin} = ${state}, peripheral pin: ${peripheralPinName}`);
          } */

          const isComplexPeripheral = ['stepper-motor', 'stepperMotor', 'a4988', 'biaxial-stepper', 'dht22', 'dht11', 'servo', 'hc-sr04',
            'mpu6050', 'ssd1306',
            'lcd1602', 'lcd2004', 'lcd1602-i2c', 'lcd2004-i2c', 'neopixel', 'neopixel-matrix', 'led-ring', 'ks2e-m-dc5', 'relay-module',
            '7segment', 'ili9341', 'pir-motion-sensor', 'ir-obstacle-sensor', 'heart-beat-sensor', 'hx711', 'ds1307', 'membrane-keypad', 'rotary-dialer', 'l298n',
            'ir-receiver', 'ir-remote'].includes(pType);

          // 1. Trace the electrical network — only for simple output peripherals
          if (!isComplexPeripheral) {
            const reachableTargets = this.traceNet(peripheralId, peripheralPinName);
            console.log(`[CIRCUIT LED] Traced from ${peripheralId}/${peripheralPinName}, found ${reachableTargets.length} targets:`, reachableTargets);
            reachableTargets.forEach(target => {
              const targetNode = currentStateStore.nodes.find(n => n.id === target.nodeId);
              if (!targetNode) return;

              // Validate GND/VCC connection — components require completing the circuit to function
              let hasConnection = false;
              let isCommonAnode = false;

              if (target.type === 'rgb-led') {
                const comConnections = this.traceNet(target.nodeId, 'COM');
                isCommonAnode = comConnections.some(conn => {
                  const connNode = currentStateStore.nodes.find(n => n.id === conn.nodeId);
                  if (connNode && (connNode.data?.type === 'arduino-uno' || connNode.data?.type === 'esp32-c3' || connNode.data?.type === 'esp32')) {
                    return ['5V', '3V3', '3.3V', 'VCC', 'VIN'].includes(conn.pinName);
                  }
                  return false;
                });
                hasConnection = isCommonAnode || this.hasGroundConnection(target.nodeId);
              } else if (target.type === 'dc-motor' || target.type === 'water-pump') {
                // DC motors & water pumps handle internal voltage differential calculation directly
                hasConnection = true;
              } else {
                hasConnection = this.hasGroundConnection(target.nodeId);
              }

              if (!hasConnection) {
                console.warn(`[CIRCUIT] ⚠ Component ${target.nodeId} (${target.type}) missing power/GND reference - simulation disabled`);
                // Mark component as damaged/non-functional without connection
                updateNodeData(target.nodeId, {
                  damaged: true,
                  value: false,
                  brightness: 0,
                  hasSignal: false,
                  pinStates: { ...targetNode.data?.pinStates || {}, [`pin_${target.pinName}`]: false }
                });
                return;
              }

              const currentPinStates = targetNode.data?.pinStates || {};
              const pinKey = `pin_${target.pinName}`;

              // PWM smoothing / duty cycle analyzer for AVR path (where isAnalogState is false)
              let intensity = 0.0;
              let pinStateValue = isHigh;
              let isPWMMode = false;

              // Base intensity calculation
              if (target.type === 'rgb-led' && isCommonAnode) {
                intensity = isHigh ? (1.0 - pwmIntensity) : 1.0;
                pinStateValue = !isHigh;
              } else {
                intensity = isHigh ? pwmIntensity : 0.0;
                pinStateValue = isHigh;
              }

              if (!isAnalogState && ['led', 'rgb-led', 'buzzer'].includes(target.type)) {
                const pinName = `${target.nodeId}_${target.pinName}`;
                const currentCycles = simulationRunner.getCycles();
                const lastCycles = buf[`_lastCycles_${pinName}`] ?? currentCycles;
                const diffCycles = currentCycles - lastCycles;

                // Accumulate cycles spent in the previous state
                const elapsed = currentCycles - lastCycles;
                buf[`_totalCycles_${pinName}`] = (buf[`_totalCycles_${pinName}`] ?? 0) + elapsed;
                if (buf[`_lastState_${pinName}`] === true) {
                  buf[`_highCycles_${pinName}`] = (buf[`_highCycles_${pinName}`] ?? 0) + elapsed;
                }

                buf[`_lastCycles_${pinName}`] = currentCycles;
                buf[`_lastState_${pinName}`] = isHigh;

                // Clear any pending timeout
                if (buf[`_timer_${pinName}`]) {
                  clearTimeout(buf[`_timer_${pinName}`]);
                  buf[`_timer_${pinName}`] = null;
                }

                // Check if toggling is high-frequency (PWM mode)
                // 100,000 cycles = ~6.25ms at 16MHz (approx. frequencies >= 160Hz)
                if (diffCycles < 100000) {
                  buf[`_isPWM_${pinName}`] = true;
                } else if (diffCycles >= 300000) {
                  // Long interval indicates a slow toggle (digital write)
                  buf[`_isPWM_${pinName}`] = false;
                }

                const isPWM = !!buf[`_isPWM_${pinName}`];

                if (isPWM) {
                  isPWMMode = true;
                  // In PWM mode, throttle updates to the store
                  // Flush when we have accumulated at least 400,000 cycles (~25ms of simulation time)
                  if ((buf[`_totalCycles_${pinName}`] ?? 0) >= 400000) {
                    const total = buf[`_totalCycles_${pinName}`] || 1;
                    const high = buf[`_highCycles_${pinName}`] ?? 0;
                    const duty = high / total;

                    // Reset accumulators
                    buf[`_totalCycles_${pinName}`] = 0;
                    buf[`_highCycles_${pinName}`] = 0;

                    if (target.type === 'rgb-led' && isCommonAnode) {
                      intensity = 1.0 - duty;
                    } else {
                      intensity = duty;
                    }
                    pinStateValue = intensity > 0.01;
                  } else {
                    // Not enough cycles accumulated yet; set up a timeout in case toggling stops,
                    // but do not update the store right now to prevent UI lag.
                    buf[`_timer_${pinName}`] = setTimeout(() => {
                      const latestIsHigh = buf[`_lastState_${pinName}`];
                      let finalIntensity = 0.0;
                      let finalPinState = false;

                      if (target.type === 'rgb-led' && isCommonAnode) {
                        finalIntensity = latestIsHigh ? 0.0 : 1.0;
                        finalPinState = !latestIsHigh;
                      } else {
                        finalIntensity = latestIsHigh ? 1.0 : 0.0;
                        finalPinState = latestIsHigh;
                      }

                      buf[`_isPWM_${pinName}`] = false;
                      buf[`_totalCycles_${pinName}`] = 0;
                      buf[`_highCycles_${pinName}`] = 0;

                      const updates: any = {
                        pinStates: { ...targetNode.data?.pinStates || {}, [pinKey]: finalPinState }
                      };
                      if (target.type === 'led') {
                        updates.brightness = finalIntensity;
                        updates.value = finalPinState;
                      } else if (target.type === 'rgb-led') {
                        updates[`intensity_${target.pinName}`] = finalIntensity;
                      } else if (target.type === 'buzzer') {
                        updates.intensity = finalIntensity;
                        updates.hasSignal = finalPinState;
                      }
                      updates.damaged = false;
                      updateNodeData(target.nodeId, updates);
                    }, 50);

                    return; // Suppress high-frequency update
                  }
                } else {
                  // Digital mode: update immediately
                  buf[`_totalCycles_${pinName}`] = 0;
                  buf[`_highCycles_${pinName}`] = 0;
                }

                // Set up a safety timeout in case the PWM stops toggling
                buf[`_timer_${pinName}`] = setTimeout(() => {
                  const latestIsHigh = buf[`_lastState_${pinName}`];
                  let finalIntensity = 0.0;
                  let finalPinState = false;

                  if (target.type === 'rgb-led' && isCommonAnode) {
                    finalIntensity = latestIsHigh ? 0.0 : 1.0;
                    finalPinState = !latestIsHigh;
                  } else {
                    finalIntensity = latestIsHigh ? 1.0 : 0.0;
                    finalPinState = latestIsHigh;
                  }

                  buf[`_isPWM_${pinName}`] = false;
                  buf[`_totalCycles_${pinName}`] = 0;
                  buf[`_highCycles_${pinName}`] = 0;

                  const updates: any = {
                    pinStates: { ...targetNode.data?.pinStates || {}, [pinKey]: finalPinState }
                  };
                  if (target.type === 'led') {
                    updates.brightness = finalIntensity;
                    updates.value = finalPinState;
                  } else if (target.type === 'rgb-led') {
                    updates[`intensity_${target.pinName}`] = finalIntensity;
                  } else if (target.type === 'buzzer') {
                    updates.intensity = finalIntensity;
                    updates.hasSignal = finalPinState;
                  }
                  updates.damaged = false;
                  updateNodeData(target.nodeId, updates);
                }, 50);
              }

              console.log(`[CIRCUIT LED] Updating ${target.nodeId} pin ${pinKey} to ${pinStateValue ? 'HIGH' : 'LOW'}, intensity: ${intensity}`);

              if (currentPinStates[pinKey] !== pinStateValue || isAnalogState || isPWMMode) {
                const updates: any = {
                  pinStates: { ...currentPinStates, [pinKey]: pinStateValue }
                };

                if (target.type === 'led') {
                  updates.brightness = intensity;
                  updates.value = pinStateValue;  // LED requires both power AND ground (validated by hasConnection above)
                  console.log(`[CIRCUIT LED] Setting LED brightness to ${intensity}, value to ${pinStateValue}`);
                }
                else if (target.type === 'rgb-led') updates[`intensity_${target.pinName}`] = intensity;
                else if (target.type === 'buzzer') {
                  updates.intensity = intensity;
                  updates.hasSignal = pinStateValue;
                }
                else if (target.type === 'dc-motor' || target.type === 'water-pump') {
                  // DC Motor / Water Pump logic: evaluate both high-side and low-side switching
                  const res = this.checkMotorPower(target.nodeId, currentPinStates, target.pinName, pinStateValue);
                  updates.speed = res.speed;
                  updates.direction = res.direction;
                  updates.running = res.running;

                  console.log(`[MOTOR ENGINE] ⚙️ Node ${target.nodeId} (${target.type}) → State: ${res.running ? 'RUNNING' : 'STOPPED'}, speed: ${res.speed.toFixed(2)}, dir: ${res.direction}, targetPin: ${target.pinName}=${pinStateValue}`);
                }

                updates.damaged = false;
                console.log(`[CIRCUIT LED] Calling updateNodeData for ${target.nodeId}:`, updates);
                updateNodeData(target.nodeId, updates);
              } else {
                console.log(`[CIRCUIT LED] Pin state unchanged, skipping update`);
              }
            });
          }

          // 2. Specialized Peripheral Emulation (Servo, LCD, etc. - keep original logic for these)
          if (peripheralNode) {
            // ... (rest of the specialized logic for HC-SR04, Servo, LCD, DHT)
            // Note: We only keep the physics simulation here. 
            // The pin state update for these complex peripherals is handled below.

            // Emulate HC-SR04 Hardware Physics
            if (peripheralNode.data?.type === 'hc-sr04' && peripheralPinName === 'TRIG') {
              if (isHigh) {
                trigStartCycles = simulationRunner.getCycles();
              } else {
                const distStr = peripheralNode.data?.sensorValues?.distance;
                const distParam = distStr !== undefined ? parseFloat(distStr) : 100;
                let divisor = 58.2;
                const sourceCode = simulationRunner.getSourceCode();
                if (sourceCode) {
                  if (sourceCode.includes('NewPing') || sourceCode.includes('<NewPing.h>')) {
                    divisor = 57.0;
                  } else {
                    // 1. Direct division on pulseIn: pulseIn(...) / 58.2
                    const matchDiv = sourceCode.match(/pulseIn(?:Long)?\s*\([^)]+\)\s*\/\s*([\d.]+)/);
                    if (matchDiv) {
                      const val = parseFloat(matchDiv[1]);
                      if (!isNaN(val)) divisor = val;
                    } else {
                      // 2. Multiplication followed by division: e.g. * 0.0343 / 2
                      const matchMulDiv = sourceCode.match(/\*\s*(0\.0\d+)\s*\/\s*([\d.]+)/);
                      if (matchMulDiv) {
                        const multiplier = parseFloat(matchMulDiv[1]);
                        const divVal = parseFloat(matchMulDiv[2]);
                        if (multiplier > 0 && !isNaN(multiplier) && !isNaN(divVal)) {
                          divisor = divVal / multiplier;
                        }
                      } else {
                        // 3. Single multiplier: e.g. * 0.01715 or * 0.017
                        const matchMul = sourceCode.match(/\*\s*(0\.017\d*|0\.034\d*)/);
                        if (matchMul) {
                          const val = parseFloat(matchMul[1]);
                          if (!isNaN(val) && val > 0) {
                            divisor = val > 0.03 ? 2 / val : 1 / val;
                          }
                        } else {
                          // 4. Division: e.g. / 58.2 or / 58
                          const matchGenericDiv = sourceCode.match(/\/\s*(58\.\d+|58|29\.\d+|29)/);
                          if (matchGenericDiv) {
                            const val = parseFloat(matchGenericDiv[1]);
                            if (!isNaN(val)) {
                              divisor = val < 40 ? val * 2 : val;
                            }
                          }
                        }
                      }
                    }
                  }
                }
                let echoPulseUs = distParam * divisor;
                if (!isESP32Board) {
                  // Calibrate AVR8js pulseIn loop overhead (16.091 cycles/loop instead of 16)
                  // and subtract the 1us offset built into pulseIn.
                  echoPulseUs = (echoPulseUs * 1.0057) - 1;
                }

                const echoWire = currentStateStore.edges.find(e =>
                  (e.source === peripheralId && (e.sourceHandle === 'ECHO' || e.sourceHandle === 'ECHO__target')) ||
                  (e.target === peripheralId && (e.targetHandle === 'ECHO' || e.targetHandle === 'ECHO__target'))
                );
                if (!echoWire) return;

                const _boardPinName = (echoWire.source === peripheralId ? echoWire.targetHandle : echoWire.sourceHandle)
                  ?.replace(/__target$/, '') ?? '';

                if (isESP32Board) {
                  // ESP32: use setTimeout (no CPU cycles available)
                  const echoMapping = simulationRunner.convertESP32Pin(_boardPinName);
                  if (echoMapping) {
                    setTimeout(() => {
                      simulationRunner.setVirtualInput(echoMapping.avrPin, true);
                      setTimeout(() => {
                        simulationRunner.setVirtualInput(echoMapping.avrPin, false);
                      }, echoPulseUs / 1000); // µs → ms
                    }, 0.5);
                  }
                } else {
                  // AVR: use cycle-accurate scheduleEvent
                  const pulseCycles = simulationRunner.getCycles() - trigStartCycles;
                  const durationUs = pulseCycles / 16;
                  if (durationUs >= 2) {
                    const echoPulseCycles = Math.floor(echoPulseUs * 16);
                    const _echoMapping = simulationRunner.convertArduinoPin(_boardPinName);
                    if (_echoMapping) {
                      simulationRunner.scheduleEvent(500, () => {
                        simulationRunner.setVirtualInput(_echoMapping.avrPin, true);
                        simulationRunner.scheduleEvent(echoPulseCycles, () => {
                          simulationRunner.setVirtualInput(_echoMapping.avrPin, false);
                        });
                      });
                    }
                  }
                }
              }
            }

            // Emulate Servo PWM Physics
            // AVR: measure pulse width in CPU cycles → angle
            // ESP32: servo angle is driven directly by the stub's servoWrite action — skip cycle math
            if (peripheralNode.data?.type === 'servo' && peripheralPinName === 'PWM' && !isESP32Board) {
              if (isHigh) {
                pwmStartCycles = simulationRunner.getCycles();
              } else {
                const pulseCycles = simulationRunner.getCycles() - pwmStartCycles;
                const durationUs = pulseCycles / 16;
                if (durationUs >= 400 && durationUs <= 2600) {
                  const angle = Math.max(0, Math.min(180, Math.round(((durationUs - 544) / (2400 - 544)) * 180)));
                  const currentAngle = peripheralNode.data?.angle ?? 0;
                  if (Math.abs(currentAngle - angle) >= 0.5) {
                    updateNodeData(peripheralId, { angle });
                  }
                }
              }
            }

            // --- LCD Display Emulation (parallel mode only) ---
            if ((peripheralNode.data?.type === 'lcd1602' || peripheralNode.data?.type === 'lcd2004') &&
              peripheralNode.data?.type !== 'lcd1602-i2c' && peripheralNode.data?.type !== 'lcd2004-i2c') {
              const buffer = this.peripheralPinBuffers.get(peripheralId)!;
              const prevE = buffer['E'];
              buffer[peripheralPinName] = isHigh;
              if (prevE === true && isHigh === false && peripheralPinName === 'E') {
                const emulator = this.lcdEmulators.get(peripheralId)!;
                const rs = !!buffer['RS'];
                let data = 0;
                if (buffer['D4']) data |= 0x10;
                if (buffer['D5']) data |= 0x20;
                if (buffer['D6']) data |= 0x40;
                if (buffer['D7']) data |= 0x80;
                emulator.processPulse(rs, data);
                updateNodeData(peripheralId, { lcdState: emulator.getState() });
              }
            }

            // --- 7-Segment Display Emulation ---
            // Segment order in values[]: A=0, B=1, C=2, D=3, E=4, F=5, G=6, DP=7
            // Common-cathode: segment is ON when pin is HIGH.
            if (peripheralNode.data?.type === '7segment') {
              const buffer = this.peripheralPinBuffers.get(peripheralId)!;
              buffer[peripheralPinName] = isHigh;
              console.log(`[7SEG] Pin ${peripheralPinName} = ${isHigh ? 'HIGH' : 'LOW'}, buffer:`, buffer);

              const segOrder = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];
              const values = segOrder.map(seg => (buffer[seg] ? 1 : 0));
              const currentValues = peripheralNode.data?.segValues;
              console.log(`[7SEG] Computed values:`, values, 'current:', currentValues);
              // Only update if something changed
              if (!currentValues || values.some((v, i) => v !== currentValues[i])) {
                console.log(`[7SEG] Updating node ${peripheralId} with segValues:`, values);
                updateNodeData(peripheralId, { segValues: values });
              }
            }

            // --- DHT Sensor Emulation ---
            if (peripheralNode.data?.type === 'dht22' || peripheralNode.data?.type === 'dht11') {
              if (peripheralPinName === 'SDA' || peripheralPinName === 'DATA') {
                if (!this.dhtEmulators.has(peripheralId)) {
                  // Pass nodeId so the emulator reads from the correct node's sensorValues
                  this.dhtEmulators.set(peripheralId, new DHT(avrPin, peripheralNode.data.type, peripheralId));
                }
                const emulator = this.dhtEmulators.get(peripheralId)!;
                emulator.processSignal(state);
              }
            }

            // --- HX711 Load Cell Emulation ---
            // Watches the SCK (clock) pin from the Arduino and responds with data on DT
            if (peripheralNode.data?.type === 'hx711') {
              if (peripheralPinName === 'SCK') {
                const emulator = this.hx711Emulators.get(peripheralId);
                if (emulator) {
                  emulator.processSCK(isHigh);
                }
              }
            }

            // --- IR Receiver Emulation ---
            // IR receiver is a pure INPUT sensor — receives IR signals from remote and outputs to DATA pin
            if (peripheralNode.data?.type === 'ir-receiver') {
              if (peripheralPinName === 'DAT' || peripheralPinName === 'DATA' || peripheralPinName === 'OUT') {
                if (!this.irReceiverEmulators.has(peripheralId)) {
                  // Create IR receiver emulator for this node
                  this.irReceiverEmulators.set(peripheralId, new IRReceiverEmulator(avrPin, peripheralId));
                  console.log(`[IR RECEIVER] Initialized emulator for node ${peripheralId} on pin ${avrPin}`);
                }
              }
            }

            // --- ILI9341 TFT SPI Display Emulation ---
            // D/C pin controls command vs data mode; CS pin enables/disables the chip.
            if (peripheralNode.data?.type === 'ili9341' || peripheralNode.data?.type === 'ili9341-touch') {
              const slave = this.ili9341Slaves.get(peripheralId);
              if (slave) {
                if (peripheralPinName === 'D/C') {
                  slave.setDC(isHigh);
                } else if (peripheralPinName === 'CS') {
                  // CS is active-LOW: chip is selected when the pin is LOW
                  slave.setCS(!isHigh);
                }
                // MOSI/SCK are handled by the SPI bus hardware (simulationRunner.SPI.onByte)
              }
            }

            // --- PIR Motion Sensor Emulation ---
            // PIR is a pure INPUT sensor — signal flows from sensor → Arduino, never the reverse.
            // The listener here fires when the AVR writes to Port D (output direction).
            // We must NOT call setVirtualInput here — that would fight against user-injected signals.
            // Initial state injection is handled below, outside this listener, after registration.

            // --- Relay Emulation (KS2E-M-DC5 DPDT) ---
            // COIL1 = signal pin (HIGH = energized), COIL2 = GND reference.
            // When energized: P1↔NO1, P2↔NO2 are closed; P1↔NC1, P2↔NC2 open.
            // When de-energized: P1↔NC1, P2↔NC2 are closed; P1↔NO1, P2↔NO2 open.
            if (peripheralNode.data?.type === 'ks2e-m-dc5') {
              const buf = this.peripheralPinBuffers.get(peripheralId)!;
              buf[peripheralPinName] = isHigh;

              // Coil is energized when COIL1 is HIGH (COIL2 is GND)
              const coil1High = !!buf['COIL1'];
              const wasEnergized = peripheralNode.data?.relayEnergized ?? false;

              if (coil1High !== wasEnergized) {
                console.log(`[RELAY] Node ${peripheralId} — coil ${coil1High ? 'ENERGIZED' : 'DE-ENERGIZED'}`);
                updateNodeData(peripheralId, { relayEnergized: coil1High });

                // Re-propagate signals through the relay contacts
                // Find what is connected to P1 and P2 and route to the active contact
                const relayEdges = currentStateStore.edges.filter(e =>
                  e.source === peripheralId || e.target === peripheralId
                );

                // For each pole (P1, P2), find the signal on P and push it to the active contact
                for (const pole of ['P1', 'P2'] as const) {
                  const suffix = pole === 'P1' ? '1' : '2';
                  const activeContact = coil1High ? `NO${suffix}` : `NC${suffix}`;
                  const inactiveContact = coil1High ? `NC${suffix}` : `NO${suffix}`;

                  // Find the signal level on the pole pin
                  const poleEdge = relayEdges.find(e =>
                    (e.source === peripheralId && e.sourceHandle?.replace(/__target$/, '') === pole) ||
                    (e.target === peripheralId && e.targetHandle?.replace(/__target$/, '') === pole)
                  );

                  if (poleEdge) {
                    // Trace what's downstream of the active contact
                    const activeTargets = this.traceNet(peripheralId, activeContact);
                    const inactiveTargets = this.traceNet(peripheralId, inactiveContact);

                    // Get the current signal level on the pole from the board
                    const poleSignal = buf[pole] ?? false;

                    // Push signal to newly-active contact targets
                    activeTargets.forEach(target => {
                      const targetNode = currentStateStore.nodes.find(n => n.id === target.nodeId);
                      if (!targetNode) return;
                      const pinStates = { ...(targetNode.data?.pinStates || {}), [`pin_${target.pinName}`]: poleSignal };
                      updateNodeData(target.nodeId, { pinStates, damaged: false });
                    });

                    // Cut signal to newly-inactive contact targets
                    inactiveTargets.forEach(target => {
                      const targetNode = currentStateStore.nodes.find(n => n.id === target.nodeId);
                      if (!targetNode) return;
                      const pinStates = { ...(targetNode.data?.pinStates || {}), [`pin_${target.pinName}`]: false };
                      updateNodeData(target.nodeId, { pinStates, damaged: false });
                    });
                  }
                }
              }
            }

            // --- Relay Module Emulation (Single-Channel) ---
            // IN = signal pin (HIGH = energized), VCC/GND = power
            // When energized (IN=HIGH): COM connects to NO
            // When de-energized (IN=LOW): COM connects to NC
            if (peripheralNode.data?.type === 'relay-module') {
              const buf = this.peripheralPinBuffers.get(peripheralId)!;
              buf[peripheralPinName] = isHigh;

              // Track ALL pins including switch terminals (COM, NO, NC)
              // This is important because COM receives signals from the circuit
              console.log(`[RELAY MODULE] Pin ${peripheralPinName} = ${isHigh ? 'HIGH' : 'LOW'}, buffer:`, buf);

              // Relay is energized when IN pin is HIGH
              const inHigh = !!buf['IN'];
              const wasEnergized = peripheralNode.data?.relayEnergized ?? false;

              // Helper: Check if a relay terminal (COM, NO, NC) connects to a power source (5V, 3.3V, Battery POS)
              const isTerminalPowered = (terminalName: string): boolean => {
                const edges = currentStateStore.edges.filter(e =>
                  e.source === peripheralId || e.target === peripheralId
                );
                for (const edge of edges) {
                  const isSourceRelay = edge.source === peripheralId;
                  const relayHandle = (isSourceRelay ? edge.sourceHandle : edge.targetHandle)?.replace(/__target$/, '') || '';
                  if (!relayHandle || relayHandle === terminalName || relayHandle.includes(terminalName)) {
                    const otherNodeId = isSourceRelay ? edge.target : edge.source;
                    const otherHandle = (isSourceRelay ? edge.targetHandle : edge.sourceHandle)?.replace(/__target$/, '') || '';
                    const otherNode = currentStateStore.nodes.find(n => n.id === otherNodeId);
                    if (otherNode) {
                      const nodeType = otherNode.data?.type || '';
                      if (['arduino-uno', 'esp32-c3', 'esp32', 'arduino-nano', 'arduino-mega'].includes(nodeType)) {
                        if (['5V', '3V3', '3.3V', 'VCC', 'VIN'].includes(otherHandle) || otherHandle.includes('5V') || otherHandle.includes('3V3')) {
                          return true;
                        }
                  } else if (nodeType.includes('battery')) {
                        if (!otherHandle || ['POS', '12V', 'VCC', '+', 'pin_POS', '1', 'pin_1', 'P1', 'V+'].includes(otherHandle) || otherHandle.includes('POS') || otherHandle === '1') {
                          return true;
                        }
                      }
                    }
                  }
                }

                // Fallback net tracing
                const targets = this.traceNet(peripheralId, terminalName);
                return targets.some(t =>
                  (t.type.includes('battery') && (t.pinName.includes('POS') || t.pinName === '12V' || t.pinName === 'VCC' || t.pinName === '+' || t.pinName === '1')) ||
                  (['arduino-uno', 'esp32-c3', 'esp32'].includes(t.type) && ['5V', '3V3', '3.3V', 'VCC', 'VIN'].includes(t.pinName))
                );
              };

              // When IN pin changes, update relay state
              if (peripheralPinName === 'IN' && inHigh !== wasEnergized) {
                console.log(`[RELAY MODULE] Node ${peripheralId} — ${inHigh ? 'ENERGIZED' : 'DE-ENERGIZED'}`);
                updateNodeData(peripheralId, { relayEnergized: inHigh });

                // Determine active and inactive contacts
                const activeContact = inHigh ? 'NO' : 'NC';
                const inactiveContact = inHigh ? 'NC' : 'NO';

                // Power can flow bidirectionally (COM -> NO/NC or NO/NC -> COM)
                const isPowered = isTerminalPowered('COM') || isTerminalPowered(activeContact);
                const activeSignal = isPowered;

                console.log(`[RELAY MODULE] Active contact (${activeContact}) powered: ${activeSignal}`);

                // Downstream targets of active contact AND COM terminal (filter duplicates)
                const rawActiveTargets = [
                  ...this.traceNet(peripheralId, activeContact),
                  ...this.traceNet(peripheralId, 'COM')
                ];
                const activeTargets = rawActiveTargets.filter((t, idx, arr) =>
                  arr.findIndex(x => x.nodeId === t.nodeId && x.pinName === t.pinName) === idx && t.nodeId !== peripheralId
                );

                const inactiveTargets = this.traceNet(peripheralId, inactiveContact).filter(t => t.nodeId !== peripheralId);

                console.log(`[RELAY MODULE] Found ${activeTargets.length} active targets, ${inactiveTargets.length} inactive targets`);

                // Push signal to active contact targets
                activeTargets.forEach((target: { nodeId: string; pinName: string; type?: string }) => {
                  const targetNode = currentStateStore.nodes.find(n => n.id === target.nodeId);
                  if (!targetNode) return;
                  const currentPinStates = targetNode.data?.pinStates || {};
                  const pinStates = { ...currentPinStates, [`pin_${target.pinName}`]: activeSignal };
                  console.log(`[RELAY MODULE] Setting ${target.nodeId} pin ${target.pinName} = ${activeSignal}`);
                  const updates: any = { pinStates, damaged: false };

                  const targetType = target.type || targetNode.data?.type;
                  if (targetType === 'dc-motor' || targetType === 'water-pump') {
                    const res = this.checkMotorPower(target.nodeId, currentPinStates, target.pinName, activeSignal);
                    updates.speed = res.speed;
                    updates.direction = res.direction;
                    updates.running = res.running;

                    console.log(`[RELAY MOTOR ROUTE] 🔀 Target ${target.nodeId} (${targetType}) pin ${target.pinName} = ${activeSignal} → running: ${res.running}, speed: ${res.speed}`);
                  }

                  updateNodeData(target.nodeId, updates);
                });

                // Cut signal to inactive contact targets
                inactiveTargets.forEach((target: { nodeId: string; pinName: string; type?: string }) => {
                  const targetNode = currentStateStore.nodes.find(n => n.id === target.nodeId);
                  if (!targetNode) return;
                  const currentPinStates = targetNode.data?.pinStates || {};
                  const pinStates = { ...currentPinStates, [`pin_${target.pinName}`]: false };
                  console.log(`[RELAY MODULE] Cutting ${target.nodeId} pin ${target.pinName}`);
                  const updates: any = { pinStates, damaged: false };

                  const targetType = target.type || targetNode.data?.type;
                  if (targetType === 'dc-motor' || targetType === 'water-pump') {
                    const res = this.checkMotorPower(target.nodeId, currentPinStates, target.pinName, false);
                    updates.speed = res.speed;
                    updates.direction = res.direction;
                    updates.running = res.running;
                  }

                  updateNodeData(target.nodeId, updates);
                });
              }

              // When COM pin receives a signal, route it through the active contact
              if (peripheralPinName === 'COM') {
                const activeContact = inHigh ? 'NO' : 'NC';
                const activeTargets = this.traceNet(peripheralId, activeContact);

                console.log(`[RELAY MODULE] COM signal changed to ${isHigh}, routing to ${activeContact}, targets:`, activeTargets.length);

                // Push signal to active contact targets
                activeTargets.forEach((target: { nodeId: string; pinName: string; type?: string }) => {
                  const targetNode = currentStateStore.nodes.find(n => n.id === target.nodeId);
                  if (!targetNode) return;
                  const currentPinStates = targetNode.data?.pinStates || {};
                  const pinStates = { ...currentPinStates, [`pin_${target.pinName}`]: isHigh };
                  console.log(`[RELAY MODULE] Propagating to ${target.nodeId} pin ${target.pinName} = ${isHigh}`);
                  const updates: any = { pinStates, damaged: false };

                  const targetType = target.type || targetNode.data?.type;
                  if (targetType === 'dc-motor' || targetType === 'water-pump') {
                    const pos = (target.pinName === 'POS' || target.pinName === 'VCC') ? isHigh : (!!currentPinStates['pin_POS'] || !!currentPinStates['pin_VCC']);
                    const neg = (target.pinName === 'NEG' || target.pinName === 'GND') ? isHigh : (!!currentPinStates['pin_NEG'] || !!currentPinStates['pin_GND']);
                    let speed = 0;
                    let direction = 'cw';
                    let running = false;

                    if (pos && !neg) {
                      speed = 1.0;
                      direction = 'cw';
                      running = true;
                    } else if (!pos && neg) {
                      speed = 1.0;
                      direction = 'ccw';
                      running = true;
                    }

                    updates.speed = speed;
                    updates.direction = direction;
                    updates.running = running;
                  }

                  updateNodeData(target.nodeId, updates);
                });
              }
            }

            // --- Stepper Motor Emulation ---
            // Supports both wiring modes:
            //   4-wire (A+, B+, A-, B-) — Arduino Stepper.h / ULN2003
            //   STEP+DIR (A4988 / DRV8825)
            // --- L298N Motor Driver Emulation ---
            if (pType === 'l298n') {
              const buf = this.peripheralPinBuffers.get(peripheralId)!;

              // Standard dedup for direction pins (IN1-IN4);
              // ENA/ENB get PWM dedup separately below.
              if (peripheralPinName !== 'ENA' && peripheralPinName !== 'ENB') {
                if (buf[peripheralPinName] === isHigh && buf['_initialized']) {
                  return;
                }
              }

              buf[peripheralPinName] = isHigh;
              if (!buf['_initialized']) {
                buf['_initialized'] = true;
              }

              // PWM debounce for ENA/ENB: AVR analogWrite() generates a pin-toggle PWM
              // (~1 kHz).  Without debounce, ena/enb would flicker on/off and the motor
              // would appear motionless.  We keep the enable active for ~25 ms after the
              // last observed HIGH — far longer than a single PWM period (~1 ms).
              if (peripheralPinName === 'ENA' || peripheralPinName === 'ENB') {
                const now = Date.now();
                if (isHigh) {
                  buf[`_${peripheralPinName}_lastHigh`] = now;
                }
                const lastHigh = (buf[`_${peripheralPinName}_lastHigh`] as number) || 0;
                if (!isHigh && (now - lastHigh <= 25)) {
                  // Still inside a PWM off-cycle — keep the enable asserted
                  // and do not re-run the (expensive) propagation logic.
                  return;
                }
              }

              // Track per-pin speed from ESP32 analogWrite (isAnalogState with 0-255 value)
              if (isAnalogState && (peripheralPinName === 'ENA' || peripheralPinName === 'ENB')) {
                buf[`_${peripheralPinName}_speed`] = pwmIntensity;
              }

              // Cache the 12V terminal power check (very expensive trace)
              // Only re-check if graph hasn't been checked for a while or on start
              if (buf['_lastPowerCheck'] === undefined || (Date.now() - (buf['_lastPowerCheck'] as any)) > 1000) {
                buf['_has12VPower'] = this.traceNet(peripheralId, '12V').some(t => t.type === 'battery-12v');
                buf['_lastPowerCheck'] = Date.now();
              }

              const has12VPower = !!buf['_has12VPower'];
              const ena = (buf['ENA'] !== false) && has12VPower;
              const in1 = !!buf['IN1'];
              const in2 = !!buf['IN2'];
              const enb = (buf['ENB'] !== false) && has12VPower;
              const in3 = !!buf['IN3'];
              const in4 = !!buf['IN4'];

              // Update visuals for L298N itself
              updateNodeData(peripheralId, { ena, enb, in1, in2, in3, in4 });

              // Motor A speed from ENA: ESP32 analogWrite → pwmIntensity, AVR digitalWrite → 1.0
              const motorASpeed = (buf['_ENA_speed'] as number) ?? 1.0;
              const motorBSpeed = (buf['_ENB_speed'] as number) ?? 1.0;

              // Motor A Logic (OUT1, OUT2)
              let a_pos = false, a_neg = false;
              if (ena) {
                if (in1 && !in2) { a_pos = true; a_neg = false; }
                else if (!in1 && in2) { a_pos = false; a_neg = true; }
              }

              // Motor B Logic (OUT3, OUT4)
              let b_pos = false, b_neg = false;
              if (enb) {
                if (in3 && !in4) { b_pos = true; b_neg = false; }
                else if (!in3 && in4) { b_pos = false; b_neg = true; }
              }

              // Only propagate if motor outputs changed to avoid redundant graph scans
              const motorStateKey = `${a_pos}${a_neg}${b_pos}${b_neg}`;
              if (buf['_lastMotorState'] === motorStateKey) return;
              buf['_lastMotorState'] = motorStateKey;

              const propagate = (outPin: string, signal: boolean, speed: number) => {
                const targets = this.traceNet(peripheralId, outPin);
                targets.forEach(target => {
                  const targetNode = currentStateStore.nodes.find(n => n.id === target.nodeId);
                  if (!targetNode) return;
                  const pinKey = `pin_${target.pinName}`;
                  const currentPinStates = targetNode.data?.pinStates || {};

                  // Skip if target pin state is already what we want
                  if (currentPinStates[pinKey] === signal) return;

                  const newPinStates = { ...currentPinStates, [pinKey]: signal };

                  if (target.type === 'dc-motor' || target.type === 'water-pump') {
                    const pos = !!newPinStates['pin_POS'] || !!newPinStates['pin_VCC'];
                    const neg = !!newPinStates['pin_NEG'] || !!newPinStates['pin_GND'];
                    let dSpeed = 0;
                    let direction = 'cw';
                    let running = false;
                    if (pos && !neg) {
                      dSpeed = speed;
                      direction = 'cw';
                      running = true;
                    } else if (!pos && neg) {
                      dSpeed = speed;
                      direction = 'ccw';
                      running = true;
                    }
                    updateNodeData(target.nodeId, { pinStates: newPinStates, speed: dSpeed, direction, running });
                  } else {
                    updateNodeData(target.nodeId, { pinStates: newPinStates });
                  }
                });
              };

              propagate('OUT1', a_pos, motorASpeed);
              propagate('OUT2', a_neg, motorASpeed);
              propagate('OUT3', b_pos, motorBSpeed);
              propagate('OUT4', b_neg, motorBSpeed);
            }

            // --- Membrane Keypad Emulation ---
            if (peripheralNode.data?.type === 'membrane-keypad') {
              const emulator = this.keypadEmulators.get(peripheralId);
              if (emulator) {
                const isOutput = simulationRunner.isPinOutput(avrPin);
                emulator.onPinChange(avrPin, isHigh, isOutput);
              }
            }

            // --- Stepper Motor Emulation ---
            if (peripheralNode.data?.type === 'stepper-motor') {
              if (!this.stepperEmulators.has(peripheralId)) {
                console.log(`[STEPPER] Wiring 4-wire emulator for node ${peripheralId} — pin ${peripheralPinName} ← AVR ${avrPin}`);
                let pendingUpdate: {
                  angle: number;
                  stepCount: number;
                  energized: boolean;
                  actualAngleUnbounded?: number;
                  currentSteps?: number;
                  currentAngle?: number;
                  totalDegrees?: number;
                  stepsPerRevolution?: number;
                } | null = null;
                let rafScheduled = false;

                const gearRatioStr = peripheralNode.data?.gearRatio || '1:1';
                let stepsPerRev: number;
                const overrideSteps = peripheralNode.data?.stepsPerRev ?? peripheralNode.data?.stepsPerRevolution;
                if (typeof overrideSteps === 'number' && overrideSteps > 0) {
                  stepsPerRev = Math.round(overrideSteps);
                } else {
                  stepsPerRev = 200;
                  const parts = gearRatioStr.split(':');
                  if (parts.length === 2) {
                    const num = parseFloat(parts[0]);
                    const den = parseFloat(parts[1]);
                    if (!isNaN(num) && !isNaN(den) && den > 0) {
                      stepsPerRev = Math.round(200 * (num / den));
                    }
                  }
                }

                // Save the visual steps (from gear ratio / UI settings) before auto-detection
                // Visual: what the user sees (e.g. 0-200 for NEMA 17 with 1:1 gear)
                // Backend: what the emulator tracks (e.g. 0-2048 for 28BYJ-48)
                const visualStepsPerRev = stepsPerRev;

                // ── Auto-detect stepsPerRevolution from Arduino source code ──
                // Parses: Stepper myStepper(stepsPerRevolution, pin1, pin2, pin3, pin4)
                // or:     Stepper myStepper(2048, 8, 10, 9, 11)
                // This ensures the emulator's step limit matches the sketch.
                const sourceCode = simulationRunner.getSourceCode();
                if (sourceCode) {
                  // 1. Try literal: Stepper varName(2048, ...)
                  const literalMatch = sourceCode.match(/Stepper\s+\w+\s*\(\s*(\d+)\s*,/);
                  if (literalMatch) {
                    const parsed = parseInt(literalMatch[1], 10);
                    if (parsed > 0) {
                      stepsPerRev = parsed;
                      console.log(`[STEPPER] Auto-detected stepsPerRevolution = ${stepsPerRev} from source code (literal), visual = ${visualStepsPerRev}`);
                    }
                  } else {
                    // 2. Try variable: Stepper varName(varName, ...) → find definition
                    const varMatch = sourceCode.match(/Stepper\s+\w+\s*\(\s*([a-zA-Z_]\w*)\s*,/);
                    if (varMatch) {
                      const varName = varMatch[1];
                      const defineRe = new RegExp(`#define\\s+${varName}\\s+(\\d+)`);
                      const constRe = new RegExp(`(?:const\\s+)?(?:int|long|unsigned)\\s+${varName}\\s*=\\s*(\\d+)`);
                      const dm = sourceCode.match(defineRe) || sourceCode.match(constRe);
                      if (dm) {
                        const parsed = parseInt(dm[1], 10);
                        if (parsed > 0) {
                          stepsPerRev = parsed;
                          console.log(`[STEPPER] Auto-detected stepsPerRevolution = ${stepsPerRev} from source code (variable '${varName}'), visual = ${visualStepsPerRev}`);
                        }
                      }
                    }
                  }
                }

                this.stepperEmulators.set(peripheralId, new StepperEmulator((state) => {
                  if (state.isClamped) {
                    simulationRunner.reportClampedStep();
                  }

                  const currentStepper = this.stepperEmulators.get(peripheralId);
                  const activeStepsPerRev = currentStepper ? currentStepper.getStepsPerRev() : stepsPerRev;
                  const activeVisualStepsPerRev = currentStepper ? currentStepper.getVisualStepsPerRev() : visualStepsPerRev;

                  // Scale internal steps (0-2048) → visual steps (0-200)
                  const visualSteps = activeStepsPerRev !== activeVisualStepsPerRev
                    ? Math.round((state.stepCount / activeStepsPerRev) * activeVisualStepsPerRev)
                    : state.stepCount;

                  pendingUpdate = {
                    angle: state.angle,
                    stepCount: visualSteps,
                    energized: state.energized,
                    currentSteps: state.currentSteps ?? visualSteps,
                    currentAngle: state.currentAngle ?? state.angle,
                    totalDegrees: state.actualAngleUnbounded ?? state.angle,
                    stepsPerRevolution: activeStepsPerRev,
                  };
                  if (!rafScheduled) {
                    rafScheduled = true;
                    requestAnimationFrame(() => {
                      rafScheduled = false;
                      if (pendingUpdate) {
                        const { angle: a, stepCount: s, energized: e, currentSteps: cs, currentAngle: ca, totalDegrees: td, stepsPerRevolution: spr } = pendingUpdate;
                        pendingUpdate = null;
                        updateNodeData(peripheralId, {
                          angle: a,
                          stepCount: s,
                          energized: e,
                          value: `${a.toFixed(1)}°`,
                          units: `${s > 0 ? '+' : ''}${s} steps`,
                          currentSteps: cs,
                          currentAngle: ca,
                          totalDegrees: td,
                          stepsPerRevolution: spr,
                        });
                      }
                    });
                  }
                }, { stepsPerRev, visualStepsPerRev, constrainRotation: false }, peripheralId));
              }
              const stepper = this.stepperEmulators.get(peripheralId)!;

              // Dynamically sync stepsPerRev if gearRatio or stepsPerRev changed in UI
              const gearRatioStr = peripheralNode.data?.gearRatio || '1:1';
              const baseSteps = stepper.getBaseStepsPerRev();
              let expectedSteps = baseSteps;
              const overrideSteps = peripheralNode.data?.stepsPerRev ?? peripheralNode.data?.stepsPerRevolution;
              if (typeof overrideSteps === 'number' && overrideSteps > 0) {
                expectedSteps = Math.round(overrideSteps);
              } else {
                const parts = gearRatioStr.split(':');
                if (parts.length === 2) {
                  const num = parseFloat(parts[0]);
                  const den = parseFloat(parts[1]);
                  if (!isNaN(num) && !isNaN(den) && den > 0) {
                    expectedSteps = Math.round(baseSteps * (num / den));
                  }
                }
              }
              const expectedVisual = expectedSteps;
              if (stepper.getStepsPerRev() !== expectedSteps) {
                stepper.setStepsPerRev(expectedSteps, expectedVisual);
              }

              const buf = this.peripheralPinBuffers.get(peripheralId)!;
              buf[peripheralPinName] = isHigh;

              if (peripheralPinName === 'STEP') {
                stepper.processStep(isHigh);
              } else if (peripheralPinName === 'DIR') {
                stepper.setDirection(isHigh);
              } else {
                // 4-wire mode — order must match Wokwi physical pin order: A-, A+, B+, B-
                // This corresponds to Arduino Stepper.h (pin1, pin2, pin3, pin4)
                stepper.processCoils(
                  !!buf['A-'],
                  !!buf['A+'],
                  !!buf['B+'],
                  !!buf['B-'],
                );
              }
            }

            // --- Unified Stepper Motor Emulation (IN1-IN4, AVR + ESP32) ---
            if (peripheralNode.data?.type === 'stepperMotor') {
              if (!this.unifiedStepperEmulators.has(peripheralId)) {
                let model = ((peripheralNode.data?.model as StepperModel) ?? 'bipolar_nema');

                // Auto-detect model/steps from source code
                const sourceCode = simulationRunner.getSourceCode();
                if (sourceCode) {
                  const literalMatch = sourceCode.match(/Stepper\s+\w+\s*\(\s*(\d+)\s*,/);
                  if (literalMatch) {
                    const parsed = parseInt(literalMatch[1], 10);
                    if (parsed === 2048) {
                      model = '28byj48';
                      console.log(`[STEPPER] Auto-detected 28BYJ-48 unified stepper motor from literal stepsPerRevolution = 2048`);
                    }
                  } else {
                    const varMatch = sourceCode.match(/Stepper\s+\w+\s*\(\s*([a-zA-Z_]\w*)\s*,/);
                    if (varMatch) {
                      const varName = varMatch[1];
                      const defineRe = new RegExp(`#define\\s+${varName}\\s+(\\d+)`);
                      const constRe = new RegExp(`(?:const\\s+)?(?:int|long|unsigned)\\s+${varName}\\s*=\\s*(\\d+)`);
                      const dm = sourceCode.match(defineRe) || sourceCode.match(constRe);
                      if (dm) {
                        const parsed = parseInt(dm[1], 10);
                        if (parsed === 2048) {
                          model = '28byj48';
                          console.log(`[STEPPER] Auto-detected 28BYJ-48 unified stepper motor from variable ${varName} = 2048`);
                        }
                      }
                    }
                  }
                }

                this.unifiedStepperEmulators.set(peripheralId, new UnifiedStepperEmulator(model));
                updateNodeData(peripheralId, {
                  model,
                  stepsPerRevolution: model === '28byj48' ? 2048 : 200,
                });
              }

              const unified = this.unifiedStepperEmulators.get(peripheralId)!;
              const buf = this.peripheralPinBuffers.get(peripheralId)!;
              buf[peripheralPinName] = isHigh;

              unified.onPinChange(
                !!buf['IN1'],
                !!buf['IN2'],
                !!buf['IN3'],
                !!buf['IN4'],
              );

              const currentDisplay = peripheralNode.data?.display ?? 'steps';
              updateNodeData(peripheralId, {
                ...unified.getState(),
                display: currentDisplay,
              });
            }

            // --- Biaxial Stepper Emulation ---
            // Two independent 4-wire steppers in one body.
            // X Axis: A1+, A1-, B1+, B1-
            // Y Axis: A2+, A2-, B2+, B2-
            if (peripheralNode.data?.type === 'biaxial-stepper') {
              const buf = this.peripheralPinBuffers.get(peripheralId)!;
              buf[peripheralPinName] = isHigh;

              const xKey = `${peripheralId}__x`;
              const yKey = `${peripheralId}__y`;

              // Create X Axis emulator
              if (!this.stepperEmulators.has(xKey)) {
                console.log(`[BIAXIAL] Wiring X Axis emulator for node ${peripheralId}`);
                let pending: any = null;
                let rafPending = false;

                const gearRatioStr = peripheralNode.data?.gearRatio || '1:1';
                let stepsPerRev: number;
                const overrideSteps = peripheralNode.data?.stepsPerRev ?? peripheralNode.data?.stepsPerRevolution;
                if (typeof overrideSteps === 'number' && overrideSteps > 0) {
                  stepsPerRev = Math.round(overrideSteps);
                } else {
                  stepsPerRev = 2048; // Default to 2048 for Biaxial
                  const parts = gearRatioStr.split(':');
                  if (parts.length === 2) {
                    const num = parseFloat(parts[0]);
                    const den = parseFloat(parts[1]);
                    if (!isNaN(num) && !isNaN(den) && den > 0) {
                      stepsPerRev = Math.round(2048 * (num / den));
                    }
                  }
                }

                this.stepperEmulators.set(xKey, new StepperEmulator((state) => {
                  pending = state;
                  if (!rafPending) {
                    rafPending = true;
                    requestAnimationFrame(() => {
                      rafPending = false;
                      if (pending) {
                        const s = pending;
                        pending = null;
                        const mmPerStep = peripheralNode.data?.mmPerStep ?? 1.0;
                        const moving = s.currentSpeed > 0.1;
                        const dir = moving ? (s.direction === 1 ? 'CW' : 'CCW') : 'STOP';
                        const rpmVal = (s.currentSpeed * 60) / stepsPerRev;

                        const steps = s.currentSteps ?? s.stepCount;
                        let angle = (steps % stepsPerRev) * 360.0 / stepsPerRev;
                        if (angle < 0) {
                          angle += 360.0;
                        }

                        const currentData = useForgeStore.getState().nodes.find(n => n.id === peripheralId)?.data || {};

                        updateNodeData(peripheralId, {
                          xSteps: steps,
                          xAngle: angle,
                          xRPM: rpmVal,
                          xDirection: dir,
                          xTotalDegrees: s.actualAngleUnbounded ?? s.angle,
                          xPosition: steps * mmPerStep,
                          xEnergized: s.energized,

                          // preserve existing Y state
                          ySteps: currentData.ySteps ?? 0,
                          yAngle: currentData.yAngle ?? 0,
                          yRPM: currentData.yRPM ?? 0,
                          yDirection: currentData.yDirection ?? 'STOP',
                          yTotalDegrees: currentData.yTotalDegrees ?? 0,
                          yPosition: currentData.yPosition ?? 0,
                          yEnergized: currentData.yEnergized ?? false
                        });
                      }
                    });
                  }
                }, { stepsPerRev, constrainRotation: false }, `${peripheralId}-x`));
              }

              // Create Y Axis emulator
              if (!this.stepperEmulators.has(yKey)) {
                console.log(`[BIAXIAL] Wiring Y Axis emulator for node ${peripheralId}`);
                let pending: any = null;
                let rafPending = false;

                const gearRatioStr = peripheralNode.data?.gearRatio || '1:1';
                let stepsPerRev: number;
                const overrideSteps = peripheralNode.data?.stepsPerRev ?? peripheralNode.data?.stepsPerRevolution;
                if (typeof overrideSteps === 'number' && overrideSteps > 0) {
                  stepsPerRev = Math.round(overrideSteps);
                } else {
                  stepsPerRev = 2048; // Default to 2048 for Biaxial
                  const parts = gearRatioStr.split(':');
                  if (parts.length === 2) {
                    const num = parseFloat(parts[0]);
                    const den = parseFloat(parts[1]);
                    if (!isNaN(num) && !isNaN(den) && den > 0) {
                      stepsPerRev = Math.round(2048 * (num / den));
                    }
                  }
                }

                this.stepperEmulators.set(yKey, new StepperEmulator((state) => {
                  pending = state;
                  if (!rafPending) {
                    rafPending = true;
                    requestAnimationFrame(() => {
                      rafPending = false;
                      if (pending) {
                        const s = pending;
                        pending = null;
                        const mmPerStep = peripheralNode.data?.mmPerStep ?? 1.0;
                        const moving = s.currentSpeed > 0.1;
                        const dir = moving ? (s.direction === 1 ? 'CW' : 'CCW') : 'STOP';
                        const rpmVal = (s.currentSpeed * 60) / stepsPerRev;

                        const steps = s.currentSteps ?? s.stepCount;
                        let angle = (steps % stepsPerRev) * 360.0 / stepsPerRev;
                        if (angle < 0) {
                          angle += 360.0;
                        }

                        const currentData = useForgeStore.getState().nodes.find(n => n.id === peripheralId)?.data || {};

                        updateNodeData(peripheralId, {
                          // preserve existing X state
                          xSteps: currentData.xSteps ?? 0,
                          xAngle: currentData.xAngle ?? 0,
                          xRPM: currentData.xRPM ?? 0,
                          xDirection: currentData.xDirection ?? 'STOP',
                          xTotalDegrees: currentData.xTotalDegrees ?? 0,
                          xPosition: currentData.xPosition ?? 0,
                          xEnergized: currentData.xEnergized ?? false,

                          ySteps: steps,
                          yAngle: angle,
                          yRPM: rpmVal,
                          yDirection: dir,
                          yTotalDegrees: s.actualAngleUnbounded ?? s.angle,
                          yPosition: steps * mmPerStep,
                          yEnergized: s.energized
                        });
                      }
                    });
                  }
                }, { stepsPerRev, constrainRotation: false }, `${peripheralId}-y`));
              }

              const xStepper = this.stepperEmulators.get(xKey)!;
              const yStepper = this.stepperEmulators.get(yKey)!;

              // Route pins to the correct emulator
              // X Axis coils: A1-, A1+, B1+, B1- (Wokwi physical order)
              if (['A1+', 'A1-', 'B1+', 'B1-'].includes(peripheralPinName)) {
                xStepper.processCoils(
                  !!buf['A1-'],
                  !!buf['A1+'],
                  !!buf['B1+'],
                  !!buf['B1-'],
                );
              }
              // Y Axis coils: A2-, A2+, B2+, B2- (Wokwi physical order)
              if (['A2+', 'A2-', 'B2+', 'B2-'].includes(peripheralPinName)) {
                yStepper.processCoils(
                  !!buf['A2-'],
                  !!buf['A2+'],
                  !!buf['B2+'],
                  !!buf['B2-'],
                );
              }
            }

            // --- NeoPixel Emulation (WS2812B protocol) ---
            // Handled via addRawListener above — every edge is captured without deduplication.

            // --- A4988 Stepper Driver Emulation ---
            // Bridges STEP/DIR from Arduino to the stepper motor connected on 1A/1B/2A/2B
            // Full A4988 feature set: microstepping (MS1/MS2/MS3), ENABLE, RESET, SLEEP
            if (peripheralNode.data?.type === 'a4988') {
              const buf = this.peripheralPinBuffers.get(peripheralId)!;
              buf[peripheralPinName] = isHigh;

              // A4988 microstep resolution table (MS3, MS2, MS1)
              // MS3 MS2 MS1 → microstep divisor
              //  0   0   0  → full step  (1)
              //  0   0   1  → half step  (2)
              //  0   1   0  → 1/4 step   (4)
              //  0   1   1  → 1/8 step   (8)
              //  1   1   1  → 1/16 step  (16)
              //
              // A4988 internal pull resistors (when pin is not connected):
              // MS1, MS2, MS3 → internal 100kΩ pull-down (default LOW = full step)
              // ENABLE → internal 100kΩ pull-down (default LOW = enabled)
              // RESET  → internal 100kΩ pull-UP (default HIGH = normal operation)
              // SLEEP  → internal 100kΩ pull-UP (default HIGH = normal operation)
              const ms1 = buf['MS1'] === true;
              const ms2 = buf['MS2'] === true;
              const ms3 = buf['MS3'] === true;
              let microstepDivisor = 1;
              if (!ms3 && !ms2 && !ms1) microstepDivisor = 1;   // full
              else if (!ms3 && !ms2 && ms1) microstepDivisor = 2;   // half
              else if (!ms3 && ms2 && !ms1) microstepDivisor = 4;   // 1/4
              else if (!ms3 && ms2 && ms1) microstepDivisor = 8;    // 1/8
              else if (ms3 && ms2 && ms1) microstepDivisor = 16;    // 1/16

              // ENABLE: active LOW. Internal pull-down → enabled by default.
              const enabled = buf['ENABLE'] !== true;
              // RESET: active LOW. Internal pull-UP → normal by default.
              const resetActive = buf['RESET'] === false;
              // SLEEP: active LOW. Internal pull-UP → normal by default.
              const sleeping = buf['SLEEP'] === false;

              // RESET and SLEEP only gate the energized state via driverActive → setEnergized().
              // The internal step counter is NOT reset — the sequencer tracks position even during
              // sleep/reset, matching Wokwi and real A4988 behavior (output drivers are gated, not position).

              // driverActive gates the energized state (not position tracking)
              const driverActive = enabled && !sleeping && !resetActive;

              // Update visual state for A4988 element
              const a4988State = {
                enable: buf['ENABLE'] === true,
                ms1, ms2, ms3,
                reset: !resetActive,
                sleep: !sleeping,
                step: buf['STEP'] === true,
                dir: buf['DIR'] === true,
                driverActive,
                microstepDivisor,
              };
              updateNodeData(peripheralId, a4988State);

              // Always process STEP/DIR — A4988 internal sequencer tracks position
              // even during sleep/reset; only the motor coil outputs are gated.
              if (peripheralPinName === 'STEP' || peripheralPinName === 'DIR') {
                // Find the stepper motor connected to this A4988's motor pins
                const motorEdges = currentStateStore.edges.filter(e =>
                  (e.source === peripheralId && ['1A', '1B', '2A', '2B'].includes(e.sourceHandle || '')) ||
                  (e.target === peripheralId && ['1A', '1B', '2A', '2B'].includes(e.targetHandle || ''))
                );

                const motorNodeId = motorEdges.length > 0
                  ? (motorEdges[0].source === peripheralId ? motorEdges[0].target : motorEdges[0].source)
                  : null;

                if (motorNodeId) {
                  const motorNode = currentStateStore.nodes.find(n => n.id === motorNodeId);
                  const isBiaxial = motorNode?.data?.type === 'biaxial-stepper';

                  if (isBiaxial) {
                    const biaxialEdges = currentStateStore.edges.filter(e =>
                      (e.source === peripheralId && motorEdges.some(me => me === e)) ||
                      (e.target === peripheralId && motorEdges.some(me => me === e))
                    );
                    const connectedBiaxialPins = biaxialEdges.map(e =>
                      e.source === motorNodeId ? e.sourceHandle : e.targetHandle
                    );
                    const isY = connectedBiaxialPins.some(p => p && ['A2+', 'A2-', 'B2+', 'B2-'].includes(p));
                    const shaftKey = isY ? `${motorNodeId}__y` : `${motorNodeId}__x`;
                    const shaftLabel = isY ? 'y' : 'x';

                    if (!this.stepperEmulators.has(shaftKey)) {
                      console.log(`[BIAXIAL] Wiring A4988 STEP/DIR emulator for ${shaftLabel} shaft of node ${motorNodeId}`);
                      let pending: any = null;
                      let rafPending = false;

                      const overrideSteps = motorNode?.data?.stepsPerRev ?? motorNode?.data?.stepsPerRevolution;
                      let stepsPerRev = 2048; // default to 2048 for Biaxial
                      if (typeof overrideSteps === 'number' && overrideSteps > 0) {
                        stepsPerRev = Math.round(overrideSteps);
                      } else {
                        const gearRatioStr = motorNode?.data?.gearRatio || '1:1';
                        const parts = gearRatioStr.split(':');
                        if (parts.length === 2) {
                          const num = parseFloat(parts[0]);
                          const den = parseFloat(parts[1]);
                          if (!isNaN(num) && !isNaN(den) && den > 0) {
                            stepsPerRev = Math.round(2048 * (num / den));
                          }
                        }
                      }

                      this.stepperEmulators.set(shaftKey, new StepperEmulator((state) => {
                        pending = state;
                        if (!rafPending) {
                          rafPending = true;
                          requestAnimationFrame(() => {
                            rafPending = false;
                            if (pending) {
                              const s = pending;
                              pending = null;
                              const mmPerStep = motorNode?.data?.mmPerStep ?? 1.0;
                              const moving = s.currentSpeed > 0.1;
                              const dir = moving ? (s.direction === 1 ? 'CW' : 'CCW') : 'STOP';
                              const rpmVal = (s.currentSpeed * 60) / stepsPerRev;

                              const steps = s.currentSteps ?? s.stepCount;
                              let angle = (steps % stepsPerRev) * 360.0 / stepsPerRev;
                              if (angle < 0) {
                                angle += 360.0;
                              }

                              const currentData = useForgeStore.getState().nodes.find(n => n.id === motorNodeId)?.data || {};

                              if (isY) {
                                updateNodeData(motorNodeId, {
                                  xSteps: currentData.xSteps ?? 0,
                                  xAngle: currentData.xAngle ?? 0,
                                  xRPM: currentData.xRPM ?? 0,
                                  xDirection: currentData.xDirection ?? 'STOP',
                                  xTotalDegrees: currentData.xTotalDegrees ?? 0,
                                  xPosition: currentData.xPosition ?? 0,
                                  xEnergized: currentData.xEnergized ?? false,

                                  ySteps: steps,
                                  yAngle: angle,
                                  yRPM: rpmVal,
                                  yDirection: dir,
                                  yTotalDegrees: s.actualAngleUnbounded ?? s.angle,
                                  yPosition: steps * mmPerStep,
                                  yEnergized: s.energized
                                });
                              } else {
                                updateNodeData(motorNodeId, {
                                  xSteps: steps,
                                  xAngle: angle,
                                  xRPM: rpmVal,
                                  xDirection: dir,
                                  xTotalDegrees: s.actualAngleUnbounded ?? s.angle,
                                  xPosition: steps * mmPerStep,
                                  xEnergized: s.energized,

                                  ySteps: currentData.ySteps ?? 0,
                                  yAngle: currentData.yAngle ?? 0,
                                  yRPM: currentData.yRPM ?? 0,
                                  yDirection: currentData.yDirection ?? 'STOP',
                                  yTotalDegrees: currentData.yTotalDegrees ?? 0,
                                  yPosition: currentData.yPosition ?? 0,
                                  yEnergized: currentData.yEnergized ?? false
                                });
                              }
                            }
                          });
                        }
                      }, { stepsPerRev, constrainRotation: false, microstepDivisor }, `${motorNodeId}-${shaftLabel}`));
                    }
                    const stepper = this.stepperEmulators.get(shaftKey)!;
                    // Update microstep divisor if changed
                    stepper.setSteppingMode('micro', microstepDivisor);
                    // Route STEP rising-edge and DIR level to the stepper emulator.
                    // This correctly handles AccelStepper DRIVER mode and the 2-wire
                    // Stepper(steps, stepPin, dirPin) constructor.
                    if (peripheralPinName === 'STEP') {
                      stepper.processStep(isHigh);
                    } else if (peripheralPinName === 'DIR') {
                      stepper.setDirection(isHigh);
                    }
                  } else {
                    if (!this.stepperEmulators.has(motorNodeId)) {
                      console.log(`[STEPPER] Wiring A4988 STEP/DIR emulator for motor node ${motorNodeId}`);
                      let pendingUpdate: { angle: number; stepCount: number; energized: boolean } | null = null;
                      let rafScheduled = false;

                      const motorNode = currentStateStore.nodes.find(n => n.id === motorNodeId);
                      const overrideSteps = motorNode?.data?.stepsPerRev ?? motorNode?.data?.stepsPerRevolution;
                      let stepsPerRev = 200;
                      if (typeof overrideSteps === 'number' && overrideSteps > 0) {
                        stepsPerRev = Math.round(overrideSteps);
                      } else {
                        const gearRatioStr = motorNode?.data?.gearRatio || '1:1';
                        const parts = gearRatioStr.split(':');
                        if (parts.length === 2) {
                          const num = parseFloat(parts[0]);
                          const den = parseFloat(parts[1]);
                          if (!isNaN(num) && !isNaN(den) && den > 0) {
                            stepsPerRev = Math.round(200 * (num / den));
                          }
                        }
                      }

                      this.stepperEmulators.set(motorNodeId, new StepperEmulator(({ angle, stepCount, energized }) => {
                        pendingUpdate = { angle, stepCount, energized };
                        if (!rafScheduled) {
                          rafScheduled = true;
                          requestAnimationFrame(() => {
                            rafScheduled = false;
                            if (pendingUpdate) {
                              const { angle: a, stepCount: s, energized: e } = pendingUpdate;
                              pendingUpdate = null;
                              const displayAngle = ((a % 360) + 360) % 360;
                              updateNodeData(motorNodeId, {
                                angle: a,
                                stepCount: s,
                                energized: e,
                                value: `${displayAngle.toFixed(1)}°`,
                                units: `${s > 0 ? '+' : ''}${s} steps`,
                                microstepDivisor,
                              });
                            }
                          });
                        }
                      }, { stepsPerRev, constrainRotation: false, microstepDivisor }, motorNodeId));
                    }
                    const stepper = this.stepperEmulators.get(motorNodeId)!;
                    stepper.setSteppingMode('micro', microstepDivisor);

                    // Route STEP rising-edge and DIR level to the stepper emulator.
                    if (peripheralPinName === 'STEP') {
                      stepper.processStep(isHigh);
                    } else if (peripheralPinName === 'DIR') {
                      stepper.setDirection(isHigh);
                    }
                  }
                }
              }

              // For non-STEP/DIR pin changes (ENABLE, RESET, SLEEP, MSx), update
              // the motor energized state.  Only ENABLE gates the output.
              if (peripheralPinName !== 'STEP' && peripheralPinName !== 'DIR') {
                const motorEdges = currentStateStore.edges.filter(e =>
                  (e.source === peripheralId && ['1A', '1B', '2A', '2B'].includes(e.sourceHandle || '')) ||
                  (e.target === peripheralId && ['1A', '1B', '2A', '2B'].includes(e.targetHandle || ''))
                );
                const motorNodeId = motorEdges.length > 0
                  ? (motorEdges[0].source === peripheralId ? motorEdges[0].target : motorEdges[0].source)
                  : null;
                if (motorNodeId) {
                  const motorNode = currentStateStore.nodes.find(n => n.id === motorNodeId);
                  if (motorNode?.data?.type === 'biaxial-stepper') {
                    const connectedPins = motorEdges.map(e =>
                      e.source === motorNodeId ? e.sourceHandle : e.targetHandle
                    );
                    const isY = connectedPins.some(p => p && ['A2+', 'A2-', 'B2+', 'B2-'].includes(p));
                    const shaftKey = isY ? `${motorNodeId}__y` : `${motorNodeId}__x`;
                    this.stepperEmulators.get(shaftKey)?.setEnergized(enabled);
                  } else {
                    this.stepperEmulators.get(motorNodeId)?.setEnergized(enabled);
                  }
                }
              }

            }

            // Update the target peripheral's UI state so standard Leap Elements react
            // Skip for complex peripherals that manage their own state
            if (!isComplexPeripheral) {
              const pinName = `${peripheralId}_${peripheralPinName}`;
              const isPWM = !!buf[`_isPWM_${pinName}`];
              if (!isPWM) {
                const currentPinStates = peripheralNode.data?.pinStates || {};
                if (currentPinStates[`pin_${peripheralPinName}`] !== isHigh) {
                  updateNodeData(peripheralId, {
                    pinStates: {
                      ...currentPinStates,
                      [`pin_${peripheralPinName}`]: isHigh
                    }
                  });
                }
              }
            }
          }
        };

        // Attach to the simulation runner
        // ── AVR path ──────────────────────────────────────────────────────────
        simulationRunner.addListener(avrPin, listener);

        // Log ESP32 listener mapping
        const esp32PType = nodes.find(n => n.id === peripheralId)?.data?.type;
        if (isESP32Board) {
          console.log(`[ESP32 LISTENER] Mapped listener for ${pinId} ← Board[${arduinoPinName}] → Peripheral[${peripheralId.slice(0, 8)}/${peripheralPinName}] (type=${esp32PType || '?'})`);
        }
        if (esp32PType === '7segment') {
          console.log(`[CIRCUIT 7SEG] Registered listener for ${avrPin} → peripheral pin ${peripheralPinName}`);
        }

        // For NeoPixel DIN pins: also attach a RAW listener that fires on every edge
        // (WS2812B protocol requires every HIGH/LOW transition, dedup breaks it)
        let neoRawListener: ((portLetter: string, bit: number, isHigh: boolean, cycles: number) => void) | null = null;
        const peripheralNodeForNeo = nodes.find(n => n.id === peripheralId);
        if (
          peripheralNodeForNeo &&
          ['neopixel', 'neopixel-matrix', 'led-ring'].includes(peripheralNodeForNeo.data?.type) &&
          peripheralPinName === 'DIN'
        ) {
          const neoType = peripheralNodeForNeo.data.type;
          const numPixels = neoType === 'neopixel' ? 1
            : neoType === 'led-ring' ? (peripheralNodeForNeo.data?.pixels ?? 16)
              : (peripheralNodeForNeo.data?.rows ?? 8) * (peripheralNodeForNeo.data?.cols ?? 8);

          const emitter = new NeoPixelEmulator(numPixels, 16, (pixels) => {
            if (neoType === 'neopixel' && pixels.length > 0) {
              updateNodeData(peripheralId, {
                neopixelR: pixels[0].r / 255,
                neopixelG: pixels[0].g / 255,
                neopixelB: pixels[0].b / 255,
              });
            } else {
              updateNodeData(peripheralId, { neopixelPixels: pixels });
            }
          });
          this.neoPixelEmulators.set(peripheralId, emitter);

          neoRawListener = (_portLetter, _bit, isHigh, cycles) => {
            emitter.processSignal(isHigh, cycles);
          };
          simulationRunner.addRawListener(avrPin, neoRawListener);
        }

        // Store the unsubscribe thunk to clean up if the wire is deleted
        this.activeSubscriptions.set(edge.id, () => {
          simulationRunner.removeListener(avrPin, listener);

          if (neoRawListener) simulationRunner.removeRawListener(avrPin, neoRawListener);

          // Clean up any pending PWM timeouts
          const buf = this.peripheralPinBuffers.get(peripheralId);
          if (buf) {
            const pinName = `${peripheralId}_${peripheralPinName}`;
            if (buf[`_timer_${pinName}`]) {
              clearTimeout(buf[`_timer_${pinName}`]);
              buf[`_timer_${pinName}`] = null;
            }
          }
        });

        // Initial state injection for slider-based sensors once after the AVR has had a chance to
        // run setup() and configure DDR/ADC. We defer by one event-loop turn.
        const initPeripheralNode = nodes.find(n => n.id === peripheralId);
        if (initPeripheralNode && initPeripheralNode.data) {
          const type = initPeripheralNode.data.type;

          setTimeout(() => {
            const freshNode = useForgeStore.getState().nodes.find(n => n.id === peripheralId);
            const nodeData = freshNode?.data || initPeripheralNode.data;

            // PIR motion sensor
            if (type === 'pir-motion-sensor' && peripheralPinName === 'OUT') {
              const initialMotion = nodeData.sensorValues?.motionDetected ?? false;
              simulationRunner.setVirtualInput(avrPin, initialMotion);
              console.log(`[FORGE CIRCUIT] PIR (${peripheralId}) initial state injected: ${initialMotion ? 'HIGH' : 'LOW'} on ${avrPin}`);
            }
            // IR Obstacle sensor (Active-LOW: LOW when obstacle detected)
            else if (type === 'ir-obstacle-sensor' && peripheralPinName === 'OUT') {
              const obstacle = nodeData.sensorValues?.obstacleDetected ?? false;
              const initialPinState = !obstacle;
              simulationRunner.setVirtualInput(avrPin, initialPinState);
              console.log(`[FORGE CIRCUIT] IR Obstacle (${peripheralId}) initial state injected: ${initialPinState ? 'HIGH' : 'LOW'} on ${avrPin}`);
            }
            // Proximity Sensor (Active-LOW: LOW when object detected)
            else if (type === 'proximity-sensor' && peripheralPinName === 'OUT') {
              const detected = nodeData.sensorValues?.obstacleDetected ?? false;
              const initialPinState = !detected;
              simulationRunner.setVirtualInput(avrPin, initialPinState);
              console.log(`[FORGE CIRCUIT] Proximity (${peripheralId}) initial state injected: ${initialPinState ? 'HIGH' : 'LOW'} on ${avrPin}`);
            }
            // Potentiometer & Slide Potentiometer
            else if ((type === 'potentiometer' || type === 'slide-potentiometer') && peripheralPinName === 'SIG') {
              this.pushInputSignal(peripheralId, 'SIG', true);
            }
            // MQ2 Gas Sensor
            else if (type === 'mq2' && (peripheralPinName === 'OUT' || peripheralPinName === 'AOUT')) {
              this.pushInputSignal(peripheralId, peripheralPinName, true);
            }
            // NTC Temperature Sensor
            else if (type === 'ntc-temperature-sensor' && peripheralPinName === 'OUT') {
              this.pushInputSignal(peripheralId, 'OUT', true);
            }
            // Photoresistor (LDR) & Photoresistor Sensor Module
            else if ((type === 'photoresistor-sensor' || type === 'photoresistor') && (peripheralPinName === 'AO' || peripheralPinName === 'DO')) {
              this.pushInputSignal(peripheralId, peripheralPinName, true);
            }
            // Flame Sensor
            else if (type === 'flame-sensor' && (peripheralPinName === 'AOUT' || peripheralPinName === 'DOUT')) {
              this.pushInputSignal(peripheralId, peripheralPinName, true);
            }
            // Gas Sensor
            else if (type === 'gas-sensor' && (peripheralPinName === 'AOUT' || peripheralPinName === 'DOUT')) {
              this.pushInputSignal(peripheralId, peripheralPinName, true);
            }
            // Rain Sensor
            else if (type === 'rain-sensor' && (peripheralPinName === 'AO' || peripheralPinName === 'DO')) {
              this.pushInputSignal(peripheralId, peripheralPinName, true);
            }
            // Soil Moisture Sensor
            else if (type === 'soil-moisture-sensor' && (peripheralPinName === 'AO' || peripheralPinName === 'DO')) {
              this.pushInputSignal(peripheralId, peripheralPinName, true);
            }
            // Water Level Float Sensor
            else if (type === 'water-level-float-sensor' && (peripheralPinName === 'S' || peripheralPinName === 'AO' || peripheralPinName === 'OUT' || peripheralPinName === 'DO')) {
              const val = Number(nodeData.sensorValues?.value ?? nodeData.value ?? 0);
              const thresh = Number(nodeData.threshold ?? 50);
              const isTriggered = val >= thresh;
              this.pushInputSignal(peripheralId, peripheralPinName, isTriggered);
              console.log(`[FORGE CIRCUIT] Water Level Float Sensor (${peripheralId}) pin ${peripheralPinName} injected: level=${val}%, thresh=${thresh}%, state=${isTriggered ? 'HIGH' : 'LOW'}`);
            }
            // Sound Sensors
            else if ((type === 'big-sound-sensor' || type === 'small-sound-sensor') && (peripheralPinName === 'AOUT' || peripheralPinName === 'DOUT')) {
              this.pushInputSignal(peripheralId, peripheralPinName, true);
            }
          }, 1);
        }
      });
    });
  }

  /**
   * Push live MPU6050 sensor values from the SensorOverlay sliders into the I2C emulator.
   * Called whenever any slider changes.
   */
  public pushMPU6050Values(nodeId: string, values: {
    accelX: number; accelY: number; accelZ: number;
    gyroX: number; gyroY: number; gyroZ: number;
    temp: number;
  }) {
    const slave = this.mpu6050Slaves.get(nodeId);
    if (slave) {
      slave.setSensorValues(values);
    }
  }

  /**
   * Push a key press/release into the membrane keypad emulator.
   * Called by LeapNode when it receives 'button-press' / 'button-release' events.
   */
  public pushKeypadKey(nodeId: string, key: string | null) {
    const emulator = this.keypadEmulators.get(nodeId);
    if (emulator) {
      emulator.pressKey(key);
    }
    // Persist pressed key in node data so transpiled sketch can read it
    const { updateNodeData } = useForgeStore.getState();
    updateNodeData(nodeId, { pressedKey: key });
  }

  public releaseKeypadKey(nodeId: string, key: string | null) {
    const emulator = this.keypadEmulators.get(nodeId);
    if (emulator) {
      emulator.releaseKey(key);
    }
    const { updateNodeData } = useForgeStore.getState();
    const currentNode = useForgeStore.getState().nodes.find(n => n.id === nodeId);
    if (key === null || currentNode?.data?.pressedKey === key) {
      updateNodeData(nodeId, { pressedKey: null });
    }
  }

  /**
   * Push a dial digit into the rotary-dialer emulator.
   * Called by LeapNode when it receives 'dial-start' events.
   */
  public pushRotaryDialerDigit(nodeId: string, digit: number) {
    const emulator = this.rotaryDialerEmulators.get(nodeId);
    if (emulator) {
      emulator.dial(digit);
    }
    console.log(`[FORGE CIRCUIT] Rotary Dialer (${nodeId}) digit ${digit}`);
  }

  /**
   * Toggle the tilt switch state.
   * Called by LeapNode when it receives 'tilt-toggle' events.
   */
  public pushTiltSwitchState(nodeId: string, tilted: boolean) {
    const emulator = this.tiltSwitchEmulators.get(nodeId);
    if (emulator) {
      emulator.setTilted(tilted);
    }
    // Persist tilt state in node data for UI visualization
    const { updateNodeData } = useForgeStore.getState();
    updateNodeData(nodeId, {
      sensorValues: { tilted }
    });
    console.log(`[FORGE CIRCUIT] Tilt Switch (${nodeId}) state: ${tilted ? 'TILTED' : 'UPRIGHT'}`);
  }

  /**
   * Update the slide switch position (0, 1, or 2).
   * Called by LeapNode when it receives 'input' events from slide-switch.
   */
  public pushSlideSwitchState(nodeId: string, value: number) {
    // Slide switch typically has 2 or 3 positions (we support both)
    const { updateNodeData, edges, nodes } = useForgeStore.getState();
    updateNodeData(nodeId, {
      value: value,
      sensorValues: { position: value }
    });

    const boardTypes = ['arduino-uno', 'esp32-c3', 'esp32', 'arduino-nano', 'arduino-mega', 'attiny85'];

    // Helper to trace if a slide switch pin is connected to VCC or GND
    const getPinVoltageSource = (pinName: string): 'VCC' | 'GND' | null => {
      const connectedEdges = edges.filter(e => 
        (e.source === nodeId && e.sourceHandle?.replace(/__target$/, '') === pinName) ||
        (e.target === nodeId && e.targetHandle?.replace(/__target$/, '') === pinName)
      );

      for (const edge of connectedEdges) {
        const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
        const otherPinName = (edge.source === nodeId ? edge.targetHandle : edge.sourceHandle)?.replace(/__target$/, '') || '';
        const otherNode = nodes.find(n => n.id === otherNodeId);
        
        if (otherNode) {
          const isBoard = boardTypes.includes(otherNode.data?.type);
          if (isBoard) {
            if (['5V', '3V3', '3.3V', 'VCC', 'VIN'].includes(otherPinName)) {
              return 'VCC';
            }
            if (['GND', 'GND.1', 'GND.2', 'GND.3', 'GROUND'].includes(otherPinName)) {
              return 'GND';
            }
          } else {
            // Trace this pin to see if it reaches board GND or VCC
            const targets = this.traceNet(nodeId, pinName);
            for (const t of targets) {
              const tNode = nodes.find(n => n.id === t.nodeId);
              if (tNode && boardTypes.includes(tNode.data?.type)) {
                if (['5V', '3V3', '3.3V', 'VCC', 'VIN'].includes(t.pinName)) {
                  return 'VCC';
                }
                if (['GND', 'GND.1', 'GND.2', 'GND.3', 'GROUND'].includes(t.pinName)) {
                  return 'GND';
                }
              }
            }
          }
        }
      }
      return null;
    };

    const hasConnection = (pinName: string): boolean => {
      return edges.some(e => 
        (e.source === nodeId && e.sourceHandle?.replace(/__target$/, '') === pinName) ||
        (e.target === nodeId && e.targetHandle?.replace(/__target$/, '') === pinName)
      );
    };

    // Traced voltage sources
    const source1 = getPinVoltageSource('1'); // Common
    const source2 = getPinVoltageSource('2'); // NO
    const source3 = getPinVoltageSource('3'); // NC

    // Switch position state:
    // If value is 1 (for 2-position) or 2 (for 3-position), it is ON (connecting Common & NO).
    // If value is 0, it is OFF (connecting Common & NC).
    const isOn = value > 0;

    // Calculate signal for each pin if connected
    if (hasConnection('1')) {
      let signal1 = false;
      if (isOn) {
        if (source2 === 'VCC') signal1 = true;
        else if (source2 === 'GND') signal1 = false;
        else {
          // Default to opposite of NC's source if NC is connected to a source
          if (source3 === 'VCC') signal1 = false;
          else if (source3 === 'GND') signal1 = true;
          else signal1 = false;
        }
      } else {
        if (source3 === 'VCC') signal1 = true;
        else if (source3 === 'GND') signal1 = false;
        else {
          // Default to opposite of NO's source if NO is connected to a source
          if (source2 === 'VCC') signal1 = false;
          else if (source2 === 'GND') signal1 = true;
          else signal1 = true; // Default OFF is HIGH (assuming pull-up)
        }
      }
      this.pushInputSignal(nodeId, '1', signal1);
    }

    if (hasConnection('2')) {
      let signal2 = false;
      if (isOn) {
        if (source1 === 'VCC') signal2 = true;
        else if (source1 === 'GND') signal2 = false;
        else if (source3 === 'GND') signal2 = true;
        else signal2 = true;
      } else {
        if (source1 === 'VCC') signal2 = false;
        else if (source1 === 'GND') signal2 = true;
        else signal2 = false;
      }
      this.pushInputSignal(nodeId, '2', signal2);
    }

    if (hasConnection('3')) {
      let signal3 = false;
      if (!isOn) {
        if (source1 === 'VCC') signal3 = true;
        else if (source1 === 'GND') signal3 = false;
        else signal3 = true;
      } else {
        if (source1 === 'VCC') signal3 = false;
        else if (source1 === 'GND') signal3 = true;
        else signal3 = false;
      }
      this.pushInputSignal(nodeId, '3', signal3);
    }

    console.log(`[FORGE CIRCUIT] Slide Switch (${nodeId}) position: ${value}, isOn: ${isOn}`);
  }


  /**
   * Update the pushbutton state (pressed or released).
   * Traces whether the button is wired to GND (active-LOW) or VCC (active-HIGH)
   * to push the correct digital signal to the connected board pin(s).
   */
  public pushPushbuttonState(nodeId: string, pressed: boolean) {
    const { nodes, edges } = useForgeStore.getState();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Persist pressed state in node data for UI representation
    const { updateNodeData } = useForgeStore.getState();
    updateNodeData(nodeId, {
      sensorValues: { pressed }
    });

    // Find all connected edges
    const connectedEdges = edges.filter(e => e.source === nodeId || e.target === nodeId);
    
    let hasGndConnection = false;
    let hasVccConnection = false;
    const boardPins: { pinName: string }[] = [];

    for (const edge of connectedEdges) {
      const buttonPin = (edge.source === nodeId ? edge.sourceHandle : edge.targetHandle)?.replace(/__target$/, '') || '';
      const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
      const otherPinName = (edge.source === nodeId ? edge.targetHandle : edge.sourceHandle)?.replace(/__target$/, '') || '';
      const otherNode = nodes.find(n => n.id === otherNodeId);
      
      if (otherNode) {
        const isBoard = otherNode.data?.type === 'arduino-uno' || otherNode.data?.type === 'esp32-c3' || otherNode.data?.type === 'esp32';
        if (isBoard) {
          const isPower = ['5V', '3V3', '3.3V', 'VCC', 'VIN'].includes(otherPinName);
          const isGnd = ['GND', 'GND.1', 'GND.2', 'GND.3', 'GROUND'].includes(otherPinName);
          if (isPower) {
            hasVccConnection = true;
          } else if (isGnd) {
            hasGndConnection = true;
          } else {
            boardPins.push({ pinName: buttonPin });
          }
        } else {
          // Trace this pin to see if it reaches board GND or VCC
          const targets = this.traceNet(nodeId, buttonPin);
          for (const t of targets) {
            const tNode = nodes.find(n => n.id === t.nodeId);
            if (tNode && (tNode.data?.type === 'arduino-uno' || tNode.data?.type === 'esp32-c3' || tNode.data?.type === 'esp32')) {
              if (['5V', '3V3', '3.3V', 'VCC', 'VIN'].includes(t.pinName)) {
                hasVccConnection = true;
              } else if (['GND', 'GND.1', 'GND.2', 'GND.3', 'GROUND'].includes(t.pinName)) {
                hasGndConnection = true;
              }
            }
          }
        }
      }
    }

    // Determine the signal level to push
    let signalToPush = true; // default released is HIGH (pull-up)
    if (pressed) {
      if (hasVccConnection && !hasGndConnection) {
        signalToPush = true;
      } else {
        signalToPush = false; // pulled to GND or default pressed is LOW
      }
    } else {
      if (hasVccConnection && !hasGndConnection) {
        signalToPush = false; // pulled to GND when released (assuming pull-down)
      } else {
        signalToPush = true; // pulled to VCC or default released is HIGH (pull-up)
      }
    }

    // Push the signal to all connected board pins
    for (const bp of boardPins) {
      this.pushInputSignal(nodeId, bp.pinName, signalToPush);
    }
    
    console.log(`[FORGE CIRCUIT] Pushbutton (${nodeId}) pressed=${pressed}, GND=${hasGndConnection}, VCC=${hasVccConnection}, pushing ${signalToPush ? 'HIGH' : 'LOW'} to pins:`, boardPins);
  }

  /**
   * Update the touchscreen state (coordinates and touched status).
   * Called by LeapNode when canvas touch/pointer events fire.
   */
  public setTouchState(nodeId: string, touched: boolean, x: number, y: number) {
    const { updateNodeData, nodes } = useForgeStore.getState();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Log transitions to avoid flooding the developer console on every pixel move
    const wasTouched = node.data?.sensorValues?.touched ?? false;
    if (wasTouched !== touched) {
      console.log(`[FORGE CIRCUIT] Touch Screen (${nodeId}) touched state: ${touched}`);
    }

    // Persist values in the store
    const currentValues = node.data?.sensorValues || {};
    updateNodeData(nodeId, {
      sensorValues: {
        ...currentValues,
        touched,
        touchX: x,
        touchY: y
      }
    });

    // Queue the touch event so the simulation can consume it coordinate-by-coordinate
    if (!this.touchQueues.has(nodeId)) {
      this.touchQueues.set(nodeId, []);
    }
    const queue = this.touchQueues.get(nodeId)!;

    enqueueTouchPoint(queue, touched, x, y);
  }

  public registerDisplayElement(nodeId: string, el: any) {
    this._displayElements.set(nodeId, el);
    console.log(`[TFT BRIDGE] Registered display element for node ${nodeId}`);
  }

  public unregisterDisplayElement(nodeId: string) {
    this._displayElements.delete(nodeId);
    console.log(`[TFT BRIDGE] Unregistered display element for node ${nodeId}`);
  }


  /**
   * Rotate the KY-040 encoder clockwise.
   * Called by LeapNode when it receives 'rotate-cw' events.
   */
  public pushRotaryEncoderCW(nodeId: string) {
    const emulator = this.rotaryEncoderEmulators.get(nodeId);
    if (emulator) {
      emulator.stepCW();
    }
    console.log(`[FORGE CIRCUIT] Rotary Encoder (${nodeId}) rotated CW`);
  }

  /**
   * Rotate the KY-040 encoder counter-clockwise.
   * Called by LeapNode when it receives 'rotate-ccw' events.
   */
  public pushRotaryEncoderCCW(nodeId: string) {
    const emulator = this.rotaryEncoderEmulators.get(nodeId);
    if (emulator) {
      emulator.stepCCW();
    }
    console.log(`[FORGE CIRCUIT] Rotary Encoder (${nodeId}) rotated CCW`);
  }

  /**
   * Handle IR remote button press/release events.
   * Called by LeapNode when it receives 'button-press' / 'button-release' events from IR remote.
   * @param remoteNodeId The IR remote node ID (source of the signal)
   * @param irCode The NEC protocol IR code (0x00-0xFF)
   * @param pressed Whether the button is pressed (true) or released (false)
   */
  public pushIRRemoteButton(remoteNodeId: string, irCode: number, pressed: boolean) {
    const { nodes, edges } = useForgeStore.getState();
    const { updateNodeData } = useForgeStore.getState();

    // Find all IR receivers in the circuit
    const irReceivers = nodes.filter(n => n.data?.type === 'ir-receiver');

    if (irReceivers.length === 0) {
      console.warn(`[IR REMOTE] No IR receivers found in circuit`);
      return;
    }

    // Build full NEC 32-bit hex for TranspiledJS / ESP32 path:
    // frame = [addr 0x00][~addr 0xFF][cmd][~cmd], e.g. cmd 0x30 -> 0x00FF30CF
    const cmdByte = irCode & 0xFF;
    const invByte = (~cmdByte) & 0xFF;
    const fullHex = `0x00FF${cmdByte.toString(16).padStart(2, '0').toUpperCase()}${invByte.toString(16).padStart(2, '0').toUpperCase()}`;

    // Send the IR signal to all receivers (simulating broadcast nature of IR)
    irReceivers.forEach(receiverNode => {
      if (pressed) {
        // ── TranspiledJS / ESP32 path: store code where IRrecv.decode() reads it ──
        const prevSv = receiverNode.data?.sensorValues || {};
        updateNodeData(receiverNode.id, {
          sensorValues: { ...prevSv, lastIrCode: fullHex, lastIrCommand: cmdByte },
        });
      } else {
        // Clear on release so next decode() blocks until next press
        const prevSv = useForgeStore.getState().nodes.find(n => n.id === receiverNode.id)?.data?.sensorValues || {};
        updateNodeData(receiverNode.id, {
          sensorValues: { ...prevSv, lastIrCode: null, lastIrCommand: null },
        });
      }

      const emulator = this.irReceiverEmulators.get(receiverNode.id);
      if (emulator) {
        if (pressed) {
          // NEC protocol: address byte is typically 0x00 for generic remotes
          const address = 0x00;
          emulator.transmit(address, irCode, false);
          console.log(`[IR REMOTE] Button pressed: code=0x${irCode.toString(16).padStart(2, '0')} (${fullHex}) → receiver ${receiverNode.id}`);
        } else {
          emulator.release();
          console.log(`[IR REMOTE] Button released → receiver ${receiverNode.id}`);
        }
      } else if (pressed) {
        // No AVR emulator yet (e.g. ESP32-only circuit) — TranspiledJS path above still delivers the code
        console.log(`[IR REMOTE] Button pressed: code=0x${irCode.toString(16).padStart(2, '0')} (${fullHex}) → receiver ${receiverNode.id} (transpiled path)`);
      }
    });
  }

  /**
   * Send a manual IR signal directly to a specific receiver (simulates Wokwi's popup menu).
   */
  public sendIRSignalToReceiver(nodeId: string, address: number, command: number) {
    const emulator = this.irReceiverEmulators.get(nodeId);
    if (emulator) {
      console.log(`[IR RECEIVER] Manual signal injected: addr=0x${address.toString(16)}, cmd=0x${command.toString(16)} to node ${nodeId}`);
      emulator.transmit(address, command, false);
    } else {
      console.warn(`[IR RECEIVER] Cannot send signal: emulator not found for node ${nodeId}`);
    }
  }

  /**
   * Push analog values from analog-joystick into CircuitEngine.
   */
  public pushJoystickAnalog(nodeId: string, x: number, y: number) {
    const { updateNodeData, nodes } = useForgeStore.getState();
    const peripheralNode = nodes.find(n => n.id === nodeId);
    if (!peripheralNode) return;

    updateNodeData(nodeId, {
      sensorValues: { ...peripheralNode.data?.sensorValues, xValue: x, yValue: y }
    });

    // We trigger pushInputSignal, passing false for digital isHigh since it's analog
    this.pushInputSignal(nodeId, 'HORZ', false);
    this.pushInputSignal(nodeId, 'VERT', false);
  }

  public resetStepper(nodeId: string) {
    const emulator = this.unifiedStepperEmulators.get(nodeId);
    if (!emulator) return;
    emulator.resetState();
    const { updateNodeData } = useForgeStore.getState();
    updateNodeData(nodeId, emulator.getState());
  }

  /**
   * Called by interactive UI nodes (e.g. Buttons, PIR sensors) to push signals backwards into the board.
   * Handles both AVR (Arduino) and ESP32 boards.
   */
  public pushInputSignal(nodeId: string, pinName: string, isHigh: boolean) {
    console.log(`[FORGE CIRCUIT] Peripheral Node ${nodeId} requesting inject on pin ${pinName} to ${isHigh ? 'HIGH' : 'LOW'}`);
    const { edges, nodes } = useForgeStore.getState();

    let wire = edges.find(e => {
      const sHandle = (e.sourceHandle || '').replace(/__target$/, '');
      const tHandle = (e.targetHandle || '').replace(/__target$/, '');
      const srcMatch = e.source === nodeId && (e.sourceHandle === pinName || e.sourceHandle === `${pinName}__target` || sHandle === pinName);
      const tgtMatch = e.target === nodeId && (e.targetHandle === pinName || e.targetHandle === `${pinName}__target` || tHandle === pinName);
      return srcMatch || tgtMatch;
    });

    if (!wire) {
      // Robust Fallback: find any connected wire on this node that is NOT VCC or GND
      wire = edges.find(e => {
        const isSrc = e.source === nodeId;
        const isTgt = e.target === nodeId;
        if (!isSrc && !isTgt) return false;
        const handle = ((isSrc ? e.sourceHandle : e.targetHandle) || '').toUpperCase();
        return !handle.includes('VCC') && !handle.includes('GND') && !handle.includes('5V') && !handle.includes('3V') && !handle.includes('POWER');
      });
    }

    if (!wire) {
      console.warn(`[FORGE CIRCUIT] Input: no wire found for node ${nodeId} pin ${pinName}`);
      return;
    }

    const boardNodeId = wire.source === nodeId ? wire.target : wire.source;
    const boardPinName = wire.source === nodeId ? wire.targetHandle : wire.sourceHandle;
    if (!boardPinName) return;

    const boardNode = nodes.find(n => n.id === boardNodeId);
    if (!boardNode) return;

    const cleanBoardPin = boardPinName.replace(/__target$/, '');
    console.log(`[PIR-DEBUG] pushInputSignal: node=${nodeId} pin=${pinName} isHigh=${isHigh} → boardPinName="${boardPinName}" cleanBoardPin="${cleanBoardPin}" boardType="${boardNode.data?.type}"`);
    const isESP32 = boardNode.data?.type === 'esp32-c3' || boardNode.data?.type === 'esp32';

    // ── ESP32 path ────────────────────────────────────────────────────────
    if (isESP32) {
      console.log(`[ESP32 CIRCUIT] Processing input signal: node=${nodeId}, pin=${pinName}, value=${isHigh ? 'HIGH' : 'LOW'}`);

      const peripheralNode = nodes.find(n => n.id === nodeId);
      const pType = peripheralNode?.data?.type;
      const sv = peripheralNode?.data?.sensorValues;

      // Use full ESP32 pin map (handles D{n}, VP, VN, ADC pins etc.)
      const esp32Mapping = simulationRunner.convertESP32Pin(cleanBoardPin);
      if (!esp32Mapping) {
        console.warn(`[ESP32 CIRCUIT] ⚠ Failed to map pin "${cleanBoardPin}" for ${pType}`);
        return; // power/GND pin — skip
      }

      const gpioNum = parseInt(esp32Mapping.avrPin.replace('ESP', ''), 10);
      console.log(`[ESP32 CIRCUIT] Mapped pin "${cleanBoardPin}" → GPIO${gpioNum} (${esp32Mapping.avrPin})`);

      // Analog sensors → inject voltage into ESP32 ADC (3.3V reference)
      const analogSensors = [
        'potentiometer', 'slide-potentiometer', 'mq2',
        'ntc-temperature-sensor', 'photoresistor-sensor', 'flame-sensor',
        'gas-sensor', 'big-sound-sensor', 'small-sound-sensor', 'photoresistor',
        'rain-sensor', 'soil-moisture-sensor', 'heart-beat-sensor',
      ];

      // Digital-only sensors that should never use analog path
      const digitalOnlySensors = [
        'tilt-switch', 'pushbutton', 'pushbutton-6mm', 'slide-switch',
        'dip-switch-8', 'pir-motion-sensor', 'ir-obstacle-sensor', 'proximity-sensor', 'membrane-keypad', 'rotary-dialer',
        'ky-040'  // KY-040 rotary encoder (CLK, DT, SW are all digital)
      ];

      // Only use analog path if it's an analog sensor AND not a digital-only sensor
      if (analogSensors.includes(pType) && !digitalOnlySensors.includes(pType)) {
        const voltage = this.computeSensorVoltage(pType, sv, 3.3, pinName, peripheralNode);

        // ESP32-C3 transpiled path — ArduinoRuntime.setAnalogInput works for any GPIO
        if (simulationRunner.isESP32C3Board) {
          simulationRunner.setESP32C3AnalogInput(gpioNum, voltage);
        }
        else if (esp32Mapping.adcChannel !== undefined) {
          // Real hardware ADC path (native RISC-V firmware)
          simulationRunner.setESP32C3AnalogInput(gpioNum, voltage);
        }
        else {
          // No ADC available — digital threshold fallback
          simulationRunner.setVirtualInput(esp32Mapping.avrPin, voltage > 0.1);
        }
        console.log(`[FORGE CIRCUIT] ESP32 Analog: ${esp32Mapping.avrPin} = ${voltage.toFixed(3)}V (${pType})`);

        // Also inject threshold digital output pins (DO/DOUT) for dual-output sensors
        const injectESP32Threshold = (pinHandle: string, high: boolean, label: string) => {
          const w = edges.find(e => {
            const s = e.source === nodeId && (e.sourceHandle === pinHandle || e.sourceHandle === `${pinHandle}__target`);
            const t = e.target === nodeId && (e.targetHandle === pinHandle || e.targetHandle === `${pinHandle}__target`);
            return s || t;
          });
          if (!w) return;
          const bp = ((w.source === nodeId ? w.targetHandle : w.sourceHandle) ?? '').replace(/__target$/, '');
          const m = simulationRunner.convertESP32Pin(bp);
          if (m) { simulationRunner.setVirtualInput(m.avrPin, high); console.log(`[FORGE CIRCUIT] ESP32 ${label}: ${m.avrPin} = ${high ? 'HIGH' : 'LOW'}`); }
        };

        if (pType === 'photoresistor-sensor') {
          injectESP32Threshold('DO', (sv?.value ?? 500) >= (sv?.threshold ?? 500), 'LDR DO');
        } else if (pType === 'gas-sensor') {
          injectESP32Threshold('DOUT', (sv?.value ?? 0) <= (sv?.threshold ?? 50), 'Gas DOUT');
        } else if (pType === 'flame-sensor') {
          injectESP32Threshold('DOUT', (sv?.value ?? 0) <= (sv?.threshold ?? 50), 'Flame DOUT');
        } else if (pType === 'big-sound-sensor' || pType === 'small-sound-sensor') {
          injectESP32Threshold('DOUT', (sv?.value ?? 0) > (sv?.threshold ?? 50), 'Sound DOUT');
        }
        return;
      }

      // Digital sensors → inject HIGH/LOW
      simulationRunner.setVirtualInput(esp32Mapping.avrPin, isHigh);
      console.log(`[FORGE CIRCUIT] ESP32 Digital: ${esp32Mapping.avrPin} = ${isHigh ? 'HIGH' : 'LOW'}`);
      return;
    }

    // ── AVR path — now unified via convertPin ────────────────────────────
    const mapping = simulationRunner.convertPin(cleanBoardPin, false);
    if (mapping) {
      if (mapping.adcChannel !== undefined || mapping.avrPin.startsWith('ESP')) {
        // --- Analog Mapping ---
        const peripheralNode = nodes.find(n => n.id === nodeId);
        const pType = peripheralNode?.data?.type;
        const sv = peripheralNode?.data?.sensorValues;

        // Use shared voltage computation (5V for AVR)
        const voltage = this.computeSensorVoltage(pType, sv, 5.0, pinName, peripheralNode);

        simulationRunner.setAnalogInput(mapping.adcChannel!, voltage);
        console.log(`[FORGE CIRCUIT] Analog Signal: Peripheral[${nodeId}] pin ${pinName} -> ${voltage.toFixed(3)}V on ADC ch${mapping.adcChannel}`);

        // Helper: inject a digital threshold output pin (DO/DOUT) for dual-output sensors
        const injectThresholdPin = (pinHandle: string, isHigh: boolean, label: string) => {
          const wire = edges.find(e => {
            const s = e.source === nodeId && (e.sourceHandle === pinHandle || e.sourceHandle === `${pinHandle}__target`);
            const t = e.target === nodeId && (e.targetHandle === pinHandle || e.targetHandle === `${pinHandle}__target`);
            return s || t;
          });
          if (!wire) return;
          const boardPin = ((wire.source === nodeId ? wire.targetHandle : wire.sourceHandle) ?? '').replace(/__target$/, '');
          const m = simulationRunner.convertPin(boardPin, isESP32);
          if (m && m.adcChannel === undefined) {
            simulationRunner.setVirtualInput(m.avrPin, isHigh);
            console.log(`[FORGE CIRCUIT] ${label}: ${isHigh ? 'HIGH' : 'LOW'} on ${m.avrPin}`);
          }
        };

        if (pType === 'photoresistor-sensor') {
          injectThresholdPin('DO', (sv?.value ?? 500) >= (sv?.threshold ?? 500), 'LDR DO');
        }
        if (pType === 'gas-sensor') {
          injectThresholdPin('DOUT', (sv?.value ?? 0) <= (sv?.threshold ?? 50), 'Gas DOUT');
        }
        if (pType === 'flame-sensor') {
          injectThresholdPin('DOUT', (sv?.value ?? 0) <= (sv?.threshold ?? 50), 'Flame DOUT');
        }
        if (pType === 'big-sound-sensor' || pType === 'small-sound-sensor') {
          injectThresholdPin('DOUT', (sv?.value ?? 0) <= (sv?.threshold ?? 50), 'Sound DOUT');
        }
        if (pType === 'rain-sensor') {
          injectThresholdPin('DO', (sv?.value ?? 0) > (sv?.threshold ?? 50), 'Rain DO');
        }
        if (pType === 'soil-moisture-sensor') {
          injectThresholdPin('DO', (sv?.value ?? 0) > (sv?.threshold ?? 50), 'Soil DO');
        }
      } else {
        // --- Digital Mapping ---
        const peripheralNode = nodes.find(n => n.id === nodeId);
        const pType = peripheralNode?.data?.type;
        const sv = peripheralNode?.data?.sensorValues;
        const dataVal = peripheralNode?.data?.value;

        let digitalSignal = isHigh;
        if (pType === 'water-level-float-sensor') {
          const val = Number(sv?.value ?? dataVal ?? 0);
          const thresh = Number(sv?.threshold ?? peripheralNode?.data?.threshold ?? 50);
          digitalSignal = val >= thresh;
        }

        simulationRunner.setVirtualInput(mapping.avrPin, digitalSignal);
        console.log(`[FORGE CIRCUIT] Digital Signal: Peripheral[${nodeId}] (${pType}) pin ${pinName} -> ${digitalSignal ? 'HIGH' : 'LOW'} on ${mapping.avrPin}`);
      }
    } else {
      console.warn(`[FORGE CIRCUIT] pushInputSignal: could not map board pin '${cleanBoardPin}' to pin`);
    }
  }

  /**
   * Compute the analog output voltage for a sensor given its type and current sensorValues.
   * vcc: supply voltage (5.0 for Arduino, 3.3 for ESP32)
   */
  private computeSensorVoltage(pType: string, sv: any, vcc = 5.0, pinName?: string, peripheralNode?: any): number {
    const dataVal = peripheralNode?.data?.value;
    switch (pType) {
      case 'potentiometer':
      case 'slide-potentiometer': {
        // Potentiometer value is 0-1023 (raw ADC)
        // Map to 0..VCC voltage
        const rawValue = sv?.value ?? dataVal ?? 0;
        return (rawValue / 1023) * vcc;
      }
      case 'mq2': {
        // MQ2 gas sensor value is 0-1023 (raw ADC)
        // Map to 0..VCC voltage
        const rawValue = sv?.value ?? dataVal ?? 0;
        return (rawValue / 1023) * vcc;
      }
      case 'analog-joystick': {
        const x = sv?.xValue ?? 0;
        const y = sv?.yValue ?? 0;
        // x and y from element are -1 to 1.
        // Map to 0..VCC, centered at VCC/2.
        const val = pinName === 'HORZ' ? x : (pinName === 'VERT' ? y : 0);
        return (vcc / 2) + (val * (vcc / 2));
      }
      case 'ntc-temperature-sensor': {
        const tempC = sv?.value ?? dataVal ?? 25;
        const R0 = 10000, B = 3950, T0 = 298.15, Rs = 10000;
        const T = tempC + 273.15;
        const R_ntc = R0 * Math.exp(B * (1 / T - 1 / T0));
        return vcc * R_ntc / (Rs + R_ntc);
      }
      case 'photoresistor-sensor':
      case 'photoresistor': {
        const lux = sv?.value ?? dataVal ?? 500;
        const R_ldr = 500000 / Math.max(1, lux);
        return vcc * 10000 / (R_ldr + 10000);
      }
      case 'flame-sensor': {
        const intensity = sv?.value ?? dataVal ?? 0;
        return vcc * (1 - Math.max(0, Math.min(100, intensity)) / 100);
      }
      case 'gas-sensor': {
        const concentration = sv?.value ?? dataVal ?? 0;
        return vcc * Math.max(0, Math.min(100, concentration)) / 100;
      }
      case 'rain-sensor': {
        const rainLevel = sv?.value ?? dataVal ?? 0;
        return vcc * Math.max(0, Math.min(100, rainLevel)) / 100;
      }
      case 'soil-moisture-sensor':
      case 'water-level-float-sensor': {
        const moisture = sv?.value ?? dataVal ?? 0;
        return vcc * Math.max(0, Math.min(100, moisture)) / 100;
      }
      case 'big-sound-sensor':
      case 'small-sound-sensor': {
        const level = sv?.value ?? dataVal ?? 0;
        return vcc * Math.max(0, Math.min(100, level)) / 100;
      }
      default: {
        const val = sv?.value ?? dataVal ?? 0;
        return val > vcc ? (val / 1023) * vcc : val;
      }
    }
  }

  /**
   * Diagnostic method to check ESP32 circuit wiring status
   * Returns detailed information about circuit connections
   */
  public getESP32CircuitStatus(): {
    boardDetected: boolean;
    boardId: string | null;
    boardType: string | null;
    componentsWired: number;
    sensorsWired: number;
    wireCount: number;
    issues: string[];
  } {
    const { nodes, edges } = useForgeStore.getState();
    const issues: string[] = [];

    // Find ESP32 board
    const esp32Board = nodes.find(n => n.data?.type === 'esp32-c3' || n.data?.type === 'esp32');

    if (!esp32Board) {
      issues.push('No ESP32-C3 board found in circuit');
      return {
        boardDetected: false,
        boardId: null,
        boardType: null,
        componentsWired: 0,
        sensorsWired: 0,
        wireCount: 0,
        issues
      };
    }

    // Count connected components
    const connectedEdges = edges.filter(e => e.source === esp32Board.id || e.target === esp32Board.id);
    const connectedNodeIds = new Set<string>();

    connectedEdges.forEach(edge => {
      const otherId = edge.source === esp32Board.id ? edge.target : edge.source;
      connectedNodeIds.add(otherId);
    });

    const connectedNodes = nodes.filter(n => connectedNodeIds.has(n.id));

    // Categorize components
    const outputComponents = ['led', 'rgb-led', 'buzzer', 'servo', 'dc-motor', 'water-pump', 'stepperMotor', 'relay-module', '7segment', 'neopixel'];
    const inputComponents = ['button', 'potentiometer', 'ldr', 'pir-motion-sensor', 'ir-obstacle-sensor', 'dht11', 'dht22', 'hc-sr04', 'heart-beat-sensor'];

    const componentsWired = connectedNodes.filter(n => outputComponents.includes(n.data?.type)).length;
    const sensorsWired = connectedNodes.filter(n => inputComponents.includes(n.data?.type)).length;

    // Check for common issues
    if (connectedEdges.length === 0) {
      issues.push('ESP32 board has no wire connections');
    }

    // Check if simulation runner is initialized
    if (!simulationRunner.isESP32C3Board) {
      issues.push('ESP32-C3 simulation runner not initialized');
    }

    return {
      boardDetected: true,
      boardId: esp32Board.id,
      boardType: esp32Board.data?.type || null,
      componentsWired,
      sensorsWired,
      wireCount: connectedEdges.length,
      issues
    };
  }
}

export const circuitEngine = new CircuitEngine();


