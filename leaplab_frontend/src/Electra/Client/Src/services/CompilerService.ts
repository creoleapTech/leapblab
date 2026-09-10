/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 *
 * Compile flow (Electron):
 *   electronAPI.compileCode(code, fqbn)
 *     → IPC: compile-code
 *     → ArduinoUploader.compileForSimulation()
 *     → pio run (PlatformIO, lib_extra_dirs = forge-lib/libraries/)
 *     → returns { success, hexContent }
 */
import { IS_ELECTRON, isElectron, CLOUD_COMPILER_URL } from '../../../../config/platform';

export interface CompileRequest {
  code: string;
  board: string;
  libraries: string[];
}

export interface CompileResult {
  success: boolean;
  hexContent?: string;
  binPath?: string;   // returned for esp32:esp32:* FQBNs in Electron (custom RISC-V emulator path)
  binBase64?: string; // returned for esp32 in Web mode
  error?: string;
}

export const compileCode = async (req: CompileRequest): Promise<CompileResult> => {
  // Use runtime check — IS_ELECTRON may be stale if preload loaded after module init
  if (IS_ELECTRON || isElectron()) {
    try {
      const result = await (window as any).electronAPI.compileCode(
        req.code,
        req.board,
        req.libraries?.join(',') || undefined,
      );
      return {
        success: result.success,
        hexContent: result.hexContent,
        binPath: result.binPath,
        error: result.error,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Web: POST to cloud compiler (Render, can cold-start ~20s)
  try {
    const isESP32 = req.board.startsWith('esp32:');
    const endpoint = isESP32 ? '/compile/esp32' : '/compile';
    const controller = new AbortController();
    const timeoutMs = 45000; // Render cold start + pio run
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${CLOUD_COMPILER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { success: false, error: `Server error: ${res.status}` };
    const data = await res.json();
    return {
      success: data.success,
      hexContent: data.hex,
      binBase64: data.binBase64,
      error: Array.isArray(data.errors) ? data.errors.join('\n') : data.errors,
    };
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return { success: false, error: isAbort ? `Cloud compiler timeout (45s) — Render cold start, please retry` : `Cloud compiler unreachable: ${err.message}` };
  }
};

// ─── ESP32 Transpile: Arduino C++ → JavaScript ──────────────────

export interface TranspileResult {
  success: boolean;
  jsCode?: string;
  error?: string;
}

/**
 * Detect infrastructure failures that should trigger client-side fallback.
 * User code errors (syntax, missing declarations) should NOT fallback,
 * so the user sees the compiler's diagnostic.
 */
function isInfraTranspileError(msg: string): boolean {
  const infraKeywords = [
    'MissingPackageManifestError',
    'package.json',
    'platform.json',
    'library.json',
    'manifest files',
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
    'Max retries exceeded',
    'Network is unreachable',
    'Temporary failure',
    'pio: command not found',
    'not found: pio',
    'Server error',
    'Server is still initializing',
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
 * Transpile an Arduino sketch to JavaScript for browser-side simulation.
 * In Electron mode: uses the cloud server's /transpile endpoint.
 * In Web mode: also uses the cloud server's /transpile endpoint.
 * Falls back to client-side transpilation if server is unreachable or
 * returns an infrastructure error (package manifest, platform missing, etc.).
 * Pure syntax/user-code errors are returned to the caller for display.
 */
export const transpileCode = async (code: string, board = 'esp32:esp32:esp32c3'): Promise<TranspileResult> => {
  try {
    console.log(`[Transpiler] Attempting server transpilation at ${CLOUD_COMPILER_URL}/transpile ...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const res = await fetch(`${CLOUD_COMPILER_URL}/transpile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, board }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // HTTP error (500, 503 cold start, etc.) — infra fallback
      console.warn(`[Transpiler] Server returned HTTP ${res.status}, falling back to client-side`);
      return clientSideTranspile(code);
    }
    const data = await res.json();
    if (data.success && data.jsCode) {
      console.log(`[Transpiler] Server transpilation successful (${data.jsCode.length} bytes)`);
      return { success: true, jsCode: data.jsCode };
    }
    const errorMsg: string = Array.isArray(data.errors)
      ? data.errors.join('\n')
      : (data.errors || (data as any).error || 'Transpilation failed');
    if (isInfraTranspileError(errorMsg)) {
      console.warn(`[Transpiler] Server infra error (fallback to client): ${errorMsg.slice(0, 600)}`);
      return clientSideTranspile(code);
    }
    console.warn('[Transpiler] Server returned user-code error, not falling back:', errorMsg.slice(0, 600));
    return {
      success: false,
      error: errorMsg,
    };
  } catch (err: any) {
    // Network error or timeout — fall back to client-side transpilation
    const reason = err.name === 'AbortError' ? 'timeout (8s)' : err.message;
    console.warn(`[Transpiler] Server unreachable (${reason}), falling back to client-side transpiler`);
    return clientSideTranspile(code);
  }
};

/**
 * Library stubs for Arduino-to-JS transpilation.
 * These provide fallback implementations when real classes aren't injected.
 */
const LIBRARY_STUBS = `
// Auto-generated by Electra Client Transpiler
// ── Library stubs ────────────────────────────────────────────────────────────
var Adafruit_SSD1306 = (typeof Adafruit_SSD1306 !== 'undefined' && Adafruit_SSD1306) || class {
  constructor(){} begin(){return true;} clearDisplay(){} display(){}
  setTextSize(){} setTextColor(){} setCursor(){} print(){} println(){}
  drawPixel(){} fillRect(){} drawRect(){} drawLine(){} drawCircle(){} fillCircle(){}
  setRotation(){} invertDisplay(){} startscrollright(){} stopscroll(){}
};
var Adafruit_GFX = (typeof Adafruit_GFX !== 'undefined' && Adafruit_GFX) || class { constructor(){} };
var LiquidCrystal_I2C = (typeof LiquidCrystal_I2C !== 'undefined' && LiquidCrystal_I2C) || class { constructor(){} begin(){} init(){} print(){} println(){} setCursor(){} clear(){} backlight(){} noBacklight(){} };
var LiquidCrystal = (typeof LiquidCrystal !== 'undefined' && LiquidCrystal) || class { constructor(){} begin(){} print(){} println(){} setCursor(){} clear(){} };
var Servo = (typeof Servo !== 'undefined' && Servo) || class { constructor(){this._angle=90;} attach(){} write(a){this._angle=a;} read(){return this._angle;} detach(){} setPeriodHertz(){} };
var DHT = (typeof DHT !== 'undefined' && DHT) || class { constructor(){} begin(){} readTemperature(){return 25.0;} readHumidity(){return 50.0;} };
var DHTesp = (typeof DHTesp !== 'undefined' && DHTesp) || class { constructor(){} setup(){} getTempAndHumidity(){ return { temperature: 25.0, humidity: 50.0 }; } getStatus(){ return 0; } getStatusString(){ return 'OK'; } };
var TempAndHumidity = (typeof TempAndHumidity !== 'undefined' && TempAndHumidity) || class { constructor(){ this.temperature = 0; this.humidity = 0; } };
var Adafruit_MPU6050 = (typeof Adafruit_MPU6050 !== 'undefined' && Adafruit_MPU6050) || class {
  constructor(){ this._accelRange = 0; this._gyroRange = 0; this._filterBw = 0; }
  begin(){return true;}
  setAccelerometerRange(r){this._accelRange = r;}
  getAccelerometerRange(){return this._accelRange || 0;}
  setGyroRange(r){this._gyroRange = r;}
  getGyroRange(){return this._gyroRange || 0;}
  setFilterBandwidth(b){this._filterBw = b;}
  getFilterBandwidth(){return this._filterBw || 0;}
  getEvent(a,g,t){
    if(a) a.acceleration={x:0,y:0,z:9.8};
    if(g) g.gyro={x:0,y:0,z:0};
    if(t) t.temperature=25.0;
    return true;
  }
};
var Adafruit_Sensor = (typeof Adafruit_Sensor !== 'undefined' && Adafruit_Sensor) || class { constructor(){} };
var IRrecv = (typeof IRrecv !== 'undefined' && IRrecv) || class { constructor(){} enableIRIn(){} decode(){return false;} resume(){} };
var decode_results = (typeof decode_results !== 'undefined' && decode_results) || class { constructor(){} };
var SoftwareSerial = (typeof SoftwareSerial !== 'undefined' && SoftwareSerial) || class { constructor(){} begin(){} print(){} println(){} available(){return 0;} read(){return -1;} };
var Stepper = (typeof Stepper !== 'undefined' && Stepper) || class { constructor(){} setSpeed(){} async step(){} };
var Keypad = (typeof Keypad !== 'undefined' && Keypad) || class {
  constructor(_keymap, _rowPins, _colPins, _rows, _cols) {
    this._keymap = _keymap || [];
    this._rowPins = _rowPins || [];
    this._colPins = _colPins || [];
    this._rows = _rows || 4;
    this._cols = _cols || 4;
    this._pressedKey = null;
  }
  getKey() {
    const k = this._pressedKey;
    this._pressedKey = null;
    return k;
  }
  isPressed(key) { return this._pressedKey === key; }
  getState() { return 0; }
  addEventListener() {}
  _simulatePress(key) { this._pressedKey = key; }
};
var makeKeymap = (typeof makeKeymap !== 'undefined' && makeKeymap) || function(keymap, rowPins, colPins, rows, cols) {return new Keypad(keymap, rowPins, colPins, rows, cols);};
var U8g2_SSD1306_128X64_NONAME_F_HW_I2C = (typeof U8g2_SSD1306_128X64_NONAME_F_HW_I2C !== 'undefined' && U8g2_SSD1306_128X64_NONAME_F_HW_I2C) || class { constructor(){} begin(){} clearBuffer(){} sendBuffer(){} setFont(){} drawStr(){} setCursor(){} print(){} println(){} };
var HX711 = (typeof HX711 !== 'undefined' && HX711) || class { constructor(){} begin(){} set_scale(){} tare(){} get_units(){return 0;} read(){return 0;} is_ready(){return true;} power_down(){} power_up(){} };
var RTC_DS1307 = (typeof RTC_DS1307 !== 'undefined' && RTC_DS1307) || class { constructor(){} begin(){return true;} adjust(){} now(){ return new DateTime(); } isrunning(){return true;} };
var DateTime = (typeof DateTime !== 'undefined' && DateTime) || class {
  constructor(y,m,d,hh,mm,ss){
    this._d = y!==undefined ? new Date(y,(m||1)-1,d||1,hh||0,mm||0,ss||0) : new Date();
  }
  year(){return this._d.getFullYear();}
  month(){return this._d.getMonth()+1;}
  day(){return this._d.getDate();}
  hour(){return this._d.getHours();}
  minute(){return this._d.getMinutes();}
  second(){return this._d.getSeconds();}
  dayOfWeek(){return this._d.getDay()||7;}
  unixtime(){return Math.floor(this._d.getTime()/1000);}
};
var Adafruit_NeoPixel = (typeof Adafruit_NeoPixel !== 'undefined' && Adafruit_NeoPixel) || class {
  constructor(){} begin(){} show(){} setPixelColor(){} setBrightness(){} clear(){}
  numPixels(){return 0;} Color(r,g,b){return (r<<16)|(g<<8)|b;}
  ColorHSV(h,s,v){return (Math.round((h||0)/256*6)%6)<<16|0;}
  gamma32(c){return c;} gamma8(v){return(v/255)*(v/255)*255|0;}
};

// ── ESP32 Wi-Fi & Networking Simulation Stubs ────────────────────────────────
var WL_IDLE_STATUS = 0;
var WL_NO_SSID_AVAIL = 1;
var WL_SCAN_COMPLETED = 2;
var WL_CONNECTED = 3;
var WL_CONNECT_FAILED = 4;
var WL_CONNECTION_LOST = 5;
var WL_DISCONNECTED = 6;
var WIFI_STA = 1;
var WIFI_AP = 2;
var WIFI_AP_STA = 3;
var WIFI_OFF = 0;

var IPAddress = (typeof IPAddress !== 'undefined' && IPAddress) || class {
  constructor(a, b, c, d) {
    if (typeof a === 'string') {
      this._str = a;
    } else {
      this._str = (a || 192) + '.' + (b || 168) + '.' + (c || 1) + '.' + (d || 105);
    }
  }
  toString() { return this._str; }
};

var WiFiClass = (typeof WiFiClass !== 'undefined' && WiFiClass) || class {
  constructor() {
    this._status = WL_DISCONNECTED;
    this._ssid = '';
    this._ip = new IPAddress('192.168.1.105');
    this._mac = '24:0A:C4:00:01:10';
  }
  begin(ssid, password) {
    this._ssid = ssid || 'Electra-GUEST';
    this._status = WL_CONNECTED;
    console.log('[ESP32 WiFi] 📶 Connecting to "' + this._ssid + '"... Connected! IP: ' + this._ip.toString());
    return WL_CONNECTED;
  }
  status() {
    return this._status;
  }
  localIP() {
    return this._ip;
  }
  subnetMask() { return new IPAddress('255.255.255.0'); }
  gatewayIP() { return new IPAddress('192.168.1.1'); }
  dnsIP() { return new IPAddress('8.8.8.8'); }
  macAddress() { return this._mac; }
  SSID(i) { return i !== undefined ? 'Electra-GUEST' : this._ssid; }
  RSSI(i) { return -55; }
  mode(m) { return true; }
  disconnect(off) { this._status = WL_DISCONNECTED; return true; }
  scanNetworks() { return 3; }
  isConnected() { return this._status === WL_CONNECTED; }
};
var WiFi = (typeof WiFi !== 'undefined' && WiFi) || new WiFiClass();

var WiFiClient = (typeof WiFiClient !== 'undefined' && WiFiClient) || class {
  constructor() { this._host = ''; this._port = 80; }
  connect(host, port) {
    this._host = host;
    this._port = port || 80;
    console.log('[ESP32 WiFiClient] 🔌 Connecting TCP socket to ' + this._host + ':' + this._port + '... Connected!');
    return true;
  }
  connected() { return true; }
  write(data) {
    console.log('[ESP32 WiFiClient ⬆️ TX] ' + data);
    return data ? data.length : 0;
  }
  print(data) {
    console.log('[ESP32 WiFiClient ⬆️ TX] ' + data);
    return true;
  }
  println(data) {
    console.log('[ESP32 WiFiClient ⬆️ TX] ' + data);
    return true;
  }
  available() { return 0; }
  read() { return -1; }
  stop() { console.log('[ESP32 WiFiClient 🔌] Connection closed'); }
};

var HTTPClient = (typeof HTTPClient !== 'undefined' && HTTPClient) || class {
  constructor() {
    this._url = '';
    this._payload = '{"status":"ok","message":"Telemetry Received","pump_command":"AUTO"}';
    this._headers = {};
  }
  begin(url) {
    this._url = url;
    console.log('[ESP32 HTTPClient 🌐] Initialized connection to ' + this._url);
    return true;
  }
  addHeader(name, value) {
    this._headers[name] = value;
  }
  GET() {
    console.log('[CLOUD TX ⬆️] GET ' + this._url);
    this._payload = '{"status":"ok","network":"Electra-GUEST","ip":"192.168.1.105"}';
    console.log('[CLOUD RX ⬇️] Response 200 OK | Body: ' + this._payload);
    return 200;
  }
  POST(payload) {
    var body = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    console.log('[CLOUD TX ⬆️] POST ' + this._url);
    console.log('[CLOUD DATA 📦] Transmitting Payload: ' + body);

    if (body.indexOf('LOW') !== -1 || (body.indexOf('"level":') !== -1 && parseInt((body.match(/"level":\s*(\d+)/) || [])[1] || '100', 10) < 50)) {
      this._payload = '{"status":"ok","action":"PUMP_ON","relay_state":"HIGH","message":"Tank Low - Actuating Pump"}';
    } else {
      this._payload = '{"status":"ok","action":"PUMP_OFF","relay_state":"LOW","message":"Tank Full - Pump Standby"}';
    }

    console.log('[CLOUD RX ⬇️] Response 200 OK | Body: ' + this._payload);
    return 200;
  }
  getString() {
    return this._payload;
  }
  end() {
    console.log('[ESP32 HTTPClient 🌐] HTTP session ended.');
  }
};

// ── Blynk IoT Simulation Stubs ───────────────────────────────────────────────
if (typeof V0 === 'undefined') { var V0 = 'V0', V1 = 'V1', V2 = 'V2', V3 = 'V3', V4 = 'V4', V5 = 'V5', V6 = 'V6', V7 = 'V7', V8 = 'V8', V9 = 'V9', V10 = 'V10'; }

var BlynkParam = (typeof BlynkParam !== 'undefined' && BlynkParam) || class {
  constructor(val) { this._val = val; }
  asInt() { return parseInt(this._val || 0, 10); }
  asFloat() { return parseFloat(this._val || 0); }
  asString() { return String(this._val || ''); }
};

var BlynkClass = (typeof BlynkClass !== 'undefined' && BlynkClass) || class {
  constructor() {
    this._vPins = {};
    this._connected = false;
  }
  begin(auth, ssid, pass, domain, port) {
    this._connected = true;
    var token = typeof auth === 'string' ? auth : 'YourAuthToken';
    var wifiSsid = typeof ssid === 'string' ? ssid : 'Electra-GUEST';
    console.log('[BLYNK IoT 💚] Initializing Blynk Cloud Session...');
    console.log('[BLYNK IoT 💚] Auth Token: ' + token.substring(0, 6) + '...');
    console.log('[BLYNK IoT 💚] Connected to blynk.cloud:80 via "' + wifiSsid + '"!');
    return true;
  }
  run() {}
  virtualWrite(vPin, val) {
    var pinStr = String(vPin);
    this._vPins[pinStr] = val;
    console.log('[BLYNK TX ⬆️] Virtual Pin ' + pinStr + ' ➔ Transmitted Data: ' + val);
  }
  setProperty(vPin, prop, val) {
    console.log('[BLYNK PROP 🎨] Virtual Pin ' + vPin + ' property "' + prop + '" set to: ' + val);
  }
  logEvent(eventCode, message) {
    console.log('[BLYNK EVENT 🚨] Event "' + eventCode + '": ' + message);
  }
  connected() { return this._connected; }
  connect() { this._connected = true; return true; }
  disconnect() { this._connected = false; }
};
var Blynk = (typeof Blynk !== 'undefined' && Blynk) || new BlynkClass();

// ── ThingSpeak IoT Simulation Stubs ──────────────────────────────────────────
var ThingSpeakClass = (typeof ThingSpeakClass !== 'undefined' && ThingSpeakClass) || class {
  constructor() {
    this._fields = {};
    this._status = '';
    this._client = null;
  }
  begin(client) {
    this._client = client;
    console.log("[THINGSPEAK IoT] Initialized ThingSpeak Cloud API Client");
    return true;
  }
  setField(fieldNum, val) {
    this._fields[fieldNum] = val;
    console.log("[THINGSPEAK FIELD] Field " + fieldNum + " set to: " + val);
  }
  setStatus(msg) {
    this._status = msg;
  }
  writeFields(channelNumber, writeAPIKey) {
    var key = typeof writeAPIKey === 'string' ? writeAPIKey : 'YOUR_API_KEY';
    console.log("[THINGSPEAK TX] Transmitting Channel " + channelNumber + " Data to api.thingspeak.com (API Key: " + key.substring(0, 6) + "...)...");
    console.log("[THINGSPEAK DATA] Payload Fields:", JSON.stringify(this._fields));
    console.log("[THINGSPEAK RX] 200 OK | Entry ID: " + (Math.floor(Math.random() * 1000) + 100));
    return 200;
  }
  writeField(channelNumber, fieldNum, val, writeAPIKey) {
    this.setField(fieldNum, val);
    return this.writeFields(channelNumber, writeAPIKey);
  }
  readFloatField(channelNumber, fieldNum, readAPIKey) {
    var val = this._fields[fieldNum] !== undefined ? parseFloat(this._fields[fieldNum]) : 75.0;
    console.log("[THINGSPEAK RX] Reading Channel " + channelNumber + " Field " + fieldNum + " Value: " + val);
    return val;
  }
  readIntField(channelNumber, fieldNum, readAPIKey) {
    return Math.round(this.readFloatField(channelNumber, fieldNum, readAPIKey));
  }
  readStringField(channelNumber, fieldNum, readAPIKey) {
    return String(this._fields[fieldNum] || '');
  }
};
var ThingSpeak = (typeof ThingSpeak !== 'undefined' && ThingSpeak) || new ThingSpeakClass();

var Adafruit_ILI9341 = (typeof Adafruit_ILI9341 !== 'undefined' && Adafruit_ILI9341) || class {
  constructor(){} begin(){} setRotation(){} fillScreen(){} setCursor(){}
  setTextColor(){} setTextSize(){} print(){} println(){} drawPixel(){}
  drawLine(){} drawRect(){} fillRect(){} drawCircle(){} fillCircle(){}
  drawTriangle(){} fillTriangle(){} drawRoundRect(){} fillRoundRect(){}
  width(){return 320;} height(){return 240;} invertDisplay(){}
};
var TFT_eSPI = (typeof TFT_eSPI !== 'undefined' && TFT_eSPI) || class {
  constructor(){} begin(){} init(){} setRotation(){} fillScreen(){} setCursor(){}
  setTextColor(){} setTextSize(){} print(){} println(){} drawPixel(){}
  drawLine(){} drawRect(){} fillRect(){} drawCircle(){} fillCircle(){}
  drawTriangle(){} fillTriangle(){} drawRoundRect(){} fillRoundRect(){}
  width(){return 320;} height(){return 240;} invertDisplay(){}
  drawString(){} drawCentreString(){} drawRightString(){} drawNumber(){} drawFloat(){}
};

var TS_Point = (typeof TS_Point !== 'undefined' && TS_Point) || class {
  constructor(x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
  }
};
var Adafruit_FT6206 = (typeof Adafruit_FT6206 !== 'undefined' && Adafruit_FT6206) || class {
  constructor() {}
  begin(threshold) { return true; }
  touched() { return 0; }
  getPoint() { return new TS_Point(0, 0, 0); }
};
var IPAddress = (typeof IPAddress !== 'undefined' && IPAddress) || class {
  constructor(a,b,c,d){ this._a=a||0; this._b=b||0; this._c=c||0; this._d=d||0; }
  toString(){ return this._a+'.'+this._b+'.'+this._c+'.'+this._d; }
};
var WiFiClass = (typeof WiFiClass !== 'undefined' && WiFiClass) || class {
  constructor() {
    this._status = 0;
    this._ssid = '';
    this._ip = new IPAddress(192,168,1,100);
  }
  begin(ssid,pass){
    if (!ssid || ssid.trim() === '') {
      console.warn('[WiFi] Error: SSID is empty');
      this._status = 6;
      return;
    }
    this._ssid = ssid;
    this._status = 0;
    setTimeout(() => { this._status = 3; }, 1);
  }
  status(){ return this._status; }
  localIP(){ return this._ip; }
  disconnect(){ this._status = 6; }
  SSID(){ return this._ssid; }
  RSSI(){ return -50; }
  macAddress(){ return '00:00:00:00:00:00'; }
};
var WiFi = (typeof WiFi !== 'undefined' && WiFi) || new WiFiClass();
var WiFiClient = (typeof WiFiClient !== 'undefined' && WiFiClient) || class {
  constructor(){ this._connected=false; this._buffer=''; }
  connect(h,p){ console.warn('[WiFiClient] Not available on this board'); return false; }
  connected(){ return this._connected; }
  stop(){ this._connected=false; this._buffer=''; }
  print(d){ this._buffer+=String(d); }
  println(d){ this._buffer+=String(d)+'\\n'; }
  available(){ return this._buffer.length; }
  read(){
    if(this._buffer.length===0)return -1;
    const c=this._buffer.charCodeAt(0);
    this._buffer=this._buffer.substring(1);
    return c;
  }
  readString(){ const s=this._buffer; this._buffer=''; return s; }
};
var HTTPClient = (typeof HTTPClient !== 'undefined' && HTTPClient) || class {
  constructor(){
    this._url=''; this._headers=new Map();
    this._code=0; this._body=''; this._timeout=5000;
  }
  begin(url){ console.warn('[HTTPClient] Not available on this board'); this._url=url; return false; }
  addHeader(n,v){ this._headers.set(n,v); }
  setTimeout(t){ this._timeout=t; }
  async GET(){ console.warn('[HTTPClient] Not available on this board'); return -2; }
  async POST(p){ console.warn('[HTTPClient] Not available on this board'); return -2; }
  async PUT(p){ console.warn('[HTTPClient] Not available on this board'); return -2; }
  async DELETE(){ console.warn('[HTTPClient] Not available on this board'); return -2; }
  async PATCH(p){ console.warn('[HTTPClient] Not available on this board'); return -2; }
  getString(){ return ''; }
  getSize(){ return 0; }
  end(){}
};
var ThingSpeakClass = class {
  constructor() { this._fields = {}; this._status = ''; }
  begin(client) { return true; }
  setField(field, value) { this._fields[field] = value; return true; }
  setStatus(status) { this._status = status; return true; }
  async writeFields(channelNumber, writeAPIKey) {
    console.log('[ThingSpeak] writeFields', channelNumber, this._fields);
    this._fields = {};
    this._status = '';
    return 200;
  }
  async writeField(channelNumber, field, value, writeAPIKey) {
    this.setField(field, value);
    return await this.writeFields(channelNumber, writeAPIKey);
  }
};
var ThingSpeak = (typeof ThingSpeak !== 'undefined' && ThingSpeak) || new ThingSpeakClass();
var MPU6050_RANGE_2_G   = (typeof MPU6050_RANGE_2_G   !== 'undefined') ? MPU6050_RANGE_2_G   : 0;
var MPU6050_RANGE_4_G   = (typeof MPU6050_RANGE_4_G   !== 'undefined') ? MPU6050_RANGE_4_G   : 1;
var MPU6050_RANGE_8_G   = (typeof MPU6050_RANGE_8_G   !== 'undefined') ? MPU6050_RANGE_8_G   : 2;
var MPU6050_RANGE_16_G  = (typeof MPU6050_RANGE_16_G  !== 'undefined') ? MPU6050_RANGE_16_G  : 3;
var MPU6050_RANGE_250_DEG  = (typeof MPU6050_RANGE_250_DEG  !== 'undefined') ? MPU6050_RANGE_250_DEG  : 0;
var MPU6050_RANGE_500_DEG  = (typeof MPU6050_RANGE_500_DEG  !== 'undefined') ? MPU6050_RANGE_500_DEG  : 1;
var MPU6050_RANGE_1000_DEG = (typeof MPU6050_RANGE_1000_DEG !== 'undefined') ? MPU6050_RANGE_1000_DEG : 2;
var MPU6050_RANGE_2000_DEG = (typeof MPU6050_RANGE_2000_DEG !== 'undefined') ? MPU6050_RANGE_2000_DEG : 3;
var MPU6050_BAND_260_HZ = (typeof MPU6050_BAND_260_HZ !== 'undefined') ? MPU6050_BAND_260_HZ : 0;
var MPU6050_BAND_184_HZ = (typeof MPU6050_BAND_184_HZ !== 'undefined') ? MPU6050_BAND_184_HZ : 1;
var MPU6050_BAND_94_HZ  = (typeof MPU6050_BAND_94_HZ  !== 'undefined') ? MPU6050_BAND_94_HZ  : 2;
var MPU6050_BAND_44_HZ  = (typeof MPU6050_BAND_44_HZ  !== 'undefined') ? MPU6050_BAND_44_HZ  : 3;
var MPU6050_BAND_21_HZ  = (typeof MPU6050_BAND_21_HZ  !== 'undefined') ? MPU6050_BAND_21_HZ  : 4;
var MPU6050_BAND_10_HZ  = (typeof MPU6050_BAND_10_HZ  !== 'undefined') ? MPU6050_BAND_10_HZ  : 5;
var MPU6050_BAND_5_HZ   = (typeof MPU6050_BAND_5_HZ   !== 'undefined') ? MPU6050_BAND_5_HZ   : 6;
var SSD1306_SWITCHCAPVCC = (typeof SSD1306_SWITCHCAPVCC !== 'undefined') ? SSD1306_SWITCHCAPVCC : 0x02;
var SSD1306_EXTERNALVCC  = (typeof SSD1306_EXTERNALVCC  !== 'undefined') ? SSD1306_EXTERNALVCC  : 0x01;
var SSD1306_WHITE  = (typeof SSD1306_WHITE  !== 'undefined') ? SSD1306_WHITE  : 1;
var SSD1306_BLACK  = (typeof SSD1306_BLACK  !== 'undefined') ? SSD1306_BLACK  : 0;
var SSD1306_INVERSE = (typeof SSD1306_INVERSE !== 'undefined') ? SSD1306_INVERSE : 2;
var BLACK   = (typeof BLACK   !== 'undefined') ? BLACK   : 0;
var WHITE   = (typeof WHITE   !== 'undefined') ? WHITE   : 1;
var INVERSE = (typeof INVERSE !== 'undefined') ? INVERSE : 2;
var RED     = (typeof RED     !== 'undefined') ? RED     : 0xF800;
var GREEN   = (typeof GREEN   !== 'undefined') ? GREEN   : 0x07E0;
var BLUE    = (typeof BLUE    !== 'undefined') ? BLUE    : 0x001F;
var CYAN    = (typeof CYAN    !== 'undefined') ? CYAN    : 0x07FF;
var MAGENTA = (typeof MAGENTA !== 'undefined') ? MAGENTA : 0xF81F;
var YELLOW  = (typeof YELLOW  !== 'undefined') ? YELLOW  : 0xFFE0;
var ORANGE  = (typeof ORANGE  !== 'undefined') ? ORANGE  : 0xFC00;
var DHT11   = (typeof DHT11   !== 'undefined') ? DHT11   : 11;
var DHT22   = (typeof DHT22   !== 'undefined') ? DHT22   : 22;
var DHT21   = (typeof DHT21   !== 'undefined') ? DHT21   : 21;
var AM2301  = (typeof AM2301  !== 'undefined') ? AM2301  : 21;
var WL_NO_SHIELD        = (typeof WL_NO_SHIELD        !== 'undefined') ? WL_NO_SHIELD        : 255;
var WL_IDLE_STATUS      = (typeof WL_IDLE_STATUS      !== 'undefined') ? WL_IDLE_STATUS      : 0;
var WL_NO_SSID_AVAIL    = (typeof WL_NO_SSID_AVAIL    !== 'undefined') ? WL_NO_SSID_AVAIL    : 1;
var WL_SCAN_COMPLETED   = (typeof WL_SCAN_COMPLETED   !== 'undefined') ? WL_SCAN_COMPLETED   : 2;
var WL_CONNECTED        = (typeof WL_CONNECTED        !== 'undefined') ? WL_CONNECTED        : 3;
var WL_CONNECT_FAILED   = (typeof WL_CONNECT_FAILED   !== 'undefined') ? WL_CONNECT_FAILED   : 4;
var WL_CONNECTION_LOST  = (typeof WL_CONNECTION_LOST  !== 'undefined') ? WL_CONNECTION_LOST  : 5;
var WL_DISCONNECTED     = (typeof WL_DISCONNECTED     !== 'undefined') ? WL_DISCONNECTED     : 6;
var WIFI_OFF            = (typeof WIFI_OFF            !== 'undefined') ? WIFI_OFF            : 0;
var WIFI_STA            = (typeof WIFI_STA            !== 'undefined') ? WIFI_STA            : 1;
var WIFI_AP             = (typeof WIFI_AP             !== 'undefined') ? WIFI_AP             : 2;
var WIFI_AP_STA         = (typeof WIFI_AP_STA         !== 'undefined') ? WIFI_AP_STA         : 3;
var DEC     = (typeof DEC     !== 'undefined') ? DEC     : 10;
var HEX     = (typeof HEX     !== 'undefined') ? HEX     : 16;
var OCT     = (typeof OCT     !== 'undefined') ? OCT     : 8;
if (typeof BIN     === 'undefined') BIN     = 2;
if (typeof PI      === 'undefined') PI      = Math.PI;
if (typeof HALF_PI === 'undefined') HALF_PI = Math.PI / 2;
if (typeof TWO_PI  === 'undefined') TWO_PI  = Math.PI * 2;
if (typeof DEG_TO_RAD === 'undefined') DEG_TO_RAD = Math.PI / 180;
if (typeof RAD_TO_DEG === 'undefined') RAD_TO_DEG = 180 / Math.PI;
if (typeof LSBFIRST === 'undefined') LSBFIRST = 0;
if (typeof MSBFIRST === 'undefined') MSBFIRST = 1;
if (typeof ILI9341_BLACK === 'undefined')       ILI9341_BLACK       = 0x0000;
if (typeof ILI9341_NAVY === 'undefined')        ILI9341_NAVY        = 0x000F;
if (typeof ILI9341_DARKGREEN === 'undefined')   ILI9341_DARKGREEN   = 0x03E0;
if (typeof ILI9341_DARKCYAN === 'undefined')    ILI9341_DARKCYAN    = 0x03EF;
if (typeof ILI9341_MAROON === 'undefined')      ILI9341_MAROON      = 0x7800;
if (typeof ILI9341_PURPLE === 'undefined')      ILI9341_PURPLE      = 0x780F;
if (typeof ILI9341_OLIVE === 'undefined')       ILI9341_OLIVE       = 0x7BE0;
if (typeof ILI9341_LIGHTGREY === 'undefined')   ILI9341_LIGHTGREY   = 0xC618;
if (typeof ILI9341_DARKGREY === 'undefined')    ILI9341_DARKGREY    = 0x7BEF;
if (typeof ILI9341_BLUE === 'undefined')        ILI9341_BLUE        = 0x001F;
if (typeof ILI9341_GREEN === 'undefined')       ILI9341_GREEN       = 0x07E0;
if (typeof ILI9341_CYAN === 'undefined')        ILI9341_CYAN        = 0x07FF;
if (typeof ILI9341_RED === 'undefined')         ILI9341_RED         = 0xF800;
if (typeof ILI9341_MAGENTA === 'undefined')     ILI9341_MAGENTA     = 0xF81F;
if (typeof ILI9341_YELLOW === 'undefined')      ILI9341_YELLOW      = 0xFFE0;
if (typeof ILI9341_WHITE === 'undefined')       ILI9341_WHITE       = 0xFFFF;
if (typeof ILI9341_ORANGE === 'undefined')      ILI9341_ORANGE      = 0xFD20;
if (typeof ILI9341_GREENYELLOW === 'undefined') ILI9341_GREENYELLOW = 0xAFE5;
if (typeof ILI9341_PINK === 'undefined')        ILI9341_PINK        = 0xFC18;
if (typeof TFT_BLACK === 'undefined')       TFT_BLACK       = 0x0000;
if (typeof TFT_NAVY === 'undefined')        TFT_NAVY        = 0x000F;
if (typeof TFT_DARKGREEN === 'undefined')   TFT_DARKGREEN   = 0x03E0;
if (typeof TFT_DARKCYAN === 'undefined')    TFT_DARKCYAN    = 0x03EF;
if (typeof TFT_MAROON === 'undefined')      TFT_MAROON      = 0x7800;
if (typeof TFT_PURPLE === 'undefined')      TFT_PURPLE      = 0x780F;
if (typeof TFT_OLIVE === 'undefined')       TFT_OLIVE       = 0x7BE0;
if (typeof TFT_LIGHTGREY === 'undefined')   TFT_LIGHTGREY   = 0xC618;
if (typeof TFT_DARKGREY === 'undefined')    TFT_DARKGREY    = 0x7BEF;
if (typeof TFT_BLUE === 'undefined')        TFT_BLUE        = 0x001F;
if (typeof TFT_GREEN === 'undefined')       TFT_GREEN       = 0x07E0;
if (typeof TFT_CYAN === 'undefined')        TFT_CYAN        = 0x07FF;
if (typeof TFT_RED === 'undefined')         TFT_RED         = 0xF800;
if (typeof TFT_MAGENTA === 'undefined')     TFT_MAGENTA     = 0xF81F;
if (typeof TFT_YELLOW === 'undefined')      TFT_YELLOW      = 0xFFE0;
if (typeof TFT_WHITE === 'undefined')       TFT_WHITE       = 0xFFFF;
if (typeof TFT_ORANGE === 'undefined')      TFT_ORANGE      = 0xFD20;
if (typeof TFT_GREENYELLOW === 'undefined') TFT_GREENYELLOW = 0xAFE5;
if (typeof TFT_PINK === 'undefined')        TFT_PINK        = 0xFC18;

// ── FreeRTOS constants (provided by runtime) ─────────────────────────────────
if (typeof pdTRUE === 'undefined')  pdTRUE = 1;
if (typeof pdFALSE === 'undefined') pdFALSE = 0;
if (typeof pdPASS === 'undefined')  pdPASS = 1;
if (typeof pdFAIL === 'undefined')  pdFAIL = 0;
if (typeof portMAX_DELAY === 'undefined') portMAX_DELAY = 0xFFFFFFFF;
if (typeof portTICK_PERIOD_MS === 'undefined') portTICK_PERIOD_MS = 1;
if (typeof tskIDLE_PRIORITY === 'undefined') tskIDLE_PRIORITY = 0;
if (typeof configMAX_PRIORITIES === 'undefined') configMAX_PRIORITIES = 25;
`;

const LIBRARY_FOOTER = `
if (typeof __setup === 'function') { __exports.setup = __setup; }
if (typeof __loop === 'function') { __exports.loop = __loop; }
`;

/**
 * Client-side Arduino-to-JS transpiler (fallback when server is unreachable).
 * This is a simplified inline version — the full transpiler runs on the server.
 */
function clientSideTranspile(code: string): TranspileResult {
  try {
    let js = code;
    // Remove comments — protect :// in URLs (e.g. "https://...") from being treated as // comments
    js = js.replace(/:\/\//g, ':\x01\x01');
    js = js.replace(/\/\/.*$/gm, '');
    // eslint-disable-next-line no-control-regex
    js = js.replace(/:\x01\x01/g, '://');
    js = js.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove #include
    js = js.replace(/^\s*#include\s*[<"].*?[>"]\s*$/gm, '');
    // Strip function prototypes / declarations (e.g. void myFunc();) to prevent them being treated as calls and getting prepended with invalid top-level awaits
    js = js.replace(/^\s*(void|int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s*\*?\s*(\w+)\s*\([^)]*\)\s*;/gm, '');
    // Strip C++ const / volatile qualifiers (before type processing)
    // Only strip when followed by a known C++ type so #define-generated `const X = Y;` is preserved
    js = js.replace(/\b(const|volatile)\s+(?=(void|int|long|short|unsigned|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool|String|string)\b)/g, '');
    // Strip standalone volatile (not followed by type)
    js = js.replace(/\bvolatile\s+/g, '');
    // Strip ESP32/AVR function attributes that appear between return type and function name
    // e.g. void IRAM_ATTR myFunc() → void myFunc()
    // e.g. void ICACHE_RAM_ATTR myFunc() → void myFunc()
    js = js.replace(/\b(IRAM_ATTR|ICACHE_RAM_ATTR|DRAM_ATTR|PROGMEM_ATTR|__attribute__\s*\(\([^)]*\)\))\s+/g, '');
    // Strip PROGMEM keyword (used to store data in flash on AVR/ESP32)
    js = js.replace(/\bPROGMEM\b/g, '');
    // Transpile BLYNK_WRITE(V1) { ... } macros to JS functions
    js = js.replace(/\bBLYNK_WRITE\s*\(\s*(\w+)\s*\)\s*\{/g, 'function BLYNK_WRITE_$1(param) {');
    // Replace Arduino macros that are identity functions on ESP32
    // digitalPinToInterrupt(pin) → pin  (on ESP32, pin == interrupt number)
    js = js.replace(/\bdigitalPinToInterrupt\s*\(/g, '(');
    // C++ scope resolution operator :: → JS dot notation (e.g. DHTesp::DHT22 → DHTesp.DHT22)
    js = js.replace(/::/g, '.');
    // Strip C++ address-of operator & in function arguments: fn(&a, &b) → fn(a, b)
    js = js.replace(/([,(]\s*)&(\w)/g, '$1$2');
    // Handle lowercase custom struct types: sensors_event_t a, g, temp; → let a = {}; let g = {}; let temp = {};
    js = js.replace(/^\s*(sensors_event_t|event_t)\s+(\w+(?:\s*,\s*\w+)*)\s*;/gm,
      (_m: string, _type: string, vars: string) => {
        return vars.split(',').map((v: string) => `let ${v.trim()} = {};`).join('\n');
      });
    // Strip C++ array dimensions from variable declarations BEFORE type stripping
    // Handles both numeric: char keys[4][4] and named: char keys[ROWS][COLS]
    // e.g. char keys[ROWS][COLS] = ... → char keys = ...
    // e.g. byte rowPins[ROWS] = ...    → byte rowPins = ...
    js = js.replace(/(\b(?:int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s+\w+)(\s*\[[\w\d]+\])+(\s*=)/g, '$1$3');
    js = js.replace(/(\b(?:int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s+\w+)(\s*\[[\w\d]+\])+(\s*;)/g, '$1$3');
    // Convert C++ nested brace array initializers to JS nested arrays
    // e.g. = {{'1','2'},{'3','4'}} → = [['1','2'],['3','4']]
    // First convert inner braces that contain char literals or identifiers
    js = js.replace(/\{(\s*'[^']*'(?:\s*,\s*'[^']*')*\s*)\}/g, '[$1]');
    // Then convert outer braces that now contain arrays or identifiers
    js = js.replace(/=\s*\{(\s*(?:\[.*?\]|\w+)(?:\s*,\s*(?:\[.*?\]|\w+))*\s*)\}/g, '= [$1]');
    // Convert remaining single-level brace initializers: = {1, 2, 3} → = [1, 2, 3]
    js = js.replace(/=\s*\{([^{}]*)\}/g, '= [$1]');
    // e.g. Adafruit_SSD1306 oled(128, 64, &Wire, -1); → var oled = new Adafruit_SSD1306(128, 64);
    // Must happen BEFORE function-type stripping so it doesn't match function signatures
    js = js.replace(
      /^\s*([A-Z][A-Za-z0-9_]*)\s+(\w+)\s*\(([^;]*)\)\s*;/gm,
      (_m: string, className: string, varName: string, args: string) => {
        const cleanArgs = args
          .split(',')
          .map((a: string) => a.trim().replace(/^&/, '').replace(/^\(.*?\)/, '').trim())
          .filter((a: string) => a.length > 0)
          .join(', ');
        return `var ${varName} = new ${className}(${cleanArgs});`;
      }
    );
    // C++ copy-initialization: ClassName varName = ClassName(args);  OR  ClassName varName = ClassName(args);
    // e.g. Adafruit_ILI9341 tft = Adafruit_ILI9341(TFT_CS, TFT_DC);
    // e.g. Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
    js = js.replace(
      /^\s*([A-Z][A-Za-z0-9_]*)\s+(\w+)\s*=\s*(?:new\s+)?([A-Z][A-Za-z0-9_]*)\s*\(([^;]*)\)\s*;/gm,
      (_m: string, _className: string, varName: string, ctorName: string, args: string) => {
        const cleanArgs = args
          .split(',')
          .map((a: string) => a.trim().replace(/^&/, '').replace(/^\(.*?\)/, '').trim())
          .filter((a: string) => a.length > 0)
          .join(', ');
        return `var ${varName} = new ${ctorName}(${cleanArgs});`;
      }
    );
    // C++ copy-initialization with lowercase function: ClassName varName = functionName(args);
    // e.g. Keypad keypad = makeKeymap(keys, rowPins, colPins, ROWS, COLS);
    js = js.replace(
      /^\s*([A-Z][A-Za-z0-9_]*)\s+(\w+)\s*=\s*([a-z][A-Za-z0-9_]*)\s*\(([^;]*)\)\s*;/gm,
      (_m: string, _className: string, varName: string, fnName: string, args: string) => {
        const cleanArgs = args
          .split(',')
          .map((a: string) => a.trim().replace(/^&/, '').trim())
          .filter((a: string) => a.length > 0)
          .join(', ');
        return `var ${varName} = ${fnName}(${cleanArgs});`;
      }
    );
    // C++ default-construction: ClassName varName; (e.g. decode_results results;)
    js = js.replace(
      /^\s*([A-Z][A-Za-z0-9_]*|decode_results)\s+(\w+)\s*;/gm,
      (_m: string, className: string, varName: string) => `var ${varName} = new ${className}();`
    );
    // Fallback: Class-type variable with arbitrary RHS assignment
    // e.g. TempAndHumidity data = dhtSensor.getTempAndHumidity();
    js = js.replace(/^\s*([A-Z][A-Za-z0-9_]*)\s+(\w+)\s*=/gm, 'let $2 =');
    // #define → const
    js = js.replace(/^\s*#define\s+(\w+)\s+(.+)$/gm, (_m, n, v) => `const ${n} = ${v.trim()};`);
    // Strip C++ numeric literal suffixes (L, UL, U, LL, F, etc.) that are invalid JS
    // e.g. 65536L → 65536,  1000UL → 1000,  3.14f → 3.14
    js = js.replace(/\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:ULL|LL|UL|LU|U|L|F|f)\b/g, '$1');
    // Collect user-defined function names before type conversion changes the syntax
    const userFunctions: string[] = [];
    const funcRegex = /\b(?:void|int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s+(\w+)\s*\([^)]*\)\s*\{/g;
    let funcMatch;
    while ((funcMatch = funcRegex.exec(js)) !== null) {
      const name = funcMatch[1];
      if (name !== 'setup' && name !== 'loop') {
        userFunctions.push(name);
      }
    }

    // Type conversions
    js = js.replace(/\b(void|int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s+(\w+)\s*\(([^)]*)\)\s*\{/g,
      (_m, _t, name, params) => {
        // Filter out 'void' params (C++ uses 'void' to mean no params) and extract param names
        const jsParams = params.split(',')
          .map((p: string) => p.trim().split(/\s+/).pop()?.replace(/[*&]/g, '') || '')
          .filter((p: any) => p && p !== 'void')
          .join(', ');
        // All functions get async so that await __delay / await __delayMicroseconds / await pulseIn work everywhere
        const prefix = 'async ';
        const jsName = name === 'setup' ? '__setup' : name === 'loop' ? '__loop' : name;
        return `${prefix}function ${jsName}(${jsParams}) {`;
      });
    // Split comma-separated variable declarations into individual ones BEFORE type stripping.
    // e.g.  "long duration_us, distance_cm;"  →  "long duration_us;\nlong distance_cm;"
    // Also handles pointer types: "char* a, *b;" → "char* a;\nchar* b;"
    js = js.replace(/^(\s*)((?:unsigned\s+long|unsigned\s+int|int|long|short|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s*\*?)\s+(\w+(?:\s*,\s*\*?\w+)+)\s*;/gm,
      (_m: string, indent: string, type: string, vars: string) => {
        return vars.split(',').map((v: string) => `${indent}${type} ${v.trim()};`).join('\n');
      });
    // Variable types (including pointer types like char*, int*, etc.)
    // Match: type* varName = ... or type varName = ...
    js = js.replace(/\b(int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s*\*?\s+([a-zA-Z0-9_]+)\s*=/g,
      (_m, _t, n) => `let ${n} =`);
    js = js.replace(/\b(int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s*\*?\s+([a-zA-Z0-9_]+)\s*;/g,
      (_m, _t, n) => `let ${n} = 0;`);
    // String type → let (Arduino String is compatible with JS string)
    js = js.replace(/\bString\s+(\w+)\s*=/g, 'let $1 =');
    js = js.replace(/\bString\s+(\w+)\s*;/g, 'let $1 = "";');
    // for loop types
    js = js.replace(/for\s*\(\s*(int|byte|uint8_t|uint16_t|uint32_t|size_t|long|short)\s+/g, 'for (let ');
    // delay → await __delay
    js = js.replace(/\bdelay\s*\(/g, 'await __delay(');
    js = js.replace(/\bdelayMicroseconds\s*\(/g, 'await __delayMicroseconds(');
    // .step() and .write() → await (needed for Stepper inertia and Servo timing)
    js = js.replace(/(\w+)\.step\s*\(/g, 'await $1.step(');
    js = js.replace(/(\w+)\.write\s*\(/g, 'await $1.write(');
    // HTTPClient async methods → await (GET/POST/PUT/DELETE/PATCH return Promise<number>)
    // e.g.  int code = http.GET();  →  let code = await http.GET();
    js = js.replace(/(\w+)\.(GET|POST|PUT|DELETE|PATCH)\s*\(/g, 'await $1.$2(');
    // ThingSpeak async methods → await
    js = js.replace(/(\w+)\.(writeFields|writeField|readFloatField|readLongField|readStringField|readIntField)\s*\(/g, 'await $1.$2(');
    // Prepend await to user-defined function calls (excluding declarations)
    userFunctions.forEach((funcName) => {
      const callRegex = new RegExp(`\\b(async\\s+)?(function\\s+)?(${funcName})\\s*\\(`, 'g');
      js = js.replace(callRegex, (match, p1, p2) => {
        if (p1 || p2) return match;
        return `await ${match}`;
      });
    });

    // Fix any double-awaits introduced by chaining
    js = js.replace(/\bawait\s+await\s+/g, 'await ');
    // Arduino utilities
    js = js.replace(/\bmap\s*\(/g, '__arduino_map(');
    js = js.replace(/\bconstrain\s*\(/g, '__arduino_constrain(');
    js = js.replace(/\brandom\s*\(/g, '__arduino_random(');
    js = js.replace(/\babs\s*\(/g, 'Math.abs(');
    js = js.replace(/\bmin\s*\(/g, 'Math.min(');
    js = js.replace(/\bmax\s*\(/g, 'Math.max(');
    js = js.replace(/\bisnan\s*\(/g, 'Number.isNaN(');
    js = js.replace(/\bisinf\s*\(/g, '(!isFinite)(');
    // sizeof() → approximate sizes (compile-time operator in C++, best-effort in JS)
    js = js.replace(/\bsizeof\s*\(([^)]+)\)/g, '(typeof $1 === "string" ? $1.length : 4)');
    // F() macro — in Arduino it stores strings in flash; in JS just return the string
    js = js.replace(/\bF\s*\(\s*"([^"]*)"\s*\)/g, '"$1"');
    // Remove .c_str() calls — JS strings don't need this
    js = js.replace(/\.c_str\s*\(\s*\)/g, '');
    // Remove C++ type casts: (uint16_t)val → val
    js = js.replace(/\(\s*(uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|unsigned\s+\w+|int|long|short|float|double|byte|char|size_t)\s*\)/g, '');
    // `unsigned long` variable declarations (not caught by the main type regex)
    js = js.replace(/\bunsigned\s+long\s+([a-zA-Z0-9_]+)\s*=/g, 'let $1 =');
    js = js.replace(/\bunsigned\s+long\s+([a-zA-Z0-9_]+)\s*;/g, 'let $1 = 0;');
    // for loop with unsigned
    js = js.replace(/for\s*\(\s*unsigned\s+\w+\s+/g, 'for (let ');
    // `yield` in delay contexts (rare but needed for async correctness)
    // Remove remaining stray `static` keyword
    js = js.replace(/\bstatic\s+/g, '');
    // Convert C++ halt patterns to a catchable exception so the browser doesn't freeze
    // for(;;);  or  for(;;) {}  or  while(1);  or  while(true) {}
    js = js.replace(/\bfor\s*\(\s*;\s*;\s*\)\s*;/g, 'throw new Error("__ARDUINO_HALT__");');
    js = js.replace(/\bfor\s*\(\s*;\s*;\s*\)\s*\{\s*\}/g, 'throw new Error("__ARDUINO_HALT__");');
    js = js.replace(/\bwhile\s*\(\s*(1|true)\s*\)\s*;/g, 'throw new Error("__ARDUINO_HALT__");');
    js = js.replace(/\bwhile\s*\(\s*(1|true)\s*\)\s*\{\s*\}/g, 'throw new Error("__ARDUINO_HALT__");');

    // Combine library stubs + user code + footer
    const wrapped = LIBRARY_STUBS + '\n' + js + '\n' + LIBRARY_FOOTER;
    return { success: true, jsCode: wrapped };
  } catch (e: any) {
    return { success: false, error: `Client transpiler error: ${e.message}` };
  }
}

