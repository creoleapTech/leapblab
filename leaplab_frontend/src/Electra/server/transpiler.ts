/**
 * Arduino-to-JS Transpiler
 *
 * Converts Arduino .ino sketches into JavaScript that can run in the browser
 * with Arduino API stubs provided by ArduinoRuntime.
 *
 * Supports:
 *  - setup() / loop() lifecycle
 *  - digitalWrite, digitalRead, analogRead, analogWrite, pinMode
 *  - Serial.begin / Serial.print / Serial.println
 *  - delay(), millis(), micros()
 *  - Variables, control flow (if/else, for, while, switch/case)
 *  - #define macros
 *  - Function definitions
 *  - Basic C++ → JS syntax conversion
 */

export function transpileArduinoToJS(arduinoCode: string): string {
  let code = arduinoCode;

  // ── Step 1: Remove comments ─────────────────────────────────
  code = removeComments(code);

  // Collect user-defined function names before type conversion changes the syntax
  const userFunctions: string[] = [];
  const funcRegex = /\b(?:void|int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let funcMatch;
  while ((funcMatch = funcRegex.exec(code)) !== null) {
    const name = funcMatch[1];
    if (name !== 'setup' && name !== 'loop') {
      userFunctions.push(name);
    }
  }

  // ── Step 2: Process #include (strip them — stubs provide everything) ──
  code = code.replace(/^\s*#include\s*[<"].*?[>"]\s*$/gm, '');
  // Strip function prototypes / declarations (e.g. void myFunc();)
  code = code.replace(/^\s*(void|int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s*\*?\s*(\w+)\s*\([^)]*\)\s*;/gm, '');

  // ── Step 3: Process #define macros ──────────────────────────
  const defines = new Map<string, string>();
  code = code.replace(/^\s*#define\s+(\w+)\s+(.+)$/gm, (_match, name, value) => {
    defines.set(name, value.trim());
    return `const ${name} = ${convertValue(value.trim())};`;
  });

  // ── Step 4: Type conversions ────────────────────────────────
  // Convert C++ types to JS (let/const)
  code = code.replace(/\b(int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s+(\w+)\s*=/g,
    (_m, _type, name) => `let ${name} =`);
  code = code.replace(/\b(int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|byte|char|float|double|boolean|bool)\s+(\w+)\s*;/g,
    (_m, _type, name) => `let ${name} = 0;`);
  // Array declarations: int arr[] = {1,2,3};
  code = code.replace(/\b(int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|byte|char|float|double)\s+(\w+)\s*\[\s*(\d*)\s*\]\s*=\s*\{([^}]*)\}\s*;/g,
    (_m, _type, name, _size, values) => `let ${name} = [${values}];`);
  // Empty array: int arr[10];
  code = code.replace(/\b(int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|byte|char|float|double)\s+(\w+)\s*\[\s*(\d+)\s*\]\s*;/g,
    (_m, _type, name, size) => `let ${name} = new Array(${size}).fill(0);`);

  // ── Step 4b: Class-type globals (Adafruit_ILI9341 tft(CS, DC, RST);) ──
  // Constructor with arguments
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
  // Default construction: Adafruit_FT6206 ctp;
  code = code.replace(
    /^\s*([A-Z][A-Za-z0-9_]*(?:<[^>]*>)?)\s+(\w+)\s*;/gm,
    (_m, className, varName) => `var ${varName} = new ${className}();`
  );
  // Copy-initialization: Adafruit_FT6206 ctp = Adafruit_FT6206();
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
  // Any other class-typed assignment: TS_Point p = ctp.getPoint();
  code = code.replace(/^\s*([A-Z][A-Za-z0-9_]*)\s+(\w+)\s*=/gm, 'let $2 =');

  // ── Step 5: String handling ─────────────────────────────────
  // Convert String("...") → "..."
  code = code.replace(/\bString\s*\(([^)]*)\)/g, 'String($1)');
  // String concatenation: str + val already works in JS

  // ── Step 6: Function return types → JS function ─────────────
  // Match function definitions: void funcName(...) { or int funcName(...) {
  code = code.replace(
    /^(\s*)(int|long|short|unsigned\s+\w+|uint8_t|uint16_t|uint32_t|float|double|char|boolean|bool|byte|size_t)\s+(\w+)\s*\(([^)]*)\)\s*\{/gm,
    (_m, indent, _retType, funcName, params) => {
      const jsParams = convertParams(params);
      const jsName = funcName === 'setup' ? '__setup' : funcName === 'loop' ? '__loop' : funcName;
      return `${indent}async function ${jsName}(${jsParams}) {`;
    }
  );

  // void functions
  code = code.replace(
    /^(\s*)void\s+(\w+)\s*\(([^)]*)\)\s*\{/gm,
    (_m, indent, funcName, params) => {
      const jsParams = convertParams(params);
      const jsName = funcName === 'setup' ? '__setup' : funcName === 'loop' ? '__loop' : funcName;
      return `${indent}async function ${jsName}(${jsParams}) {`;
    }
  );

  // ── Step 7: C++ specific syntax ─────────────────────────────
  // Convert for(int i=0; ...) → for(let i=0; ...)
  code = code.replace(/for\s*\(\s*(int|unsigned\s+int|long|short|byte|uint8_t|uint16_t|uint32_t|size_t)\s+/g, 'for (let ');

  // Convert true/false/HIGH/LOW/INPUT/OUTPUT constants
  // (these will be provided by the runtime, but ensure they're uppercase)

  // Convert C-style casts: (int)x → Math.trunc(x), (float)x → Number(x)
  // Each cast wraps the next atomic expression in parentheses.
  code = code.replace(/\(int\)\s*/g, 'Math.trunc(');
  code = code.replace(/\(float\)\s*/g, 'Number(');
  code = code.replace(/\(double\)\s*/g, 'Number(');
  code = code.replace(/\(byte\)\s*/g, '(0xFF & ');
  code = code.replace(/\(char\)\s*/g, 'String.fromCharCode(');

  // Post-fix: close unclosed parens from cast conversions.
  // Scan for each cast function and ensure its opening paren has a matching close.
  {
    const castPrefixes = ['Math.trunc(', 'Number(', '(0xFF & ', 'String.fromCharCode('];
    for (const prefix of castPrefixes) {
      let idx = 0;
      while ((idx = code.indexOf(prefix, idx)) !== -1) {
        const start = idx + prefix.length;
        let depth = 1;
        let i = start;
        while (i < code.length && depth > 0) {
          if (code[i] === '(') depth++;
          else if (code[i] === ')') depth--;
          i++;
        }
        if (depth !== 0) {
          code = code.substring(0, i) + ')' + code.substring(i);
        }
        idx = start;
      }
    }
  }

  // Convert sizeof(x) → (x.length || sizeof_lookup)
  // For arrays/strings use .length, for primitives approximate typical sizes
  code = code.replace(/sizeof\s*\(\s*(\w+)\s*\)/g, '(__sizeof_val($1))');

  // ── Step 8: Arduino-specific API mappings ───────────────────
  // These are provided by the runtime, but ensure correct syntax

  // map() function — Arduino's map is different from JS Array.map
  code = code.replace(/\bmap\s*\(/g, '__arduino_map(');

  // constrain()
  code = code.replace(/\bconstrain\s*\(/g, '__arduino_constrain(');

  // random() / randomSeed()
  code = code.replace(/\brandomSeed\s*\(/g, '__arduino_randomSeed(');
  code = code.replace(/\brandom\s*\(/g, '__arduino_random(');

  // Bitwise helpers
  code = code.replace(/\bbitRead\s*\(/g, '__arduino_bitRead(');
  code = code.replace(/\bbitWrite\s*\(/g, '__arduino_bitWrite(');
  code = code.replace(/\bbitSet\s*\(/g, '__arduino_bitSet(');
  code = code.replace(/\bbitClear\s*\(/g, '__arduino_bitClear(');
  code = code.replace(/\bbit\s*\(/g, '__arduino_bit(');
  code = code.replace(/\blowByte\s*\(/g, '__arduino_lowByte(');
  code = code.replace(/\bhighByte\s*\(/g, '__arduino_highByte(');

  // abs, min, max — need to convert to Math equivalents (Arduino macros)
  code = code.replace(/\babs\s*\(/g, 'Math.abs(');
  code = code.replace(/\bmin\s*\(/g, 'Math.min(');
  code = code.replace(/\bmax\s*\(/g, 'Math.max(');
  code = code.replace(/\bpow\s*\(/g, 'Math.pow(');
  code = code.replace(/\bsqrt\s*\(/g, 'Math.sqrt(');
  code = code.replace(/\bsq\s*\(/g, '__arduino_sq(');

  // ── Step 9: Handle delay() → async yield ────────────────────
  // Mark setup and loop as async so delay() can yield
  code = code.replace(/function setup\s*\(\s*\)/g, 'async function __setup()');
  code = code.replace(/function loop\s*\(\s*\)/g, 'async function __loop()');

  // Convert delay() to await __delay()
  code = code.replace(/\bdelay\s*\(/g, 'await __delay(');
  code = code.replace(/\bdelayMicroseconds\s*\(/g, 'await __delayMicroseconds(');

  // Prepend await to user-defined function calls (excluding declarations)
  userFunctions.forEach((funcName) => {
    const callRegex = new RegExp(`\\b(async\\s+)?(function\\s+)?(${funcName})\\s*\\(`, 'g');
    code = code.replace(callRegex, (match, p1, p2) => {
      if (p1 || p2) return match;
      return `await ${match}`;
    });
  });
  // Clean up double awaits
  code = code.replace(/\bawait\s+await\s+/g, 'await ');

  // ── Step 10: Wrap in module ─────────────────────────────────
  const wrapped = `
// ═══════════════════════════════════════════════════════════════
// Auto-generated by Electra Arduino Transpiler
// Do not edit — regenerated on each compilation
// ═══════════════════════════════════════════════════════════════

${code}

// ── Export lifecycle functions ──────────────────────────────
if (typeof __setup === 'function') { __exports.setup = __setup; }
if (typeof __loop === 'function') { __exports.loop = __loop; }
`;

  return wrapped;
}

// ─── Helpers ────────────────────────────────────────────────────

function removeComments(code: string): string {
  // Remove single-line comments (but not inside strings)
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
      if (code[i] === stringChar) {
        inString = false;
      }
      result += code[i];
      i++;
    } else {
      if (code[i] === '"' || code[i] === "'") {
        inString = true;
        stringChar = code[i];
        result += code[i];
        i++;
      } else if (code[i] === '/' && code[i + 1] === '/') {
        // Single-line comment — skip to end of line
        while (i < code.length && code[i] !== '\n') i++;
      } else if (code[i] === '/' && code[i + 1] === '*') {
        // Multi-line comment — skip to */
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

function convertParams(params: string): string {
  if (!params.trim()) return '';
  return params.split(',').map(p => {
    const parts = p.trim().split(/\s+/);
    return parts[parts.length - 1].replace(/[*&]/g, ''); // Take last word (param name)
  })
  .filter(p => p && p !== 'void')
  .join(', ');
}

function convertValue(value: string): string {
  // Convert hex literals
  if (/^0x[0-9a-fA-F]+$/.test(value)) return value;
  // Convert binary literals
  if (/^0b[01]+$/.test(value)) return value;
  // Convert character literals
  if (/^'.'$/.test(value)) return `${value}.charCodeAt(0)`;
  return value;
}
