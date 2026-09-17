/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { memo, useRef, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { getComponentPins } from '../../lib/PinMap';
import { useForgeStore, getCircuitEngineSync } from '../../../utils/store/useForgeStore';
import { SensorOverlay } from './SensorOverlay';
import { StepperMotorNode } from './StepperMotorNode';

const withEngine = (cb: (engine: any) => void) => {
  const engine = getCircuitEngineSync();
  if (engine) {
    cb(engine);
  } else {
    import('../../engine/Arduino/CircuitEngine').then(({ circuitEngine }) => {
      cb(circuitEngine);
    });
  }
};

// This is a generic wrapper for our internalized Leap elements (rebranded Leap)
export const LeapNode = memo(({ id, data, selected }: NodeProps) => {
  if (data.type === 'stepperMotor') {
    return <StepperMotorNode nodeId={id} data={data} selected={selected} />;
  }

  const selectedNodeId = useForgeStore((state) => state.selectedNodeId);
  const isSimulating = useForgeStore((state) => state.isSimulating);
  const wireDraft = useForgeStore((state) => state.wireDraft);
  const pendingSource = useForgeStore((state) => state.pendingSource);
  const setPendingSource = useForgeStore((state) => state.setPendingSource);
  const startWireDraft = useForgeStore((state) => state.startWireDraft);
  const completeWireDraft = useForgeStore((state) => state.completeWireDraft);
  const cancelWireDraft = useForgeStore((state) => state.cancelWireDraft);
  const isSelected = selected || selectedNodeId === id;

  // Tinkercad-style: track which pin the cursor is hovering over during a wire draft.
  // This powers the red-square target indicator shown on valid drop targets.
  const [hoveredPinName, setHoveredPinName] = useState<string | null>(null);

  // The pin that is currently the source of an in-progress wire (where the drag started)
  const isDraftSource = wireDraft?.source === id;
  const draftSourcePin = isDraftSource ? wireDraft?.sourceHandle : null;

  // The pin that the user is currently pressing the mouse down on (not yet released).
  // While a pin is "armed", the wire is NOT yet being drawn — it only appears after
  // the user releases the mouse on the pin (the "click and release" requirement).
  const isPendingSource = pendingSource?.nodeId === id;
  const pendingSourcePin = isPendingSource ? pendingSource?.pinName : null;

  // useReactFlow gives us getViewport so we can compute exact pin positions
  // in flow coordinates from the inner container's visual bounds and pin percentages.
  const { getViewport, screenToFlowPosition } = useReactFlow();

  // Subscribe only to edge count (number) — cheap comparison, no re-render during drag.
  // Full edges accessed via getState() inside useMemo.
  const edgeCount = useForgeStore((state) => state.edges.length);
  const connectedPinColors = useMemo(() => {
    const map = new Map<string, string>();
    const WIRE_COLORS: Record<string, string> = {
      green: '#22c55e', red: '#ef4444', blue: '#3b82f6',
      yellow: '#eab308', black: '#1e293b', white: '#f8fafc',
      orange: '#f97316', purple: '#a855f7', pink: '#ec4899', cyan: '#06b6d4',
    };
    for (const edge of useForgeStore.getState().edges) {
      let pinName: string | null = null;
      if (edge.source === id && edge.sourceHandle) {
        pinName = edge.sourceHandle.replace(/__target$/, '');
      }
      if (edge.target === id && edge.targetHandle) {
        pinName = edge.targetHandle.replace(/__target$/, '');
      }
      if (pinName && !map.has(pinName)) {
        const wireColor = WIRE_COLORS[edge.data?.color as string] || edge.data?.color || '#22c55e';
        map.set(pinName, wireColor);
      }
    }
    return map;
  }, [edgeCount, id]);

  // I2C variants map to the same element as their parallel counterpart
  const elementType = data.type === 'lcd1602-i2c' ? 'lcd1602'
    : data.type === 'lcd2004-i2c' ? 'lcd2004'
      : data.type;
  const Tag = `leap-${elementType}` as any;
  const pins = getComponentPins(data.type);

  // Custom styling for the node container.
  // The wrapper is intentionally invisible — no border, no border-radius, no
  // background — so the visible "box" around the component is exactly the SVG
  // silhouette (via drop-shadow on the inner container), not a generic rectangle.
  // The scale(0.75) lives on the inner SVG container so React Flow's handle
  // position calculation (which uses getBoundingClientRect on the wrapper)
  // matches the actual terminal positions on the SVG component.
  const nodeStyle: React.CSSProperties = {
    padding: 0,
    borderRadius: 0,
    background: 'transparent',
    border: 'none',
    transform: `rotate(${data.rotation || 0}deg)`,
    transformOrigin: 'center center',
    position: 'relative',
    boxSizing: 'border-box',
    cursor: 'grab',
  };

  // ── Hardware Property Mapper ──
  // Translating electrical logic (HIGH/LOW on pins) directly into Leap's visual attributes!
  const mappedProps: any = { ...data };

  if (data.type === 'led') {
    // Hardware pins are "Anode" and "Cathode". Using pin_Anode for state.
    mappedProps.value = data.pinStates?.pin_Anode === true || data.pinStates?.pin_A === true;
    mappedProps.brightness = data.brightness ?? (mappedProps.value ? 1.0 : 0.0);
    mappedProps.damaged = false;
  } else if (data.type === 'rgb-led') {
    // RGB LED uses Red, Green, and Blue channels relative to Common pin (COM)
    // We expect intensity per channel if provided by CircuitEngine, otherwise fallback to digital
    mappedProps.ledRed = data.pinStates?.pin_R === true ? (data.intensity_R ?? 1.0) : 0;
    mappedProps.ledGreen = data.pinStates?.pin_G === true ? (data.intensity_G ?? 1.0) : 0;
    mappedProps.ledBlue = data.pinStates?.pin_B === true ? (data.intensity_B ?? 1.0) : 0;
    mappedProps.damaged = false;
  } else if (data.type === 'buzzer') {
    // Buzzers use Pin 2 as Positive (Red) signal pin as per spec, or VCC as per PinHarness definitions
    if (
      data.pinStates?.pin_PIEZO === true ||
      data.pinStates?.pin_1 === true ||
      data.pinStates?.pin_2 === true ||
      data.pinStates?.pin_SIG === true ||
      data.pinStates?.pin_VCC === true ||
      data.hasSignal === true
    ) {
      mappedProps.hasSignal = true;
      mappedProps.intensity = data.intensity ?? 1.0;
      mappedProps.damaged = false;
      mappedProps.mode = data.mode ?? 'smooth';
      mappedProps.volume = data.volume ?? 1.0;
    } else {
      mappedProps.hasSignal = false;
      mappedProps.mode = data.mode ?? 'smooth';
      mappedProps.volume = data.volume ?? 1.0;
    }
  } else if (data.type === 'servo') {
    // Servos use the 'angle' property calculated in CircuitEngine
    mappedProps.angle = data.angle ?? 0;
  } else if (data.type === 'dc-motor') {
    // DC Motor: speed and direction from CircuitEngine
    mappedProps.speed = data.speed ?? 0;
    mappedProps.direction = data.direction ?? 'cw';
  } else if (data.type === 'water-pump') {
    // Water Pump: speed, running state, and direction from CircuitEngine
    const hasPowerPin = data.pinStates?.pin_POS === true || data.pinStates?.pin_VCC === true || data.pinStates?.pin_1 === true;
    mappedProps.speed = data.speed ?? (hasPowerPin ? 1.0 : 0);
    mappedProps.running = data.running ?? (mappedProps.speed > 0 || hasPowerPin);
    mappedProps.direction = data.direction ?? 'cw';
  } else if (data.type === 'water-level-float-sensor') {
    mappedProps.value = data.sensorValues?.value ?? data.value ?? 0;
    mappedProps.threshold = data.threshold ?? 50;
    mappedProps.state = data.state ?? (mappedProps.value >= mappedProps.threshold);
    mappedProps.ledPower = data.ledPower ?? true;
    mappedProps.ledSignal = data.ledSignal ?? mappedProps.state;
  } else if (data.type === 'stepper-motor') {
    mappedProps.angle = data.angle ?? 0;
    mappedProps.value = data.value ?? '';
    mappedProps.units = data.units ?? '';
    mappedProps.arrow = data.arrow ?? '';
    mappedProps.display = data.display ?? 'steps';
    mappedProps.gearRatio = data.gearRatio ?? '1:1';
    mappedProps.energized = data.energized ?? false;
    mappedProps.stepCount = data.stepCount ?? 0;
  } else if (data.type === 'ks2e-m-dc5') {
    // Relay: energized when COIL1 is HIGH (COIL2 is typically GND)
    mappedProps.energized = data.relayEnergized ?? false;
  } else if (data.type === 'relay-module') {
    // Relay Module: energized when IN pin is HIGH
    mappedProps.energized = data.relayEnergized ?? false;
    mappedProps.led = data.relayEnergized ?? false;
  } else if (data.type === 'biaxial-stepper') {
                mappedProps.outerHandAngle = data.xAngle ?? 0;
                mappedProps.innerHandAngle = data.yAngle ?? 0;
                mappedProps.xSteps = data.xSteps ?? 0;
                mappedProps.ySteps = data.ySteps ?? 0;
                mappedProps.xRPM = data.xRPM ?? 0;
                mappedProps.yRPM = data.yRPM ?? 0;
                mappedProps.xDirection = data.xDirection ?? 'STOP';
                mappedProps.yDirection = data.yDirection ?? 'STOP';
                mappedProps.xTotalDegrees = data.xTotalDegrees ?? 0;
                mappedProps.yTotalDegrees = data.yTotalDegrees ?? 0;
  } else if (['potentiometer', 'slide-potentiometer', 'ntc-temperature-sensor', 'mq2', 'resistor'].includes(data.type)) {
    // Analog sensors (and resistors) use the 'value' from sensorValues or data.value
    mappedProps.value = data.sensorValues?.value ?? data.value ?? (data.type === 'ntc-temperature-sensor' ? 25 : 0);
  } else if (data.type === 'photoresistor-sensor') {
    // Photoresistor: pass lux value, threshold, and LED states
    const sv = data.sensorValues ?? {};
    const lux = Number(sv.value ?? 500);
    const threshold = Number(sv.threshold ?? 500);
    mappedProps.value = lux;
    mappedProps.threshold = threshold;
    mappedProps.ledPower = true;                  // always on when placed
    mappedProps.ledDO = lux < threshold;       // DO LED mirrors comparator output
  } else if (data.type === 'flame-sensor') {
    // Flame sensor: pass intensity, threshold, and LED states
    const sv = data.sensorValues ?? {};
    const intensity = Number(sv.value ?? 0);
    const threshold = Number(sv.threshold ?? 50);
    const flameOn = intensity > threshold;
    mappedProps.value = intensity;
    mappedProps.threshold = threshold;
    mappedProps.ledPower = true;                  // always on when placed
    mappedProps.ledSignal = flameOn;               // signal LED on when flame detected
  } else if (data.type === 'gas-sensor') {
    // Gas sensor: pass concentration, threshold, and LED states
    const sv = data.sensorValues ?? {};
    const concentration = Number(sv.value ?? 0);
    const threshold = Number(sv.threshold ?? 50);
    const gasDetected = concentration > threshold;
    mappedProps.value = concentration;
    mappedProps.threshold = threshold;
    mappedProps.ledPower = true;
    mappedProps.ledD0 = gasDetected;
  } else if (data.type === 'rain-sensor') {
    // Rain sensor: pass rain level, threshold, and LED states
    const sv = data.sensorValues ?? {};
    const rainLevel = Number(sv.value ?? 0);
    const threshold = Number(sv.threshold ?? 50);
    const rainDetected = rainLevel > threshold;
    mappedProps.value = rainLevel;
    mappedProps.threshold = threshold;
    mappedProps.ledPower = true;
    mappedProps.ledDO = rainDetected;
  } else if (data.type === 'soil-moisture-sensor') {
    // Soil moisture sensor: pass moisture level, threshold, and LED states
    const sv = data.sensorValues ?? {};
    const moisture = Number(sv.value ?? 0);
    const threshold = Number(sv.threshold ?? 50);
    const soilWet = moisture > threshold;
    mappedProps.value = moisture;
    mappedProps.threshold = threshold;
    mappedProps.ledPower = true;
    mappedProps.ledDO = soilWet;
  } else if (data.type === 'heart-beat-sensor') {
    // Heart rate sensor: pass BPM, current beat phase, and live ADC value
    mappedProps.bpm = data.sensorValues?.bpm ?? 72;
    mappedProps.beatPhase = data.sensorValues?.beatPhase ?? 0;
    mappedProps.adcValue = data.sensorValues?.adcValue ?? 512;
  } else if (data.type === 'big-sound-sensor' || data.type === 'small-sound-sensor') {
    // Sound sensors: pass level, threshold, and LED states
    const sv = data.sensorValues ?? {};
    const level = Number(sv.value ?? 0);
    const threshold = Number(sv.threshold ?? 50);
    const soundOn = level > threshold;
    mappedProps.value = level;
    mappedProps.threshold = threshold;
    if (data.type === 'big-sound-sensor') {
      mappedProps.led1 = true;      // power LED
      mappedProps.led2 = soundOn;   // signal LED
    } else {
      mappedProps.ledPower = true;
      mappedProps.ledSignal = soundOn;
    }
  } else if (data.type === 'hx711') {
    // HX711 load cell amplifier: pass weight and max capacity
    mappedProps.weight = data.sensorValues?.weight ?? 0;
    mappedProps.maxWeight = data.sensorValues?.maxWeight ?? 5000;
  } else if (data.type === 'lcd1602' || data.type === 'lcd2004' || data.type === 'lcd1602-i2c' || data.type === 'lcd2004-i2c') {
    // LCD Displays map the internal emulator state to visual properties
    const state = data.lcdState;
    // I2C variants render with i2c pins, parallel variants with full pins
    mappedProps.pins = (data.type === 'lcd1602-i2c' || data.type === 'lcd2004-i2c') ? 'i2c' : 'full';
    if (state) {
      mappedProps.characters = new Uint8Array(state.characters);
      mappedProps.cursorX = state.cursorX;
      mappedProps.cursorY = state.cursorY;
      mappedProps.cursor = state.cursor;
      mappedProps.blink = state.blink;
      mappedProps.backlight = state.backlight;
    }
  } else if (data.type === 'led-bar-graph') {
    // LED Bar Graph has 10 segments controlled by pins A1 to A10
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 10; i++) {
      values[i] = data.pinStates?.[`pin_A${i + 1}`] === true ? 1 : 0;
    }
    mappedProps.values = values;
  } else if (data.type === '7segment') {
    // 7-segment: map segValues [A,B,C,D,E,F,G,DP] written by CircuitEngine
    // Falls back to all-off if no simulation data yet
    const segValues = data.segValues ?? [0, 0, 0, 0, 0, 0, 0, 0];
    console.log(`[LEAP NODE 7SEG] Rendering 7-segment with values:`, segValues);
    mappedProps.values = segValues;
  } else if (data.type === 'ssd1306') {
    // SSD1306 OLED: pass ImageData decoded by CircuitEngine from the I2C pixel buffer
    if (data.oledImageData) {
      mappedProps.imageData = data.oledImageData;
    }
  } else if (data.type === 'ili9341' || data.type === 'ili9341-touch') {
    // ILI9341 TFT: pass RGBA ImageData decoded by CircuitEngine from the SPI pixel stream
    if (data.tftImageData) {
      mappedProps.imageData = data.tftImageData;
    }
  } else if (data.type === 'pir-motion-sensor') {
    // PIR: reflect the simulated motion state onto the visual element
    mappedProps.motionDetected = data.sensorValues?.motionDetected ?? false;
  } else if (data.type === 'ir-obstacle-sensor') {
    // IR Obstacle Sensor: reflect simulated obstacle state onto visual element
    const active = data.sensorValues?.obstacleDetected ?? false;
    mappedProps.obstacleDetected = active;
    mappedProps.ledPower = true;
    mappedProps.ledSignal = active;
  } else if (data.type === 'proximity-sensor') {
    // Proximity Sensor: reflect simulated object detection state
    const active = data.sensorValues?.obstacleDetected ?? false;
    mappedProps.detected = active;
    mappedProps.ledPower = true;
    mappedProps.ledSignal = active;
  } else if (data.type === 'mpu6050') {

    // MPU6050: pass all 7 sensor values to the visual element
    const sv = data.sensorValues ?? {};
    mappedProps.accelX = sv.accelX ?? 0;
    mappedProps.accelY = sv.accelY ?? 0;
    mappedProps.accelZ = sv.accelZ ?? 1;
    mappedProps.gyroX = sv.gyroX ?? 0;
    mappedProps.gyroY = sv.gyroY ?? 0;
    mappedProps.gyroZ = sv.gyroZ ?? 0;
    mappedProps.temp = sv.temp ?? 25;
  } else if (data.type === 'neopixel') {
    // Single NeoPixel: map decoded WS2812B RGB values (0-1 range)
    mappedProps.r = data.neopixelR ?? 0;
    mappedProps.g = data.neopixelG ?? 0;
    mappedProps.b = data.neopixelB ?? 0;
  } else if (data.type === 'neopixel-matrix' || data.type === 'led-ring') {
    // NeoPixel Matrix / LED Ring: pass through configuration
    if (data.type === 'neopixel-matrix') {
      mappedProps.rows = data.rows ?? 8;
      mappedProps.cols = data.cols ?? 8;
    } else {
      mappedProps.pixels = Array.isArray(data.pixels) ? (data.numPixels ?? data.pixels.length) : (data.pixels ?? 16);
    }
    mappedProps.neopixelPixels = data.neopixelPixels ?? [];
  } else if (['arduino-uno', 'arduino-nano', 'arduino-mega', 'esp32-c3', 'esp32'].includes(data.type)) {
    // MCU Boards: internal power LED and built-in "L" LED (connected internally to Pin 13 & GND)
    mappedProps.ledPower = isSimulating || data.ledPower === true;
    mappedProps.led13 = data.pinStates?.pin_13 === true || data.pinStates?.pin_PB5 === true || data.pinStates?.pin_PB7 === true || data.led13 === true || false;
    mappedProps.led1 = data.pinStates?.pin_8 === true || data.pinStates?.pin_13 === true || data.pinStates?.pin_2 === true || data.led1 === true || false;
  }

  // ── Ref for NeoPixel DOM access (setPixel requires DOM methods) ──
  const elementRef = useRef<any>(null);

  // Sync wrapper dimensions to match the inner scaled container's visual size.
  // The inner container has transform: scale(0.75), which doesn't affect the
  // wrapper's layout box. Without this sync, React Flow would measure the
  // wrapper at the unscaled size, creating a dead zone around the component
  // that blocks canvas interactions (wire waypoints, pane clicks, etc.).
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    if (!container || !wrapper) return;

    const syncSize = () => {
      const unscaledWidth = container.offsetWidth;
      const unscaledHeight = container.offsetHeight;
      if (unscaledWidth === 0 || unscaledHeight === 0) return;
      wrapper.style.width = `${unscaledWidth * 0.75}px`;
      wrapper.style.height = `${unscaledHeight * 0.75}px`;
    };

    const ro = new ResizeObserver(syncSize);
    ro.observe(container);

    // Fallback initial sync: the ResizeObserver fires asynchronously,
    // so use requestAnimationFrame to ensure layout is complete.
    const raf = requestAnimationFrame(syncSize);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // Push ImageData to ILI9341 / SSD1306 canvas elements via DOM property assignment
  // (React JSX spread doesn't reliably set complex object properties on Web Components)
  useEffect(() => {
    if (!elementRef.current) return;
    if ((data.type === 'ili9341' || data.type === 'ili9341-touch') && data.tftImageData) {
      elementRef.current.imageData = data.tftImageData;
    } else if (data.type === 'ssd1306' && data.oledImageData) {
      console.log(`[LEAP NODE OLED] useEffect: setting imageData on element. ref=${!!elementRef.current}, imageData=${data.oledImageData?.width}×${data.oledImageData?.height}`);
      elementRef.current.imageData = data.oledImageData;
      console.log(`[LEAP NODE OLED] imageData set ✓`);
    }
  }, [data.tftImageData, data.oledImageData, data.type]);

  // Direct display registration with the simulation engine to bypass React/Zustand render lag
  useEffect(() => {
    const el = elementRef.current;
    if (!el || !['ili9341', 'ili9341-touch'].includes(data.type)) return;

    withEngine(engine => engine.registerDisplayElement(id, el));

    return () => {
      withEngine(engine => engine.unregisterDisplayElement(id));
    };
  }, [id, data.type]);

  // Imperatively set LCD characters as DOM property.
  // Uint8Array / array props must be set directly — JSX spread stringifies them.
  useEffect(() => {
    const isLcd = data.type === 'lcd1602' || data.type === 'lcd2004' ||
      data.type === 'lcd1602-i2c' || data.type === 'lcd2004-i2c';
    if (!elementRef.current || !isLcd || !data.lcdState) return;
    const el = elementRef.current;
    const state = data.lcdState;
    el.characters = new Uint8Array(state.characters);
    el.cursorX = state.cursorX ?? 0;
    el.cursorY = state.cursorY ?? 0;
    el.cursor = state.cursor ?? false;
    el.blink = state.blink ?? false;
    el.backlight = state.backlight ?? true;
  }, [data.type, data.lcdState]);

  // Imperatively set LED value/brightness as DOM properties.
  // React JSX sets boolean/number props as string attributes on Web Components,
  // which breaks Lit's @property() binding. Direct assignment bypasses this.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'led') return;
    const el = elementRef.current;
    const isOn = data.pinStates?.pin_Anode === true || data.pinStates?.pin_A === true;
    el.value = isOn;
    el.brightness = isOn ? (data.brightness ?? 1.0) : 0.0;
  }, [data.type, data.pinStates, data.brightness]);

  // Imperatively set RGB LED channel values as DOM properties.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'rgb-led') return;
    const el = elementRef.current;
    el.ledRed = data.pinStates?.pin_R === true ? (data.intensity_R ?? 1.0) : 0;
    el.ledGreen = data.pinStates?.pin_G === true ? (data.intensity_G ?? 1.0) : 0;
    el.ledBlue = data.pinStates?.pin_B === true ? (data.intensity_B ?? 1.0) : 0;
  }, [data.type, data.pinStates, data.intensity_R, data.intensity_G, data.intensity_B]);

  // Imperatively set single NeoPixel r/g/b as DOM properties.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'neopixel') return;
    const el = elementRef.current;
    el.r = data.neopixelR ?? 0;
    el.g = data.neopixelG ?? 0;
    el.b = data.neopixelB ?? 0;
  }, [data.type, data.neopixelR, data.neopixelG, data.neopixelB]);

  // Imperatively set NeoPixel Matrix / LED Ring pixels as DOM properties.
  useEffect(() => {
    if (!elementRef.current || !['neopixel-matrix', 'led-ring'].includes(data.type)) return;
    const el = elementRef.current;
    const pixels = data.neopixelPixels ?? [];
    if (el.setPixel) {
      pixels.forEach((p: any, i: number) => {
        // Normalize 0-255 to 0-1 as expected by the Lit elements
        const rgb = {
          r: (p.r ?? 0) / 255,
          g: (p.g ?? 0) / 255,
          b: (p.b ?? 0) / 255
        };

        if (data.type === 'neopixel-matrix') {
          const cols = (el as any).cols || 8;
          const row = Math.floor(i / cols);
          const col = i % cols;
          el.setPixel(row, col, rgb);
        } else {
          // 1D elements like LED Ring or simple NeoPixel strips
          el.setPixel(i, rgb);
        }
      });
    }
  }, [data.type, data.neopixelPixels]);

  // Imperatively set servo angle as DOM property.
  // React JSX sets number props as string attributes on Web Components.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'servo') return;
    const el = elementRef.current;
    const angle = data.angle ?? 0;
    el.angle = angle;
  }, [data.type, data.angle]);

  // Imperatively set pir-motion-sensor motionDetected property on Lit element.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'pir-motion-sensor') return;
    const el = elementRef.current;
    const motionDetected = !!(data.sensorValues?.motionDetected);
    el.motionDetected = motionDetected;
    if (typeof el.requestUpdate === 'function') el.requestUpdate();
  }, [data.type, data.sensorValues?.motionDetected]);

  // Imperatively set dc-motor speed and direction as DOM properties.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'dc-motor') return;
    const el = elementRef.current;
    el.speed = data.speed ?? 0;
    el.direction = data.direction ?? 'cw';
  }, [data.type, data.speed, data.direction]);

  // Imperatively set water-pump properties as DOM properties.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'water-pump') return;
    const el = elementRef.current;
    const hasPowerPin = data.pinStates?.pin_POS === true || data.pinStates?.pin_VCC === true || data.pinStates?.pin_1 === true;
    const spd = Number(data.speed ?? (hasPowerPin ? 1.0 : 0));
    const isRunning = Boolean(data.running ?? (spd > 0 || hasPowerPin));
    el.speed = spd;
    el.running = isRunning;
    el.direction = data.direction ?? 'cw';
    if (typeof el.requestUpdate === 'function') el.requestUpdate();
  }, [data.type, data.speed, data.running, data.direction, data.pinStates]);

  // Imperatively set water-level-float-sensor properties as DOM properties.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'water-level-float-sensor') return;
    const el = elementRef.current;
    const val = Number(data.sensorValues?.value ?? data.value ?? 0);
    const thresh = Number(data.threshold ?? 50);
    const isTriggered = Boolean(data.state ?? (val >= thresh));
    el.value = val;
    el.threshold = thresh;
    el.state = isTriggered;
    el.ledPower = data.ledPower ?? true;
    el.ledSignal = data.ledSignal ?? isTriggered;
    if (typeof el.requestUpdate === 'function') el.requestUpdate();
  }, [data.type, data.value, data.sensorValues?.value, data.threshold, data.state, data.ledPower, data.ledSignal]);

  // Imperatively set stepper-motor angle as DOM property.
  // Same issue as servo — Lit @property({ type: Number }) needs a real number, not a string attribute.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'stepper-motor') return;
    const el = elementRef.current;
    el.angle = data.angle ?? 0;
    el.arrow = data.arrow ?? '';
    el.display = data.display ?? 'steps';
    el.gearRatio = data.gearRatio ?? '1:1';
    el.energized = data.energized ?? false;
    el.stepCount = data.stepCount ?? 0;
    el.size = data.size ?? 23;
  }, [data.type, data.angle, data.arrow, data.display, data.gearRatio, data.energized, data.stepCount, data.size]);

  // Imperatively set biaxial-stepper hand angles as DOM properties.
  useEffect(() => {
    if (!elementRef.current || data.type !== 'biaxial-stepper') return;
    const el = elementRef.current;
    el.outerHandAngle = data.xAngle ?? 0;
    el.innerHandAngle = data.yAngle ?? 0;
    el.xSteps = data.xSteps ?? 0;
    el.ySteps = data.ySteps ?? 0;
    el.xRpm = data.xRPM ?? 0;
    el.yRpm = data.yRPM ?? 0;
    el.xDirection = data.xDirection ?? 'STOP';
    el.yDirection = data.yDirection ?? 'STOP';
  }, [
    data.type,
    data.xAngle,
    data.yAngle,
    data.xSteps,
    data.ySteps,
    data.xRPM,
    data.yRPM,
    data.xDirection,
    data.yDirection,
  ]);

  // Push pixel data to matrix/ring elements via DOM setPixel() method
  useEffect(() => {
    if (!elementRef.current || !data.neopixelPixels) return;
    const el = elementRef.current;
    const pixels = data.neopixelPixels;

    if (data.type === 'neopixel-matrix' && typeof el.setPixel === 'function') {
      const cols = data.cols ?? 8;
      for (let i = 0; i < pixels.length; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        el.setPixel(row, col, {
          r: pixels[i].r / 255,
          g: pixels[i].g / 255,
          b: pixels[i].b / 255,
        });
      }
      // Trigger re-render after all pixels are set
      if (typeof el.requestUpdate === 'function') el.requestUpdate();
    } else if (data.type === 'led-ring' && typeof el.setPixel === 'function') {
      for (let i = 0; i < pixels.length; i++) {
        el.setPixel(i, {
          r: pixels[i].r / 255,
          g: pixels[i].g / 255,
          b: pixels[i].b / 255,
        });
      }
      // Trigger re-render if the element has a render method
      if (typeof el.requestUpdate === 'function') el.requestUpdate();
    }
  }, [data.neopixelPixels, data.type, data.cols]);

  // Wire ili9341-touch canvas events into the circuit engine
  useEffect(() => {
    const el = elementRef.current;
    if (!el || data.type !== 'ili9341-touch') return;

    const handleTouchChange = (e: Event) => {
      const { touched, x, y } = (e as CustomEvent).detail ?? { touched: false, x: 0, y: 0 };
      withEngine(engine => engine.setTouchState(id, touched, x, y));
    };

    el.addEventListener('touch-change', handleTouchChange);
    return () => {
      el.removeEventListener('touch-change', handleTouchChange);
    };
  }, [data.type, id]);

  // Wire membrane-keypad DOM button-press/release events into the circuit engine
  useEffect(() => {
    const el = elementRef.current;
    if (!el || data.type !== 'membrane-keypad') return;

    const handlePress = (e: Event) => {
      const key = (e as CustomEvent).detail?.key ?? null;
      withEngine(engine => engine.pushKeypadKey(id, key));
    };
    const handleRelease = (e: Event) => {
      const key = (e as CustomEvent).detail?.key ?? null;
      withEngine(engine => engine.releaseKeypadKey(id, key));
    };

    el.addEventListener('button-press', handlePress);
    el.addEventListener('button-release', handleRelease);
    return () => {
      el.removeEventListener('button-press', handlePress);
      el.removeEventListener('button-release', handleRelease);
    };
  }, [data.type, id]);

  // Wire rotary-dialer DOM dial-start events into the circuit engine
  useEffect(() => {
    const el = elementRef.current;
    if (!el || data.type !== 'rotary-dialer') return;

    const handleDialStart = (e: Event) => {
      const digit = (e as CustomEvent).detail?.digit ?? 0;
      withEngine(engine => engine.pushRotaryDialerDigit(id, digit));
    };

    el.addEventListener('dial-start', handleDialStart);
    return () => {
      el.removeEventListener('dial-start', handleDialStart);
    };
  }, [data.type, id]);

  // Wire tilt-switch DOM tilt-toggle events into the circuit engine
  useEffect(() => {
    const el = elementRef.current;
    if (!el || data.type !== 'tilt-switch') return;

    const handleTiltToggle = (e: Event) => {
      const tilted = (e as CustomEvent).detail?.tilted ?? false;
      withEngine(engine => engine.pushTiltSwitchState(id, tilted));
    };

    el.addEventListener('tilt-toggle', handleTiltToggle);

    // Set initial state on mount
    const initialTilted = data.sensorValues?.tilted ?? false;
    withEngine(engine => engine.pushTiltSwitchState(id, initialTilted));

    return () => {
      el.removeEventListener('tilt-toggle', handleTiltToggle);
    };
  }, [data.type, id]);

  // Wire pushbutton / pushbutton-6mm DOM press/release events into the circuit engine
  useEffect(() => {
    const el = elementRef.current;
    if (!el || !['pushbutton', 'pushbutton-6mm'].includes(data.type)) return;

    const handlePress = () => {
      withEngine(engine => engine.pushPushbuttonState(id, true));
    };

    const handleRelease = () => {
      withEngine(engine => engine.pushPushbuttonState(id, false));
    };

    el.addEventListener('button-press', handlePress);
    el.addEventListener('button-release', handleRelease);

    // Initial state (released)
    withEngine(engine => engine.pushPushbuttonState(id, false));

    return () => {
      el.removeEventListener('button-press', handlePress);
      el.removeEventListener('button-release', handleRelease);
    };
  }, [data.type, id]);

  // Wire slide-switch DOM input events into the circuit engine
  useEffect(() => {
    const el = elementRef.current;
    if (!el || data.type !== 'slide-switch') return;

    const handleInput = (e: Event) => {
      const value = (e as CustomEvent).detail ?? (el as any).value ?? 0;
      withEngine(engine => engine.pushSlideSwitchState(id, value));
    };

    el.addEventListener('input', handleInput);

    // Set initial state on mount
    const initialValue = data.value ?? 0;
    withEngine(engine => engine.pushSlideSwitchState(id, initialValue));

    return () => {
      el.removeEventListener('input', handleInput);
    };
  }, [data.type, id, data.value]);

  // Wire potentiometer / slide-potentiometer DOM input events into the store and circuit engine.
  // Single source of truth — reads fresh store state (no stale closures), updates both `value`
  // and `sensorValues.value`, and re-injects the analog signal. Runs identically whether the
  // simulation is running or not.
  useEffect(() => {
    const el = elementRef.current;
    if (!el || !['potentiometer', 'slide-potentiometer'].includes(data.type)) return;

    const handleInput = (e: Event) => {
      const value = (e as CustomEvent).detail ?? (el as any).value ?? 0;
      const numVal = typeof value === 'number' ? value : parseFloat(value);
      if (isNaN(numVal)) return;
      const currentNode = useForgeStore.getState().nodes.find(n => n.id === id);
      if (!currentNode) return;
      const currentValues = currentNode.data?.sensorValues || {};
      useForgeStore.getState().updateNodeData(id, {
        value: numVal,
        sensorValues: { ...currentValues, value: numVal },
      });
      withEngine(engine => engine.pushInputSignal(id, 'SIG', true));
    };

    el.addEventListener('input', handleInput);
    return () => {
      el.removeEventListener('input', handleInput);
    };
  }, [data.type, id]);

  // Imperatively set potentiometer / slide-potentiometer value as DOM property
  useEffect(() => {
    const isPot = data.type === 'potentiometer' || data.type === 'slide-potentiometer';
    if (!elementRef.current || !isPot) return;
    const el = elementRef.current;
    const val = data.sensorValues?.value ?? 0;
    if (el.value !== val) {
      el.value = val;
    }
  }, [data.type, data.sensorValues?.value]);

  // Wire KY-040 rotary encoder DOM events into the circuit engine
  useEffect(() => {
    const el = elementRef.current;
    if (!el || data.type !== 'ky-040') return;

    const handleRotateCW = () => {
      import('../../engine/Arduino/CircuitEngine').then(({ circuitEngine }) => {
        circuitEngine.pushRotaryEncoderCW(id);
      });
    };

    const handleRotateCCW = () => {
      import('../../engine/Arduino/CircuitEngine').then(({ circuitEngine }) => {
        circuitEngine.pushRotaryEncoderCCW(id);
      });
    };

    // SW button is handled by standard button-press/button-release events
    const handlePress = () => {
      withEngine(engine => engine.pushInputSignal(id, 'SW', false)); // Active LOW
    };

    const handleRelease = () => {
      withEngine(engine => engine.pushInputSignal(id, 'SW', true)); // Pull-up HIGH
    };

    el.addEventListener('rotate-cw', handleRotateCW);
    el.addEventListener('rotate-ccw', handleRotateCCW);
    el.addEventListener('button-press', handlePress);
    el.addEventListener('button-release', handleRelease);

    // Set initial state (idle: CLK and DT HIGH with pull-ups, SW HIGH)
    // Use setTimeout to ensure this happens after component is fully mounted
    const initTimer = setTimeout(() => {
      withEngine(engine => {
        engine.pushInputSignal(id, 'CLK', true);
        engine.pushInputSignal(id, 'DT', true);
        engine.pushInputSignal(id, 'SW', true);  // SW must start HIGH (pull-up)
        console.log(`[KY-040] Initial state set: CLK=HIGH, DT=HIGH, SW=HIGH for node ${id}`);
      });
    }, 100);

    return () => {
      clearTimeout(initTimer);
      el.removeEventListener('rotate-cw', handleRotateCW);
      el.removeEventListener('rotate-ccw', handleRotateCCW);
      el.removeEventListener('button-press', handlePress);
      el.removeEventListener('button-release', handleRelease);
    };
  }, [data.type, id]);

  // Wire IR remote DOM button-press/release events into the circuit engine
  useEffect(() => {
    const el = elementRef.current;
    if (!el || data.type !== 'ir-remote') return;

    const handlePress = (e: Event) => {
      const irCode = (e as CustomEvent).detail?.irCode ?? 0;
      withEngine(engine => engine.pushIRRemoteButton(id, irCode, true));
    };

    const handleRelease = (e: Event) => {
      const irCode = (e as CustomEvent).detail?.irCode ?? 0;
      withEngine(engine => engine.pushIRRemoteButton(id, irCode, false));
    };

    el.addEventListener('button-press', handlePress);
    el.addEventListener('button-release', handleRelease);

    return () => {
      el.removeEventListener('button-press', handlePress);
      el.removeEventListener('button-release', handleRelease);
    };
  }, [data.type, id]);

  // Wire analog-joystick DOM events into the circuit engine
  useEffect(() => {
    const el = elementRef.current;
    if (!el || data.type !== 'analog-joystick') return;

    const handleInput = () => {
      const x = el.xValue ?? 0;
      const y = el.yValue ?? 0;
      withEngine(engine => engine.pushJoystickAnalog(id, x, y));
    };

    // Joystick SEL button is typically pulled HIGH externally/internally, goes LOW on press
    const handlePress = () => {
      withEngine(engine => engine.pushInputSignal(id, 'SEL', false));
    };
    const handleRelease = () => {
      withEngine(engine => engine.pushInputSignal(id, 'SEL', true));
    };

    el.addEventListener('input', handleInput);
    el.addEventListener('button-press', handlePress);
    el.addEventListener('button-release', handleRelease);

    // Inject the center resting state immediately on mount
    handleInput();
    handleRelease();

    return () => {
      el.removeEventListener('input', handleInput);
      el.removeEventListener('button-press', handlePress);
      el.removeEventListener('button-release', handleRelease);
    };
  }, [data.type, id]);

  // Optional: Fallback for generic elements that listen to 'value'
  if (mappedProps.value === undefined && data.value !== undefined) {
    mappedProps.value = data.value;
  }

  return (
    <div ref={wrapperRef} style={nodeStyle} className={`leap-node-wrapper${isSelected ? ' is-selected' : ''}`}>
      {/* ── COMPONENT & HANDLES CONTAINER ── */}
      <div
        ref={containerRef}
        className="leap-node-svg-container"
        style={{
          position: 'relative',
          display: 'inline-block',
          transform: 'scale(0.75)',
          transformOrigin: '0 0',
        }}
      >
        {/* Dynamic Leap Element */}
        <Tag
          ref={elementRef}
          simulating={isSimulating}
          {...mappedProps}
          onPinStateChange={(pinName: string, state: boolean) => {
            console.log(`[LEAP NODE] Interaction event fired on Node ${id}, pin ${pinName} = ${state}`);
            withEngine(engine => engine.pushInputSignal(id, pinName, state));
          }}
        />

        {/* ── DYNAMIC PIN HANDLES — Tinkercad-style connection indicators ── */}
        {pins.map((pin, idx) => {
          const isConnected = connectedPinColors.has(pin.name);
          const wireColor = connectedPinColors.get(pin.name);
          const isPinHigh = data.pinStates?.[`pin_${pin.name}`] === true;

          // Check if this is a power/ground pin
          const isPowerPin = ['VCC', '5V', '3V3', '3.3V', 'VIN', 'POWER', 'V+'].includes(pin.name);
          const isGroundPin = ['GND', 'GROUND', 'V-', 'VSS'].includes(pin.name);

          // Tinkercad-style connection state machine:
          //  - isPendingSourcePin : user is currently pressing the mouse down on this pin
          //                         (the wire is NOT yet being drawn — they must release first)
          //  - isDraftSourcePin   : the wire is actively being drawn from this pin
          //                         (after click+release on this pin)
          //  - isDraftTarget      : a wire is being drawn and the cursor is over this pin
          //  - isDraftActive      : a wire is being drawn somewhere on the canvas
          const isDraftActive = wireDraft !== null;
          const isPendingSourcePin = isPendingSource && pendingSourcePin === pin.name;
          const isDraftSourcePin = isDraftSource && draftSourcePin === pin.name;
          const isDraftTarget =
            isDraftActive && !isDraftSourcePin && hoveredPinName === pin.name;

          // Pin color matches wire color when connected; turns red/cyan during a draft
          let pinColor = '#475569';
          let pinOpacity = isSelected ? 0.5 : 0.1;
          let pinGlow = 'none';
          let borderColor = isConnected ? pinColor : '#334155';

          if (isConnected && wireColor) {
            pinColor = wireColor;
            pinOpacity = 1.0;
            pinGlow = `0 0 6px ${wireColor}`;
            borderColor = wireColor;
          }

          // Tinkercad-style: red square glow on hovered pin (the signature connection indicator)
          if (isDraftTarget) {
            pinColor = '#ef4444';
            borderColor = '#ef4444';
            pinOpacity = 1.0;
            pinGlow = '0 0 8px #ef4444, 0 0 14px rgba(239, 68, 68, 0.55)';
          }

          // "Armed" pin: mouse pressed down but not yet released — shows a yellow/amber
          // pulse so the user knows the click has registered and the wire is waiting for release.
          if (isPendingSourcePin) {
            pinColor = '#f59e0b';
            borderColor = '#f59e0b';
            pinOpacity = 1.0;
            pinGlow = '0 0 8px #f59e0b, 0 0 14px rgba(245, 158, 11, 0.55)';
          }

          // The source pin pulses with the wire's own color while the draft is active
          if (isDraftSourcePin) {
            pinColor = '#22c55e';
            borderColor = '#22c55e';
            pinOpacity = 1.0;
            pinGlow = '0 0 8px #22c55e, 0 0 14px rgba(34, 197, 94, 0.55)';
          }

          // Larger hit area + larger visible pin when in a draft, Tinkercad-style — optimized for user-friendly targeting
          const isDraftRelevant =
            isDraftSourcePin || isDraftTarget || isDraftActive || isPendingSourcePin;
          const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
          const basePinSize = isTouchDevice ? 14 : (isDraftRelevant ? 14 : (isConnected ? 6 : 4));
          const pinSize = isDraftRelevant ? (isTouchDevice ? 24 : 16) : basePinSize;
          const halfSize = pinSize / 2;
          const handleStyle: React.CSSProperties = {
            left: `${pin.x}%`,
            top: `${pin.y}%`,
            width: `${pinSize}px`,
            height: `${pinSize}px`,
            marginLeft: `-${halfSize}px`,
            marginTop: `-${halfSize}px`,
            zIndex: 10,
            pointerEvents: 'all',
            touchAction: 'none',
            transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
          };

          return (
            <React.Fragment key={`${pin.name}-${idx}`}>
              {/* Hidden handle (target) — 0-size at exact pin center for wire connection */}
              <Handle
                id={`${pin.name}__target`}
                type="target"
                position={Position.Top}
                style={{
                  left: `${pin.x}%`,
                  top: `${pin.y}%`,
                  width: 0,
                  height: 0,
                  zIndex: 10,
                  pointerEvents: 'none',
                  background: 'transparent',
                  border: 'none',
                }}
              />
              {/* Hidden handle (source) — 0-size at exact pin center for wire connection */}
              <Handle
                id={`${pin.name}`}
                type="source"
                position={Position.Top}
                style={{
                  left: `${pin.x}%`,
                  top: `${pin.y}%`,
                  width: 0,
                  height: 0,
                  zIndex: 10,
                  pointerEvents: 'none',
                  background: 'transparent',
                  border: 'none',
                }}
              />
              {/* Visible interactive pin dot */}
              <div
                className="leap-pin-dot react-flow__handle nodrag"
                style={{
                  ...handleStyle,
                  position: 'absolute',
                  background: pinColor,
                  border: `1.5px solid ${borderColor}`,
                  borderRadius: '50%',
                  opacity: pinOpacity,
                  boxShadow: pinGlow,
                  cursor: wireDraft ? 'crosshair' : 'pointer',
                  // Enlarge on hover for easier target acquisition (Tinkercad-style)
                  transform: isDraftTarget ? 'scale(1.4)' : 'scale(1)',
                }}
                title={
                  isDraftTarget
                    ? `Drop to connect to ${pin.name}`
                    : isPendingSourcePin
                      ? `Release on this pin to start a wire from ${pin.name}, or release on another pin to connect directly`
                      : isDraftSourcePin
                        ? `Wire started from ${pin.name} — click another pin to connect, or click empty space to cancel`
                        : `${pin.name}${isConnected ? ' ✓' : ''}${isPowerPin ? ' (POWER)' : ''}${isGroundPin ? ' (GND)' : ''}`
                }
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const state = useForgeStore.getState();
                  if (e.button === 2 && (state.wireDraft || state.pendingSource)) {
                    e.preventDefault();
                    cancelWireDraft();
                    return;
                  }
                  if (!state.wireDraft && !state.pendingSource) {
                    const pinDotEl = e.currentTarget as HTMLElement;
                    if (pinDotEl) {
                      const rect = pinDotEl.getBoundingClientRect();
                      const vp = getViewport();
                      const canvasContainer = document.querySelector('.forge-canvas-container');
                      const canvasRect = canvasContainer ? canvasContainer.getBoundingClientRect() : { left: 0, top: 0 };
                      const sourcePos = {
                        x: (rect.left + rect.width / 2 - canvasRect.left - vp.x) / vp.zoom,
                        y: (rect.top + rect.height / 2 - canvasRect.top - vp.y) / vp.zoom,
                      };
                      setPendingSource({
                        nodeId: id,
                        pinName: pin.name,
                        sourcePosition: sourcePos,
                      });
                    }
                  }
                }}
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse') return;
                  e.stopPropagation();
                  e.preventDefault();
                  const state = useForgeStore.getState();
                  if (!state.wireDraft && !state.pendingSource) {
                    const pinDotEl = e.currentTarget as HTMLElement;
                    if (pinDotEl) {
                      const rect = pinDotEl.getBoundingClientRect();
                      const vp = getViewport();
                      const canvasContainer = document.querySelector('.forge-canvas-container');
                      const canvasRect = canvasContainer ? canvasContainer.getBoundingClientRect() : { left: 0, top: 0 };
                      const sourcePos = {
                        x: (rect.left + rect.width / 2 - canvasRect.left - vp.x) / vp.zoom,
                        y: (rect.top + rect.height / 2 - canvasRect.top - vp.y) / vp.zoom,
                      };
                      setPendingSource({
                        nodeId: id,
                        pinName: pin.name,
                        sourcePosition: sourcePos,
                      });
                    }
                  }
                }}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  const state = useForgeStore.getState();
                  // Case 1: a wire is actively being drawn.
                  if (state.wireDraft) {
                    if (state.wireDraft.source === id && state.wireDraft.sourceHandle === pin.name) {
                      cancelWireDraft();
                    } else {
                      completeWireDraft(id, pin.name);
                    }
                    return;
                  }
                  // Case 2: a pin is armed (pendingSource) but no wire is being drawn yet.
                  if (state.pendingSource) {
                    if (state.pendingSource.nodeId === id && state.pendingSource.pinName === pin.name) {
                      startWireDraft(id, pin.name, state.pendingSource.sourcePosition);
                    } else {
                      startWireDraft(state.pendingSource.nodeId, state.pendingSource.pinName, state.pendingSource.sourcePosition);
                      completeWireDraft(id, pin.name);
                    }
                  }
                }}
                onPointerUp={(e) => {
                  if (e.pointerType === 'mouse') return;
                  e.stopPropagation();
                  e.preventDefault();
                  const state = useForgeStore.getState();
                  if (state.wireDraft) {
                    if (state.wireDraft.source === id && state.wireDraft.sourceHandle === pin.name) {
                      cancelWireDraft();
                    } else {
                      completeWireDraft(id, pin.name);
                    }
                    return;
                  }
                  if (state.pendingSource) {
                    if (state.pendingSource.nodeId === id && state.pendingSource.pinName === pin.name) {
                      startWireDraft(id, pin.name, state.pendingSource.sourcePosition);
                    } else {
                      startWireDraft(state.pendingSource.nodeId, state.pendingSource.pinName, state.pendingSource.sourcePosition);
                      completeWireDraft(id, pin.name);
                    }
                  }
                }}
                onMouseEnter={() => {
                  const state = useForgeStore.getState();
                  // Only show the red target indicator when a wire is actively being
                  // drawn (not just armed). Avoids showing it prematurely on pending.
                  if (state.wireDraft) {
                    setHoveredPinName(pin.name);
                  }
                }}
                onMouseLeave={() => {
                  if (hoveredPinName === pin.name) {
                    setHoveredPinName(null);
                  }
                }}
                onContextMenu={(e) => {
                  const state = useForgeStore.getState();
                  // Right-click on a pin during a draft/pending arms cancels the wire
                  if (state.wireDraft || state.pendingSource) {
                    e.preventDefault();
                    cancelWireDraft();
                  }
                }}
              />
            </React.Fragment>
          );
        })}
      </div>


      {/* ── SENSOR OVERLAY (sliders shown above the node — only when selected) ── */}
      {isSelected && (
        <SensorOverlay
          nodeId={id}
          type={data.type}
          currentValues={data.sensorValues}
          rotation={data.rotation || 0}
        />
      )}
    </div>
  );
});

LeapNode.displayName = 'LeapNode';
