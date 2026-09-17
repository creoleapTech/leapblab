/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React from 'react';
import { useForgeStore, getCircuitEngineSync } from '../../../utils/store/useForgeStore';
import { LEAP_PINS } from '../../engine/Arduino/PinHarness';

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

interface SensorOverlayProps {
  nodeId: string;
  type: string;
  currentValues: any;
  rotation?: number;
  wrapperRef?: React.RefObject<HTMLDivElement | null>;
}

// ── Single-value slider row (Horizontal and Compact) ─────────────────────────
interface SliderRowProps {
  label: string;
  unit: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  color?: string;
  onChange: (v: number) => void;
}

const clamp = (min: number, max: number, value: number) => Math.max(min, Math.min(max, value));

const SliderRow: React.FC<SliderRowProps> = ({ label, unit, min, max, step = 1, value, color = '#BEF264', onChange }) => {
  const uiTheme = useForgeStore(state => state.uiTheme);
  const isLightTheme = uiTheme === 'light';

  const [inputVal, setInputVal] = React.useState(value.toString());
  const lastUpdatedRef = React.useRef<number>(0);
  const timeoutRef = React.useRef<any>(null);
  const lastValueRef = React.useRef<number>(parseFloat(value.toString()) || 0);
  // True while the user is actively dragging/typing — external prop updates
  // must NOT overwrite the in-progress value, otherwise the thumb snaps back
  // to the last committed value (throttled up to 100ms) mid-drag.
  const interactingRef = React.useRef(false);

  // Keep input val in sync with props changes (skip while user is interacting)
  React.useEffect(() => {
    if (!interactingRef.current && parseFloat(inputVal) !== value) {
      setInputVal(value.toString());
    }
  }, [value]);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const displayColor = isLightTheme ? '#0f172a' : '#f8fafc';
  const labelColor = isLightTheme ? '#475569' : '#94a3b8';

  const sendUpdate = (val: number) => {
    lastValueRef.current = val;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Debounce store update to 60ms to avoid re-render flicker while dragging slider
    timeoutRef.current = setTimeout(() => {
      onChange(val);
      lastUpdatedRef.current = Date.now();
      timeoutRef.current = null;
    }, 60);
  };

  // Flush any pending value immediately (e.g. when the pointer is released)
  const flushPending = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Only flush if value actually changed since last committed
    if (lastValueRef.current !== value) {
      onChange(lastValueRef.current);
      lastUpdatedRef.current = Date.now();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) {
      setInputVal(v.toString());
      sendUpdate(v);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const clean = raw.replace(/[^0-9.]/g, '');
    setInputVal(clean);
    
    const v = parseFloat(clean);
    if (!isNaN(v)) {
      sendUpdate(v);
    }
  };

  const handleBlur = () => {
    interactingRef.current = false;
    const v = clamp(min, max, parseFloat(inputVal) || 0);
    const rounded = step >= 1 ? Math.round(v) : parseFloat(v.toFixed(1));
    setInputVal(rounded.toString());
    sendUpdate(rounded);
  };

  return (
    <div
      className="flex items-center gap-2 w-full select-none"
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <span className={`text-[9px] font-bold w-[45px] overflow-hidden text-ellipsis whitespace-nowrap ${isLightTheme ? 'text-slate-600' : 'text-slate-400'}`}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={parseFloat(inputVal) || 0}
        onInput={handleChange}
        onChange={handleChange}
        onPointerDown={(e) => { interactingRef.current = true; e.stopPropagation(); }}
        onPointerUp={() => { interactingRef.current = false; flushPending(); }}
        onMouseUp={() => { interactingRef.current = false; flushPending(); }}
        onBlur={() => { interactingRef.current = false; }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        className="flex-1 h-1 cursor-pointer rounded-xs outline-none"
        style={{ accentColor: color }}
      />
      <input
        type="text"
        value={inputVal}
        onChange={handleTextChange}
        onBlur={handleBlur}
        onFocus={() => { interactingRef.current = true; }}
        onPointerDown={(e) => { interactingRef.current = true; e.stopPropagation(); }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        className={`w-[65px] border rounded-md px-1 py-0.5 text-[10px] font-extrabold font-mono text-right outline-none ${
          isLightTheme ? 'bg-slate-100 border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-700 text-slate-50'
        }`}
      />
      {unit && <span className={`text-[10px] font-extrabold font-mono ${isLightTheme ? 'text-slate-900' : 'text-slate-50'}`}>{unit}</span>}
    </div>
  );
};

// Create context for unrotating sensor overlay cards
export const RotationContext = React.createContext<number>(0);
export const NodeDimensionsContext = React.createContext<{ width: number; height: number }>({ width: 150, height: 80 });

// ── Compact theme-aware Card Wrapper sitting right above the component ──────
interface CompactCardProps {
  borderColor?: string;
  children: React.ReactNode;
}

const CompactCard: React.FC<CompactCardProps> = ({ borderColor, children }) => {
  const uiTheme = useForgeStore(state => state.uiTheme);
  const isLightTheme = uiTheme === 'light';
  const defaultBorder = isLightTheme ? '#cbd5e1' : (borderColor || 'rgba(255, 255, 255, 0.08)');
  const rotation = React.useContext(RotationContext);

  return (
    <div
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onMouseEnter={e => e.stopPropagation()}
      onMouseLeave={e => e.stopPropagation()}
      onPointerEnter={e => e.stopPropagation()}
      onPointerLeave={e => e.stopPropagation()}
      className={`nodrag nopan w-[250px] backdrop-blur-md rounded-lg py-1.5 px-3.5 z-[9999] flex flex-col gap-1 select-none pointer-events-auto cursor-default ${
        isLightTheme ? 'bg-white/92 shadow-sm' : 'bg-slate-900/92 shadow-xl'
      }`}
      style={{
        position: 'absolute',
        left: '50%',
        top: '-12px',
        transform: `translate(-50%, -100%) rotate(${-rotation}deg)`,
        transformOrigin: 'bottom center',
        border: `1px solid ${defaultBorder}`,
        cursor: 'default',
      }}
    >
      {children}
    </div>
  );
};

// ── Main overlay ──────────────────────────────────────────────────────────────
export const SensorOverlay: React.FC<SensorOverlayProps> = ({ nodeId, type, currentValues, rotation = 0 }) => {
  const updateNodeData = useForgeStore(state => state.updateNodeData);
  const uiTheme = useForgeStore(state => state.uiTheme);
  const isLightTheme = uiTheme === 'light';

  const isDHT = type === 'dht22' || type === 'dht11';
  const isDistance = type === 'hc-sr04';
  const isAnalog = ['potentiometer', 'slide-potentiometer', 'mq2', 'resistor', 'photoresistor'].includes(type);
  const isNTC = type === 'ntc-temperature-sensor';
  const isPIR = type === 'pir-motion-sensor';
  const isIRObstacle = type === 'ir-obstacle-sensor';
  const isProximity = type === 'proximity-sensor';
  const isMPU6050 = type === 'mpu6050';
  const isLDR = type === 'photoresistor-sensor';
  const isFlame = type === 'flame-sensor';
  const isGas = type === 'gas-sensor';
  const isRain = type === 'rain-sensor';
  const isSoilMoisture = type === 'soil-moisture-sensor';
  const isWaterLevelFloat = type === 'water-level-float-sensor';
  const isHeartRate = type === 'heart-beat-sensor';
  const isBigSound = type === 'big-sound-sensor' || type === 'small-sound-sensor';
  const isHX711 = type === 'hx711';
  if (!isDHT && !isDistance && !isAnalog && !isNTC && !isPIR && !isIRObstacle && !isProximity && !isMPU6050 && !isLDR && !isFlame && !isGas && !isRain && !isSoilMoisture && !isWaterLevelFloat && !isHeartRate && !isBigSound && !isHX711) return null;

  const renderContent = () => {
    // ── DHT Sensor ──────────────────────────────────────────────────────────
    if (isDHT) {
      const temp = currentValues?.temperature ?? 25;
      const humidity = currentValues?.humidity ?? 50;

      const update = (key: 'temperature' | 'humidity', val: number) => {
        updateNodeData(nodeId, {
          sensorValues: { ...currentValues, [key]: val },
        });
      };

      return (
        <CompactCard borderColor="rgba(186, 242, 100, 0.2)">
          <SliderRow
            label="TEMP"
            unit="°C"
            min={type === 'dht11' ? 0 : -40}
            max={type === 'dht11' ? 50 : 80}
            step={0.1}
            value={temp}
            color="#f97316"
            onChange={v => update('temperature', v)}
          />
          <SliderRow
            label="HUMIDITY"
            unit="%"
            min={0}
            max={100}
            step={1}
            value={humidity}
            color="#38bdf8"
            onChange={v => update('humidity', v)}
          />
        </CompactCard>
      );
    }

    // ── PIR Motion Sensor ───────────────────────────────────────────────────
    if (isPIR) {
      const motionDetected = currentValues?.motionDetected ?? false;

      const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const next = !motionDetected;
        updateNodeData(nodeId, {
          sensorValues: { ...currentValues, motionDetected: next },
        });
        withEngine(engine => engine.pushInputSignal(nodeId, 'OUT', next));
      };

      return (
        <CompactCard borderColor={motionDetected ? 'rgba(74,222,128,0.4)' : 'rgba(186,242,100,0.2)'}>
          <button
            onClick={toggle}
            className={`w-full py-1 rounded-md border-none cursor-pointer font-extrabold text-[9px] font-mono tracking-wider transition-all ${
              motionDetected
                ? 'bg-emerald-400/90 text-slate-900 shadow-[0_0_6px_rgba(74,222,128,0.3)]'
                : (isLightTheme ? 'bg-slate-200 text-slate-700' : 'bg-slate-700/90 text-slate-400')
            }`}
          >
            {motionDetected ? '● MOTION DETECTED' : '○ TRIGGER MOTION'}
          </button>
        </CompactCard>
      );
    }

    // ── IR Obstacle Sensor ──────────────────────────────────────────────────
    if (isIRObstacle) {
      const obstacleDetected = currentValues?.obstacleDetected ?? false;

      const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const next = !obstacleDetected;
        updateNodeData(nodeId, {
          sensorValues: { ...currentValues, obstacleDetected: next },
        });
        // FC-51 IR obstacle sensor is Active-LOW: OUT goes LOW (0V) when obstacle detected
        withEngine(engine => engine.pushInputSignal(nodeId, 'OUT', !next));
      };

      return (
        <CompactCard borderColor={obstacleDetected ? 'rgba(239,68,68,0.4)' : 'rgba(186,242,100,0.2)'}>
          <button
            onClick={toggle}
            className={`w-full py-1 rounded-md border-none cursor-pointer font-extrabold text-[9px] font-mono tracking-wider transition-all ${
              obstacleDetected
                ? 'bg-red-500/90 text-white shadow-[0_0_6px_rgba(239,68,68,0.3)]'
                : (isLightTheme ? 'bg-slate-200 text-slate-700' : 'bg-slate-700/90 text-slate-400')
            }`}
          >
            {obstacleDetected ? '● OBSTACLE DETECTED' : '○ SIMULATE OBSTACLE'}
          </button>
        </CompactCard>
      );
    }

    // ── Proximity Sensor ──────────────────────────────────────────────────
    if (isProximity) {
      const objectDetected = currentValues?.obstacleDetected ?? false;

      const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const next = !objectDetected;
        updateNodeData(nodeId, {
          sensorValues: { ...currentValues, obstacleDetected: next },
        });
        // Proximity sensor is Active-LOW: OUT goes LOW when object detected
        withEngine(engine => engine.pushInputSignal(nodeId, 'OUT', !next));
      };

      return (
        <CompactCard borderColor={objectDetected ? 'rgba(239,68,68,0.4)' : 'rgba(186,242,100,0.2)'}>
          <button
            onClick={toggle}
            className={`w-full py-1 rounded-md border-none cursor-pointer font-extrabold text-[9px] font-mono tracking-wider transition-all ${
              objectDetected
                ? 'bg-red-500/90 text-white shadow-[0_0_6px_rgba(239,68,68,0.3)]'
                : (isLightTheme ? 'bg-slate-200 text-slate-700' : 'bg-slate-700/90 text-slate-400')
            }`}
          >
            {objectDetected ? '● OBJECT DETECTED' : '○ SIMULATE OBJECT'}
          </button>
        </CompactCard>
      );
    }

    // ── MPU6050 3D IMU ──────────────────────────────────────────────────────
    if (isMPU6050) {
      const sv = currentValues ?? {};
      const accelX = sv.accelX ?? 0;
      const accelY = sv.accelY ?? 0;
      const accelZ = sv.accelZ ?? 1;
      const gyroX = sv.gyroX ?? 0;
      const gyroY = sv.gyroY ?? 0;
      const gyroZ = sv.gyroZ ?? 0;
      const temp = sv.temp ?? 25;

      const update = (key: string, val: number) => {
        const next = { accelX, accelY, accelZ, gyroX, gyroY, gyroZ, temp, [key]: val };
        updateNodeData(nodeId, { sensorValues: next });
        withEngine(engine => engine.pushMPU6050Values(nodeId, next));
      };

      return (
        <CompactCard borderColor="rgba(186, 242, 100, 0.2)">
          <SliderRow label="ACCEL X" unit="g" min={-2} max={2} step={0.01} value={accelX} color="#38bdf8" onChange={v => update('accelX', v)} />
          <SliderRow label="ACCEL Y" unit="g" min={-2} max={2} step={0.01} value={accelY} color="#38bdf8" onChange={v => update('accelY', v)} />
          <SliderRow label="ACCEL Z" unit="g" min={-2} max={2} step={0.01} value={accelZ} color="#38bdf8" onChange={v => update('accelZ', v)} />
          <SliderRow label="GYRO X" unit="°" min={-250} max={250} step={1} value={gyroX} color="#a78bfa" onChange={v => update('gyroX', v)} />
          <SliderRow label="GYRO Y" unit="°" min={-250} max={250} step={1} value={gyroY} color="#a78bfa" onChange={v => update('gyroY', v)} />
          <SliderRow label="GYRO Z" unit="°" min={-250} max={250} step={1} value={gyroZ} color="#a78bfa" onChange={v => update('gyroZ', v)} />
          <SliderRow label="TEMP" unit="°C" min={-40} max={85} step={0.1} value={temp} color="#f97316" onChange={v => update('temp', v)} />
        </CompactCard>
      );
    }

    // ── NTC Temperature Sensor ───────────────────────────────────────────────
    if (isNTC) {
      const tempC = currentValues?.value ?? 25;

      const R0 = 10000, B = 3950, T0 = 298.15, Rs = 10000, VCC = 5.0;
      const T = tempC + 273.15;
      const R_ntc = R0 * Math.exp(B * (1 / T - 1 / T0));
      const voltage = VCC * R_ntc / (Rs + R_ntc);
      const adcRaw = Math.round((voltage / VCC) * 1023);

      const handleChange = (val: number) => {
        updateNodeData(nodeId, { sensorValues: { ...currentValues, value: val } });
        withEngine(engine => engine.pushInputSignal(nodeId, 'OUT', true));
      };

      return (
        <CompactCard borderColor="rgba(249,115,22,0.3)">
          <SliderRow
            label="TEMP"
            unit="°C"
            min={-40}
            max={125}
            step={0.5}
            value={tempC}
            color="#f97316"
            onChange={handleChange}
          />
          <div className="flex justify-between text-[9px] font-mono font-bold px-0.5">
            <span className="text-slate-500">Vout</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{voltage.toFixed(2)}V</span>
            <span className="text-slate-500">ADC</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{adcRaw}</span>
          </div>
        </CompactCard>
      );
    }

    // ── Photoresistor (LDR) Sensor ──────────────────────────────────────────
    if (isLDR) {
      const lux = Number(currentValues?.value ?? 500);
      const threshold = Number(currentValues?.threshold ?? 500);

      const R_ldr = 500000 / Math.max(1, lux);
      const R_series = 10000;
      const voltage = 5.0 * R_series / (R_ldr + R_series);
      const adcRaw = Math.round((voltage / 5.0) * 1023);
      const doLow = lux < threshold;

      const handleChange = (key: 'value' | 'threshold', val: number) => {
        const next = { ...currentValues, [key]: val };
        updateNodeData(nodeId, { sensorValues: next });
        withEngine(engine => {
          engine.pushInputSignal(nodeId, 'AO', true);
          const doIsLow = (key === 'value' ? val : lux) < (key === 'threshold' ? val : threshold);
          engine.pushInputSignal(nodeId, 'DO', !doIsLow);
        });
      };

      return (
        <CompactCard borderColor="rgba(251,191,36,0.3)">
          <SliderRow
            label="LIGHT"
            unit="lx"
            min={0}
            max={1000}
            step={1}
            value={lux}
            color="#fbbf24"
            onChange={v => handleChange('value', v)}
          />
          <div className="flex justify-between text-[9px] font-mono font-bold px-0.5">
            <span className="text-slate-500">Vout</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{voltage.toFixed(1)}V</span>
            <span className="text-slate-500">ADC</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{adcRaw}</span>
            <span className="text-slate-500">DO</span>
            <span className={`font-black ${doLow ? 'text-red-500' : 'text-emerald-400'}`}>
              {doLow ? 'LOW' : 'HIGH'}
            </span>
          </div>
        </CompactCard>
      );
    }

    // ── Flame Sensor ────────────────────────────────────────────────────────
    if (isFlame) {
      const intensity = Number(currentValues?.value ?? 0);
      const threshold = Number(currentValues?.threshold ?? 50);
      const flameOn = intensity > threshold;
      const voltage = 5.0 * (1 - intensity / 100);

      const handleChange = (key: 'value' | 'threshold', val: number) => {
        const next = { ...currentValues, [key]: val };
        updateNodeData(nodeId, { sensorValues: next });
        withEngine(engine => {
          engine.pushInputSignal(nodeId, 'AOUT', true);
          const nowFlame = (key === 'value' ? val : intensity) > (key === 'threshold' ? val : threshold);
          engine.pushInputSignal(nodeId, 'DOUT', !nowFlame);
        });
      };

      return (
        <CompactCard borderColor={flameOn ? 'rgba(249,115,22,0.4)' : 'rgba(186,242,100,0.2)'}>
          <SliderRow
            label="FLAME"
            unit="%"
            min={0}
            max={100}
            step={1}
            value={intensity}
            color="#f97316"
            onChange={v => handleChange('value', v)}
          />
          <div className="flex justify-between text-[9px] font-mono font-bold px-0.5">
            <span className="text-slate-500">State</span>
            <span className={`font-black ${flameOn ? 'text-red-500' : 'text-emerald-400'}`}>
              {flameOn ? 'ACTIVE' : 'SAFE'}
            </span>
            <span className="text-slate-500">Vout</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{voltage.toFixed(2)}V</span>
          </div>
        </CompactCard>
      );
    }

    // ── Gas Sensor ──────────────────────────────────────────────────────────
    if (isGas) {
      const concentration = Number(currentValues?.value ?? 0);
      const threshold = Number(currentValues?.threshold ?? 50);
      const gasDetected = concentration > threshold;
      const voltage = 5.0 * concentration / 100;

      const handleChange = (key: 'value' | 'threshold', val: number) => {
        const next = { ...currentValues, [key]: val };
        updateNodeData(nodeId, { sensorValues: next });
        withEngine(engine => {
          engine.pushInputSignal(nodeId, 'AOUT', true);
          const nowGas = (key === 'value' ? val : concentration) > (key === 'threshold' ? val : threshold);
          engine.pushInputSignal(nodeId, 'DOUT', !nowGas);
        });
      };

      return (
        <CompactCard borderColor={gasDetected ? 'rgba(251,146,60,0.4)' : 'rgba(186,242,100,0.2)'}>
          <SliderRow
            label="GAS"
            unit="%"
            min={0}
            max={100}
            step={1}
            value={concentration}
            color="#fb923c"
            onChange={v => handleChange('value', v)}
          />
          <div className="flex justify-between text-[9px] font-mono font-bold px-0.5">
            <span className="text-slate-500">Air</span>
            <span className={`font-black ${gasDetected ? 'text-red-500' : 'text-emerald-400'}`}>
              {gasDetected ? 'SMOKE' : 'CLEAN'}
            </span>
            <span className="text-slate-500">Vout</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{voltage.toFixed(2)}V</span>
          </div>
        </CompactCard>
      );
    }

    // ── Rain Sensor ────────────────────────────────────────────────────────
    if (isRain) {
      const rainLevel = Number(currentValues?.value ?? 0);
      const threshold = Number(currentValues?.threshold ?? 50);
      const rainDetected = rainLevel > threshold;
      const voltage = 5.0 * rainLevel / 100;

      const handleChange = (key: 'value' | 'threshold', val: number) => {
        const next = { ...currentValues, [key]: val };
        updateNodeData(nodeId, { sensorValues: next });
        withEngine(engine => {
          engine.pushInputSignal(nodeId, 'AO', true);
          const nowRain = (key === 'value' ? val : rainLevel) > (key === 'threshold' ? val : threshold);
          engine.pushInputSignal(nodeId, 'DO', !nowRain);
        });
      };

      return (
        <CompactCard borderColor={rainDetected ? 'rgba(56,189,248,0.4)' : 'rgba(186,242,100,0.2)'}>
          <SliderRow
            label="RAIN"
            unit="%"
            min={0}
            max={100}
            step={1}
            value={rainLevel}
            color="#38bdf8"
            onChange={v => handleChange('value', v)}
          />
          <div className="flex justify-between text-[9px] font-mono font-bold px-0.5">
            <span className="text-slate-500">State</span>
            <span className={`font-black ${rainDetected ? 'text-sky-400' : 'text-emerald-400'}`}>
              {rainDetected ? 'WET' : 'DRY'}
            </span>
            <span className="text-slate-500">Vout</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{voltage.toFixed(2)}V</span>
          </div>
        </CompactCard>
      );
    }

    // ── Soil Moisture Sensor ─────────────────────────────────────────────
    if (isSoilMoisture) {
      const moisture = Number(currentValues?.value ?? 0);
      const threshold = Number(currentValues?.threshold ?? 50);
      const soilWet = moisture > threshold;
      const voltage = 5.0 * moisture / 100;

      const handleChange = (key: 'value' | 'threshold', val: number) => {
        const next = { ...currentValues, [key]: val };
        updateNodeData(nodeId, { sensorValues: next });
        withEngine(engine => {
          engine.pushInputSignal(nodeId, 'AO', true);
          const nowWet = (key === 'value' ? val : moisture) > (key === 'threshold' ? val : threshold);
          engine.pushInputSignal(nodeId, 'DO', !nowWet);
        });
      };

      return (
        <CompactCard borderColor={soilWet ? 'rgba(34,197,94,0.4)' : 'rgba(186,242,100,0.2)'}>
          <SliderRow
            label="MOISTURE"
            unit="%"
            min={0}
            max={100}
            step={1}
            value={moisture}
            color="#22c55e"
            onChange={v => handleChange('value', v)}
          />
          <div className="flex justify-between text-[9px] font-mono font-bold px-0.5">
            <span className="text-slate-500">State</span>
            <span className={`font-black ${soilWet ? 'text-green-400' : 'text-emerald-400'}`}>
              {soilWet ? 'WET' : 'DRY'}
            </span>
            <span className="text-slate-500">Vout</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{voltage.toFixed(2)}V</span>
          </div>
        </CompactCard>
      );
    }

    // ── Water Level Float Sensor ──────────────────────────────────────────
    if (isWaterLevelFloat) {
      const level = Number(currentValues?.value ?? 0);
      const threshold = Number(currentValues?.threshold ?? 50);
      const isFull = level >= threshold;
      const voltage = 5.0 * level / 100;

      const handleChange = (key: 'value' | 'threshold', val: number) => {
        const next = { ...currentValues, [key]: val };
        updateNodeData(nodeId, { sensorValues: next, value: next.value });
        withEngine(engine => {
          const nowVal = key === 'value' ? val : level;
          const nowThresh = key === 'threshold' ? val : threshold;
          const nowFull = nowVal >= nowThresh;
          engine.pushInputSignal(nodeId, 'S', nowFull);
          engine.pushInputSignal(nodeId, 'OUT', nowFull);
          engine.pushInputSignal(nodeId, 'AO', nowFull);
        });
      };

      return (
        <CompactCard borderColor={isFull ? 'rgba(56,189,248,0.4)' : 'rgba(148,163,184,0.2)'}>
          <SliderRow
            label="WATER LEVEL"
            unit="%"
            min={0}
            max={100}
            step={1}
            value={level}
            color="#38bdf8"
            onChange={v => handleChange('value', v)}
          />
          <div className="flex justify-between text-[9px] font-mono font-bold px-0.5">
            <span className="text-slate-500">State</span>
            <span className={`font-black ${isFull ? 'text-sky-400' : 'text-slate-400'}`}>
              {isFull ? 'TANK FULL (HIGH)' : 'TANK LOW (LOW)'}
            </span>
            <span className="text-slate-500">Vout</span>
            <span className="text-sky-400 font-mono">{voltage.toFixed(2)}V</span>
          </div>
        </CompactCard>
      );
    }

    // ── Heart Rate Sensor ────────────────────────────────────────────────────
    if (isHeartRate) {
      const bpm = Number(currentValues?.bpm ?? 72);

      const handleChange = (val: number) => {
        updateNodeData(nodeId, { sensorValues: { ...currentValues, bpm: val } });
      };

      return (
        <CompactCard borderColor="rgba(239,68,68,0.3)">
          <SliderRow
            label="PULSE"
            unit="bpm"
            min={20}
            max={200}
            step={1}
            value={bpm}
            color="#ef4444"
            onChange={handleChange}
          />
        </CompactCard>
      );
    }

    // ── Sound Sensor ────────────────────────────────────────────────────────
    if (isBigSound) {
      const level = Number(currentValues?.value ?? 0);
      const threshold = Number(currentValues?.threshold ?? 50);
      const soundOn = level > threshold;
      const voltage = 5.0 * level / 100;

      const handleChange = (key: 'value' | 'threshold', val: number) => {
        const next = { ...currentValues, [key]: val };
        updateNodeData(nodeId, { sensorValues: next });
        withEngine(engine => {
          engine.pushInputSignal(nodeId, 'AOUT', true);
          const nowSound = (key === 'value' ? val : level) > (key === 'threshold' ? val : threshold);
          engine.pushInputSignal(nodeId, 'DOUT', nowSound);
        });
      };

      return (
        <CompactCard borderColor={soundOn ? 'rgba(251,146,60,0.4)' : 'rgba(186,242,100,0.2)'}>
          <SliderRow
            label="SOUND"
            unit="%"
            min={0}
            max={100}
            step={1}
            value={level}
            color="#fb923c"
            onChange={v => handleChange('value', v)}
          />
          <div className="flex justify-between text-[9px] font-mono font-bold px-0.5">
            <span className="text-slate-500">Mic</span>
            <span className={`font-black ${soundOn ? 'text-orange-400' : 'text-slate-500'}`}>
              {soundOn ? 'LOUD' : 'QUIET'}
            </span>
            <span className="text-slate-500">Vout</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{voltage.toFixed(2)}V</span>
          </div>
        </CompactCard>
      );
    }

    // ── HX711 Load Cell ─────────────────────────────────────────────────────
    if (isHX711) {
      const weight = Number(currentValues?.weight ?? 0);
      const maxWeight = Number(currentValues?.maxWeight ?? 5000);
      const weightKg = (weight / 1000).toFixed(2);

      const handleWeightChange = (val: number) => {
        updateNodeData(nodeId, { sensorValues: { ...currentValues, weight: val } });
      };

      return (
        <CompactCard borderColor="rgba(186,242,100,0.2)">
          <SliderRow
            label="WEIGHT"
            unit="g"
            min={0}
            max={maxWeight}
            step={1}
            value={weight}
            color="#bef264"
            onChange={handleWeightChange}
          />
          <div className="flex justify-between text-[9px] font-mono font-bold px-0.5">
            <span className="text-slate-500">Mass</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{weightKg} kg</span>
            <span className="text-slate-500">Max</span>
            <span className={isLightTheme ? 'text-sky-600' : 'text-[#bef264]'}>{maxWeight}g</span>
          </div>
        </CompactCard>
      );
    }



    // ── Single-value sensors (hc-sr04, resistor, etc.) ──────────────────────
    const config = isDistance
      ? { label: 'DIST', unit: 'cm', min: 0, max: 400, step: 0.1, key: 'distance', default: 100, color: '#BEF264' }
      : type === 'potentiometer'
        ? { label: 'POS', unit: '', min: 0, max: 1023, step: 1, key: 'value', default: 100, color: '#BEF264' }
        : type === 'slide-potentiometer'
          ? { label: 'POS', unit: '', min: 0, max: 1023, step: 1, key: 'value', default: 100, color: '#BEF264' }
          : type === 'resistor'
            ? { label: 'RES', unit: 'Ω', min: 0, max: 1000000, step: 100, key: 'value', default: 1000, color: '#BEF264' }
            : type === 'photoresistor'
              ? { label: 'LIGHT', unit: 'lux', min: 0, max: 1000, step: 1, key: 'value', default: 500, color: '#fbbf24' }
              : type === 'ntc-temperature-sensor'
                ? { label: 'TEMP', unit: '°C', min: -40, max: 125, step: 0.1, key: 'value', default: 25, color: '#f97316' }
                : { label: 'VAL', unit: '', min: 0, max: 1023, step: 1, key: 'value', default: 100, color: '#BEF264' };

    const currentValue = currentValues?.[config.key] ?? config.default ?? config.min;

    const handleChange = (val: number) => {
      updateNodeData(nodeId, {
        [config.key]: val,
        sensorValues: { ...currentValues, [config.key]: val },
      });
      // HC-SR04: distance is read from the store at each TRIG edge — pushing
      // the ECHO pin HIGH would leave it stuck HIGH, making pulseIn wait for
      // the engine's next scheduled LOW (1s timeout → zero readings).
      if (type === 'hc-sr04') return;
      const outPin = type === 'photoresistor' || type === 'photoresistor-sensor' ? 'AO'
        : type === 'potentiometer' || type === 'slide-potentiometer' ? 'SIG'
          : 'OUT';
      withEngine(engine => engine.pushInputSignal(nodeId, outPin, true));
    };

      return (
        <CompactCard borderColor="rgba(186, 242, 100, 0.2)">
        <SliderRow
          label={config.label}
          unit={config.unit}
          min={config.min}
          max={config.max}
          step={config.step}
          value={currentValue}
          color={config.color}
          onChange={handleChange}
        />
      </CompactCard>
    );
  };

  const cardContent = renderContent();
  if (!cardContent) return null;

  const pinData = LEAP_PINS[type];
  const nodeW = (pinData?.viewBox?.width || 150) * 0.75;
  const nodeH = (pinData?.viewBox?.height || 80) * 0.75;

  return (
    <RotationContext.Provider value={rotation}>
      <NodeDimensionsContext.Provider value={{ width: nodeW, height: nodeH }}>
        {cardContent}
      </NodeDimensionsContext.Provider>
    </RotationContext.Provider>
  );
};
