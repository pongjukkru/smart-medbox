# Smart MedBox v2 — LINE MINI App + ESP8266 + DS3231

## ฟังก์ชัน
- ตั้งเวลาใน LINE MINI App
- เลือกช่องยา 1-4 ต่อหนึ่งเวลา
- ตั้งชื่อยาในแต่ละช่อง
- เปิด/ปิดตาราง
- ผูกตู้กับ LINE user
- ESP8266 ดึงตารางจาก server
- DS3231 เป็นเวลาหลักของตู้
- ถึงเวลา -> Buzzer D8 ดัง
- กดปุ่ม D7 -> หยุดเสียง
- จ่ายเฉพาะช่องยาที่กำหนด
- บันทึกประวัติการจ่ายยา

## ติดตั้ง
ต้องใช้ Node.js 18+ และ HTTPS สำหรับใช้งานกับ LINE

```bash
npm install
```

ตั้ง environment:
- LIFF_ID = LIFF ID ของ LINE MINI App
- LINE_CHANNEL_ID = Channel ID ที่ใช้สร้าง LIFF
- PORT = 3000 (ไม่จำเป็น)

รัน:
```bash
npm start
```

## LINE
ใน LINE Developers Console สร้าง LINE MINI App / LIFF และตั้ง Endpoint URL เป็น:
`https://YOUR-DOMAIN/`

ใส่ LIFF ID และ Channel ID ให้ server

LINE MINI App ใช้ URL:
`https://miniapp.line.me/{LIFF_ID}`

## ESP8266
แก้ใน `esp8266_example.ino`:
- WIFI_SSID
- WIFI_PASS
- SERVER
- DEVICE_ID

ไลบรารี:
- RTClib
- ESP8266Servo
- ArduinoJson

## ขา
DS3231:
- SDA -> D2/GPIO4
- SCL -> D1/GPIO5
- VCC -> Vin
- GND -> GND

Buzzer:
- D8/GPIO15

Button:
- D7/GPIO13 -> button -> GND

Servo:
- Servo 1 -> GPIO0/D3
- Servo 2 -> GPIO2/D4
- Servo 3 -> GPIO14/D5
- Servo 4 -> GPIO12/D6

## การตั้งเวลา
ตัวอย่าง:
07:00 + ช่อง 1,3
12:00 + ช่อง 2
18:00 + ช่อง 1,4

ESP8266 จะตรวจเวลาจาก DS3231 และจ่ายตามตารางที่ server ส่งให้

## ความปลอดภัย
ตัวอย่างนี้ตรวจสอบ LINE ID token ที่ server ก่อนอ่าน/แก้ตาราง และไม่ใช้ X-User-Id ที่ผู้ใช้ปลอมเองได้

สำหรับโครงงานจริงควรเพิ่ม:
- HTTPS
- database จริง
- authentication ของ ESP8266 (device token/HMAC)
- watchdog
- ตรวจว่ามียาตกจริง
- recovery หลังไฟดับ
- ป้องกันการจ่ายซ้ำ
- ทดสอบกลไกก่อนใช้กับยาจริง

Servo ไม่ควรรับไฟจาก 3.3V ของ ESP8266 ให้ใช้แหล่งจ่ายที่เหมาะสมและต่อ GND ร่วมกัน

GPIO0/GPIO2 เป็น boot-strap pins จึงต้องระวังวงจรไม่ให้ทำให้ ESP8266 บูตผิดปกติ
