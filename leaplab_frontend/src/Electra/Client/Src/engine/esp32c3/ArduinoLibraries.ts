/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 *
 * ArduinoLibraries.ts — Complete Arduino library implementations for ESP32 simulation
 * 
 * This file provides Wokwi-level simulation quality for all major Arduino libraries.
 * Each library is implemented as a JavaScript class that mimics the real Arduino API.
 */

import { useForgeStore } from '../../../utils/store/useForgeStore';

/** Helper to match a React Flow edge pin handle to a numeric pin */
function matchPin(handle: string | null | undefined, pin: number): boolean {
    if (!handle) return false;
    const cleanHandle = handle.replace(/__target$/, '').trim().toUpperCase();
    const pinStr = String(pin);
    return cleanHandle === pinStr || 
           cleanHandle === `D${pinStr}` || 
           cleanHandle === `ESP${pinStr}` || 
           cleanHandle === `A${pinStr}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVO LIBRARY
// ═══════════════════════════════════════════════════════════════════════════

export function createServoClass(runtime: any) {
    return class Servo {
        private pin = -1;
        private angle = 90;
        private minPulse = 544;  // µs
        private maxPulse = 2400; // µs
        private _attached = false;

        attach(pin: number, min?: number, max?: number): number {
            this.pin = pin;
            this._attached = true;
            if (min !== undefined) this.minPulse = min;
            if (max !== undefined) this.maxPulse = max;
            runtime.pinMode(pin, 1); // OUTPUT
            console.log(`[Servo] Attached to pin ${pin}`);
            return pin;
        }

        setPeriodHertz(hertz: number): void {
            console.log(`[Servo] setPeriodHertz to ${hertz}Hz`);
        }

        write(angle: number): void {
            if (!this._attached || this.pin < 0) return;
            this.angle = Math.max(0, Math.min(180, angle));
            // Send angle directly to CircuitEngine (0-180 range)
            runtime.analogWrite(this.pin, this.angle);
            console.log(`[Servo] Pin ${this.pin} → ${this.angle}°`);
        }

        writeMicroseconds(us: number): void {
            if (!this._attached || this.pin < 0) return;
            // Convert microseconds to angle: 544µs=0°, 2400µs=180°
            const angle = ((us - this.minPulse) / (this.maxPulse - this.minPulse)) * 180;
            this.write(angle);
        }

        read(): number {
            return this.angle;
        }

        readMicroseconds(): number {
            return Math.round(this.minPulse + (this.angle / 180) * (this.maxPulse - this.minPulse));
        }

        attached(): boolean {
            return this._attached;
        }

        detach(): void {
            this._attached = false;
            this.pin = -1;
            console.log(`[Servo] Detached`);
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// STEPPER LIBRARY
// ═══════════════════════════════════════════════════════════════════════════

export function createStepperClass(runtime: any) {
    return class Stepper {
        private stepsPerRev: number;
        private pins: number[];
        private currentStep = 0;
        private stepDelay = 1000; // µs per step
        private direction = 1;
        private lastStepTime = 0;

        constructor(steps: number, pin1: number, pin2: number, pin3?: number, pin4?: number) {
            this.stepsPerRev = steps;
            this.pins = [pin1, pin2];
            if (pin3 !== undefined) this.pins.push(pin3);
            if (pin4 !== undefined) this.pins.push(pin4);

            // Initialize all pins as OUTPUT
            this.pins.forEach(p => runtime.pinMode(p, 1));

            if (this.pins.length === 4) {
                console.warn(
                    `[Stepper] ⚠ 4-wire mode (pins: ${this.pins.join(',')}). ` +
                    `Your circuit has an A4988 driver, but 4-wire mode drives coil pins ` +
                    `(for ULN2003). With A4988, use: Stepper(200, STEP_PIN, DIR_PIN) ` +
                    `(2-wire STEP/DIR mode) or AccelStepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN). ` +
                    `Alternatively, replace the A4988 with a "Stepper Motor" component.`
                );
            }

            console.log(`[Stepper] Initialized: ${steps} steps/rev, pins: ${this.pins.join(',')}`);
        }

        setSpeed(rpm: number): void {
            this.stepDelay = Math.max(50, (60 * 1000000) / (this.stepsPerRev * rpm));
            console.log(`[Stepper] Speed set to ${rpm} RPM (${this.stepDelay}µs per step)`);
        }

        async step(steps: number): Promise<void> {
            const stepsToMove = Math.abs(steps);
            this.direction = steps > 0 ? 1 : -1;

            for (let i = 0; i < stepsToMove; i++) {
                const now = runtime.micros();
                if (now - this.lastStepTime < this.stepDelay) {
                    const waitTime = this.stepDelay - (now - this.lastStepTime);
                    await runtime.__delayMicroseconds(waitTime);
                }

                this.currentStep += this.direction;
                if (this.currentStep >= this.stepsPerRev) this.currentStep = 0;
                if (this.currentStep < 0) this.currentStep = this.stepsPerRev - 1;

                await this.stepMotor();
                this.lastStepTime = runtime.micros();
            }
        }

        private async stepMotor(): Promise<void> {
            if (this.pins.length === 4) {
                // 4-wire bipolar stepper (full step) — direct coil drive (ULN2003)
                const sequence = [
                    [1, 0, 1, 0],
                    [0, 1, 1, 0],
                    [0, 1, 0, 1],
                    [1, 0, 0, 1]
                ];
                const pattern = sequence[Math.abs(this.currentStep) % 4];
                this.pins.forEach((pin, i) => {
                    runtime.digitalWrite(pin, pattern[i]);
                });
            } else if (this.pins.length === 2) {
                // 2-wire stepper (STEP + DIR) — used with A4988/DRV8825 driver
                // Convention: pins[0] = STEP_PIN, pins[1] = DIR_PIN
                // Set direction BEFORE step pulse (real A4988 needs 200ns setup time)
                runtime.digitalWrite(this.pins[1], this.direction > 0 ? 1 : 0); // DIR
                // Rising edge on STEP pin → one microstep
                runtime.digitalWrite(this.pins[0], 1); // STEP HIGH
                await runtime.__delayMicroseconds(5);
                runtime.digitalWrite(this.pins[0], 0); // STEP LOW
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCELSTEPPER LIBRARY (commonly used with A4988 / DRV8825)
// ═══════════════════════════════════════════════════════════════════════════

export function createAccelStepperClass(runtime: any) {
    return class AccelStepper {
        static DRIVER = 1;
        static FULL2WIRE = 2;
        static FULL3WIRE = 3;
        static FULL4WIRE = 4;
        static HALF4WIRE = 6;

        private type!: number;
        private stepPin = -1;
        private dirPin = -1;
        private pin1 = -1;
        private pin2 = -1;
        private pin3 = -1;
        private pin4 = -1;

        private _currentPos = 0;
        private _targetPos = 0;
        private _speed = 0;
        private _maxSpeed = 500;
        private _acceleration = 200;
        private _stepInterval = 0;
        private _lastStepTime = 0;
        private _direction = 1;
        private _yieldCounter = 0;

        // 4-wire step sequences
        private static FULL4WIRE_SEQ = [
            [1, 0, 1, 0],
            [0, 1, 1, 0],
            [0, 1, 0, 1],
            [1, 0, 0, 1]
        ];
        private static HALF4WIRE_SEQ = [
            [1, 0, 0, 0],
            [1, 1, 0, 0],
            [0, 1, 0, 0],
            [0, 1, 1, 0],
            [0, 0, 1, 0],
            [0, 0, 1, 1],
            [0, 0, 0, 1],
            [1, 0, 0, 1]
        ];

        constructor(type: number, pin1: number, pin2: number, pin3?: number, pin4?: number) {
            this.type = type;
            if (type === 1) { // DRIVER mode (STEP + DIR)
                this.stepPin = pin1;
                this.dirPin = pin2;
                runtime.pinMode(this.stepPin, 1);
                runtime.pinMode(this.dirPin, 1);
                console.log(`[AccelStepper] DRIVER mode: STEP=${pin1}, DIR=${pin2}`);
            } else if (type === 4) { // FULL4WIRE
                this.pin1 = pin1;
                this.pin2 = pin2;
                this.pin3 = pin3!;
                this.pin4 = pin4!;
                [pin1, pin2, pin3, pin4].forEach(p => runtime.pinMode(p, 1));
                console.log(`[AccelStepper] FULL4WIRE mode: pins=${pin1},${pin2},${pin3},${pin4}`);
            } else if (type === 6) { // HALF4WIRE
                this.pin1 = pin1;
                this.pin2 = pin2;
                this.pin3 = pin3!;
                this.pin4 = pin4!;
                [pin1, pin2, pin3, pin4].forEach(p => runtime.pinMode(p, 1));
                console.log(`[AccelStepper] HALF4WIRE mode: pins=${pin1},${pin2},${pin3},${pin4}`);
            } else {
                console.warn(`[AccelStepper] Unsupported type: ${type}`);
            }
        }

        setMaxSpeed(speed: number): void {
            this._maxSpeed = Math.max(1, speed);
        }

        setAcceleration(accel: number): void {
            this._acceleration = Math.max(1, accel);
        }

        moveTo(absolute: number): void {
            this._targetPos = absolute;
        }

        move(relative: number): void {
            this._targetPos = this._currentPos + relative;
        }

        run(): boolean {
            if (this._targetPos === this._currentPos) return false;

            const direction = this._targetPos > this._currentPos ? 1 : -1;
            const distance = Math.abs(this._targetPos - this._currentPos);

            // Speed ramp calculation
            const currentSpeed = this._speed;
            let newSpeed: number;

            // Accelerate up to max speed, decelerate near target
            const decelDistance = (currentSpeed * currentSpeed) / (2 * this._acceleration);
            if (distance > decelDistance) {
                // Accelerate or cruise
                newSpeed = Math.min(this._maxSpeed, currentSpeed + this._acceleration * 0.001);
            } else {
                // Decelerate
                newSpeed = Math.max(1, currentSpeed - this._acceleration * 0.001);
            }

            this._speed = newSpeed;
            this._direction = direction;

            // Calculate step interval in microseconds
            const stepsPerSecond = Math.max(1, newSpeed);
            this._stepInterval = 1000000 / stepsPerSecond;

            const now = runtime.micros();
            if (now - this._lastStepTime >= this._stepInterval) {
                this._lastStepTime = now;
                this._currentPos += direction;

                // Output the step
                this.stepMotor(direction);

                // Check if we've arrived
                if (Math.abs(this._targetPos - this._currentPos) <= 0) {
                    this._currentPos = this._targetPos;
                    this._speed = 0;
                    return false;
                }
            }

            return true;
        }

        async runToPosition(): Promise<void> {
            while (this.run()) {
                this._yieldCounter++;
                if (this._yieldCounter % 100 === 0) {
                    // Yield to event loop every 100 attempts to keep UI responsive
                    await new Promise<void>(resolve => setTimeout(resolve, 0));
                }
            }
        }

        runSpeedToPosition(): boolean {
            if (this._targetPos === this._currentPos) return false;
            const direction = this._targetPos > this._currentPos ? 1 : -1;
            this._direction = direction;

            const now = runtime.micros();
            if (now - this._lastStepTime >= this._stepInterval) {
                this._lastStepTime = now;
                this._currentPos += direction;
                this.stepMotor(direction);
            }
            return this._targetPos !== this._currentPos;
        }

        runSpeed(): boolean {
            const now = runtime.micros();
            if (now - this._lastStepTime >= this._stepInterval) {
                this._lastStepTime = now;
                this._currentPos += this._direction;
                this.stepMotor(this._direction);
                return true;
            }
            return false;
        }

        setSpeed(speed: number): void {
            this._speed = speed;
            this._stepInterval = Math.max(50, 1000000 / Math.max(1, Math.abs(speed)));
            this._direction = speed >= 0 ? 1 : -1;
        }

        distanceToGo(): number {
            return this._targetPos - this._currentPos;
        }

        currentPosition(): number {
            return this._currentPos;
        }

        setCurrentPosition(position: number): void {
            this._currentPos = position;
        }

        targetPosition(): number {
            return this._targetPos;
        }

        speed(): number {
            return this._speed;
        }

        maxSpeed(): number {
            return this._maxSpeed;
        }

        acceleration(): number {
            return this._acceleration;
        }

        stop(): void {
            this._targetPos = this._currentPos;
            this._speed = 0;
        }

        private stepMotor(direction: number): void {
            if (this.type === 1) {
                // DRIVER mode: STEP + DIR for A4988
                // Set DIR first (A4988 requires 200ns setup time before STEP rising edge)
                runtime.digitalWrite(this.dirPin, direction > 0 ? 1 : 0);
                // STEP rising edge → one microstep
                runtime.digitalWrite(this.stepPin, 1);
                runtime.digitalWrite(this.stepPin, 0);
            } else if (this.type === 4) {
                const seq = AccelStepper.FULL4WIRE_SEQ;
                const idx = ((this._currentPos % 4) + 4) % 4;
                const pattern = seq[idx];
                runtime.digitalWrite(this.pin1, pattern[0]);
                runtime.digitalWrite(this.pin2, pattern[1]);
                runtime.digitalWrite(this.pin3, pattern[2]);
                runtime.digitalWrite(this.pin4, pattern[3]);
            } else if (this.type === 6) {
                const seq = AccelStepper.HALF4WIRE_SEQ;
                const idx = ((this._currentPos % 8) + 8) % 8;
                const pattern = seq[idx];
                runtime.digitalWrite(this.pin1, pattern[0]);
                runtime.digitalWrite(this.pin2, pattern[1]);
                runtime.digitalWrite(this.pin3, pattern[2]);
                runtime.digitalWrite(this.pin4, pattern[3]);
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// DHT SENSOR LIBRARY (DHT11, DHT22, DHT21)
// ═══════════════════════════════════════════════════════════════════════════

export function createDHTClass(runtime: any) {
    return class DHT {
        private pin: number;
        private type: number;
        private lastReadTime = 0;
        private temperature = 25.0;
        private humidity = 60.0;

        constructor(pin: number, type: number) {
            this.pin = pin;
            this.type = type; // DHT11=11, DHT22=22
            console.log(`[DHT] Initialized DHT${type} on pin ${pin}`);
        }

        begin(): void {
            runtime.pinMode(this.pin, 2); // INPUT_PULLUP
            console.log(`[DHT] Sensor ready`);
        }

        readTemperature(fahrenheit = false): number {
            this.readSensor();
            return fahrenheit ? (this.temperature * 9 / 5) + 32 : this.temperature;
        }

        readHumidity(): number {
            this.readSensor();
            return this.humidity;
        }

        computeHeatIndex(temperature: number, humidity: number, isFahrenheit = false): number {
            let t = temperature;
            if (!isFahrenheit) {
                t = (temperature * 9 / 5) + 32; // Convert to Fahrenheit
            }

            // Heat index formula (Rothfusz regression)
            const hi = -42.379 + 2.04901523 * t + 10.14333127 * humidity
                - 0.22475541 * t * humidity - 0.00683783 * t * t
                - 0.05481717 * humidity * humidity + 0.00122874 * t * t * humidity
                + 0.00085282 * t * humidity * humidity - 0.00000199 * t * t * humidity * humidity;

            return isFahrenheit ? hi : (hi - 32) * 5 / 9;
        }

        private readSensor(): void {
            const now = runtime.millis();
            // DHT sensors need 2 seconds between reads
            if (now - this.lastReadTime < 2000) return;
            this.lastReadTime = now;

            // Get sensor values from CircuitEngine
            try {
                const { nodes, edges } = useForgeStore.getState();

                // Find DHT sensor connected to this pin
                for (const edge of edges) {
                    const pinMatch = matchPin(edge.sourceHandle, this.pin) || matchPin(edge.targetHandle, this.pin);
                    if (!pinMatch) continue;

                    let sensor = nodes.find(n => n.id === edge.source);
                    if (!sensor || !(sensor.data?.type === 'dht11' || sensor.data?.type === 'dht22')) {
                        sensor = nodes.find(n => n.id === edge.target);
                    }

                    if (sensor && (sensor.data?.type === 'dht11' || sensor.data?.type === 'dht22')) {
                        const sv = sensor.data?.sensorValues || {};
                        this.temperature = sv.temperature ?? 25.0;
                        this.humidity = sv.humidity ?? 60.0;
                        console.log(`[DHT] Read: ${this.temperature}°C, ${this.humidity}%`);
                        return;
                    }
                }
            } catch (e) {
                console.warn('[DHT] Could not read from store:', e);
            }

            // Default values if sensor not found
            this.temperature = 25.0;
            this.humidity = 60.0;
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAFRUIT NEOPIXEL LIBRARY (WS2812B RGB LEDs)
// ═══════════════════════════════════════════════════════════════════════════

export function createNeoPixelClass(runtime: any) {
    return class Adafruit_NeoPixel {
        private pin: number;
        private _numPixels: number;
        private pixels: Uint8Array; // RGB data: [R0,G0,B0, R1,G1,B1, ...]
        private brightness = 255;
        private begun = false;

        // Color order constants
        static NEO_RGB = 0x06;
        static NEO_GRB = 0x52; // Default for WS2812B
        static NEO_KHZ800 = 0x0000;

        constructor(numPixels: number, pin: number, type = 0x52) {
            this._numPixels = numPixels;
            this.pin = pin;
            this.pixels = new Uint8Array(numPixels * 3);
            console.log(`[NeoPixel] Created: ${numPixels} pixels on pin ${pin}`);
        }

        begin(): void {
            runtime.pinMode(this.pin, 1); // OUTPUT
            this.begun = true;
            this.clear();
            this.show();
            console.log(`[NeoPixel] Initialized`);
        }

        show(): void {
            if (!this.begun) return;

            // Apply brightness scaling
            const scaledPixels = new Uint8Array(this.pixels.length);
            for (let i = 0; i < this.pixels.length; i++) {
                scaledPixels[i] = Math.round((this.pixels[i] * this.brightness) / 255);
            }

            // Send to CircuitEngine
            this.updateCircuitEngine(scaledPixels);
            console.log(`[NeoPixel] Updated ${this._numPixels} pixels`);
        }

        setPixelColor(n: number, ...args: number[]): void {
            if (n >= this._numPixels) return;

            let r: number, g: number, b: number;

            if (args.length === 1) {
                // 32-bit color
                const color = args[0];
                r = (color >> 16) & 0xFF;
                g = (color >> 8) & 0xFF;
                b = color & 0xFF;
            } else if (args.length === 3) {
                // Separate R, G, B
                [r, g, b] = args;
            } else {
                return;
            }

            const offset = n * 3;
            this.pixels[offset] = r;
            this.pixels[offset + 1] = g;
            this.pixels[offset + 2] = b;
        }

        fill(color: number, first = 0, count?: number): void {
            const end = count === undefined ? this._numPixels : first + count;
            for (let i = first; i < end && i < this._numPixels; i++) {
                this.setPixelColor(i, color);
            }
        }

        setBrightness(brightness: number): void {
            this.brightness = Math.max(0, Math.min(255, brightness));
        }

        clear(): void {
            this.pixels.fill(0);
        }

        getPixelColor(n: number): number {
            if (n >= this._numPixels) return 0;
            const offset = n * 3;
            return (this.pixels[offset] << 16) | (this.pixels[offset + 1] << 8) | this.pixels[offset + 2];
        }

        numPixels(): number {
            return this._numPixels;
        }

        // Instance color helpers (mirror C++ static access on instances)
        Color(r: number, g: number, b: number): number {
            return Adafruit_NeoPixel.Color(r, g, b);
        }

        ColorHSV(hue: number, sat = 255, val = 255): number {
            return Adafruit_NeoPixel.ColorHSV(hue, sat, val);
        }

        // Static color helper
        static Color(r: number, g: number, b: number): number {
            return ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
        }

        // Rainbow color wheel (0-255)
        static ColorHSV(hue: number, sat = 255, val = 255): number {
            const h = (hue * 6) / 256;
            const s = sat / 255;
            const v = val / 255;

            const i = Math.floor(h);
            const f = h - i;
            const p = v * (1 - s);
            const q = v * (1 - f * s);
            const t = v * (1 - (1 - f) * s);

            let r: number, g: number, b: number;
            switch (i % 6) {
                case 0: r = v; g = t; b = p; break;
                case 1: r = q; g = v; b = p; break;
                case 2: r = p; g = v; b = t; break;
                case 3: r = p; g = q; b = v; break;
                case 4: r = t; g = p; b = v; break;
                case 5: r = v; g = p; b = q; break;
                default: r = g = b = 0;
            }

            return ((Math.round(r * 255) & 0xFF) << 16) |
                ((Math.round(g * 255) & 0xFF) << 8) |
                (Math.round(b * 255) & 0xFF);
        }

        // Gamma correction (8-bit) — simplified sRGB-like curve
        static gamma8(value: number): number {
            const v = value / 255;
            return Math.round(255 * (v * v));
        }

        // Apply gamma correction to a 32-bit packed color
        gamma32(color: number): number {
            return Adafruit_NeoPixel.gamma32(color);
        }

        static gamma32(color: number): number {
            const r = (color >> 16) & 0xFF;
            const g = (color >> 8) & 0xFF;
            const b = color & 0xFF;
            return Adafruit_NeoPixel.Color(
                Adafruit_NeoPixel.gamma8(r),
                Adafruit_NeoPixel.gamma8(g),
                Adafruit_NeoPixel.gamma8(b)
            );
        }

        private updateCircuitEngine(pixelData: Uint8Array): void {
            try {
                const { nodes, edges } = useForgeStore.getState();

                // Find NeoPixel component connected to this pin
                for (const edge of edges) {
                    const pinMatch = matchPin(edge.sourceHandle, this.pin) || matchPin(edge.targetHandle, this.pin);
                    if (!pinMatch) continue;

                    let component = nodes.find(n => n.id === edge.source);
                    if (!component || !(component.data?.type === 'neopixel' || component.data?.type === 'neopixel-matrix' || component.data?.type === 'led-ring')) {
                        component = nodes.find(n => n.id === edge.target);
                    }

                    if (component && (component.data?.type === 'neopixel' || component.data?.type === 'neopixel-matrix' || component.data?.type === 'led-ring')) {
                        const componentId = component.id;
                        // Convert pixel data to array of {r, g, b} objects
                        const colors = [];
                        for (let i = 0; i < this._numPixels; i++) {
                            const offset = i * 3;
                            colors.push({
                                r: pixelData[offset],
                                g: pixelData[offset + 1],
                                b: pixelData[offset + 2]
                            });
                        }

                        // Update component data
                        if (component.data?.type === 'neopixel') {
                            useForgeStore.getState().updateNodeData(componentId, {
                                neopixelR: colors[0] ? colors[0].r / 255 : 0,
                                neopixelG: colors[0] ? colors[0].g / 255 : 0,
                                neopixelB: colors[0] ? colors[0].b / 255 : 0,
                                neopixelPixels: colors,
                                pixels: colors,
                                numPixels: this._numPixels
                            });
                        } else {
                            useForgeStore.getState().updateNodeData(componentId, {
                                neopixelPixels: colors,
                                pixels: colors,
                                numPixels: this._numPixels
                            });
                        }
                        return;
                    }
                }
            } catch (e) {
                console.warn('[NeoPixel] Could not update circuit:', e);
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDCRYSTAL_I2C LIBRARY (I2C LCD Displays)
// ═══════════════════════════════════════════════════════════════════════════

export function createLiquidCrystalI2CClass(runtime: any) {
    return class LiquidCrystal_I2C {
        private address: number;
        private cols: number;
        private rows: number;
        private buffer: string[][];
        private cursorCol = 0;
        private cursorRow = 0;
        private displayOn = true;
        private cursorOn = false;
        private blinkOn = false;
        private backlightOn = true;

        constructor(address: number, cols: number, rows: number) {
            this.address = address;
            this.cols = cols;
            this.rows = rows;
            this.buffer = Array(rows).fill(null).map(() => Array(cols).fill(' '));
            console.log(`[LCD_I2C] Created ${cols}x${rows} at address 0x${address.toString(16)}`);
        }

        begin(): void {
            this.init();
        }

        init(): void {
            // Initialize I2C communication
            if (runtime._i2cBus) {
                runtime._i2cBus.startTransmission(this.address);
                runtime._i2cBus.write(0x00); // Init command
                runtime._i2cBus.endTransmission();
            }
            this.clear();
            console.log(`[LCD_I2C] Initialized`);
        }

        clear(): void {
            this.buffer = Array(this.rows).fill(null).map(() => Array(this.cols).fill(' '));
            this.cursorCol = 0;
            this.cursorRow = 0;
            this.updateDisplay();
        }

        home(): void {
            this.cursorCol = 0;
            this.cursorRow = 0;
        }

        setCursor(col: number, row: number): void {
            this.cursorCol = Math.max(0, Math.min(this.cols - 1, col));
            this.cursorRow = Math.max(0, Math.min(this.rows - 1, row));
        }

        print(text: any): void {
            const str = String(text);
            for (let i = 0; i < str.length; i++) {
                if (this.cursorCol < this.cols) {
                    this.buffer[this.cursorRow][this.cursorCol] = str[i];
                    this.cursorCol++;
                }
            }
            this.updateDisplay();
        }

        write(char: number | string): void {
            const c = typeof char === 'number' ? String.fromCharCode(char) : char;
            if (this.cursorCol < this.cols) {
                this.buffer[this.cursorRow][this.cursorCol] = c;
                this.cursorCol++;
            }
            this.updateDisplay();
        }

        display(): void {
            this.displayOn = true;
            this.updateDisplay();
        }

        noDisplay(): void {
            this.displayOn = false;
            this.updateDisplay();
        }

        cursor(): void {
            this.cursorOn = true;
            this.updateDisplay();
        }

        noCursor(): void {
            this.cursorOn = false;
            this.updateDisplay();
        }

        blink(): void {
            this.blinkOn = true;
            this.updateDisplay();
        }

        noBlink(): void {
            this.blinkOn = false;
            this.updateDisplay();
        }

        backlight(): void {
            this.backlightOn = true;
            this.updateDisplay();
        }

        noBacklight(): void {
            this.backlightOn = false;
            this.updateDisplay();
        }

        scrollDisplayLeft(): void {
            // Shift all content left
            for (let row = 0; row < this.rows; row++) {
                this.buffer[row].push(this.buffer[row].shift()!);
            }
            this.updateDisplay();
        }

        scrollDisplayRight(): void {
            // Shift all content right
            for (let row = 0; row < this.rows; row++) {
                this.buffer[row].unshift(this.buffer[row].pop()!);
            }
            this.updateDisplay();
        }

        createChar(location: number, charmap: number[]): void {
            // Custom character creation (stored but not rendered in simulation)
            console.log(`[LCD_I2C] Custom char ${location} created`);
        }

        private updateDisplay(): void {
            try {
                const { nodes, edges } = useForgeStore.getState();

                // Find LCD component with matching I2C address
                for (const node of nodes) {
                    if ((node.data?.type === 'lcd1602-i2c' || node.data?.type === 'lcd2004-i2c') &&
                        node.data?.address === this.address) {

                        useForgeStore.getState().updateNodeData(node.id, {
                            buffer: this.buffer,
                            displayOn: this.displayOn,
                            cursorOn: this.cursorOn,
                            cursorCol: this.cursorCol,
                            cursorRow: this.cursorRow,
                            backlightOn: this.backlightOn
                        });
                        return;
                    }
                }
            } catch (e) {
                console.warn('[LCD_I2C] Could not update display:', e);
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ULTRASONIC (HC-SR04) LIBRARY
// ═══════════════════════════════════════════════════════════════════════════

export function createUltrasonicClass(runtime: any) {
    return class Ultrasonic {
        private trigPin: number;
        private echoPin: number;

        constructor(trigPin: number, echoPin: number) {
            this.trigPin = trigPin;
            this.echoPin = echoPin;
            runtime.pinMode(trigPin, 1); // OUTPUT
            runtime.pinMode(echoPin, 0); // INPUT
            console.log(`[Ultrasonic] Initialized: TRIG=${trigPin}, ECHO=${echoPin}`);
        }

        read(unit: string | number = 'CM'): number {
            // Send 10µs trigger pulse
            runtime.digitalWrite(this.trigPin, 0);
            runtime.__delayMicroseconds(2);
            runtime.digitalWrite(this.trigPin, 1);
            runtime.__delayMicroseconds(10);
            runtime.digitalWrite(this.trigPin, 0);

            // Read distance directly from store (avoids floating-point round-trip via pulseIn)
            const distanceCm = runtime.getUltrasonicDistanceCm();

            if (unit === 'CM' || unit === 1) {
                return distanceCm;
            } else if (unit === 'IN' || unit === 'INC' || unit === 'INCH' || unit === 0) {
                return distanceCm / 2.54;
            }

            let divisor = 58.2;
            try {
                const { sourceCode } = useForgeStore.getState();
                if (sourceCode) {
                    const match = sourceCode.match(/pulseIn(?:Long)?\s*\([^)]+\)\s*\/\s*([\d.]+)/);
                    if (match) {
                        divisor = parseFloat(match[1]);
                    }
                }
            } catch (e) { }

            return distanceCm * divisor;
        }

        distanceRead(unit = 'CM'): number {
            return this.read(unit);
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// NEWPING LIBRARY (Alternative ultrasonic library)
// ═══════════════════════════════════════════════════════════════════════════

export function createNewPingClass(runtime: any) {
    return class NewPing {
        private trigPin: number;
        private echoPin: number;
        private maxDistance: number;

        constructor(trigPin: number, echoPin: number, maxDistance = 200) {
            this.trigPin = trigPin;
            this.echoPin = echoPin;
            this.maxDistance = maxDistance;
            runtime.pinMode(trigPin, 1); // OUTPUT
            runtime.pinMode(echoPin, 0); // INPUT
            console.log(`[NewPing] Initialized: TRIG=${trigPin}, ECHO=${echoPin}, MAX=${maxDistance}cm`);
        }

        ping(): number {
            // Returns round-trip time in microseconds
            runtime.digitalWrite(this.trigPin, 0);
            runtime.__delayMicroseconds(2);
            runtime.digitalWrite(this.trigPin, 1);
            runtime.__delayMicroseconds(10);
            runtime.digitalWrite(this.trigPin, 0);

            return runtime.pulseIn(this.echoPin, 1, this.maxDistance * 58.2 * 2);
        }

        ping_cm(): number {
            return runtime.getUltrasonicDistanceCm();
        }

        ping_in(): number {
            return runtime.getUltrasonicDistanceCm() / 2.54;
        }

        ping_median(iterations = 5): number {
            const readings: number[] = [];
            for (let i = 0; i < iterations; i++) {
                readings.push(runtime.getUltrasonicDistanceCm());
                runtime.__delay(29); // Wait between pings
            }
            readings.sort((a, b) => a - b);
            return readings[Math.floor(iterations / 2)];
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// IRREMOTE LIBRARY (NEC / IR RECEIVER & TRANSMITTER)
// ═══════════════════════════════════════════════════════════════════════════

export function createIRremoteClass(runtime: any) {
    class decode_results {
        public value: number = 0;
        public decode_type: number = 3; // NEC
        public bits: number = 32;
        public rawbuf: number[] = [];
        public rawlen: number = 0;
    }

    class IRrecv {
        private recvPin: number;
        private isEnabled: boolean = false;
        private lastReadHex: string | null = null;

        constructor(recvPin: number) {
            this.recvPin = recvPin;
        }

        enableIRIn(): void {
            this.isEnabled = true;
        }

        disableIRIn(): void {
            this.isEnabled = false;
        }

        private getIrNode(): any {
            try {
                const { nodes } = useForgeStore.getState();
                // Prefer a real receiver so a stray ir-remote node never shadows the code
                return nodes.find(n => n.data?.type === 'ir-receiver')
                    ?? nodes.find(n =>
                        n.data?.type === 'ir-remote' ||
                        n.data?.type === 'ir-obstacle-sensor' ||
                        n.data?.type === 'ir-sensor'
                    );
            } catch (e) {
                return null;
            }
        }

        decode(results?: any): boolean {
            const node = this.getIrNode();
            if (!node) return false;

            const sv = node.data?.sensorValues;
            const currentHex = sv?.lastIrCode ?? (sv?.obstacleDetected ? '0x00FF30CF' : null);
            if (!currentHex || currentHex === this.lastReadHex) return false;

            this.lastReadHex = currentHex;
            const val = parseInt(currentHex.replace(/^0x/i, ''), 16) || 0;

            // Consume a real remote press so one click = one decode().
            // (Obstacle fallback has no press event, so leave it for repeat reads.)
            // resume() clears lastReadHex; without consuming here a single click
            // would re-trigger every loop() until button release.
            try {
                if (sv?.lastIrCode) {
                    const { updateNodeData } = useForgeStore.getState();
                    updateNodeData(node.id, {
                        sensorValues: { ...sv, lastIrCode: null, lastIrCommand: null },
                    });
                }
            } catch (e) {
                // store unavailable (unit tests) — ignore
            }

            if (results) {
                results.value = val;
                results.decode_type = 3;
                results.bits = 32;
            }
            return true;
        }

        resume(): void {
            this.lastReadHex = null;
        }
    }

    const IrReceiver = {
        decodedIRData: {
            decodedRawData: 0,
            protocol: 3,
            command: 0,
            address: 0,
        },
        begin(_pin?: number): void {},
        decode(): boolean {
            const res = new decode_results();
            const recv = new IRrecv(11);
            const found = recv.decode(res);
            if (found) {
                this.decodedIRData.decodedRawData = res.value;
                this.decodedIRData.command = res.value & 0xFF;
                this.decodedIRData.address = (res.value >> 16) & 0xFF;
            }
            return found;
        },
        resume(): void {},
    };

    return {
        IRrecv,
        decode_results,
        IrReceiver,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL LIBRARY CREATORS
// ═══════════════════════════════════════════════════════════════════════════

export function injectAllLibraries(runtime: any): Record<string, any> {
    const Servo = createServoClass(runtime);
    const Stepper = createStepperClass(runtime);
    const DHT = createDHTClass(runtime);
    const Adafruit_NeoPixel = createNeoPixelClass(runtime);
    const LiquidCrystal_I2C = createLiquidCrystalI2CClass(runtime);
    const Ultrasonic = createUltrasonicClass(runtime);
    const NewPing = createNewPingClass(runtime);
    const AccelStepper = createAccelStepperClass(runtime);
    const irRemote = createIRremoteClass(runtime);

    return {
        // Servo
        Servo,

        // Stepper
        Stepper,

        // AccelStepper (commonly used with A4988/DRV8825)
        AccelStepper,

        // DHT sensors
        DHT,
        DHT_Unified: DHT, // Alias

        // NeoPixel
        Adafruit_NeoPixel,

        // LCD
        LiquidCrystal_I2C,
        LiquidCrystal: LiquidCrystal_I2C, // Alias for parallel LCD

        // Ultrasonic
        Ultrasonic,
        NewPing,

        // IRremote
        IRrecv: irRemote.IRrecv,
        decode_results: irRemote.decode_results,
        IrReceiver: irRemote.IrReceiver,

        // NeoPixel static methods
        NEO_RGB: Adafruit_NeoPixel.NEO_RGB,
        NEO_GRB: Adafruit_NeoPixel.NEO_GRB,
        NEO_KHZ800: Adafruit_NeoPixel.NEO_KHZ800,
    };
}
