# Projekt: OKF Smart Home Integration

Dieses System verbindet alle Smart-Home-Geraete ueber einen zentralen MQTT-Broker.
Jedes Geraet sendet seinen Status als JSON-Payload an ein dediziertes Topic.
Ein Node-RED-Flow verarbeitet die eingehenden Daten und triggert Automationen.

## Architektur

- **MQTT Broker** (Mosquitto) auf Raspberry Pi 4
- **Node-RED** fuer visuelle Flow-Programmierung
- **InfluxDB** als Zeitreihen-Datenbank fuer Sensorwerte
- **Grafana** Dashboard fuer Echtzeit-Visualisierung

## Geraete-Integration

1. **Shelly Plug S** - Stromverbrauchsmessung
2. **Xiaomi Aqara** - Temperatur, Luftfeuchtigkeit, Bewegung
3. **Sonoff Basic R3** - Lichtsteuerung
4. **Hue Bridge v2** - Philips Hue Lampen

## Automationen

- Bewegung im Flur → Licht an (20:00-06:00, 30% Helligkeit)
- Temperatur > 25°C → Ventilator einschalten
- Stromverbrauch > 500W → Push-Nachricht via Telegram
- Fenster offen + Heizung an → Heizung aus, Notification

## Sicherheit

- MQTT mit TLS und Client-Zertifikaten
- VLAN fuer IoT-Geraete vom Hauptnetz getrennt
- Keine Cloud-Abhaengigkeit (100% lokal)
