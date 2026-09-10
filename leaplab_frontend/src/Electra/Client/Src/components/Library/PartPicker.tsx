/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 */
import React, { useState } from 'react';
import { LEAP_PINS } from '../../engine/Arduino/PinHarness';
import {
  Search,
  X,
  ChevronDown
} from 'lucide-react';

const COMPONENTS = [
  { id: 'battery-12v', name: '12V Battery', category: 'inputs', desc: '12V Lead-acid battery' },
  { id: '7segment', name: '7-Segment', category: 'displays', desc: 'Numeric display' },
  { id: 'a4988', name: 'A4988 Driver', category: 'outputs', desc: 'Stepper motor driver' },
  { id: 'biaxial-stepper', name: 'Biaxial Stepper', category: 'outputs', desc: 'Dual-axis stepper' },
  { id: 'big-sound-sensor', name: 'Big Sound Sensor', category: 'sensors', desc: 'Sound detection module' },
  { id: 'buzzer', name: 'Buzzer', category: 'outputs', desc: 'Piezo sounder' },
  { id: 'dc-motor', name: 'DC Motor', category: 'outputs', desc: 'Simple DC motor' },
  { id: 'dht22', name: 'DHT22', category: 'sensors', desc: 'Temp & Humidity' },
  { id: 'ds1307', name: 'DS1307 RTC', category: 'sensors', desc: 'Real-time clock' },
  { id: 'flame-sensor', name: 'Flame Sensor', category: 'sensors', desc: 'IR flame detector' },
  { id: 'gas-sensor', name: 'Gas Sensor', category: 'sensors', desc: 'MQ-series gas sensor' },
  { id: 'hc-sr04', name: 'HC-SR04', category: 'sensors', desc: 'Ultrasonic distance' },
  { id: 'heart-beat-sensor', name: 'Heart Rate', category: 'sensors', desc: 'Pulse sensor' },
  { id: 'hx711', name: 'HX711 Load Cell', category: 'sensors', desc: 'Weight sensor amp' },
  { id: 'ili9341', name: 'ILI9341 TFT', category: 'displays', desc: '2.8" SPI TFT' },
  { id: 'ili9341-touch', name: 'ILI9341 TFT + FT6206 Touch', category: 'displays', desc: '2.8" SPI TFT + I2C Touch' },
  { id: 'ir-receiver', name: 'IR Receiver', category: 'sensors', desc: 'Infrared receiver' },
  { id: 'ir-remote', name: 'IR Remote', category: 'inputs', desc: 'Infrared remote' },
  { id: 'analog-joystick', name: 'Joystick', category: 'inputs', desc: '2-axis analog joystick' },
  { id: 'membrane-keypad', name: 'Keypad (4x4)', category: 'inputs', desc: 'Matrix keypad' },
  { id: 'l298n', name: 'L298N Driver', category: 'outputs', desc: 'Dual DC motor driver' },
  { id: 'lcd1602', name: 'LCD 1602', category: 'displays', desc: '16x2 Character display' },
  { id: 'lcd1602-i2c', name: 'LCD 1602 I²C', category: 'displays', desc: '16x2 Character display (I²C)' },
  { id: 'lcd2004', name: 'LCD 2004', category: 'displays', desc: '20x4 Character display' },
  { id: 'lcd2004-i2c', name: 'LCD 2004 I²C', category: 'displays', desc: '20x4 Character display (I²C)' },
  { id: 'led', name: 'LED', category: 'outputs', desc: 'Standard 5mm LED' },
  { id: 'led-bar-graph', name: 'LED Bar Graph', category: 'outputs', desc: '10-segment LED bar' },
  { id: 'led-ring', name: 'LED Ring', category: 'outputs', desc: 'NeoPixel Ring' },
  { id: 'microsd-card', name: 'MicroSD Card', category: 'sensors', desc: 'SD card module' },
  { id: 'mpu6050', name: 'MPU6050', category: 'sensors', desc: 'Accelerometer & Gyro' },
  { id: 'neopixel', name: 'NeoPixel', category: 'outputs', desc: 'Addressable RGB LED' },
  { id: 'neopixel-matrix', name: 'NeoPixel Matrix', category: 'outputs', desc: 'RGB LED Matrix' },
  { id: 'ntc-temperature-sensor', name: 'NTC Thermistor', category: 'sensors', desc: 'Temperature sensor' },
  { id: 'ssd1306', name: 'OLED SSD1306', category: 'displays', desc: '128x64 Graphics OLED' },
  { id: 'photoresistor-sensor', name: 'Photoresistor', category: 'sensors', desc: 'Light sensor (LDR)' },
  { id: 'pir-motion-sensor', name: 'PIR Sensor', category: 'sensors', desc: 'Motion detector' },
  { id: 'ir-obstacle-sensor', name: 'IR Sensor', category: 'sensors', desc: 'IR Obstacle Avoidance (FC-51)' },
  { id: 'potentiometer', name: 'Potentiometer', category: 'inputs', desc: 'Variable resistor' },
  { id: 'proximity-sensor', name: 'Proximity Sensor', category: 'sensors', desc: 'IR proximity detector' },
  { id: 'rain-sensor', name: 'Rain Sensor', category: 'sensors', desc: 'Rain detection sensor (AO + DO)' },
  { id: 'soil-moisture-sensor', name: 'Soil Moisture', category: 'sensors', desc: 'Soil moisture sensor (AO + DO)' },
  { id: 'pushbutton', name: 'Pushbutton', category: 'inputs', desc: 'Momentary switch' },
  { id: 'relay-module', name: 'Relay Module', category: 'outputs', desc: 'Single-channel relay' },
  { id: 'resistor', name: 'Resistor', category: 'inputs', desc: 'Passive resistor' },
  { id: 'rgb-led', name: 'RGB LED', category: 'outputs', desc: 'Multi-color LED' },
  { id: 'rotary-dialer', name: 'Rotary Dialer', category: 'inputs', desc: 'Rotary dial selector' },
  { id: 'ky-040', name: 'Rotary Encoder', category: 'inputs', desc: 'Incremental encoder' },
  { id: 'servo', name: 'Servo Motor', category: 'outputs', desc: 'Positionable motor' },
  { id: 'slide-potentiometer', name: 'Slide Pot', category: 'inputs', desc: 'Slider potentiometer' },
  { id: 'slide-switch', name: 'Slide Switch', category: 'inputs', desc: 'SPDT toggle' },
  { id: 'small-sound-sensor', name: 'Small Sound Sensor', category: 'sensors', desc: 'Microphone sensor' },
  { id: 'stepper-motor', name: 'Stepper Motor', category: 'outputs', desc: 'Step motor' },
  { id: 'tilt-switch', name: 'Tilt Switch', category: 'sensors', desc: 'Tilt detection switch' },
  { id: 'water-pump', name: 'Water Pump', category: 'outputs', desc: 'Mini 3V-6V DC water pump' },
  { id: 'water-level-float-sensor', name: 'Float Sensor', category: 'sensors', desc: 'Water level float sensor (AO + DO)' },
];

const getComponentScale = (id: string, defaultScale: number): number => {
  // Custom manual scale overrides for components that need specific sizing
  if (id === 'neopixel') return 2.3;
  if (id === 'led' || id === 'rgb-led') return 1.0;
  if (id === 'resistor') return 1.3;
  if (id === 'membrane-keypad') return 0.2;
  if (id === 'analog-joystick') return 0.55;
  if (id === 'hc-sr04') return 0.4;
  if (id === 'led-bar-graph') return 0.8;
  if (id === 'l298n') return 0.4;
  if (id === 'a4988') return 0.4;
  if (id === 'ds1307') return 0.8;
  if (id === 'microsd-card') return 0.8;
  if (id === 'hx711') return 0.4;
  if (id === '7segment') return 0.8;
  if (id === 'lcd1602') return 0.25;
  if (id === 'lcd1602-i2c') return 0.25;
  if (id === 'lcd2004') return 0.25;
  if (id === 'lcd2004-i2c') return 0.25;
  if (id === 'ssd1306') return 0.8;
  if (id === 'ili9341') return 0.4;
  if (id === 'ili9341-touch') return 0.4;
  if (id == 'neopixel-matrix') return 0.4;
  if (id === 'rain-sensor' || id === 'soil-moisture-sensor') return 0.45;
  const pinData = LEAP_PINS[id];
  if (!pinData || !pinData.viewBox) {
    return defaultScale; // Fallback to default scale
  }
  const { width, height } = pinData.viewBox;
  const maxDim = Math.max(width, height);
  // Calculate the component size at default scale
  const currentSize = maxDim * defaultScale;
  // If it exceeds the target box size (72px), scale it down to fit.
  // Otherwise, keep the default scale so it doesn't get oversized.
  if (currentSize > 72) {
    return 72 / maxDim;
  }
  return defaultScale;
};

interface PartPickerProps {
  onSelect: (type: string) => void;
  onClose: () => void;
  currentBoard?: 'arduino-uno' | 'esp32-c3' | 'esp32';
}

export const PartPicker: React.FC<PartPickerProps> = ({ onSelect, onClose, currentBoard = 'arduino-uno' }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(true);

  const handleDragStart = (event: React.DragEvent, componentType: string) => {
    event.dataTransfer.setData('application/forge-component', componentType);
    event.dataTransfer.effectAllowed = 'move';
    // Use the card itself as drag image to avoid flicker from inner
    // leap-element interactive states (pushbutton pressed gradient etc.).
    // Without this, the browser snapshots the inner SVG while its
    // :active / pressed Lit state toggles during mousedown → flicker.
    const target = event.currentTarget as HTMLElement;
    if (target && event.dataTransfer.setDragImage) {
      const rect = target.getBoundingClientRect();
      // Center the ghost under cursor for stable dragging
      const offsetX = rect.width / 2;
      const offsetY = rect.height / 2;
      try {
        event.dataTransfer.setDragImage(target, offsetX, offsetY);
      } catch {
        // Some browsers (e.g. older Safari) throw if called outside dragstart
      }
    }
  };

  const isESP32Board = currentBoard === 'esp32-c3' || currentBoard === 'esp32';

  const shouldHide = (id: string): boolean => {
    if (id === 'biaxial-stepper' && isESP32Board) return true;
    return false;
  };

  let allComponents = [...COMPONENTS];

  // Apply board-specific hiding
  if (isESP32Board) {
    allComponents = allComponents.filter(c => !shouldHide(c.id));
  }

  // Sort alphabetically by name
  allComponents.sort((a, b) => a.name.localeCompare(b.name));

  // Filter based on search query
  const filteredComponents = allComponents.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="component-sidebar w-full h-full bg-white flex flex-col border-r border-slate-200 font-sans">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white/90">
        <div className="flex flex-col">
          <span className="text-cyan-600 text-xs font-extrabold tracking-wider uppercase">Component Library</span>
          <span className="text-slate-500 text-[9px] font-semibold">v1.1.0-STABLE</span>
        </div>
        <button
          onClick={onClose}
          className="bg-transparent border-none text-slate-500 hover:text-cyan-600 cursor-pointer p-1 flex items-center justify-center transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Search Bar - outside scrollable area */}
      <div className="p-3 px-4 bg-white border-b border-slate-200 shrink-0">
        <div className="bg-slate-100 flex items-center px-2.5 border border-slate-200 rounded-lg shadow-inner">
          <Search size={14} className="text-slate-400 mr-1.5" />
          <input
            type="text"
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none py-2 text-slate-800 text-xs outline-none w-full font-sans"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1">
        {/* Accordion 1: COMPONENT LIBRARY */}
        <div className="flex flex-col">
          <button
            onClick={() => setLibraryOpen(!libraryOpen)}
            className="p-3.5 px-4 bg-transparent border-none border-b border-slate-200 flex items-center justify-between text-slate-700 font-bold text-[11px] uppercase tracking-wider cursor-pointer w-full text-left"
          >
            <span>COMPONENT LIBRARY</span>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${libraryOpen ? 'rotate-0' : '-rotate-90'}`}
            />
          </button>

          {libraryOpen && (
            <div className="flex flex-col bg-slate-50">
              {/* 2-Column Grid */}
              <div className="grid grid-cols-2 gap-3 p-3 px-4 pb-4">
                {filteredComponents.map(comp => (
                  <div key={comp.id} className="flex flex-col gap-1.5 items-center min-w-0">
                    <div
                      onClick={() => onSelect(comp.id)}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, comp.id)}
                      className="component-card bg-white border border-slate-200 w-full aspect-square cursor-grab flex items-center justify-center rounded-2xl shadow-sm relative overflow-hidden transition-all duration-200 hover:border-cyan-500 hover:shadow-md"
                      title={comp.name}
                    >
                      <div
                        style={{ transform: `scale(${getComponentScale(comp.id, 0.7)})`, pointerEvents: 'none' }}
                        className="origin-center w-full h-full flex items-center justify-center opacity-95 select-none"
                        aria-hidden="true"
                      >
                        {React.createElement(`leap-${comp.id}` as any, {
                          color: comp.id === 'led' ? 'red' : undefined,
                          ...(comp.id === 'rgb-led' ? { ledRed: 0.2, ledGreen: 0.8, ledBlue: 0.8 } : {}),
                          ...(comp.id === 'neopixel' ? { r: 0.2, g: 0.8, b: 0.8 } : {}),
                          value: true
                        })}
                      </div>
                    </div>
                    <span className="text-[9px] font-bold text-slate-600 text-center w-full whitespace-nowrap overflow-hidden text-ellipsis opacity-90">
                      {comp.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="p-2 px-4 border-t border-slate-200 text-[9px] font-semibold text-slate-400 flex justify-between bg-white/90">
        <span>READY</span>
        <span>{filteredComponents.length} ELEMENTS</span>
      </div>
    </div>
  );
};

export default PartPicker;
