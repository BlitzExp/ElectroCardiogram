# CardioScope

CardioScope is a browser-based ECG monitor for newline-delimited samples sent by an ESP32 over USB serial. It includes a synthetic demo signal, a real-time Canvas waveform, basic heart-rate estimation, gain and sweep controls, and connection feedback.

> Visualization only. This project is not a diagnostic medical device.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in desktop Chrome or Edge. The Web Serial API is only available in supported Chromium browsers and requires a secure context (`https://` or localhost).

## Serial data format

The app opens the selected port at **115200 baud** and expects one numeric sample per line:

```text
2048
2054
2108
```

CSV-style lines also work; the final numeric field is used:

```text
1712345678,2048
1712345682,2054
```

The waveform and BPM detector currently assume a sample rate of **250 Hz**. The serial monitor and CardioScope cannot open the same USB port at the same time.

## ESP8266 / ESP32 test sketch

This sketch sends a repeating synthetic ECG-like pulse at 250 samples per second:

```cpp
const int sampleRate = 250;
const int beatSamples = 208; // About 72 BPM
int sampleIndex = 0;

float pulse(int x, int center, float width, float amplitude) {
  float distance = (x - center) / width;
  return amplitude * exp(-0.5 * distance * distance);
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  int phase = sampleIndex % beatSamples;
  float value = 2048
    + pulse(phase, 38, 6, 100)
    - pulse(phase, 77, 2, 150)
    + pulse(phase, 83, 2, 1000)
    - pulse(phase, 90, 3, 260)
    + pulse(phase, 139, 11, 210);

  Serial.println((int)value);
  sampleIndex++;
  delayMicroseconds(1000000 / sampleRate);
}
```

For the NodeMCU ESP8266 shown above, upload [`firmware/esp8266_mock_ecg/esp8266_mock_ecg.ino`](firmware/esp8266_mock_ecg/esp8266_mock_ecg.ino) with **NodeMCU 1.0 (ESP-12E Module)** selected. Then close the Arduino Serial Monitor, open CardioScope, select **Connect USB**, and choose the USB serial port.
