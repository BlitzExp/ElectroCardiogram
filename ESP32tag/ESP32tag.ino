const int PIN_SENAL = A0;

void setup() {
  Serial.begin(115200);
}

void loop() {
  int lectura = analogRead(PIN_SENAL); // 0–1023
  Serial.println(lectura);
  delay(5);
}