/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import Blockly from '@blockly-runtime';



// ═══════════════════════════════════════════════════════════════════════════

// LOGGING UTILITY

// ═══════════════════════════════════════════════════════════════════════════

const log = (blockType: string, msg: string, data?: any) => {

    console.log(`[GENERATOR:${blockType}] ${msg}`, data ?? '');

};



// Arduino generator uses a buffered proxy to avoid TDZ errors:
// Property assignments (set) are buffered at module scope without touching Blockly.
// On first get access, the real Blockly.Generator is created and buffered props replayed.

let _arduinoGenerator: Blockly.Generator | null = null;
const _bufferedProps: Array<[PropertyKey, any]> = [];

export function getArduinoGenerator(): Blockly.Generator {
    if (!_arduinoGenerator) {
        console.log('[GENERATOR] Creating Arduino generator...');
        _arduinoGenerator = new Blockly.Generator('Arduino');
        // Replay any buffered property assignments
        for (const [prop, value] of _bufferedProps) {
            (_arduinoGenerator as any)[prop] = value;
        }
        _bufferedProps.length = 0;
    }
    return _arduinoGenerator;
}
export const arduinoGenerator = new Proxy({} as Blockly.Generator, {
    get(_target, prop) {
        const instance = getArduinoGenerator();
        const value = (instance as any)[prop];
        return typeof value === 'function' ? value.bind(instance) : value;
    },
    set(_target, prop, value) {
        if (_arduinoGenerator) {
            (_arduinoGenerator as any)[prop] = value;
        } else {
            _bufferedProps.push([prop, value]);
        }
        return true;
    }
});



const ORDER_ATOMIC = 0;

const ORDER_UNARY_PREFIX = 2;

const ORDER_MULTIPLICATIVE = 3;

const ORDER_ADDITIVE = 4;

const ORDER_RELATIONAL = 5;

const ORDER_LOGICAL_AND = 7;

const ORDER_LOGICAL_OR = 8;

const ORDER_NONE = 99;



// Initialize the generator

arduinoGenerator.init = function (workspace: Blockly.Workspace) {

    (this as any).definitions_ = {};

    (this as any).setups_ = {};

    (this as any).loopBuffer_ = '';

};



// Block scrubbing (concatenation)

arduinoGenerator.scrub_ = function (block: Blockly.Block, code: string, thisOnly?: boolean) {

    // Prevent floating non-hat blocks from rendering in global scope if event hats exist

    if (!block.getParent()) {

        const isHat = block.type === 'arduino_setup' || block.type === 'arduino_loop' || block.type === 'esp32_setup';

        if (!isHat) {

            const hasHats = block.workspace.getTopBlocks(false).some(

                b => b.type === 'arduino_setup' || b.type === 'arduino_loop' || b.type === 'esp32_setup'

            );

            if (hasHats) {

                return ''; // Nullify this entire floating stack's output string

            }

        }

    }



    const nextBlock = block.nextConnection && block.nextConnection.targetBlock();

    let nextCode = '';

    if (nextBlock && !thisOnly) {

        nextCode = this.blockToCode(nextBlock) as string;

    }



    let result = code + nextCode;



    // Special handling for setup hats: they open a { but don't close it in their own generator

    // because they use nextStatement. We must close it here if it's the top of a stack.

    if (!block.getParent() && (block.type === 'arduino_setup' || block.type === 'esp32_setup')) {

        result += '}\n\n';

    }



    return result;

};



// Final code adjustments

arduinoGenerator.finish = function (code: string) {

    const generator = this as any;

    const defs = Object.values(generator.definitions_ || {}).join('\n');

    const setups = Object.values(generator.setups_ || {}).join('\n');



    let finalCode = '';

    if (defs) finalCode += defs + '\n\n';



    // Ensure code has balanced braces for functions

    let processedCode = code;

    const openBraces = (processedCode.match(/{/g) || []).length;

    const closeBraces = (processedCode.match(/}/g) || []).length;

    if (openBraces > closeBraces) {

        processedCode += '\n}\n'.repeat(openBraces - closeBraces);

    }



    // Check if user provided their own setup() or loop()

    const hasSetup = processedCode.includes('void setup()');

    const hasLoop = processedCode.includes('void loop()');



    // Hoist nested Forever contents (marker sections) out of setup so they
    // always end up in void loop(). Leave a pointer comment behind.

    const foreverSections: string[] = [];

    processedCode = processedCode.replace(
        /\/\/ <leapblocks:forever>\n([\s\S]*?)\/\/ <\/leapblocks:forever>\n?/g,
        (_m, body) => {
            foreverSections.push(body);
            return `  // (Forever contents moved to void loop() below)\n`;
        }
    );

    const hoistedLoop = foreverSections.join('');

    const hasHoistedLoop = hoistedLoop.trim().length > 0;



    if (!hasSetup) {

        finalCode += `void setup() {\n${setups}\n}\n\n`;

    } else {

        // Inject setups into the existing setup function - handle both with/without newline

        processedCode = processedCode.replace(/void setup\(\) {(\n)?/, `void setup() {\n${setups}\n`);

    }



    if (!hasLoop) {

        if (processedCode.trim() && !hasSetup) {

            // Case 1: Loose code (wrapped in loop)

            finalCode += `void loop() {\n${processedCode}\n}\n`;

        } else if (hasSetup) {

            // Case 2: Setup exists but no loop.
            // Nested Forever contents (hoisted) become the loop body.

            if (hasHoistedLoop) {

                finalCode += processedCode + `\nvoid loop() {\n${hoistedLoop}}\n`;

            } else {

                finalCode += processedCode + `\nvoid loop() {\n  // main loop\n}\n`;

            }

        } else {

            // Case 3: Empty code (ensure both)

            finalCode += `void loop() {\n}\n`;

        }

    } else {

        // Top-level loop exists. Merge any nested Forever contents into it.

        if (hasHoistedLoop) {

            processedCode = processedCode.replace(/void loop\(\)\s*\{/, (m) => `${m}\n${hoistedLoop}`);

        }

        finalCode += processedCode;

    }



    return finalCode;

};



// Helper to add setup code

(arduinoGenerator as any).addSetup = function (name: string, code: string) {

    if (!this.setups_) this.setups_ = {};

    this.setups_[name] = code;

};



// Only add setup entry if key does not exist yet.
// Used for Serial.begin fallback so an explicit baud-rate block is never
// duplicated/overridden by the implicit 9600 fallback.

(arduinoGenerator as any).addSetupIfMissing = function (name: string, code: string) {

    if (!this.setups_) this.setups_ = {};

    if (!(name in this.setups_)) {

        this.setups_[name] = code;

    }

};



// Helper to add definitions/includes

(arduinoGenerator as any).addDefinition = function (name: string, code: string) {

    if (!this.definitions_) this.definitions_ = {};

    this.definitions_[name] = code;

};



// ═══════════════════════════════════════════════════════════════════════════

// EVENTS

// ═══════════════════════════════════════════════════════════════════════════

arduinoGenerator.forBlock['arduino_setup'] = function (block, generator) {

    log('arduino_setup', 'Generating');

    return `void setup() {\n`;

};



arduinoGenerator.forBlock['arduino_loop'] = function (block, generator) {

    const doCode = generator.statementToCode(block, 'DO') || '';

    log('arduino_loop', 'Generating', { innerLength: doCode.length });



    // Forever must always end up in void loop().
    // If nested inside setup (or anything else), wrap its contents in markers
    // so finish() can hoist them into void loop(). Markers are stateless,
    // so hoisting survives any init/finish ordering. finish() strips them.

    if (block.getParent()) {

        return `  // <leapblocks:forever>\n${doCode}  // </leapblocks:forever>\n`;

    }



    return `void loop() {\n${doCode}}\n`;

};



// ═══════════════════════════════════════════════════════════════════════════

// CONTROL

// ═══════════════════════════════════════════════════════════════════════════

arduinoGenerator.forBlock['arduino_delay'] = function (block) {

    const secs = block.getFieldValue('SECS');

    const ms = Math.round(secs * 1000);

    log('arduino_delay', 'Generating', { secs, ms });

    return `  delay(${ms});\n`;

};



arduinoGenerator.forBlock['arduino_repeat'] = function (block, generator) {

    const times = block.getFieldValue('TIMES');

    const doCode = generator.statementToCode(block, 'DO') || '';

    log('arduino_repeat', 'Generating', { times });

    return `  for (int i = 0; i < ${times}; i++) {\n${doCode}  }\n`;

};



arduinoGenerator.forBlock['arduino_if'] = function (block, generator) {

    const condition = generator.valueToCode(block, 'CONDITION', ORDER_NONE) || 'false';

    const doCode = generator.statementToCode(block, 'DO') || '';

    log('arduino_if', 'Generating', { condition });

    return `  if (${condition}) {\n${doCode}  }\n`;

};



arduinoGenerator.forBlock['arduino_if_else'] = function (block, generator) {

    const condition = generator.valueToCode(block, 'CONDITION', ORDER_NONE) || 'false';

    const doCode = generator.statementToCode(block, 'DO') || '';

    const elseCode = generator.statementToCode(block, 'ELSE') || '';

    log('arduino_if_else', 'Generating', { condition });

    return `  if (${condition}) {\n${doCode}  } else {\n${elseCode}  }\n`;

};



arduinoGenerator.forBlock['arduino_wait_until'] = function (block, generator) {

    const condition = generator.valueToCode(block, 'CONDITION', ORDER_NONE) || 'false';

    log('arduino_wait_until', 'Generating', { condition });

    return `  while (!(${condition})) { delay(10); }\n`;

};



arduinoGenerator.forBlock['arduino_repeat_until'] = function (block, generator) {

    const condition = generator.valueToCode(block, 'CONDITION', ORDER_NONE) || 'false';

    const doCode = generator.statementToCode(block, 'DO') || '';

    log('arduino_repeat_until', 'Generating', { condition });

    return `  while (!(${condition})) {\n${doCode}  }\n`;

};



arduinoGenerator.forBlock['arduino_stop'] = function (block) {

    log('arduino_stop', 'Generating');

    return `  while(true) { delay(1000); } // stop\n`;

};



// ═══════════════════════════════════════════════════════════════════════════

// GPIO

// ═══════════════════════════════════════════════════════════════════════════

arduinoGenerator.forBlock['arduino_digital_write'] = function (block) {

    const pin = block.getFieldValue('PIN');

    const value = block.getFieldValue('VALUE');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, OUTPUT);`);

    log('arduino_digital_write', 'Generating', { pin, value });

    return `  digitalWrite(${pin}, ${value});\n`;

};



arduinoGenerator.forBlock['arduino_digital_read'] = function (block) {

    const pin = block.getFieldValue('PIN');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, INPUT);`);

    log('arduino_digital_read', 'Generating', { pin });

    return [`digitalRead(${pin})`, ORDER_ATOMIC];

};

arduinoGenerator.forBlock['arduino_pir'] = function (block) {

    const pin = block.getFieldValue('PIN');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, INPUT);`);

    log('arduino_pir', 'Generating', { pin });

    return [`((digitalRead(${pin}) == HIGH) ? 1 : 0)`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_ir_obstacle'] = function (block) {

    const pin = block.getFieldValue('PIN');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, INPUT);`);

    log('arduino_ir_obstacle', 'Generating', { pin });

    return [`((digitalRead(${pin}) == LOW) ? 1 : 0)`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_digital_sensor'] = function (block) {

    const sensor = block.getFieldValue('SENSOR');

    const pin = block.getFieldValue('PIN');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, INPUT);`);

    log('arduino_digital_sensor', 'Generating', { sensor, pin });



    // Most digital sensors (PIR, Soil Moisture, Hall, Touch) are Active High (1 when detected)

    // IR (Proximity) is often Active Low (0 when detected)

    // To keep it consistent for kids, we'll try to provide a "detected" state.

    // However, some users might want the raw state.

    // Based on the LeapBlox style, usually "read digital sensor" returns true if detection is high.

    // But for IR proximity, it's usually low.

    // Let's check the sensor type and handle inversion if it's IR.



    if (sensor === 'IR') {

        return [`((digitalRead(${pin}) == LOW) ? 1 : 0)`, ORDER_ATOMIC];

    }

    return [`((digitalRead(${pin}) == HIGH) ? 1 : 0)`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_analog_write'] = function (block) {

    const pin = block.getFieldValue('PIN');

    const value = block.getFieldValue('VALUE');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, OUTPUT);`);

    log('arduino_analog_write', 'Generating', { pin, value });

    return `  analogWrite(${pin}, ${value});\n`;

};



arduinoGenerator.forBlock['arduino_analog_read'] = function (block) {

    const pin = block.getFieldValue('PIN');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, INPUT);`);

    log('arduino_analog_read', 'Generating', { pin });

    return [`analogRead(${pin})`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_tone'] = function (block) {

    const pin = block.getFieldValue('PIN');

    const freq = block.getFieldValue('FREQ');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, OUTPUT);`);

    log('arduino_tone', 'Generating', { pin, freq });

    return `  tone(${pin}, ${freq});\n`;

};



arduinoGenerator.forBlock['arduino_notone'] = function (block) {

    const pin = block.getFieldValue('PIN');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, OUTPUT);`);

    log('arduino_notone', 'Generating', { pin });

    return `  noTone(${pin});\n`;

};



arduinoGenerator.forBlock['arduino_millis'] = function () {

    log('arduino_millis', 'Generating');

    return [`millis()`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_map'] = function (block, generator) {

    const value = generator.valueToCode(block, 'VALUE', ORDER_NONE) || '0';

    const inMin = block.getFieldValue('IN_MIN');

    const inMax = block.getFieldValue('IN_MAX');

    const outMin = block.getFieldValue('OUT_MIN');

    const outMax = block.getFieldValue('OUT_MAX');

    log('arduino_map', 'Generating', { value });

    return [`map(${value}, ${inMin}, ${inMax}, ${outMin}, ${outMax})`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_constrain'] = function (block, generator) {

    const value = generator.valueToCode(block, 'VALUE', ORDER_NONE) || '0';

    const min = block.getFieldValue('MIN');

    const max = block.getFieldValue('MAX');

    log('arduino_constrain', 'Generating', { value, min, max });

    return [`constrain(${value}, ${min}, ${max})`, ORDER_ATOMIC];

};



// ═══════════════════════════════════════════════════════════════════════════

// VARIABLES

// ═══════════════════════════════════════════════════════════════════════════

// Helper to extract variable info from both 'VAR' and 'VARIABLE' fields

const sanitizeName = (name: string) => {

    let safeName = name.replace(/[^a-zA-Z0-9]/g, '_');

    if (/^[0-9]/.test(safeName)) {

        safeName = '_' + safeName;

    }

    return safeName;

};



const getVarInfo = (block: any) => {

    const varId = block.getFieldValue('VAR') || block.getFieldValue('VARIABLE');

    const variable = block.workspace.getVariableById(varId);

    const rawName = variable ? (variable as any).name : varId;

    return {

        id: varId,

        name: sanitizeName(rawName),

        type: variable ? (variable as any).type : ''

    };

};



const ensureVarDeclared = (name: string, type: string) => {

    const declType = (type === 'String') ? 'String' : 'double';

    const initVal = (type === 'String') ? '""' : '0';

    (arduinoGenerator as any).addDefinition(`var_decl_${name}`, `${declType} ${name} = ${initVal};`);

};



arduinoGenerator.forBlock['variables_get'] = function (block) {

    const { name, type } = getVarInfo(block);

    ensureVarDeclared(name, type);

    log('variables_get', 'Generating', { name, type });

    return [name, ORDER_ATOMIC];

};

// ——— Fix: LEAP/UI variable reporters (data_variable) share the same workspace model
// but were not handled for Arduino. Without this, `valueToCode` for `write [var] to serial`
// returned empty and fell back to the shadow "Hello World" literal.
// See IntermediateApp.tsx:1859 LEAP_VARIABLES replacement → data_variable.
arduinoGenerator.forBlock['data_variable'] = function (block) {
    // field_variable stores ID; resolve to real variable for type/sanitised name
    const varId = block.getFieldValue('VARIABLE');
    let variable: any = null;
    try { variable = block.workspace.getVariableById(varId); } catch {}
    if (!variable) {
        try { variable = block.workspace.getVariable(varId, '') || block.workspace.getVariable(varId, 'Number') || block.workspace.getVariable(varId, 'String'); } catch {}
    }
    let name: string;
    let type = '';
    if (variable) {
        name = sanitizeName((variable as any).name);
        type = (variable as any).type || '';
    } else {
        name = sanitizeName(varId || 'var');
    }
    ensureVarDeclared(name, type);
    log('data_variable', 'Generating', { name, type, varId });
    return [name, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['variable_reporter_checkbox'] = function (block) {
    // Flyout placeholder before replacement — field stores name directly
    const rawName = block.getFieldValue('VARIABLE') || block.getFieldValue('LIST') || 'var';
    let variable: any = null;
    try { variable = block.workspace.getVariable(rawName, '') || block.workspace.getVariable(rawName, 'Number') || block.workspace.getVariable(rawName, 'String') || block.workspace.getVariableById(rawName); } catch {}
    const type = variable ? (variable as any).type : '';
    const name = sanitizeName(rawName);
    ensureVarDeclared(name, type);
    log('variable_reporter_checkbox', 'Generating', { name, type, rawName });
    return [name, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['list_reporter_checkbox'] = function (block) {
    const rawName = block.getFieldValue('LIST') || 'list';
    const name = sanitizeName(rawName);
    ensureVarDeclared(name, 'list');
    return [name, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['data_listcontents'] = function (block) {
    const varId = block.getFieldValue('LIST');
    let variable: any = null;
    try { variable = block.workspace.getVariableById(varId); } catch {}
    if (!variable) try { variable = block.workspace.getVariable(varId, 'list'); } catch {}
    const name = variable ? sanitizeName((variable as any).name) : sanitizeName(varId || 'list');
    ensureVarDeclared(name, 'list');
    return [name, ORDER_ATOMIC];
};



arduinoGenerator.forBlock['variables_set'] = function (block, generator) {

    const { name, type } = getVarInfo(block);

    const value = generator.valueToCode(block, 'VALUE', ORDER_NONE) || '0';

    ensureVarDeclared(name, type);

    log('variables_set', 'Generating', { name, type });

    return `  ${name} = ${value};\n`;

};



// LeapBlox/leap-style variable blocks used by LEAP_VARIABLES category

arduinoGenerator.forBlock['data_setvariableto'] = function (block, generator) {

    const { name, type } = getVarInfo(block);

    const value = generator.valueToCode(block, 'VALUE', ORDER_NONE) || '0';

    ensureVarDeclared(name, type);

    log('data_setvariableto', 'Generating', { name, type });

    return `  ${name} = ${value};\n`;

};



arduinoGenerator.forBlock['variables_set_intermediate'] = function (block, generator) {

    const { name, type } = getVarInfo(block);

    const value = generator.valueToCode(block, 'VALUE', ORDER_NONE) || '0';

    ensureVarDeclared(name, type);

    log('variables_set_intermediate', 'Generating', { name, type });

    return `  ${name} = ${value};\n`;

};



arduinoGenerator.forBlock['data_changevariableby'] = function (block, generator) {

    const { name, type } = getVarInfo(block);

    const value = generator.valueToCode(block, 'VALUE', ORDER_NONE) || '1';

    ensureVarDeclared(name, type);

    log('data_changevariableby', 'Generating', { name, type });

    return `  ${name} = ${name} + ${value};\n`;

};



arduinoGenerator.forBlock['data_showvariable'] = function (block) {

    return ''; // UI only, no Arduino code

};



arduinoGenerator.forBlock['data_hidevariable'] = function (block) {

    return ''; // UI only, no Arduino code

};



// ═══════════════════════════════════════════════════════════════════════════

// TABLES (Serial Proxy for Arduino)

// ═══════════════════════════════════════════════════════════════════════════



arduinoGenerator.forBlock['data_tablecontents'] = function (block) {

    const { name } = getVarInfo(block);

    return [`String("TABLE:") + String("${name}")`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['data_setintable'] = function (block, generator) {

    const { name } = getVarInfo(block);

    const col = generator.valueToCode(block, 'COLUMN', ORDER_NONE) || '""';

    const row = generator.valueToCode(block, 'ROW', ORDER_NONE) || '1';

    const value = generator.valueToCode(block, 'VALUE', ORDER_NONE) || '""';

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.print("TABLE_SET:${name},"); Serial.print(${col}); Serial.print(","); Serial.print(${row}); Serial.print(","); Serial.println(${value});\n`;

};



arduinoGenerator.forBlock['data_addcolumn'] = function (block, generator) {

    const { name } = getVarInfo(block);

    const col = generator.valueToCode(block, 'COLUMN', ORDER_NONE) || '""';

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.print("TABLE_ADD_COL:${name},"); Serial.println(${col});\n`;

};



arduinoGenerator.forBlock['data_deletecolumn'] = function (block, generator) {

    const { name } = getVarInfo(block);

    const col = generator.valueToCode(block, 'COLUMN', ORDER_NONE) || '""';

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.print("TABLE_DEL_COL:${name},"); Serial.println(${col});\n`;

};



arduinoGenerator.forBlock['data_getvalueattable'] = function (block, generator) {

    const { name } = getVarInfo(block);

    const col = generator.valueToCode(block, 'COLUMN', ORDER_NONE) || '""';

    const row = generator.valueToCode(block, 'ROW', ORDER_NONE) || '1';

    return [`String("VAL_AT:") + String("${name}")`, ORDER_ATOMIC]; // Placeholder for C++ side retrieval

};



arduinoGenerator.forBlock['data_showtable'] = function (block) {

    const { name } = getVarInfo(block);

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.println("TABLE_SHOW:${name}");\n`;

};



arduinoGenerator.forBlock['data_hidetable'] = function (block) {

    const { name } = getVarInfo(block);

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.println("TABLE_HIDE:${name}");\n`;

};



arduinoGenerator.forBlock['data_deleterow'] = function (block, generator) {

    const { name } = getVarInfo(block);

    const row = generator.valueToCode(block, 'ROW', ORDER_NONE) || '1';

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.print("TABLE_DEL_ROW:${name},"); Serial.println(${row});\n`;

};



arduinoGenerator.forBlock['data_cleartable'] = function (block) {

    const { name } = getVarInfo(block);

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.println("TABLE_CLEAR:${name}");\n`;

};



arduinoGenerator.forBlock['data_gettablecount'] = function (block) {

    const { name } = getVarInfo(block);

    const type = block.getFieldValue('TYPE');

    return [`0`, ORDER_ATOMIC]; // Placeholder

};



arduinoGenerator.forBlock['data_exporttable'] = function (block) {

    const { name } = getVarInfo(block);

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.println("TABLE_EXPORT:${name}");\n`;

};



arduinoGenerator.forBlock['data_gettimestamp'] = function () {

    return [`String(millis())`, ORDER_ATOMIC];

};



// ═══════════════════════════════════════════════════════════════════════════

// SERIAL

// ═══════════════════════════════════════════════════════════════════════════

arduinoGenerator.forBlock['arduino_serial_begin'] = function (block) {

    const baud = block.getFieldValue('BAUD') || '9600';

    log('arduino_serial_begin', 'Generating', { baud });

    (arduinoGenerator as any).addSetup('serial_begin', `  Serial.begin(${baud});`);

    // NOTE: setup injection (finish()) already emits this line inside
    // void setup(). Returning it inline as well produced
    // Serial.begin x2/x3. So emit nothing here.

    return '';

};



arduinoGenerator.forBlock['arduino_serial_print'] = function (block, generator) {

    const text = generator.valueToCode(block, 'TEXT', ORDER_NONE) || '""';

    log('arduino_serial_print', 'Generating', { text });

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.print(${text});\n`;

};



arduinoGenerator.forBlock['arduino_serial_println'] = function (block, generator) {

    const text = generator.valueToCode(block, 'TEXT', ORDER_NONE) || '""';

    log('arduino_serial_println', 'Generating', { text });

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.println(${text});\n`;

};



arduinoGenerator.forBlock['arduino_serial_print_labeled'] = function (block, generator) {

    const label = generator.valueToCode(block, 'LABEL', ORDER_ATOMIC) || '"label: "';

    const value = generator.valueToCode(block, 'VALUE', ORDER_ATOMIC) || '0';

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return `  Serial.print(${label});\n  Serial.println(${value});\n`;

};



arduinoGenerator.forBlock['arduino_serial_available'] = function () {

    log('arduino_serial_available', 'Generating');

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return [`Serial.available()`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_serial_read'] = function () {

    log('arduino_serial_read', 'Generating');

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    return [`Serial.read()`, ORDER_ATOMIC];

};



// Advanced Communication Generators

arduinoGenerator.forBlock['arduino_bluetooth_serial_begin'] = function (block) {

    const baud = block.getFieldValue('BAUD');

    (arduinoGenerator as any).addDefinition('bt_serial_include', '#ifdef ARDUINO_ARCH_ESP32\n#include "BluetoothSerial.h"\n#endif');

    (arduinoGenerator as any).addDefinition('bt_serial_def', '#ifdef ARDUINO_ARCH_ESP32\nBluetoothSerial SerialBT;\n#endif');

    (arduinoGenerator as any).addSetup('bt_serial_begin', `#ifdef ARDUINO_ARCH_ESP32\n  SerialBT.begin("LeapBlocks_ESP32");\n#else\n  // Bluetooth Serial only supported on ESP32\n#endif\n  // Baud ${baud} ignored by BT Serial normally but kept for compatibility`);

    return '';

};



const getSerialPortName = (port: string) => {

    return port === '0' ? 'Serial' : `Serial${port}`;

};



arduinoGenerator.forBlock['arduino_serial_multi_write'] = function (block, generator) {

    const value = generator.valueToCode(block, 'VALUE', ORDER_NONE) || '""';

    (arduinoGenerator as any).addSetupIfMissing('serial_begin', '  Serial.begin(9600);');

    log('arduino_serial_multi_write', 'Generating', { value });

    return `  Serial.println(${value});\n`;

};



// ═══════════════════════════════════════════════════════════════════════════

// OPERATORS

// ═══════════════════════════════════════════════════════════════════════════

arduinoGenerator.forBlock['arduino_math_add'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_ADDITIVE) || '0';

    const b = generator.valueToCode(block, 'B', ORDER_ADDITIVE) || '0';

    log('arduino_math_add', 'Generating', { a, b });

    return [`(${a} + ${b})`, ORDER_ADDITIVE];

};



arduinoGenerator.forBlock['arduino_math_subtract'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_ADDITIVE) || '0';

    const b = generator.valueToCode(block, 'B', ORDER_ADDITIVE) || '0';

    log('arduino_math_subtract', 'Generating', { a, b });

    return [`(${a} - ${b})`, ORDER_ADDITIVE];

};



arduinoGenerator.forBlock['arduino_math_multiply'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_MULTIPLICATIVE) || '0';

    const b = generator.valueToCode(block, 'B', ORDER_MULTIPLICATIVE) || '0';

    log('arduino_math_multiply', 'Generating', { a, b });

    return [`(${a} * ${b})`, ORDER_MULTIPLICATIVE];

};



arduinoGenerator.forBlock['arduino_math_divide'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_MULTIPLICATIVE) || '0';

    const b = generator.valueToCode(block, 'B', ORDER_MULTIPLICATIVE) || '1';

    log('arduino_math_divide', 'Generating', { a, b });

    return [`(${a} / ${b})`, ORDER_MULTIPLICATIVE];

};



arduinoGenerator.forBlock['arduino_random'] = function (block) {

    const min = block.getFieldValue('MIN');

    const max = block.getFieldValue('MAX');

    log('arduino_random', 'Generating', { min, max });

    return [`random(${min}, ${max + 1})`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_compare_gt'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_RELATIONAL) || '0';

    const b = generator.valueToCode(block, 'B', ORDER_RELATIONAL) || '0';

    log('arduino_compare_gt', 'Generating', { a, b });

    return [`(${a} > ${b})`, ORDER_RELATIONAL];

};



arduinoGenerator.forBlock['arduino_compare_lt'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_RELATIONAL) || '0';

    const b = generator.valueToCode(block, 'B', ORDER_RELATIONAL) || '0';

    log('arduino_compare_lt', 'Generating', { a, b });

    return [`(${a} < ${b})`, ORDER_RELATIONAL];

};



arduinoGenerator.forBlock['arduino_compare_eq'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_RELATIONAL) || '0';

    const b = generator.valueToCode(block, 'B', ORDER_RELATIONAL) || '0';

    log('arduino_compare_eq', 'Generating', { a, b });

    return [`(${a} == ${b})`, ORDER_RELATIONAL];

};



arduinoGenerator.forBlock['arduino_logic_and'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_LOGICAL_AND) || 'false';

    const b = generator.valueToCode(block, 'B', ORDER_LOGICAL_AND) || 'false';

    log('arduino_logic_and', 'Generating', { a, b });

    return [`(${a} && ${b})`, ORDER_LOGICAL_AND];

};



arduinoGenerator.forBlock['arduino_logic_or'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_LOGICAL_OR) || 'false';

    const b = generator.valueToCode(block, 'B', ORDER_LOGICAL_OR) || 'false';

    log('arduino_logic_or', 'Generating', { a, b });

    return [`(${a} || ${b})`, ORDER_LOGICAL_OR];

};



arduinoGenerator.forBlock['arduino_logic_not'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_UNARY_PREFIX) || 'false';

    log('arduino_logic_not', 'Generating', { a });

    return [`!${a}`, ORDER_UNARY_PREFIX];

};



arduinoGenerator.forBlock['arduino_number'] = function (block) {

    const num = block.getFieldValue('NUM');

    log('arduino_number', 'Generating', { num });

    return [String(num), ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_text'] = function (block) {

    const text = block.getFieldValue('TEXT');

    log('arduino_text', 'Generating', { text });

    return [`"${text}"`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_mod'] = function (block, generator) {

    const a = generator.valueToCode(block, 'A', ORDER_MULTIPLICATIVE) || '0';

    const b = generator.valueToCode(block, 'B', ORDER_MULTIPLICATIVE) || '1';

    log('arduino_mod', 'Generating', { a, b });

    return [`(${a} % ${b})`, ORDER_MULTIPLICATIVE];

};



arduinoGenerator.forBlock['arduino_round'] = function (block, generator) {

    const num = generator.valueToCode(block, 'NUM', ORDER_NONE) || '0';

    log('arduino_round', 'Generating', { num });

    return [`round(${num})`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_abs'] = function (block, generator) {

    const num = generator.valueToCode(block, 'NUM', ORDER_NONE) || '0';

    log('arduino_abs', 'Generating', { num });

    return [`abs(${num})`, ORDER_ATOMIC];

};



// ═══════════════════════════════════════════════════════════════════════════

// ACTUATORS

// ═══════════════════════════════════════════════════════════════════════════

arduinoGenerator.forBlock['arduino_servo'] = function (block) {

    const pin = block.getFieldValue('PIN');

    const angle = block.getFieldValue('ANGLE');



    // Choose library based on architecture

    const libDef = '#ifdef ARDUINO_ARCH_ESP32\n#include <ESP32Servo.h>\n#else\n#include <Servo.h>\n#endif';

    (arduinoGenerator as any).addDefinition('servo_include', libDef);

    (arduinoGenerator as any).addDefinition(`servo_def_${pin}`, `Servo servo_${pin};`);

    (arduinoGenerator as any).addSetup(`servo_attach_${pin}`, `  servo_${pin}.attach(${pin});`);



    log('arduino_servo', 'Generating', { pin, angle });

    return `  servo_${pin}.write(${angle});\n`;

};



arduinoGenerator.forBlock['arduino_motor'] = function (block) {

    const motor = block.getFieldValue('MOTOR');

    const dir = block.getFieldValue('DIR');

    const speed = block.getFieldValue('SPEED');



    // Define a simple motor control if not already defined

    // This is a placeholder for actual shield logic

    const motorDef = `

class Motor {

public:

  void forward(int s) { /* implement for your shield */ }

  void backward(int s) { /* implement for your shield */ }

  void stop() { /* implement for your shield */ }

};

Motor motorA, motorB;

`;

    (arduinoGenerator as any).addDefinition('motor_class', motorDef);



    log('arduino_motor', 'Generating', { motor, dir, speed });

    if (dir === 'stop') {

        return `  motor${motor}.stop();\n`;

    }

    return `  motor${motor}.${dir}(${speed});\n`;

};



arduinoGenerator.forBlock['arduino_led'] = function (block) {

    const pin = block.getFieldValue('PIN');

    const brightness = block.getFieldValue('BRIGHTNESS');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, OUTPUT);`);

    log('arduino_led', 'Generating', { pin, brightness });

    return `  analogWrite(${pin}, ${brightness});\n`;

};



arduinoGenerator.forBlock['arduino_relay'] = function (block) {

    const pin = block.getFieldValue('PIN');

    const state = block.getFieldValue('STATE');

    (arduinoGenerator as any).addSetup(`pinMode_${pin}`, `  pinMode(${pin}, OUTPUT);`);

    log('arduino_relay', 'Generating', { pin, state });

    return `  digitalWrite(${pin}, ${state});\n`;

};



// ═══════════════════════════════════════════════════════════════════════════

// SENSORS

// ═══════════════════════════════════════════════════════════════════════════

arduinoGenerator.forBlock['arduino_ultrasonic'] = function (block, generator) {

    const trig = block.getFieldValue('TRIG');

    const echo = block.getFieldValue('ECHO');



    const functionName = '_readUltrasonicDistance';

    // Use pulseInLong() instead of pulseIn() — pulseIn() is unreliable on ESP32

    // because FreeRTOS task switches interrupt the timing and cause it to return 0.

    // pulseInLong() uses interrupts internally and works correctly on ESP32.

    const functionDef = [

        'float ' + functionName + '(int trigPin, int echoPin) {',

        '  pinMode(trigPin, OUTPUT);',

        '  pinMode(echoPin, INPUT);',

        '  digitalWrite(trigPin, LOW);',

        '  delayMicroseconds(4);',

        '  digitalWrite(trigPin, HIGH);',

        '  delayMicroseconds(10);',

        '  digitalWrite(trigPin, LOW);',

        '  long duration = pulseInLong(echoPin, HIGH, 38000UL); // interrupt-safe, 38ms timeout',

        '  if (duration == 0) return 0.0; // no echo / out of range',

        '  return (float)duration / 58.2; // convert microseconds to cm',

        '}'

    ].join('\n');



    (generator as any).addDefinition('ultrasonic_distance', functionDef);



    return [`${functionName}(${trig}, ${echo})`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_dht_temp'] = function (block) {

    const type = block.getFieldValue('TYPE');

    const pin = block.getFieldValue('PIN');

    (arduinoGenerator as any).addDefinition('dht_include', '#include "DHT.h"');

    (arduinoGenerator as any).addDefinition(`dht_def_${pin}`, `DHT dht_${pin}(${pin}, DHT11);`);

    (arduinoGenerator as any).addSetup(`dht_begin_${pin}`, `  dht_${pin}.begin();`);



    log('arduino_dht_temp', 'Generating', { type, pin });

    return [`dht_${pin}.read${type === 'temperature' ? 'Temperature' : 'Humidity'}()`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_button'] = function (block) {

    const pin = block.getFieldValue('PIN');

    log('arduino_button', 'Generating', { pin });

    return [`((digitalRead(${pin}) == LOW) ? 1 : 0)`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_ldr'] = function (block) {

    const pin = block.getFieldValue('PIN');

    log('arduino_ldr', 'Generating', { pin });

    return [`analogRead(${pin})`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_potentiometer'] = function (block) {

    const pin = block.getFieldValue('PIN');

    log('arduino_potentiometer', 'Generating', { pin });

    return [`analogRead(${pin})`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['arduino_pir'] = function (block) {

    const pin = block.getFieldValue('PIN');

    log('arduino_pir', 'Generating', { pin });

    return [`((digitalRead(${pin}) == HIGH) ? 1 : 0)`, ORDER_ATOMIC];

};



console.log('[GENERATOR] All block generators registered');



// Map ESP32 blocks to existing Arduino generators

const esp32Mappings = [

    'setup', 'digital_write', 'digital_read', 'analog_read',

    'tone', 'notone', 'servo', 'led', 'relay', 'ultrasonic',

    'dht_temp', 'button', 'ldr', 'potentiometer', 'pir', 'digital_sensor',

    // Serial blocks — required for "set baud rate" and "write to serial" in ESP32 mode

    'serial_begin', 'serial_print', 'serial_println', 'serial_print_labeled',

    'serial_available', 'serial_read',

    // Math/logic blocks used in ESP32 toolbox

    'delay', 'repeat', 'if', 'if_else', 'wait_until', 'repeat_until', 'stop',

    'map', 'constrain', 'millis', 'math_add', 'math_subtract', 'math_multiply',

    'math_divide', 'mod', 'round', 'abs', 'random',

    'compare_gt', 'compare_lt', 'compare_eq', 'logic_and', 'logic_or', 'logic_not',

    'number', 'text', 'motor',

];



esp32Mappings.forEach(name => {

    arduinoGenerator.forBlock[`esp32_${name}`] = arduinoGenerator.forBlock[`arduino_${name}`];

});



// New Custom ESP32 Generators



arduinoGenerator.forBlock['esp32_pwm_write'] = function (block: any) {

    const pin = block.getFieldValue('PIN');

    const value = arduinoGenerator.valueToCode(block, 'VALUE', ORDER_ATOMIC) || '0';

    (arduinoGenerator as any).addSetup(`pwm_mode_${pin}`, `pinMode(${pin}, OUTPUT);`);

    return `analogWrite(${pin}, ${value});\n`;

};



arduinoGenerator.forBlock['esp32_touch_read'] = function (block: any) {

    const pin = block.getFieldValue('PIN');

    return [`touchRead(${pin})`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['esp32_hall_read'] = function (block: any) {

    return [`hallRead()`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['esp32_mac_address'] = function (block: any) {

    (arduinoGenerator as any).addDefinition('wifi_include', '#ifdef ARDUINO_ARCH_ESP32\n#include <WiFi.h>\n#endif');

    return [`WiFi.macAddress()`, ORDER_ATOMIC];

};



arduinoGenerator.forBlock['esp32_map'] = function (block: any) {

    const value = arduinoGenerator.valueToCode(block, 'VALUE', ORDER_ATOMIC) || '0';

    const inMin = arduinoGenerator.valueToCode(block, 'IN_MIN', ORDER_ATOMIC) || '0';

    const inMax = arduinoGenerator.valueToCode(block, 'IN_MAX', ORDER_ATOMIC) || '255';

    const outMin = arduinoGenerator.valueToCode(block, 'OUT_MIN', ORDER_ATOMIC) || '0';

    const outMax = arduinoGenerator.valueToCode(block, 'OUT_MAX', ORDER_ATOMIC) || '1023';

    return [`map(${value}, ${inMin}, ${inMax}, ${outMin}, ${outMax})`, ORDER_ATOMIC];

};

// ── ESP32 Sensor / Actuator Generators ───────────────────────────────────────

arduinoGenerator.forBlock['esp32_tone'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    const freq = block.getFieldValue('FREQ');
    (arduinoGenerator as any).addSetup(`tone_mode_${pin}`, `pinMode(${pin}, OUTPUT);`);
    return `tone(${pin}, ${freq});\n`;
};

arduinoGenerator.forBlock['esp32_notone'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    return `noTone(${pin});\n`;
};

arduinoGenerator.forBlock['esp32_servo'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    const angle = block.getFieldValue('ANGLE');
    (arduinoGenerator as any).addDefinition('servo_include', '#include <ESP32Servo.h>');
    (arduinoGenerator as any).addDefinition(`servo_obj_${pin}`, `Servo _servo${pin};`);
    (arduinoGenerator as any).addSetup(`servo_attach_${pin}`, `_servo${pin}.attach(${pin});`);
    return `_servo${pin}.write(${angle});\n`;
};

arduinoGenerator.forBlock['esp32_led'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    const brightness = block.getFieldValue('BRIGHTNESS');
    (arduinoGenerator as any).addSetup(`led_mode_${pin}`, `pinMode(${pin}, OUTPUT);`);
    return `analogWrite(${pin}, ${brightness});\n`;
};

arduinoGenerator.forBlock['esp32_relay'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    const state = block.getFieldValue('STATE');
    (arduinoGenerator as any).addSetup(`relay_mode_${pin}`, `pinMode(${pin}, OUTPUT);`);
    return `digitalWrite(${pin}, ${state});\n`;
};

arduinoGenerator.forBlock['esp32_ultrasonic'] = function (block: any) {
    const trig = block.getFieldValue('TRIG');
    const echo = block.getFieldValue('ECHO');
    (arduinoGenerator as any).addDefinition('ultrasonic_fn',
        `float _ultrasonicRead(int trig, int echo) {\n` +
        `  pinMode(trig, OUTPUT); digitalWrite(trig, LOW); delayMicroseconds(2);\n` +
        `  digitalWrite(trig, HIGH); delayMicroseconds(10); digitalWrite(trig, LOW);\n` +
        `  pinMode(echo, INPUT);\n` +
        `  return pulseInLong(echo, HIGH) / 58.2;\n` +
        `}`
    );
    return [`_ultrasonicRead(${trig}, ${echo})`, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_dht_temp'] = function (block: any) {
    const type = block.getFieldValue('TYPE');   // 'temperature' | 'humidity'
    const sensorType = block.getFieldValue('SENSOR_TYPE') || '22'; // '11' or '22'
    const pin = block.getFieldValue('PIN');
    (arduinoGenerator as any).addDefinition('dht_include', '#include <DHT.h>');
    (arduinoGenerator as any).addDefinition(`dht_obj_${pin}`, `DHT _dht${pin}(${pin}, DHT${sensorType});`);
    (arduinoGenerator as any).addSetup(`dht_begin_${pin}`, `_dht${pin}.begin();`);
    const call = type === 'temperature'
        ? `_dht${pin}.readTemperature()`
        : `_dht${pin}.readHumidity()`;
    return [call, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_button'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    (arduinoGenerator as any).addSetup(`btn_mode_${pin}`, `pinMode(${pin}, INPUT_PULLUP);`);
    return [`(digitalRead(${pin}) == LOW)`, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_ldr'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    return [`analogRead(${pin})`, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_potentiometer'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    return [`analogRead(${pin})`, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_pir'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    (arduinoGenerator as any).addSetup(`pir_mode_${pin}`, `pinMode(${pin}, INPUT);`);
    return [`(digitalRead(${pin}) == HIGH)`, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_ir_obstacle'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    (arduinoGenerator as any).addSetup(`ir_mode_${pin}`, `pinMode(${pin}, INPUT);`);
    return [`(digitalRead(${pin}) == LOW)`, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_digital_sensor'] = function (block: any) {
    const pin = block.getFieldValue('PIN');
    (arduinoGenerator as any).addSetup(`dsensor_mode_${pin}`, `pinMode(${pin}, INPUT);`);
    return [`(digitalRead(${pin}) == HIGH)`, ORDER_ATOMIC];
};

// ── ESP32 WiFi Generators ─────────────────────────────────────────────────────

arduinoGenerator.forBlock['esp32_wifi_connect'] = function (block: any) {
    const ssid = arduinoGenerator.valueToCode(block, 'SSID', ORDER_ATOMIC) || '""';
    const pass = arduinoGenerator.valueToCode(block, 'PASSWORD', ORDER_ATOMIC) || '""';
    (arduinoGenerator as any).addDefinition('wifi_include', '#include <WiFi.h>');
    return `WiFi.begin(${ssid}, ${pass});\nwhile (WiFi.status() != WL_CONNECTED) { delay(500); }\n`;
};

arduinoGenerator.forBlock['esp32_wifi_connected'] = function (_block: any) {
    (arduinoGenerator as any).addDefinition('wifi_include', '#include <WiFi.h>');
    return [`(WiFi.status() == WL_CONNECTED)`, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_wifi_ip'] = function (_block: any) {
    (arduinoGenerator as any).addDefinition('wifi_include', '#include <WiFi.h>');
    return [`WiFi.localIP().toString()`, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_wifi_disconnect'] = function (_block: any) {
    (arduinoGenerator as any).addDefinition('wifi_include', '#include <WiFi.h>');
    return `WiFi.disconnect();\n`;
};

// ── ESP32 HTTP Generators ─────────────────────────────────────────────────────

arduinoGenerator.forBlock['esp32_http_get'] = function (block: any) {
    const url = arduinoGenerator.valueToCode(block, 'URL', ORDER_ATOMIC) || '""';
    (arduinoGenerator as any).addDefinition('wifi_include', '#include <WiFi.h>');
    (arduinoGenerator as any).addDefinition('http_include', '#include <HTTPClient.h>');
    return [
        `([]() -> String {\n` +
        `  HTTPClient http;\n` +
        `  http.begin(${url});\n` +
        `  int code = http.GET();\n` +
        `  String body = (code > 0) ? http.getString() : "";\n` +
        `  http.end();\n` +
        `  return body;\n` +
        `})()`,
        ORDER_ATOMIC
    ];
};

arduinoGenerator.forBlock['esp32_http_post'] = function (block: any) {
    const url = arduinoGenerator.valueToCode(block, 'URL', ORDER_ATOMIC) || '""';
    const body = arduinoGenerator.valueToCode(block, 'BODY', ORDER_ATOMIC) || '""';
    (arduinoGenerator as any).addDefinition('wifi_include', '#include <WiFi.h>');
    (arduinoGenerator as any).addDefinition('http_include', '#include <HTTPClient.h>');
    return `{\n  HTTPClient http;\n  http.begin(${url});\n  http.addHeader("Content-Type", "application/json");\n  http.POST(${body});\n  http.end();\n}\n`;
};

arduinoGenerator.forBlock['esp32_http_status'] = function (block: any) {
    const url = arduinoGenerator.valueToCode(block, 'URL', ORDER_ATOMIC) || '""';
    (arduinoGenerator as any).addDefinition('wifi_include', '#include <WiFi.h>');
    (arduinoGenerator as any).addDefinition('http_include', '#include <HTTPClient.h>');
    return [
        `([]() -> int {\n  HTTPClient http;\n  http.begin(${url});\n  int c = http.GET();\n  http.end();\n  return c;\n})()`,
        ORDER_ATOMIC
    ];
};

// ── ESP32 MQTT Generators ─────────────────────────────────────────────────────

arduinoGenerator.forBlock['esp32_mqtt_connect'] = function (block: any) {
    const broker = arduinoGenerator.valueToCode(block, 'BROKER', ORDER_ATOMIC) || '"broker.hivemq.com"';
    const port = block.getFieldValue('PORT') || '1883';
    const clientId = arduinoGenerator.valueToCode(block, 'CLIENT_ID', ORDER_ATOMIC) || '"esp32client"';
    (arduinoGenerator as any).addDefinition('wifi_include', '#include <WiFi.h>');
    (arduinoGenerator as any).addDefinition('mqtt_include', '#include <PubSubClient.h>');
    (arduinoGenerator as any).addDefinition('mqtt_client_obj',
        `WiFiClient _wifiClient;\nPubSubClient _mqttClient(_wifiClient);`);
    (arduinoGenerator as any).addSetup('mqtt_server',
        `_mqttClient.setServer(${broker}, ${port});`);
    return `if (!_mqttClient.connected()) {\n  _mqttClient.connect(${clientId});\n}\n_mqttClient.loop();\n`;
};

arduinoGenerator.forBlock['esp32_mqtt_publish'] = function (block: any) {
    const topic = arduinoGenerator.valueToCode(block, 'TOPIC', ORDER_ATOMIC) || '""';
    const payload = arduinoGenerator.valueToCode(block, 'PAYLOAD', ORDER_ATOMIC) || '""';
    (arduinoGenerator as any).addDefinition('mqtt_include', '#include <PubSubClient.h>');
    return `_mqttClient.publish(${topic}, ${payload});\n`;
};

arduinoGenerator.forBlock['esp32_mqtt_subscribe'] = function (block: any) {
    const topic = arduinoGenerator.valueToCode(block, 'TOPIC', ORDER_ATOMIC) || '""';
    (arduinoGenerator as any).addDefinition('mqtt_include', '#include <PubSubClient.h>');
    return `_mqttClient.subscribe(${topic});\n`;
};

arduinoGenerator.forBlock['esp32_mqtt_loop'] = function (_block: any) {
    (arduinoGenerator as any).addDefinition('mqtt_include', '#include <PubSubClient.h>');
    return `_mqttClient.loop();\n`;
};

arduinoGenerator.forBlock['esp32_mqtt_connected'] = function (_block: any) {
    (arduinoGenerator as any).addDefinition('mqtt_include', '#include <PubSubClient.h>');
    return [`_mqttClient.connected()`, ORDER_ATOMIC];
};

// ── ESP32 WebSocket Generators ────────────────────────────────────────────────

arduinoGenerator.forBlock['esp32_ws_connect'] = function (block: any) {
    const host = arduinoGenerator.valueToCode(block, 'HOST', ORDER_ATOMIC) || '"echo.websocket.org"';
    const port = block.getFieldValue('PORT') || '80';
    const path = arduinoGenerator.valueToCode(block, 'PATH', ORDER_ATOMIC) || '"/"';
    (arduinoGenerator as any).addDefinition('ws_include', '#include <WebSocketsClient.h>');
    (arduinoGenerator as any).addDefinition('ws_obj', 'WebSocketsClient _wsClient;');
    (arduinoGenerator as any).addSetup('ws_begin', `_wsClient.begin(${host}, ${port}, ${path});`);
    return `_wsClient.loop();\n`;
};

arduinoGenerator.forBlock['esp32_ws_send'] = function (block: any) {
    const msg = arduinoGenerator.valueToCode(block, 'MESSAGE', ORDER_ATOMIC) || '""';
    (arduinoGenerator as any).addDefinition('ws_include', '#include <WebSocketsClient.h>');
    return `_wsClient.sendTXT(${msg});\n`;
};

arduinoGenerator.forBlock['esp32_ws_connected'] = function (_block: any) {
    (arduinoGenerator as any).addDefinition('ws_include', '#include <WebSocketsClient.h>');
    return [`_wsClient.isConnected()`, ORDER_ATOMIC];
};

arduinoGenerator.forBlock['esp32_ws_loop'] = function (_block: any) {
    (arduinoGenerator as any).addDefinition('ws_include', '#include <WebSocketsClient.h>');
    return `_wsClient.loop();\n`;
};

