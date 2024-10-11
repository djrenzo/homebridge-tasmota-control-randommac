<p align="center">
  <a href="https://github.com/grzegorz914/homebridge-tasmota-control"><img src="https://raw.githubusercontent.com/grzegorz914/homebridge-tasmota-control/main/graphics/homebridge-tasmota-control.png" width="640"></a>
</p>

<span align="center">

# Homebridge Tasmota Control

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://badgen.net/npm/dt/homebridge-tasmota-control?color=purple)](https://www.npmjs.com/package/homebridge-tasmota-control)
[![npm](https://badgen.net/npm/v/homebridge-tasmota-control?color=purple)](https://www.npmjs.com/package/homebridge-tasmota-control)
[![npm](https://img.shields.io/npm/v/homebridge-tasmota-control/beta.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-tasmota-control)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/grzegorz914/homebridge-tasmota-control.svg)](https://github.com/grzegorz914/homebridge-tasmota-control/pulls)
[![GitHub issues](https://img.shields.io/github/issues/grzegorz914/homebridge-tasmota-control.svg)](https://github.com/grzegorz914/homebridge-tasmota-control/issues)

Homebridge plugin for Tasmota flashed devices.

</span>

## Package Requirements

| Package | Installation | Role | Required |
| --- | --- | --- | --- |
| [Homebridge](https://github.com/homebridge/homebridge) | [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki) | HomeKit Bridge | Required |
| [Config UI X](https://github.com/homebridge/homebridge-config-ui-x) | [Config UI X Wiki](https://github.com/homebridge/homebridge-config-ui-x/wiki) | Homebridge Web User Interface | Recommended |
| [Tasmota Control](https://www.npmjs.com/package/homebridge-tasmota-control) | [Plug-In Wiki](https://github.com/grzegorz914/homebridge-tasmota-control/wiki) | Homebridge Plug-In | Required |

## About The Plugin

* Plugin work with Tasmota v6.0.0 and abowe.

* Support Mitsubishi HVAC:
* Precompiled ESP firmware for `MiElHVAC` are in `firmware` folder.
* If You need firmware for specific `ESP` please go to [Firmware for MiElHVAC](https://github.com/grzegorz914/homebridge-tasmota-control/issues/18) and meke request.
  * Heater Cooler:
    * Power `ON/OFF`.
    * Operating mode `AUTO/HEAT/COOL`.
    * Temperature `HEATING/COOLING/AUTO`.
    * Fan speed `OFF/QUIET/1/2/3/4/AUTO`.
    * Swing mode `AUTO/SWING`.
    * Physical lock controls `LOCK/UNLOCK`.
    * Temperature display unit `°F/°C`.
  * Buttons:
    * For direct device control.
      * Power `ON/OFF`.
      * Operating mode `HEAT/DRY/COOL/FAN/AUTO`.
      * Fan speed `OFF/QUIET/1/2/3/4/AUTO`.
      * Vane H `LEFT/LEFT MIDDLE/CENTER/RIGHT MIDDLE/RIGHT/SPLIT/SWING`.
      * Vane V `AUTO/UP/UP MIDDLE/CENTER/DOWN MIDDLE/DOWN/SWING`.
      * Air direction `INDIRECT/DIRECT/EVEN`.
      * Prohibit `POWER/MODE/TEMPERATURE/ALL`.
      * Physical lock controls `LOCK/UNLOCK`.
      * Presets `SET/UNSET`.
  * Sensors:
    * For automation and notifications.
      * Power `ON/OFF`.
      * Operating mode `HEAT/DRY/COOL/FAN/AUTO`.
      * Fan speed `OFF/QUIET/1/2/3/4/AUTO`.
      * Vane H `AUTO/1/2/3/4/5/SPLIT/SWING`.
      * Vane V `AUTO/1/2/3/4/5/SWING`.
      * Air direction `INDIRECT/DIRECT/EVEN`.
      * Physical lock controls `LOCK/UNLOCK`.
      * Presets `ACTIV/UNACTIV`.
      * Room temperature.
      * Outdoor temperature.

* Supported relay devices:
  * Light - `Power ON/OFF`, `Dimmer`, `Color Temperature`, `Hue`, `Saturation`
  * Outlet - `Power ON/OFF`
  * Switch - `Power ON/OFF`
  
* Supported Sensors:
  * Temperature - `Temperature`, `Dew Point`, `Reference`, `Obj`, `Amb`
  * Humidity
  * Carbon Dioxyde
  * Ambient Light
  * Motion

### Configuration

* Run this plugin as a [Child Bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges) (Highly Recommended), this prevent crash Homebridge if plugin crashes.
* Install and use [Homebridge Config UI X](https://github.com/homebridge/homebridge-config-ui-x/wiki) to configure this plugin (Highly Recommended).
* The `sample-config.json` can be used as an alternative, make a backup copy before making any changes.

<p align="center">
  <a href="https://github.com/grzegorz914/homebridge-tasmota-control"><img src="https://raw.githubusercontent.com/grzegorz914/homebridge-tasmota-control/master/graphics/ustawienia.png" width="840"></a>
</p>

| Key | Description |
| --- | --- |
| `name` | Here set the accessory *Name* to be displayed in *Homebridge/HomeKit*. |
| `host` | Here set the *Hsostname or Address IP* of the Device.|
| `auth` | If enabled, authorizatins credentials will be used for login. |
| `user` | Here set the authorization *Username*. |
| `passwd` | Here set the authorization *Password*. |
| `miElHvac.heatDryFanMode` | Here select the operatiing mode for `Heat`, only for Mitsubishio AC. |
| `miElHvac.coolDryFanMode` | Here select the operatiing mode for `Cool`, only for Mitsubishio AC. |
| `miElHvac.autoDryFanMode` | Here select the operatiing mode for `Auto`, only for Mitsubishio AC. |
| `miElHvac.temperatureSensor` | This enable extra `Room` temperature sensors to use with automations in HomeKit app. |
| `miElHvac.temperatureSensorOutdoor` | This enable extra `Outdoor` temperature sensors to use with automations in HomeKit app. |
| `miElHvac.presets` | Array of presets sensors. |
| `miElHvac.presets.name` | Here You can schange the `Preset Name` which is exposed to the `Homebridge/HomeKit`. |
| `miElHvac.presets.mode` | Here set the operation mode . |
| `miElHvac.presets.setTemp` | Here set the target temperature. |
| `miElHvac.presets.fanSpeed` | Here set the fan speed. |
| `miElHvac.presets.swingV` | Here set the vane vertical direction. |
| `miElHvac.presets.swingH` | Here set the vane horizontal direction. |
| `miElHvac.presets.displayType` | Here select display type in HomeKit, `0 - None/Disabled`, `1 - Outlet`, `2 - Switch`, `3 - Motion Sensor`, `4 - Occupancy Sensor`, `5 - Contact Sensor`. |
| `miElHvac.buttonsSensors` | Array of buttons sensors. |
| `miElHvac.buttonsSensors.name` | Here set `Button Name` which You want expose to the `Homebridge/HomeKit`. |
| `miElHvac.buttonsSensors.mode` | Here select button function mode. |
| `miElHvac.buttonsSensors.displayType` | Here select display type in HomeKit, `0 - None/Disabled`, `1 - Outlet`, `2 - Switch`, `3 - Motion Sensor`, `4 - Occupancy Sensor`, `5 - Contact Sensor`. |
| `miElHvac.buttonsSensors.namePrefix` | Here enable/disable the accessory name as a prefix for button/sensor name. |
| `relaysNamePrefix` | Here enable/disable the accessory name as a prefix for relays name. |
| `relaysDisplayType` | Here select characteristic display type for relays which are exposed in the HomeKit app. |
| `lightsNamePrefix` | Here enable/disable the accessory name as a prefix for lights name. |
| `sensorsNamePrefix` | Here enable/disable the accessory name as a prefix for sensors name. |
| `loadNameFromDevice` | If enabled, the accessory name will be loaded direct from device. |
| `refreshInterval` | Here set the data refresh time in (sec). |
| `enableDebugMode` | This enable debug log in homebridge console. |
| `disableLogInfo` | This disable log info, all values and state will not be displayed in Homebridge log console. |
| `disableLogDeviceInfo` | If enabled, add ability to disable log device info by every connections device to the network. |
