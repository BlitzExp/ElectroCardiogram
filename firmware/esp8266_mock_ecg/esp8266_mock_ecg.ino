// CardioScope mock ECG sender for a NodeMCU ESP8266 (ESP-12E).
// Sends one numeric sample per line at 115200 baud / 250 Hz.
// This is synthetic data for visualization only, not medical data.

const uint16_t SAMPLE_RATE = 250;
const uint16_t BEAT_SAMPLES = 208; // ~72 BPM at 250 samples per second

uint16_t sampleIndex = 0;

float pulse(int x, int center, float width, float amplitude) {
  const float distance = (x - center) / width;
  return amplitude * exp(-0.5f * distance * distance);
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  const int phase = sampleIndex % BEAT_SAMPLES;
  const float value = 2048
    + pulse(phase, 38, 6, 100)    // P wave
    - pulse(phase, 77, 2, 150)    // Q wave
    + pulse(phase, 83, 2, 1000)   // R wave
    - pulse(phase, 90, 3, 260)    // S wave
    + pulse(phase, 139, 11, 210); // T wave

  Serial.println((int)value);
  sampleIndex++;
  delayMicroseconds(1000000UL / SAMPLE_RATE);
}
