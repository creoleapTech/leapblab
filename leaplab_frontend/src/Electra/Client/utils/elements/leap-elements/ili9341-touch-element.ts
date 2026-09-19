/**
 * ILI9341 2.8" SPI TFT Display + FT6206 I2C capacitive touchscreen.
 * Simulation element for Electra (Wokwi-compatible approach).
 */
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ElementPin, spi, i2c } from './pin';

// SVG viewBox dimensions (mm)
const SVG_W = 46.5;
const SVG_H = 77.6;

// Scale factor: render at ~3× for a crisp on-screen size
const SCALE = 3;
const PX_W = Math.round(SVG_W * SCALE); // ~140 px
const PX_H = Math.round(SVG_H * SCALE); // ~233 px

// Screen rect in SVG units: x=1.62 y=6.79 w=43.3 h=61.9
// Scaled to CSS pixels for the canvas overlay
const SCREEN_X = Math.round(1.62  * SCALE); //  ~5 px
const SCREEN_Y = Math.round(6.79  * SCALE); // ~20 px
const SCREEN_W = Math.round(43.3  * SCALE); // ~130 px
const SCREEN_H = Math.round(61.9  * SCALE); // ~186 px

// Native pixel resolution of the ILI9341
const NATIVE_W = 240;
const NATIVE_H = 320;

type CanvasCtx = CanvasRenderingContext2D | null | undefined;

@customElement('leap-ili9341-touch')
export class ILI9341TouchElement extends LitElement {
  /** Native screen width (pixels) */
  readonly screenWidth  = NATIVE_W;
  /** Native screen height (pixels) */
  readonly screenHeight = NATIVE_H;

  /**
   * RGBA pixel buffer (240×320×4 bytes).
   */
  @property({ attribute: false, hasChanged: () => true }) imageData: ImageData | null = null;

  @property({ type: Boolean }) flipHorizontal = false;
  @property({ type: Boolean }) flipVertical    = false;
  @property({ type: Number }) rotation         = 0;
  @property({ type: Boolean, reflect: true }) simulating = false;

  /** Rendered element width in CSS pixels */
  readonly width  = PX_W;
  /** Rendered element height in CSS pixels */
  readonly height = PX_H;

  private _canvas: HTMLCanvasElement | null | undefined = undefined;
  private _ctx: CanvasCtx = null;
  private _isTouched = false;
  /** Last reported native touch position — used to ignore duplicate/jitter moves. */
  private _lastNativeX = -1;
  private _lastNativeY = -1;
  private _canvasCTM: DOMMatrix | null = null;

  // 11-pin layout: 9 display SPI + 2 touch I2C (2.54mm pitch)
  readonly pinInfo: ElementPin[] = [
    { name: 'VCC',  x: Math.round(14.34 * SCALE), y: Math.round(76.0 * SCALE), signals: [{ type: 'power', signal: 'VCC' }] },
    { name: 'GND',  x: Math.round(16.88 * SCALE), y: Math.round(76.0 * SCALE), signals: [{ type: 'power', signal: 'GND' }] },
    { name: 'CS',   x: Math.round(19.42 * SCALE), y: Math.round(76.0 * SCALE), signals: [spi('SS')] },
    { name: 'RST',  x: Math.round(21.96 * SCALE), y: Math.round(76.0 * SCALE), signals: [] },
    { name: 'D/C',  x: Math.round(24.50 * SCALE), y: Math.round(76.0 * SCALE), signals: [] },
    { name: 'MOSI', x: Math.round(27.04 * SCALE), y: Math.round(76.0 * SCALE), signals: [spi('MOSI')] },
    { name: 'SCK',  x: Math.round(29.58 * SCALE), y: Math.round(76.0 * SCALE), signals: [spi('SCK')] },
    { name: 'LED',  x: Math.round(32.12 * SCALE), y: Math.round(76.0 * SCALE), signals: [] },
    { name: 'MISO', x: Math.round(34.66 * SCALE), y: Math.round(76.0 * SCALE), signals: [spi('MISO')] },
    { name: 'SDA',  x: Math.round(37.20 * SCALE), y: Math.round(76.0 * SCALE), signals: [i2c('SDA')] },
    { name: 'SCL',  x: Math.round(39.74 * SCALE), y: Math.round(76.0 * SCALE), signals: [i2c('SCL')] },
  ];

  static get styles() {
    return css`
      :host { display: block; }

      :host(:not([simulating])) canvas {
        pointer-events: none;
      }

      .tft-wrap {
        position: relative;
        display: inline-block;
        line-height: 0;
      }

      .tft-wrap svg {
        display: block;
        width:  ${PX_W}px;
        height: ${PX_H}px;
      }

      .tft-wrap canvas {
        position: absolute;
        left:   ${SCREEN_X}px;
        top:    ${SCREEN_Y}px;
        width:  ${SCREEN_W}px;
        height: ${SCREEN_H}px;
        image-rendering: crisp-edges;
        image-rendering: pixelated;
        background: #000;
        cursor: crosshair;
        touch-action: none;
      }
    `;
  }

  constructor() {
    super();
    // Default blank (black) frame
    this.imageData = new ImageData(NATIVE_W, NATIVE_H);
    for (let i = 3; i < this.imageData.data.length; i += 4) {
      this.imageData.data[i] = 255;
    }
  }

  public redraw(): void {
    if (this._ctx && this.imageData) {
      if (!(this.imageData instanceof ImageData)) {
        try {
          const w = (this.imageData as any).width || NATIVE_W;
          const h = (this.imageData as any).height || NATIVE_H;
          const raw = (this.imageData as any).data;
          if (raw) {
            const arr = raw instanceof Uint8ClampedArray ? raw : new Uint8ClampedArray(Object.values(raw));
            this.imageData = new ImageData(arr as any, w, h);
          } else {
            this.imageData = new ImageData(NATIVE_W, NATIVE_H);
          }
        } catch (e) {
          this.imageData = new ImageData(NATIVE_W, NATIVE_H);
        }
      }
      this._ctx.putImageData(this.imageData, 0, 0);
    }
  }

  private _initContext(): void {
    this._canvas = this.shadowRoot?.querySelector('canvas') ?? null;
    this._ctx    = this._canvas?.getContext('2d') ?? null;
  }

  private _updateCanvasCTM(): void {
    if (!this._canvas) {
      this._canvasCTM = null;
      return;
    }
    try {
      // Use getScreenCTM for accurate mapping that accounts for wrapper scale(0.75) and rotate()
      const ctm = (this._canvas as unknown as SVGGraphicsElement).getScreenCTM?.() || (this._canvas as any).getScreenCTM?.();
      if (ctm) {
        this._canvasCTM = (ctm as unknown as DOMMatrix).inverse();
        return;
      }
    } catch {}
    // Fallback: will use getBoundingClientRect in _handlePointerEvent
    this._canvasCTM = null;
  }

  override firstUpdated(): void {
    this._initContext();
    this.redraw();
    this.dispatchEvent(new CustomEvent('canvas-ready', { bubbles: true, composed: true }));
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('imageData') && this.imageData) {
      if (!this._ctx) this._initContext();
      this.redraw();
    }
    if (changed.has('flipHorizontal') || changed.has('flipVertical')) {
      this._applyFlip();
    }
  }

  private _applyFlip(): void {
    if (!this._canvas) return;
    const sx = this.flipHorizontal ? -1 : 1;
    const sy = this.flipVertical   ? -1 : 1;
    this._canvas.style.transform = (sx !== 1 || sy !== 1) ? `scale(${sx}, ${sy})` : '';
  }

  private _onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this._isTouched = true;
    this._lastNativeX = -1;
    this._lastNativeY = -1;
    this._updateCanvasCTM();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this._handlePointerEvent(e, true);
  }

  private _onPointerMove(e: PointerEvent): void {
    e.stopPropagation();
    if (this._isTouched) {
      this._handlePointerEvent(e, true);
    }
  }

  private _onPointerUp(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this._isTouched = false;
    if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
    this._handlePointerEvent(e, false);
  }

  private _handlePointerEvent(e: PointerEvent, isTouched: boolean): void {
    if (!isTouched) {
      this._lastNativeX = -1;
      this._lastNativeY = -1;
      this.dispatchEvent(new CustomEvent('touch-change', {
        detail: { touched: false, x: 0, y: 0 },
        bubbles: true,
        composed: true
      }));
      return;
    }

    // Refresh CTM on every move so pan/zoom/rotate during touch stays accurate
    if (isTouched) this._updateCanvasCTM();

    let offsetX: number, offsetY: number, w: number, h: number;
    if (this._canvasCTM) {
      try {
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(this._canvasCTM as unknown as DOMMatrix);
        offsetX = pt.x;
        offsetY = pt.y;
        w = SCREEN_W;
        h = SCREEN_H;
      } catch {
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        w = rect.width;
        h = rect.height;
      }
    } else {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      w = rect.width;
      h = rect.height;
    }

    // Scale coordinates — FT6206 origin is at bottom-right (Wokwi convention)
    let nativeX = (offsetX / w) * NATIVE_W;
    let nativeY = (offsetY / h) * NATIVE_H;

    // Account for display flip/rotation so touch matches rendered image
    if (this.flipHorizontal) nativeX = NATIVE_W - 1 - nativeX;
    if (this.flipVertical) nativeY = NATIVE_H - 1 - nativeY;
    const rot = ((this.rotation % 360) + 360) % 360;
    if (rot === 90) {
      const tmp = nativeX; nativeX = nativeY; nativeY = NATIVE_W - 1 - tmp;
    } else if (rot === 180) {
      nativeX = NATIVE_W - 1 - nativeX; nativeY = NATIVE_H - 1 - nativeY;
    } else if (rot === 270) {
      const tmp = nativeX; nativeX = NATIVE_H - 1 - nativeY; nativeY = tmp;
    }

    nativeX = Math.max(0, Math.min(NATIVE_W - 1, Math.floor(nativeX)));
    nativeY = Math.max(0, Math.min(NATIVE_H - 1, Math.floor(nativeY)));

    // Ignore duplicate / sub-pixel-jitter move events. Queueing them makes the
    // simulated controller replay stale positions and the UI feel unreliable.
    if (
      this._lastNativeX >= 0 &&
      Math.abs(nativeX - this._lastNativeX) < 2 &&
      Math.abs(nativeY - this._lastNativeY) < 2
    ) {
      return;
    }
    this._lastNativeX = nativeX;
    this._lastNativeY = nativeY;

    this.dispatchEvent(new CustomEvent('touch-change', {
      detail: { touched: true, x: nativeX, y: nativeY },
      bubbles: true,
      composed: true
    }));
  }

  private renderSVG() {
    return html`<svg
      width="${PX_W}"
      height="${PX_H}"
      viewBox="0 0 46.5 77.6"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
    >
      <!-- PCB board -->
      <path
        d="m8.8e-7 3.37e-6v77.6h46.5v-77.6zm43.1 1.78a1.8 1.8 0 0 1 1.8 1.8 1.8 1.8 0 0 1-1.8 1.8 1.8 1.8 0 0 1-1.8-1.8 1.8 1.8 0 0 1 1.8-1.8zm-39.4 0.0946a1.8 1.8 0 0 1 1.8 1.8 1.8 1.8 0 0 1-1.8 1.8 1.8 1.8 0 0 1-1.8-1.8 1.8 1.8 0 0 1 1.8-1.8zm0 70.7a1.8 1.8 0 0 1 1.8 1.8 1.8 1.8 0 0 1-1.8 1.8 1.8 1.8 0 0 1-1.8-1.8 1.8 1.8 0 0 1 1.8-1.8zm39.4 0.0946a1.8 1.8 0 0 1 1.8 1.8 1.8 1.8 0 0 1-1.8 1.8 1.8 1.8 0 0 1-1.8-1.8 1.8 1.8 0 0 1 1.8-1.8zm-31 2.68h1.41v1.34h-1.41zm2.53 0h1.41v1.34h-1.41zm2.56 0h1.41v1.34h-1.41zm2.54 0h1.41v1.34h-1.41zm12.7 0h1.41v1.34h-1.41zm-10.1 0.0119h1.41v1.34h-1.41zm2.54 0.0119h1.41v1.34h-1.41zm5.08 0h1.41v1.34h-1.41zm-2.53 0.0114h1.41v1.34h-1.41z"
        fill="#931917"
        stroke-width="0"
      />

      <!-- LCD panel background -->
      <path d="m0.17 5.65v64.6h46.1v-64.6zm6.46 62.9h34.7v1.7h-34.7z" fill="#f6e1f1" />

      <!-- Backlight strip -->
      <rect x="11.2" y="66.7" width="24.2" height="6.24" rx="1" ry="1" fill="#bdab16" opacity=".4" />

      <!-- Active screen area (canvas overlays this) -->
      <rect x="1.62" y="6.79" width="43.3" height="61.9" fill="#000" />

      <!-- Pin header outline (11 pins width = ~27.9) -->
      <rect x="13.3" y="74.6" width="27.9" height="2.83" fill="none" stroke="#fff" stroke-width=".27" />

      <!-- Pin circles -->
      <g fill="#ccc">
        <path d="m14.34 75v1.99h1.98v-1.99zm0.988 0.397a0.6 0.6 0 0 1 0.0041 0 0.6 0.6 0 0 1 0.6 0.6 0.6 0.6 0 0 1-0.6 0.6 0.6 0.6 0 0 1-0.6-0.6 0.6 0.6 0 0 1 0.596-0.6z" />
        <path
          id="ili-pin"
          d="m17.88 75a1 1 0 0 0-0.987 1 1 1 0 0 0 1 1 1 1 0 0 0 1-1 1 1 0 0 0-1-1 1 1 0 0 0-0.0134 0zm0.0093 0.4a0.6 0.6 0 0 1 0.0041 0 0.6 0.6 0 0 1 0.6 0.6 0.6 0.6 0 0 1-0.6 0.6 0.6 0.6 0 0 1-0.6-0.6 0.6 0.6 0 0 1 0.596-0.6z"
        />
        <use xlink:href="#ili-pin" x="2.54" />
        <use xlink:href="#ili-pin" x="5.08" />
        <use xlink:href="#ili-pin" x="7.62" />
        <use xlink:href="#ili-pin" x="10.16" />
        <use xlink:href="#ili-pin" x="12.7" />
        <use xlink:href="#ili-pin" x="15.24" />
        <use xlink:href="#ili-pin" x="17.78" />
        <use xlink:href="#ili-pin" x="20.32" />
        <use xlink:href="#ili-pin" x="22.86" />
      </g>

      <!-- Labels -->
      <text font-family="monospace" font-size="3.5px" fill="#fff">
        <tspan x="10.8" y="76.9">1</tspan>
        <tspan x="40.2" y="76.9">11</tspan>
        <tspan x="11.2" y="4.3" font-size="4.0px">ILI9341+Touch</tspan>
      </text>
    </svg>`;
  }

  override render() {
    return html`
      <div class="tft-wrap">
        ${this.renderSVG()}
        <canvas
          width="${NATIVE_W}"
          height="${NATIVE_H}"
          @pointerdown=${this._onPointerDown}
          @pointermove=${this._onPointerMove}
          @pointerup=${this._onPointerUp}
          @pointerleave=${this._onPointerUp}
          @pointercancel=${this._onPointerUp}
        ></canvas>
      </div>
    `;
  }
}
