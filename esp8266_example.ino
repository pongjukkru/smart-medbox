/*
 Smart MedBox v2
 Board: ESP8266
 RTC: DS3231
 I2C: SDA=D2(GPIO4), SCL=D1(GPIO5)
 Buzzer: D8(GPIO15)
 Button: D7(GPIO13) -> GND
 Servo1: GPIO0(D3)
 Servo2: GPIO2(D4)
 Servo3: GPIO14(D5)
 Servo4: GPIO12(D6)

 Libraries:
   RTClib
   ESP8266Servo
   ArduinoJson
*/

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <Wire.h>
#include <RTClib.h>
#include <ESP8266Servo.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* SERVER = "https://YOUR-DOMAIN.example.com";
const char* DEVICE_ID = "MEDBOX-01";

const uint8_t BUZZER_PIN = 15; // D8
const uint8_t BUTTON_PIN = 13; // D7
const uint8_t SERVO_PINS[4] = {0,2,14,12};

const int SERVO_CENTER = 90;
const int SERVO_RELEASE = 180;
const uint16_t SERVO_HOLD_MS = 450;

RTC_DS3231 rtc;
Servo servo[4];

struct Schedule {
  char id[40];
  char time[6];
  bool enabled;
  bool channel[4];
};
Schedule schedules[30];
int scheduleCount=0;

bool alarmActive=false;
String lastAlarmKey="";
unsigned long lastPoll=0;

String pad2(int n){ return n<10 ? "0"+String(n) : String(n); }

void setup(){
  Serial.begin(115200);
  Wire.begin(4,5);

  pinMode(BUZZER_PIN,OUTPUT);
  noTone(BUZZER_PIN);
  pinMode(BUTTON_PIN,INPUT_PULLUP);

  // NOTE: GPIO0/GPIO2 are boot-strap pins; test boot behavior carefully.
  for(int i=0;i<4;i++){
    servo[i].attach(SERVO_PINS[i]);
    servo[i].write(SERVO_CENTER);
  }

  if(!rtc.begin()) Serial.println("ERROR: DS3231 not found");

  WiFi.begin(WIFI_SSID,WIFI_PASS);
  while(WiFi.status()!=WL_CONNECTED){delay(500);Serial.print(".");}
  Serial.println("\nWiFi OK");
}

void loop(){
  DateTime now=rtc.now();

  if(millis()-lastPoll>5000){
    downloadSchedules();
    sendStatus(now);
    lastPoll=millis();
  }

  String hhmm=pad2(now.hour())+":"+pad2(now.minute());
  String alarmKey=String(now.year())+"-"+pad2(now.month())+"-"+pad2(now.day())+"-"+hhmm;

  if(!alarmActive && alarmKey!=lastAlarmKey){
    int idx=findSchedule(hhmm);
    if(idx>=0 && schedules[idx].enabled){
      alarmActive=true;
      lastAlarmKey=alarmKey;
      tone(BUZZER_PIN,2500);
      Serial.println("ALARM: "+hhmm);
    }
  }

  if(alarmActive && digitalRead(BUTTON_PIN)==LOW){
    delay(30);
    if(digitalRead(BUTTON_PIN)==LOW){
      noTone(BUZZER_PIN);
      int idx=findSchedule(hhmm);
      if(idx>=0) dispense(schedules[idx],now);
      alarmActive=false;
      while(digitalRead(BUTTON_PIN)==LOW) delay(10);
    }
  }

  delay(50);
}

int findSchedule(String hhmm){
  for(int i=0;i<scheduleCount;i++)
    if(String(schedules[i].time)==hhmm) return i;
  return -1;
}

void dispense(Schedule &s, DateTime now){
  String channels="";
  bool first=true;

  for(int i=0;i<4;i++){
    if(!s.channel[i]) continue;

    if(!first) channels+=",";
    channels+=String(i+1);
    first=false;

    servo[i].write(SERVO_RELEASE);
    delay(SERVO_HOLD_MS);
    servo[i].write(SERVO_CENTER);
    delay(600);
  }

  sendLog(now,channels);
}

void downloadSchedules(){
  if(WiFi.status()!=WL_CONNECTED)return;

  WiFiClient client;
  HTTPClient http;
  String url=String(SERVER)+"/api/device/schedule?deviceId="+DEVICE_ID;

  if(!http.begin(client,url))return;
  int code=http.GET();

  if(code==200){
    String payload=http.getString();
    DynamicJsonDocument doc(12288);

    if(deserializeJson(doc,payload)==DeserializationError::Ok){
      scheduleCount=0;
      for(JsonObject o:doc["schedules"].as<JsonArray>()){
        if(scheduleCount>=30)break;
        Schedule &s=schedules[scheduleCount];
        strlcpy(s.id,o["id"]|"",sizeof(s.id));
        strlcpy(s.time,o["time"]|"",sizeof(s.time));
        s.enabled=o["enabled"]|false;
        for(int i=0;i<4;i++)s.channel[i]=false;
        for(int v:o["channels"].as<JsonArray>())
          if(v>=1 && v<=4)s.channel[v-1]=true;
        scheduleCount++;
      }
    }
  }
  http.end();
}

void sendStatus(DateTime now){
  if(WiFi.status()!=WL_CONNECTED)return;
  WiFiClient client;
  HTTPClient http;
  if(!http.begin(client,String(SERVER)+"/api/device/status"))return;
  http.addHeader("Content-Type","application/json");

  DynamicJsonDocument doc(512);
  doc["deviceId"]=DEVICE_ID;
  doc["online"]=true;
  doc["alarm"]=alarmActive;
  doc["rtc"]=String(now.year())+"-"+pad2(now.month())+"-"+pad2(now.day())+
             " "+pad2(now.hour())+":"+pad2(now.minute())+":"+pad2(now.second());

  String body; serializeJson(doc,body);
  http.POST(body);
  http.end();
}

void sendLog(DateTime now,String channels){
  if(WiFi.status()!=WL_CONNECTED)return;
  WiFiClient client;
  HTTPClient http;
  if(!http.begin(client,String(SERVER)+"/api/device/log"))return;
  http.addHeader("Content-Type","application/json");

  DynamicJsonDocument doc(512);
  doc["deviceId"]=DEVICE_ID;
  doc["time"]=String(now.year())+"-"+pad2(now.month())+"-"+pad2(now.day())+
              " "+pad2(now.hour())+":"+pad2(now.minute());
  doc["result"]="dispensed";
  JsonArray arr=doc.createNestedArray("channels");

  int start=0;
  while(start<channels.length()){
    int comma=channels.indexOf(',',start);
    if(comma<0)comma=channels.length();
    arr.add(channels.substring(start,comma).toInt());
    start=comma+1;
  }

  String body;serializeJson(doc,body);
  http.POST(body);
  http.end();
}