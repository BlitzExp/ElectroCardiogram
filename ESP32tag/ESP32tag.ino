// Mock ECG sender for NodeMCU ESP8266 (ESP-12E)
// Visualization/demo data only — not medical data.

const uint16_t SAMPLE_RATE = 250;
const unsigned long NORMAL_DURATION_MS = 30000;   // 30 seconds
const unsigned long FLATLINE_DURATION_MS = 10000; // 10 seconds

enum Mode {
  NORMAL_RHYTHM,
  FINAL_BEAT,
  FLATLINE
};

Mode mode = NORMAL_RHYTHM;

uint16_t sampleInBeat = 0;
uint16_t beatLength = 375;
unsigned long modeStartedAt = 0;

float pulse(int x, int center, float width, float amplitude) {
  float distance = (x - center) / width;
  return amplitude * exp(-0.5f * distance * distance);
}

int normalEcgSample(int phase) {
  float value = 2048
    + pulse(phase, 35, 6, 100)    // P wave
    - pulse(phase, 72, 2, 150)    // Q wave
    + pulse(phase, 78, 2, 1000)   // R wave
    - pulse(phase, 86, 3, 260)    // S wave
    + pulse(phase, 135, 11, 210); // T wave

  return (int)value;
}

int finalBeatSample(int phase) {
  float value = 2048
    - pulse(phase, 90, 12, 250)
    + pulse(phase, 108, 8, 1200)
    - pulse(phase, 132, 18, 380);

  return (int)value;
}

void startNewNormalBeat() {
  sampleInBeat = 0;
  beatLength = random(SAMPLE_RATE, SAMPLE_RATE * 2 + 1); // 1–2 seconds
}

void setup() {
  Serial.begin(115200);

  randomSeed(micros());
  modeStartedAt = millis();
  startNewNormalBeat();
}

void loop() {
  int value = 2048; // Flatline baseline

  if (mode == NORMAL_RHYTHM) {
    value = normalEcgSample(sampleInBeat);
    sampleInBeat++;

    if (sampleInBeat >= beatLength) {
      startNewNormalBeat();
    }

    if (millis() - modeStartedAt >= NORMAL_DURATION_MS) {
      mode = FINAL_BEAT;
      sampleInBeat = 0;
    }
  }
  else if (mode == FINAL_BEAT) {
    value = finalBeatSample(sampleInBeat);
    sampleInBeat++;

    if (sampleInBeat >= SAMPLE_RATE) {
      mode = FLATLINE;
      modeStartedAt = millis();
    }
  }
  else if (mode == FLATLINE) {
    value = 2048 + random(-3, 4);

    if (millis() - modeStartedAt >= FLATLINE_DURATION_MS) {
      mode = NORMAL_RHYTHM;
      modeStartedAt = millis();
      startNewNormalBeat();
    }
  }

  // Small, visible random variation on every emitted value.
  value += random(-15, 16);

  Serial.println(value);
  delayMicroseconds(1000000UL / SAMPLE_RATE);
}