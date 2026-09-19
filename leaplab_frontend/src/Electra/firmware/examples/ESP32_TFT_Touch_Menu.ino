/**
 * ESP32 TFT Touch Menu Example
 *
 * Touch menu on a 2.8" SPI TFT (ILI9341) with an FT6206 capacitive
 * touchscreen. The main menu toggles the ESP32 built-in LED and opens a
 * Sensor Info page whose BACK button returns to the main menu.
 *
 * Hardware:
 * - ESP32-C3 board
 * - ILI9341 TFT Display (SPI) + FT6206 Touch (I2C)
 *
 * Circuit Connections (wired in the simulator or physically):
 * - TFT VCC  -> 3.3V / 5V
 * - TFT GND  -> GND
 * - TFT CS   -> GPIO 5
 * - TFT RST  -> GPIO 4
 * - TFT D/C  -> GPIO 2
 * - TFT MOSI -> GPIO 23 (SPI MOSI)
 * - TFT SCK  -> GPIO 18 (SPI SCK)
 * - TFT LED  -> 3.3V
 * - TFT MISO -> GPIO 19 (SPI MISO)
 * - TFT SDA  -> GPIO 21 (I2C SDA)
 * - TFT SCL  -> GPIO 22 (I2C SCL)
 *
 * COORDINATES: the panel is driven in its native 240x320 portrait frame and
 * the FT6206 reports points with the origin at the bottom-right, so the raw
 * point MUST be converted to the top-left drawing space before hit-testing.
 * Without that conversion the buttons are tested against the wrong region and
 * taps (including the Sensor Info BACK button) are silently ignored.
 *
 * Every button rectangle below is defined once and used for BOTH drawing and
 * hit-testing so the visible button and its touch region can never drift apart.
 */

#include <SPI.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Adafruit_FT6206.h>

// TFT pins
#define TFT_CS   5
#define TFT_DC   2
#define TFT_RST  4

// Built-in LED (ESP32-C3). GPIO 2 is taken by TFT D/C, so use GPIO 8.
#define LED_PIN  8

Adafruit_ILI9341 tft(TFT_CS, TFT_DC, TFT_RST);
Adafruit_FT6206 ctp;

// ── Button rectangles {x, y, width, height} in portrait pixels ──────────
int BTN_HOME[4]     = {20, 56, 200, 48};
int BTN_LED_ON[4]   = {20, 116, 200, 48};
int BTN_LED_OFF[4]  = {20, 176, 200, 48};
int BTN_INFO[4]     = {20, 236, 200, 48};
int BTN_BACK[4]     = {20, 240, 200, 48};

#define SCREEN_MAIN 0
#define SCREEN_INFO 1
int currentScreen = SCREEN_MAIN;

void drawMainMenu();
void drawSensorInfo();
void drawButton(int *b, unsigned int color, const char *text);
void showStatus(const char *msg, unsigned int color);

// Shared hit-test — x/y inclusive on the top-left, exclusive on the bottom-right
bool hit(int *b, int x, int y)
{
  return x >= b[0] && x < (b[0] + b[2]) && y >= b[1] && y < (b[1] + b[3]);
}

void setup()
{
  Serial.begin(115200);
  Serial.println("Starting TFT Touch Menu...");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  tft.begin();
  tft.setRotation(0); // Portrait 240x320 (matches the native frame buffer)
  tft.fillScreen(ILI9341_BLACK);

  if (!ctp.begin(40))
  {
    Serial.println("Touch controller FT6206 not found!");
    tft.setTextColor(ILI9341_RED);
    tft.setTextSize(2);
    tft.setCursor(20, 100);
    tft.print("Touch Not Found");
    while (1)
    {
      delay(10);
    }
  }

  Serial.println("TFT touch screen initialized.");
  drawMainMenu();
}

void loop()
{
  if (!ctp.touched())
    return;

  TS_Point p = ctp.getPoint();

  // Convert the raw FT6206 point (origin bottom-right) into the display's
  // top-left pixel space so (x, y) matches what was drawn on screen.
  int x = tft.width() - 1 - p.x;
  int y = tft.height() - 1 - p.y;

  delay(200); // Simple debounce

  Serial.print("Touch X=");
  Serial.print(x);
  Serial.print(" Y=");
  Serial.println(y);

  if (currentScreen == SCREEN_MAIN)
  {
    if (hit(BTN_HOME, x, y))
    {
      drawMainMenu();
    }
    else if (hit(BTN_LED_ON, x, y))
    {
      digitalWrite(LED_PIN, HIGH);
      showStatus("LED TURNED ON", ILI9341_GREEN);
    }
    else if (hit(BTN_LED_OFF, x, y))
    {
      digitalWrite(LED_PIN, LOW);
      showStatus("LED TURNED OFF", ILI9341_RED);
    }
    else if (hit(BTN_INFO, x, y))
    {
      currentScreen = SCREEN_INFO;
      drawSensorInfo();
    }
  }
  else
  {
    // Sensor Info page: BACK returns to the main menu
    if (hit(BTN_BACK, x, y))
    {
      currentScreen = SCREEN_MAIN;
      drawMainMenu();
    }
  }
}

void drawButton(int *b, unsigned int color, const char *text)
{
  tft.fillRoundRect(b[0], b[1], b[2], b[3], 8, color);
  tft.drawRoundRect(b[0], b[1], b[2], b[3], 8, ILI9341_WHITE);

  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(2);
  tft.setCursor(b[0] + 16, b[1] + 16);
  tft.print(text);
}

void showStatus(const char *msg, unsigned int color)
{
  tft.fillRect(0, 288, 240, 24, ILI9341_BLACK);
  tft.setTextColor(color);
  tft.setTextSize(2);
  tft.setCursor(10, 292);
  tft.print(msg);
}

void drawMainMenu()
{
  tft.fillScreen(ILI9341_BLACK);

  tft.setTextColor(ILI9341_YELLOW);
  tft.setTextSize(3);
  tft.setCursor(38, 14);
  tft.print("MAIN MENU");

  drawButton(BTN_HOME, ILI9341_BLUE, "HOME");
  drawButton(BTN_LED_ON, ILI9341_GREEN, "LED ON");
  drawButton(BTN_LED_OFF, ILI9341_RED, "LED OFF");
  drawButton(BTN_INFO, ILI9341_MAGENTA, "SENSOR INFO");
}

void drawSensorInfo()
{
  tft.fillScreen(ILI9341_BLACK);

  tft.setTextColor(ILI9341_CYAN);
  tft.setTextSize(2);
  tft.setCursor(60, 20);
  tft.print("SENSOR INFO");

  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(2);
  tft.setCursor(20, 70);
  tft.print("Board: ESP32-C3");
  tft.setCursor(20, 100);
  tft.print("Display: ILI9341");
  tft.setCursor(20, 130);
  tft.print("Touch: FT6206");
  tft.setCursor(20, 160);
  tft.print("Status: ONLINE");

  drawButton(BTN_BACK, ILI9341_RED, "BACK");
}
