export function transpileArduinoToJS(arduinoCode: string): string {
  let code = arduinoCode;

  code = removeComments(code);

  const userFunctions: string[] = [];
  const funcRegex = /\b(?:void|int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let funcMatch: RegExpExecArray | null;
  while ((funcMatch = funcRegex.exec(code)) !== null) {
    const name = funcMatch[1];
    if (name !== 'setup' && name !== 'loop') {
      userFunctions.push(name);
    }
  }

  code = code.replace(/^\s*#include\s*[<"].*?[>"]\s*$/gm, '');
  // Strip function prototypes / declarations (e.g. void myFunc();)
  code = code.replace(/^\s*(void|int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s*\*?\s*(\w+)\s*\([^)]*\)\s*;/gm, '');

  code = code.replace(/^\s*#define\s+(\w+)\s+(.+)$/gm, (_m, n, v) => `const ${n} = ${v.trim()};`);

  code = code.replace(/\b(const|volatile)\s+(?=(void|int|long|short|unsigned|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool|String|string)\b)/g, '');

  code = code.replace(
    /^\s*([A-Z][A-Za-z0-9_]*(?:<[^>]*>)?)\s+(\w+)\s*\(([^)]*)\)\s*;/gm,
    (_m, className, varName, args) => {
      const cleanArgs = args
        .split(',')
        .map((a: string) => a.trim().replace(/^&/, '').replace(/^\(.*?\)/, '').trim())
        .filter((a: string) => a.length > 0)
        .join(', ');
      return `var ${varName} = new ${className}(${cleanArgs});`;
    }
  );
  code = code.replace(
    /^\s*([A-Z][A-Za-z0-9_]*(?:<[^>]*>)?)\s+(\w+)\s*;/gm,
    (_m, className, varName) => `var ${varName} = new ${className}();`
  );
  // Copy-initialization: `Adafruit_FT6206 ctp = Adafruit_FT6206();` must become
  // `new Adafruit_FT6206()` — calling the injected ES class without `new`
  // throws "Class constructor cannot be invoked without 'new'".
  code = code.replace(
    /^\s*([A-Z][A-Za-z0-9_]*)\s+(\w+)\s*=\s*(?:new\s+)?([A-Z][A-Za-z0-9_]*)\s*\(([^;]*)\)\s*;/gm,
    (_m, _className, varName, ctorName, args) => {
      const cleanArgs = args
        .split(',')
        .map((a: string) => a.trim().replace(/^&/, '').replace(/^\(.*?\)/, '').trim())
        .filter((a: string) => a.length > 0)
        .join(', ');
      return `var ${varName} = new ${ctorName}(${cleanArgs});`;
    }
  );

  const TYPES = '(?:void|int|long|unsigned\\s+\\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool|String|string)';
  code = code.replace(
    new RegExp(`\\b${TYPES}\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'g'),
    (_m, name, params) => {
      const jsParams = params.split(',')
        .map((p: string) => p.trim().split(/\s+/).pop()?.replace(/[*&]/g, ''))
        .filter((p: string | undefined): p is string => Boolean(p) && p !== 'void').join(', ');
      // All functions are async so `await` (prepended to user-function calls
      // and inserted for delay()) is legal inside them — only marking
      // setup/loop async produced "await inside non-async function" syntax
      // errors for any sketch with helper functions.
      const jsName = name === 'setup' ? '__setup' : name === 'loop' ? '__loop' : name;
      return `async function ${jsName}(${jsParams}) {`;
    }
  );

  code = code.replace(
    new RegExp(`\\b${TYPES}\\s*\\*?\\s+(\\w+)\\s*=`, 'g'),
    (_m, n) => `let ${n} =`
  );
  code = code.replace(
    new RegExp(`\\b${TYPES}\\s*\\*?\\s+(\\w+)\\s*;`, 'g'),
    (_m, n) => `let ${n} = 0;`
  );

  code = code.replace(/\b(int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|byte|char|float|double)\s+(\w+)\s*\[\s*(\d*)\s*\]\s*=\s*\{([^}]*)\}\s*;/g,
    (_m, _type, name, _size, values) => `let ${name} = [${values}];`);
  code = code.replace(/\b(int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|byte|char|float|double)\s+(\w+)\s*\[\s*(\d+)\s*\]\s*;/g,
    (_m, _type, name, size) => `let ${name} = new Array(${size}).fill(0);`);

  code = code.replace(/for\s*\(\s*(?:int|byte|uint8_t|uint16_t|uint32_t|size_t|long|short)\s+/g, 'for (let ');

  code = code.replace(/\bString\s+(\w+)/g, 'let $1');

  code = code.replace(/\((?:int|float|double|byte|char|long|uint8_t|uint16_t|uint32_t)\)\s*/g, '');

  code = code.replace(/::/g, '.');

  code = code.replace(/\.c_str\s*\(\s*\)/g, '');

  code = code.replace(/^\s*([A-Z][A-Za-z0-9_]*)\s+(\w+)\s*=/gm, 'let $2 =');

  code = code.replace(/\btrue\b/g, 'true');
  code = code.replace(/\bfalse\b/g, 'false');
  code = code.replace(/\bNULL\b/g, 'null');
  code = code.replace(/\bHIGH\b/g, 'HIGH');
  code = code.replace(/\bLOW\b/g, 'LOW');

  code = code.replace(/\bdelay\s*\(/g, 'await __delay(');
  code = code.replace(/\bdelayMicroseconds\s*\(/g, 'await __delayMicroseconds(');
  code = code.replace(/\bmap\s*\(/g, '__arduino_map(');
  code = code.replace(/\bconstrain\s*\(/g, '__arduino_constrain(');
  code = code.replace(/\brandom\s*\(/g, '__arduino_random(');
  code = code.replace(/\brandomSeed\s*\(/g, '__arduino_randomSeed(');
  code = code.replace(/\babs\s*\(/g, 'Math.abs(');
  code = code.replace(/\bmin\s*\(/g, 'Math.min(');
  code = code.replace(/\bmax\s*\(/g, 'Math.max(');
  code = code.replace(/\bsq\s*\(/g, '__arduino_sq(');
  code = code.replace(/\bpow\s*\(/g, 'Math.pow(');
  code = code.replace(/\bsqrt\s*\(/g, 'Math.sqrt(');
  code = code.replace(/\bbitRead\s*\(/g, '__arduino_bitRead(');
  code = code.replace(/\bbitWrite\s*\(/g, '__arduino_bitWrite(');
  code = code.replace(/\bbitSet\s*\(/g, '__arduino_bitSet(');
  code = code.replace(/\bbitClear\s*\(/g, '__arduino_bitClear(');
  code = code.replace(/\bbit\s*\(/g, '__arduino_bit(');
  code = code.replace(/\blowByte\s*\(/g, '__arduino_lowByte(');
  code = code.replace(/\bhighByte\s*\(/g, '__arduino_highByte(');
  code = code.replace(/sizeof\s*\(([^)]+)\)/g, '($1.length || 1)');

  code = code.replace(/(\w+)\.(GET|POST|PUT|DELETE|PATCH)\s*\(/g, 'await $1.$2(');
  code = code.replace(/(\w+)\.(writeFields|writeField|readFloatField|readLongField|readStringField|readIntField)\s*\(/g, 'await $1.$2(');
  code = code.replace(/(\w+)\.(getString)\s*\(/g, 'await $1.$2(');

  userFunctions.forEach((funcName) => {
    // Never prefix declarations — `function drawButton(` must not become
    // `function await drawButton(` (invalid JS / SyntaxError).
    const callRegex = new RegExp(`\\b(async\\s+)?(function\\s+)?(${funcName})\\s*\\(`, 'g');
    code = code.replace(callRegex, (match, p1, p2) => {
      if (p1 || p2) return match;
      return `await ${match}`;
    });
  });
  code = code.replace(/\bawait\s+await\s+/g, 'await ');

  const wrapped = `
// ── Electra Transpiled Sketch ──────────────────────────────────────────────
if (typeof __exports === 'undefined') __exports = {};

// ── Library stubs ────────────────────────────────────────────────────────────
if (typeof Adafruit_SSD1306 === 'undefined') Adafruit_SSD1306 = class { constructor() { this._buf = new Uint8Array(128 * 8); } begin() { return true; } clearDisplay() { this._buf.fill(0); } display() {} setTextSize() {} setTextColor() {} setCursor() {} print(v) { console.log('[OLED]', v); } println(v) { console.log('[OLED]', v); } drawPixel(x, y, c) { if (x >= 0 && x < 128 && y >= 0 && y < 64) { const page = Math.floor(y / 8); const bit = y % 8; if (c) this._buf[page * 128 + x] |= (1 << bit); else this._buf[page * 128 + x] &= ~(1 << bit); } } fillRect() {} drawRect() {} drawCircle() {} fillCircle() {} setRotation() {} invertDisplay() {} startscrollright() {} stopscroll() {} getBuffer() { return this._buf; } };
if (typeof Adafruit_GFX === 'undefined') Adafruit_GFX = class { constructor() {} };
if (typeof LiquidCrystal_I2C === 'undefined') LiquidCrystal_I2C = class { constructor() {} begin() {} print(v) { console.log('[LCD]', v); } println(v) { console.log('[LCD]', v); } setCursor() {} clear() {} backlight() {} noBacklight() {} };
if (typeof LiquidCrystal === 'undefined') LiquidCrystal = class { constructor() {} begin() {} print(v) { console.log('[LCD]', v); } println(v) { console.log('[LCD]', v); } setCursor() {} clear() {} };
if (typeof DHT === 'undefined') DHT = class { constructor() {} begin() {} readTemperature() { return 25.0; } readHumidity() { return 50.0; } isnan(v) { return isNaN(v); } };
if (typeof IRrecv === 'undefined') IRrecv = class { constructor() {} enableIRIn() {} decode() { return false; } resume() {} };
if (typeof decode_results === 'undefined') decode_results = class { constructor() { this.value = 0; } };
if (typeof SoftwareSerial === 'undefined') SoftwareSerial = class { constructor() {} begin() {} print(v) { Serial.print(v); } println(v) { Serial.println(v); } available() { return 0; } read() { return -1; } };
if (typeof Stepper === 'undefined') Stepper = class { constructor() {} setSpeed() {} step() {} };
if (typeof Keypad === 'undefined') Keypad = class { constructor() {} getKey() { return null; } };
if (typeof makeKeymap === 'undefined') makeKeymap = (k) => k;
if (typeof U8g2_SSD1306_128X64_NONAME_F_HW_I2C === 'undefined') U8g2_SSD1306_128X64_NONAME_F_HW_I2C = class { constructor() {} begin() {} clearBuffer() {} sendBuffer() {} setFont() {} drawStr() {} setCursor() {} print() {} println() {} };
if (typeof TFT_eSPI === 'undefined') TFT_eSPI = class { constructor() {} init() {} fillScreen() {} setTextColor() {} setTextSize() {} setCursor() {} print() {} println() {} drawPixel() {} fillRect() {} drawRect() {} };
if (typeof Servo === 'undefined') Servo = class { constructor() { this._pin = 0; this._angle = 90; } attach(pin) { this._pin = pin; } write(a) { this._angle = a; if (typeof __onServoWrite === 'function') __onServoWrite(this._pin, a); } read() { return this._angle; } detach() {} };
if (typeof NeoPixel === 'undefined') NeoPixel = class { constructor(n, pin) { this._n = n; this._pin = pin; this._pixels = new Uint32Array(n); } begin() {} show() {} setPixelColor(i, r, g, b) { if (i < this._n) this._pixels[i] = (r << 16) | (g << 8) | b; } Color(r, g, b) { return (r << 16) | (g << 8) | b; } clear() { this._pixels.fill(0); } };
if (typeof Adafruit_NeoPixel === 'undefined') Adafruit_NeoPixel = NeoPixel;
if (typeof WiFiClient === 'undefined') WiFiClient = class { constructor() { this._connected = false; } connect() { this._connected = true; return true; } connected() { return this._connected; } available() { return 0; } read() { return -1; } write() { return 0; } print(v) { console.log('[WiFiClient]', v); } println(v) { console.log('[WiFiClient]', v); } stop() { this._connected = false; } flush() {} };
if (typeof ThingSpeak === 'undefined') ThingSpeak = new (class { constructor() { this._fields = {}; this._status = ''; } begin(client) { return true; } setField(field, value) { this._fields[field] = value; return true; } setStatus(status) { this._status = status; return true; } async writeFields(channelNumber, writeAPIKey) { console.log('[ThingSpeak] writeFields', channelNumber, this._fields); this._fields = {}; this._status = ''; return 200; } async writeField(channelNumber, field, value, writeAPIKey) { this.setField(field, value); return await this.writeFields(channelNumber, writeAPIKey); } })();
if (typeof DHTesp === 'undefined') DHTesp = class { constructor() { this.DHT22 = 22; this.DHT11 = 11; } setup() {} getTempAndHumidity() { return { temperature: 25.0, humidity: 50.0 }; } getTemperature() { return 25.0; } getHumidity() { return 50.0; } };
if (typeof isnan === 'undefined') isnan = (v) => isNaN(v);
if (typeof isinf === 'undefined') isinf = (v) => !isFinite(v);
if (typeof F === 'undefined') F = (s) => s;
if (typeof PROGMEM === 'undefined') PROGMEM = '';
if (typeof pgm_read_byte === 'undefined') pgm_read_byte = (p) => p;

if (typeof SSD1306_SWITCHCAPVCC === 'undefined') SSD1306_SWITCHCAPVCC = 0x02;
if (typeof SSD1306_EXTERNALVCC  === 'undefined') SSD1306_EXTERNALVCC  = 0x01;
if (typeof BLACK   === 'undefined') BLACK   = 0;
if (typeof WHITE   === 'undefined') WHITE   = 1;
if (typeof INVERSE === 'undefined') INVERSE = 2;
if (typeof RED     === 'undefined') RED     = 0xF800;
if (typeof GREEN   === 'undefined') GREEN   = 0x07E0;
if (typeof BLUE    === 'undefined') BLUE    = 0x001F;
if (typeof CYAN    === 'undefined') CYAN    = 0x07FF;
if (typeof MAGENTA === 'undefined') MAGENTA = 0xF81F;
if (typeof YELLOW  === 'undefined') YELLOW  = 0xFFE0;
if (typeof ORANGE  === 'undefined') ORANGE  = 0xFC00;
if (typeof DHT11   === 'undefined') DHT11   = 11;
if (typeof DHT22   === 'undefined') DHT22   = 22;
if (typeof DHT21   === 'undefined') DHT21   = 21;
if (typeof AM2301  === 'undefined') AM2301  = 21;
if (typeof DEC     === 'undefined') DEC     = 10;
if (typeof HEX     === 'undefined') HEX     = 16;
if (typeof OCT     === 'undefined') OCT     = 8;
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
if (typeof Adafruit_ILI9341 === 'undefined') Adafruit_ILI9341 = class { constructor() {} begin() {} setRotation() {} fillScreen() {} setTextColor() {} setTextSize() {} setCursor() {} print() {} println() {} drawPixel() {} drawLine() {} drawRect() {} fillRect() {} drawCircle() {} fillCircle() {} drawRoundRect() {} fillRoundRect() {} width() { return 240; } height() { return 320; } invertDisplay() {} };
if (typeof TS_Point === 'undefined') TS_Point = class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } };
if (typeof Adafruit_FT6206 === 'undefined') Adafruit_FT6206 = class { constructor() {} begin() { return true; } touched() { return 0; } getPoint() { return new TS_Point(0, 0, 0); } };


${code}

if (typeof __setup === 'function') { __exports.setup = __setup; }
if (typeof __loop  === 'function') { __exports.loop  = __loop;  }
`;

  return wrapped;
}

function removeComments(code: string): string {
  let result = '';
  let inString = false;
  let stringChar = '';
  let i = 0;
  while (i < code.length) {
    if (inString) {
      if (code[i] === '\\') {
        result += code[i] + (code[i + 1] || '');
        i += 2;
        continue;
      }
      if (code[i] === stringChar) inString = false;
      result += code[i];
      i++;
    } else {
      if (code[i] === '"' || code[i] === "'") {
        inString = true;
        stringChar = code[i];
        result += code[i];
        i++;
      } else if (code[i] === '/' && code[i + 1] === '/') {
        while (i < code.length && code[i] !== '\n') i++;
      } else if (code[i] === '/' && code[i + 1] === '*') {
        i += 2;
        while (i < code.length - 1 && !(code[i] === '*' && code[i + 1] === '/')) i++;
        i += 2;
      } else {
        result += code[i];
        i++;
      }
    }
  }
  return result;
}
