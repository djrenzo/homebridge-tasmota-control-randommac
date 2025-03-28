import { promises as fsPromises } from 'fs';
import axios from 'axios';
import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import { ApiCommands, MiElHVAC, LightKeys, SensorKeys, TemperatureDisplayUnits } from './constants.js';
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class TasmotaDevice extends EventEmitter {
    constructor(api, config, miElHvac, defaultHeatingSetTemperatureFile, defaultCoolingSetTemperatureFile) {
        super();

        Accessory = api.platformAccessory;
        Characteristic = api.hap.Characteristic;
        Service = api.hap.Service;
        Categories = api.hap.Categories;
        AccessoryUUID = api.hap.uuid;

        //device configuration
        this.name = config.name;
        this.serial = config.serial;
        this.mymodel = config.model;
        this.mymanufacturer = config.manufacturer;
        this.devicenumberid = config.devicenumberid;
        const host = config.host;
        const auth = config.auth || false;
        const url = `http://${host}/cm?cmnd=`;
        const user = config.user || '';
        const passwd = config.passwd || '';

        //mitsubishi ac
        this.heatDryFanMode = miElHvac.heatDryFanMode || 1; //NONE, HEAT, DRY, FAN
        this.coolDryFanMode = miElHvac.coolDryFanMode || 1; //NONE, COOL, DRY, FAN
        this.autoDryFanMode = miElHvac.autoDryFanMode || 1; //NONE, COOL, DRY, FAN

        //external sensor
        const remoteTemperatureSensor = miElHvac.remoteTemperatureSensor ?? {};
        const remoteTemperatureSensorEnable = remoteTemperatureSensor.enable || false;
        const remoteTemperatureSensorPath = remoteTemperatureSensor.path;
        const remoteTemperatureSensorRefreshInterval = remoteTemperatureSensor.refreshInterval * 1000 || 5000;
        const remoteTemperatureSensorAuth = remoteTemperatureSensor.auth || false;
        const remoteTemperatureSensorUser = remoteTemperatureSensor.user;
        const remoteTemperatureSensorPasswd = remoteTemperatureSensor.passwd;
        this.remoteTemperatureSensorEnable = remoteTemperatureSensorEnable;
        this.remoteTemperatureSensorRefreshInterval = remoteTemperatureSensorRefreshInterval;

        //presets
        const presets = miElHvac.presets || [];
        this.presetsConfigured = [];
        for (const preset of presets) {
            const presetName = preset.name ?? false;
            const presetDisplayType = preset.displayType ?? 0;
            const presetNamePrefix = preset.namePrefix ?? false;
            if (presetName && presetDisplayType > 0) {
                const presetyServiceType = ['', Service.Outlet, Service.Switch, Service.MotionSensor, Service.OccupancySensor, Service.ContactSensor][presetDisplayType];
                const presetCharacteristicType = ['', Characteristic.On, Characteristic.On, Characteristic.MotionDetected, Characteristic.OccupancyDetected, Characteristic.ContactSensorState][presetDisplayType];
                preset.namePrefix = presetNamePrefix;
                preset.serviceType = presetyServiceType;
                preset.characteristicType = presetCharacteristicType;
                preset.state = false;
                preset.previousSettings = {};
                this.presetsConfigured.push(preset);
            } else {
                const log = presetDisplayType === 0 ? false : this.emit('warn', `Preset Name: ${preset ? preset : 'Missing'}`);
            };
        }
        this.presetsConfiguredCount = this.presetsConfigured.length || 0;

        //buttons
        const buttons = miElHvac.buttons || [];
        this.buttonsConfigured = [];
        for (const button of buttons) {
            const buttonName = button.name ?? false;
            const buttonMode = button.mode ?? -1;
            const buttonDisplayType = button.displayType ?? 0;
            const buttonNamePrefix = button.namePrefix ?? false;
            if (buttonName && buttonMode >= 0 && buttonDisplayType > 0) {
                const buttonServiceType = ['', Service.Outlet, Service.Switch][buttonDisplayType];
                const buttonCharacteristicType = ['', Characteristic.On, Characteristic.On][buttonDisplayType];
                button.namePrefix = buttonNamePrefix;
                button.serviceType = buttonServiceType;
                button.characteristicType = buttonCharacteristicType;
                button.state = false;
                button.previousValue = null;
                this.buttonsConfigured.push(button);
            } else {
                const log = buttonDisplayType === 0 ? false : this.emit('warn', `Button Name: ${buttonName ? buttonName : 'Missing'}, Mode: ${buttonMode ? buttonMode : 'Missing'}`);
            };
        }
        this.buttonsConfiguredCount = this.buttonsConfigured.length || 0;

        //sensors
        const sensors = miElHvac.sensors || [];
        this.sensorsConfigured = [];
        for (const sensor of sensors) {
            const sensorName = sensor.name ?? false;
            const sensorMode = sensor.mode ?? -1;
            const sensorDisplayType = sensor.displayType ?? 0;
            const sensorNamePrefix = sensor.namePrefix ?? false;
            if (sensorName && sensorMode >= 0 && sensorDisplayType > 0) {
                const sensorServiceType = ['', Service.MotionSensor, Service.OccupancySensor, Service.ContactSensor][sensorDisplayType];
                const sensorCharacteristicType = ['', Characteristic.MotionDetected, Characteristic.OccupancyDetected, Characteristic.ContactSensorState][sensorDisplayType];
                sensor.namePrefix = sensorNamePrefix;
                sensor.serviceType = sensorServiceType;
                sensor.characteristicType = sensorCharacteristicType;
                sensor.state = false;
                sensor.previousValue = null;
                this.sensorsConfigured.push(sensor);
            } else {
                const log = sensorDisplayType === 0 ? false : this.emit('warn', `Sensor Name: ${sensorName ? sensorName : 'Missing'}, Mode: ${sensorMode ? sensorMode : 'Missing'}`);
            };
        }
        this.sensorsConfiguredCount = this.sensorsConfigured.length || 0;

        //frost protect
        const frostProtect = miElHvac.frostProtect ?? {};
        this.frostProtectEnable = frostProtect.enable || false;
        this.frostProtectLowTemp = frostProtect.lowTemp || 14;
        this.frostProtectHighTemp = frostProtect.highTemp || 16;
        this.frostProtectActive = false;

        //extra sensors
        this.temperatureSensor = miElHvac.temperatureSensor || false;
        this.temperatureSensorOutdoor = miElHvac.temperatureSensorOutdoor || false;

        //other config
        this.relaysDisplayType = config.relaysDisplayType || 0;
        this.relaysNamePrefix = config.relaysNamePrefix || false;
        this.lightsNamePrefix = config.lightsNamePrefix || false;
        this.sensorsNamePrefix = config.sensorsNamePrefix || false;
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
        this.loadNameFromDevice = config.loadNameFromDevice || false;
        const refreshInterval = config.refreshInterval * 1000 || 5000;
        this.refreshInterval = refreshInterval;

        //files
        this.defaultHeatingSetTemperatureFile = defaultHeatingSetTemperatureFile;
        this.defaultCoolingSetTemperatureFile = defaultCoolingSetTemperatureFile;

        //switches, outlets, lights
        this.relaysCount = 0;

        //sensors
        this.sensorsCount = 0;
        this.sensorsTemperatureCount = 0;
        this.sensorsReferenceTemperatureCount = 0;
        this.sensorsObjTemperatureCount = 0;
        this.sensorsAmbTemperatureCount = 0;
        this.sensorsHumidityCount = 0;
        this.sensorsDewPointTemperatureCount = 0;
        this.sensorsPressureCount = 0;
        this.sensorsGasCount = 0;
        this.sensorsCarbonDioxydeCount = 0;
        this.sensorsAmbientLightCount = 0;
        this.sensorsMotionCount = 0;

        //variable
        this.startPrepareAccessory = true;

        //mielhvac
        this.accessory = {};
        this.device = 0; //0 - mielhvac, 1 - switch/outlet, 2 - light
        this.previousStateSwingV = 'auto';
        this.previousStateSwingH = 'center';

        //axios instance
        this.axiosInstance = axios.create({
            method: 'GET',
            baseURL: url,
            timeout: refreshInterval > 10000 ? 10000 : refreshInterval,
            withCredentials: auth,
            auth: {
                username: user,
                password: passwd
            }
        });

        //axios instance remote temp
        if (remoteTemperatureSensorEnable) {
            const path = remoteTemperatureSensorPath;
            this.axiosInstanceRemoteTemp = axios.create({
                method: 'GET',
                baseURL: path,
                timeout: remoteTemperatureSensorRefreshInterval > 10000 ? 10000 : remoteTemperatureSensorRefreshInterval,
                withCredentials: remoteTemperatureSensorAuth,
                auth: {
                    username: remoteTemperatureSensorUser,
                    password: remoteTemperatureSensorPasswd
                }
            });
        };

        //impulse generator
        this.impulseGenerator = new ImpulseGenerator();
        this.impulseGenerator.on('checkDeviceState', async () => {
            try {
                await this.checkDeviceState();
            } catch (error) {
                this.emit('error', `Impulse generator error: ${error}`);
            };
        }).on('updateRemoteTemp', async () => {
            try {
                await this.updateRemoteTemp();
            } catch (error) {
                this.emit('error', `Impulse generator error: ${error}`);
            };
        }).on('state', (state) => {
            const emitState = state ? this.emit('success', `Impulse generator started`) : this.emit('warn', `Impulse generator stopped`);
        });
    };

    async getDeviceInfo() {
        const debug = this.enableDebugMode ? this.emit('debug', `Requesting info`) : false;
        try {
            const deviceInfoData = await this.axiosInstance(ApiCommands.Status);
            const deviceInfo = deviceInfoData.data ?? {};
            const debug = this.enableDebugMode ? this.emit('debug', `Info: ${JSON.stringify(deviceInfo, null, 2)}`) : false;
            await new Promise(resolve => setTimeout(resolve, 250));
            
            // Helper function to generate a random MAC address
            const generateRandomMac = () => {
                return "02:00:00:" + [...Array(3)]
                    .map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, "0"))
                    .join(":");
            };

            //status
            const friendlyNames = [];
            const status = deviceInfo.Status ?? {};
            const deviceName = this.loadNameFromDevice ? status.DeviceName ?? 'Unknown' : this.name;
            const friendlyName = status.FriendlyName ?? [];
            const relaysName = Array.isArray(friendlyName) ? friendlyName : [friendlyName];
            for (const relayName of relaysName) {
                const name = relayName ?? 'Unknown'
                friendlyNames.push(name);
            };

            //status FWR
            const statusFwr = deviceInfo.StatusFWR ?? {};
            const firmwareRevision = statusFwr.Version ?? 'Unknown';
            // const modelName = statusFwr.Hardware ?? 'Unknown';
            const modelName = this.mymodel;

            //status NET
            const statusNet = deviceInfo.StatusNET ?? {};
            const addressMac = this.serial;

            //status SNS
            const statusSns = deviceInfo.StatusSNS ?? {};
            const statusSnsKeys = Object.keys(statusSns);

            //status STS
            const statusSts = deviceInfo.StatusSTS ?? {};
            const statusStsKeys = Object.keys(statusSts);

            this.device = this.devicenumberid; //statusSnsKeys.includes('MiElHVAC') ? 0 : statusStsKeys.some(key => LightKeys.includes(key)) ? 2 : 1;
            this.deviceName = deviceName;
            this.friendlyNames = friendlyNames;
            this.modelName = modelName;
            this.serialNumber = addressMac;
            this.firmwareRevision = firmwareRevision;
            this.relaysCount = friendlyNames.length;

            return addressMac;
        } catch (error) {
            throw new Error(`Check info error: ${error}`);
        };
    };

    async checkDeviceState() {
        const debug = this.enableDebugMode ? this.emit('debug', `Requesting status`) : false;
        try {
            let powerStatusData;
            let powerStatus;
            let powerStatusKeys;
            let sensorStatusData;
            let sensorStatus;
            let sensorStatusKeys;
            let statusSnsSupported;
            let statusSns;
            let statusSnsKeys;
            let statusStsSupported;
            let statusSts;
            let statusStsKeys;
            let relaysCount;
            if (this.device !== 0){
                //power status
                powerStatusData = await this.axiosInstance(ApiCommands.PowerStatus);
                powerStatus = powerStatusData.data ?? {};
                // const debug = this.enableDebugMode ? this.emit('debug', `Power status: ${JSON.stringify(powerStatus, null, 2)}`) : false;
                //power status keys
                powerStatusKeys = Object.keys(powerStatus);
                //sensor status
                sensorStatusData = await this.axiosInstance(ApiCommands.Status);
                sensorStatus = sensorStatusData.data ?? {};
                // const debug1 = this.enableDebugMode ? this.emit('debug', `Sensors status: ${JSON.stringify(sensorStatus, null, 2)}`) : false;
                //sensor status keys
                sensorStatusKeys = Object.keys(sensorStatus);
                //status SNS
                statusSnsSupported = sensorStatusKeys.includes('StatusSNS');
                statusSns = statusSnsSupported ? sensorStatus.StatusSNS : {};
                statusSnsKeys = Object.keys(statusSns);
                //status STS
                statusStsSupported = sensorStatusKeys.includes('StatusSTS');
                statusSts = statusStsSupported ? sensorStatus.StatusSTS : {};
                statusStsKeys = Object.keys(statusSts);
                //relays
                relaysCount = this.relaysCount;
            }

            //device
            switch (this.device) {
                case 0: //mielhvac
                    const power = MiElHVAC.powerstate; //power
                    const time = '2025-03-25T18:32:02'; //status SNS
                    const temperatureUnit = '°C' // statusSns.TempUnit === 'C' ? '°C' : 'F';

                    //mielhvac
                    const miElHvac = {}; //statusSns.MiElHVAC ?? {};
                    const roomTemperature = MiElHVAC.lastSetTemp; //miElHvac.Temperature ?? null;
                    const outdoorTemperature = miElHvac.OutdoorTemperature ?? null;
                    const setTemperature = miElHvac.SetTemperature;
                    const operationMode = MiElHVAC.lastSetMode;
                    const operationModeStage = miElHvac.ModeStage ?? 'Unknown';
                    const fanSpeed = miElHvac.FanSpeed ?? 'Unknown';
                    const fanSpeedStage = miElHvac.FanStage ?? 'Unknown';
                    const vaneVerticalDirection = miElHvac.SwingV ?? 'Unknown';
                    const vaneHorizontalDirection = miElHvac.SwingH ?? 'Unknown';
                    const prohibit = miElHvac.Prohibit ?? 'Unknown';
                    const airDirection = miElHvac.AirDirection ?? 'Unknown';
                    const compressor = miElHvac.Compressor ?? 'Unknown';
                    const compressorFrequency = miElHvac.CompressorFrequency ?? 0;
                    const operationPower = miElHvac.OperationPower ?? 0;
                    const operationEnergy = miElHvac.OperationEnergy ?? 0;
                    const operationStage = miElHvac.OperationStage ?? 'Unknown';
                    const swingMode = 1; //vaneVerticalDirection === 'swing' && vaneHorizontalDirection === 'swing' ? 1 : 0;
                    const defaultCoolingSetTemperature = parseFloat(await this.readData(this.defaultCoolingSetTemperatureFile));
                    const defaultHeatingSetTemperature = parseFloat(await this.readData(this.defaultHeatingSetTemperatureFile));
                    const remoteTemperatureSensorState = miElHvac.RemoteTemperatureSensorState ?? false; //ON, OFF
                    const remoteTemperatureSensorAutoClearTime = miElHvac.RemoteTemperatureSensorAutoClearTime ?? 0; //time in ms

                    const modelSupportsHeat = true;
                    const modelSupportsDry = true;
                    const modelSupportsCool = true;
                    const modelSupportsAuto = true;
                    const modelSupportsFanSpeed = true;
                    const hasAutomaticFanSpeed = true;
                    const numberOfFanSpeeds = 5;
                    const lockPhysicalControl = prohibit === 'all' ?? false;
                    const useFahrenheit = temperatureUnit === 'F' ?? false;
                    const temperatureIncrement = 1;
                    const hideDryModeControl = false;
                    const hideVaneControls = false;

                    this.accessory = {
                        time: time,
                        power: power,
                        roomTemperature: roomTemperature,
                        outdoorTemperature: outdoorTemperature,
                        setTemperature: setTemperature,
                        operationMode: operationMode,
                        operationModeStage: operationModeStage,
                        vaneVerticalDirection: vaneVerticalDirection,
                        vaneHorizontalDirection: vaneHorizontalDirection,
                        prohibit: prohibit,
                        airDirection: airDirection,
                        swingMode: swingMode,
                        compressor: compressor,
                        compressorFrequency: compressorFrequency,
                        operationPower: operationPower,
                        operationEnergy: operationEnergy,
                        operationStage: operationStage,
                        defaultCoolingSetTemperature: defaultCoolingSetTemperature,
                        defaultHeatingSetTemperature: defaultHeatingSetTemperature,
                        remoteTemperatureSensorState: remoteTemperatureSensorState,
                        remoteTemperatureSensorAutoClearTime: remoteTemperatureSensorAutoClearTime,
                        modelSupportsHeat: modelSupportsHeat,
                        modelSupportsDry: modelSupportsDry,
                        modelSupportsCool: modelSupportsCool,
                        modelSupportsAuto: modelSupportsAuto,
                        modelSupportsFanSpeed: modelSupportsFanSpeed,
                        hasAutomaticFanSpeed: hasAutomaticFanSpeed,
                        numberOfFanSpeeds: numberOfFanSpeeds,
                        lockPhysicalControl: prohibit === 'all' ? 1 : 0,
                        temperatureUnit: temperatureUnit,
                        useFahrenheit: useFahrenheit,
                        temperatureIncrement: temperatureIncrement,
                        hideDryModeControl: hideDryModeControl,
                        hideVaneControls: hideVaneControls
                    };

                    this.emit('warn', `Operating mode: ${operationMode}`);
                    this.accessory.currentOperationMode = !power ? 0 : MiElHVAC.lastSetModeInt;
                    this.accessory.operationModeSetPropsMinValue = 0;
                    this.accessory.operationModeSetPropsMaxValue = 2;
                    this.accessory.operationModeSetPropsValidValues = [0, 1, 2];

                    //update characteristics
                    if (this.miElHvacService) {
                        this.miElHvacService
                            .updateCharacteristic(Characteristic.Active, power)
                            .updateCharacteristic(Characteristic.CurrentHeaterCoolerState, this.accessory.currentOperationMode + 1)
                            .updateCharacteristic(Characteristic.TargetHeaterCoolerState, this.accessory.currentOperationMode)
                            .updateCharacteristic(Characteristic.CurrentTemperature, roomTemperature)
                            .updateCharacteristic(Characteristic.LockPhysicalControls, 0)
                            .updateCharacteristic(Characteristic.TemperatureDisplayUnits, 0)
                            .updateCharacteristic(Characteristic.SwingMode, swingMode)
                            .updateCharacteristic(Characteristic.RotationSpeed, MiElHVAC.lastSetFan)
                            .updateCharacteristic(Characteristic.CoolingThresholdTemperature, MiElHVAC.lastSetTempCool)
                            .updateCharacteristic(Characteristic.HeatingThresholdTemperature, MiElHVAC.lastSetTempHeat);
                    };

                    // //update presets state
                    // if (this.presetsConfigured.length > 0) {
                    //     for (let i = 0; i < this.presetsConfigured.length; i++) {
                    //         const preset = this.presetsConfigured[i];

                    //         let iseeMode = operationMode;
                    //         iseeMode = (operationMode === 'heat' || operationMode === 'heat_isee') ? 'heat' : iseeMode;
                    //         iseeMode = (operationMode === 'dry' || operationMode === 'dry_isee') ? 'dry' : iseeMode;
                    //         iseeMode = (operationMode === 'cool' || operationMode === 'cool_isee') ? 'cool' : iseeMode;

                    //         preset.state = power ? (preset.mode === iseeMode
                    //             && (preset.setTemp).toFixed(1) === parseFloat(setTemperature).toFixed(1)
                    //             && preset.fanSpeed === fanSpeed
                    //             && preset.swingV === vaneVerticalDirection
                    //             && preset.swingH === vaneHorizontalDirection) : false;

                    //         if (this.presetsServices) {
                    //             const characteristicType = preset.characteristicType;
                    //             this.presetsServices[i]
                    //                 .updateCharacteristic(characteristicType, preset.state)
                    //         };
                    //     };
                    // };

                    //update buttons state
                    if (this.buttonsConfiguredCount > 0) {
                        for (let i = 0; i < this.buttonsConfiguredCount; i++) {
                            const button = this.buttonsConfigured[i];
                            //update services
                            if (this.buttonsServices) {
                                const characteristicType = button.characteristicType;
                                this.buttonsServices[i]
                                    .updateCharacteristic(characteristicType, button.state);
                            };
                        };
                    };

                    //update sensors state
                    if (this.sensorsConfiguredCount > 0) {
                        for (let i = 0; i < this.sensorsConfiguredCount; i++) {
                            const sensor = this.sensorsConfigured[i];
                            if (this.sensorsServices) { //update services
                                const characteristicType = sensor.characteristicType;
                                this.sensorsServices[i]
                                    .updateCharacteristic(characteristicType, sensor.state);
                            };
                        };
                    };

                    //update room temperature sensor
                    if (this.roomTemperatureSensorService) {
                        this.roomTemperatureSensorService
                            .updateCharacteristic(Characteristic.CurrentTemperature, roomTemperature);
                    };

                    //update outdoor temperature sensor
                    if (this.outdoorTemperatureSensorService) {
                        this.outdoorTemperatureSensorService
                            .updateCharacteristic(Characteristic.CurrentTemperature, outdoorTemperature);
                    };

                    //log current state
                    if (!this.disableLogInfo) {
                        this.emit('message', `Power: ${power ? 'ON' : 'OFF'}`);
                        const info = power ? this.emit('message', `Target operation mode: ${operationMode.toUpperCase()}`) : false;
                        const info1 = power ? this.emit('message', `Current operation mode: ${operationModeStage.toUpperCase()}`) : false;
                        const info2 = power ? this.emit('message', `Target temperature: ${setTemperature}${temperatureUnit}`) : false;
                        const info3 = power ? this.emit('message', `Current temperature: ${roomTemperature}${temperatureUnit}`) : false;
                        const info4 = power && outdoorTemperature !== null ? this.emit('message', `Outdoor temperature: ${outdoorTemperature}${temperatureUnit}`) : false;
                        const info5 = power && modelSupportsFanSpeed ? this.emit('message', `Target Fan speed: ${fanSpeed.toUpperCase()}`) : false;
                        const info6 = power && modelSupportsFanSpeed ? this.emit('message', `Current Fan speed: ${fanSpeedStage.toUpperCase()}`) : false;
                        const info7 = power && vaneHorizontalDirection !== 'Unknown' ? this.emit('message', `Vane horizontal: ${MiElHVAC.HorizontalVane[vaneHorizontalDirection] ?? vaneHorizontalDirection}`) : false;
                        const info8 = power && vaneVerticalDirection !== 'Unknown' ? this.emit('message', `Vane vertical: ${MiElHVAC.VerticalVane[vaneVerticalDirection] ?? vaneVerticalDirection}`) : false;
                        const info9 = power ? this.emit('message', `Swing mode: ${MiElHVAC.SwingMode[swingMode]}`) : false;
                        const info10 = power && vaneHorizontalDirection === 'isee' && airDirection !== 'Unknown' ? this.emit('message', `Air direction: ${MiElHVAC.AirDirection[airDirection]}`) : false;
                        const info11 = power ? this.emit('message', `Prohibit: ${MiElHVAC.Prohibit[prohibit]}`) : false;
                        const info12 = power ? this.emit('message', `Temperature display unit: ${temperatureUnit}`) : false;
                        const info13 = power ? this.emit('message', `Compressor: ${compressor.toUpperCase()}`) : false;
                        const info14 = power ? this.emit('message', `OperationPower: ${operationPower}W`) : false;
                        const info15 = power ? this.emit('message', `OperationEnergy: ${operationEnergy}kWh`) : false;
                    };
                    break;
                case 1: //switches, outlets
                    if (relaysCount > 0) {
                        this.switchesOutlets = [];

                        for (let i = 0; i < relaysCount; i++) {
                            const friendlyName = this.friendlyNames[i];
                            const powerNr = i + 1;
                            const powerKey = relaysCount === 1 ? 'POWER' : `POWER${powerNr}`;
                            const power = powerStatus[powerKey] === 'ON';

                            //push to array
                            const switchOutlet = {
                                friendlyName: friendlyName,
                                power: power
                            };
                            this.switchesOutlets.push(switchOutlet);

                            //update characteristics
                            if (this.switchOutletLightServices) {
                                this.switchOutletLightServices[i].updateCharacteristic(Characteristic.On, power);
                            };

                            //log info
                            if (!this.disableLogInfo) {
                                this.emit('message', `${friendlyName}, state: ${power ? 'ON' : 'OFF'}`);
                            };
                        };
                    };

                    //status SNS
                    if (statusSnsSupported) {
                        this.sensorsName = [];
                        this.sensorsTemperature = [];
                        this.sensorsReferenceTemperature = [];
                        this.sensorsObjTemperature = [];
                        this.sensorsAmbTemperature = [];
                        this.sensorsDewPointTemperature = [];
                        this.sensorsHumidity = [];
                        this.sensorsPressure = [];
                        this.sensorsGas = [];
                        this.sensorsCarbonDioxyde = [];
                        this.sensorsAmbientLight = [];
                        this.sensorsMotion = [];

                        const sensor = Object.entries(statusSns)
                            .filter(([key]) => SensorKeys.some(type => key.includes(type)))
                            .reduce((obj, [key, value]) => {
                                obj[key] = value;
                                return obj;
                            }, {});

                        for (const [key, value] of Object.entries(sensor)) {
                            const sensorName = key ?? `Sensor`;
                            const sensorData = value;

                            //sensors
                            const temperature = sensorData.Temperature ?? false;
                            const referenceTemperature = sensorData.ReferenceTemperature ?? false;
                            const objTemperature = sensorData.OBJTMP ?? false;
                            const ambTemperature = sensorData.AMBTMP ?? false;
                            const dewPointTemperature = sensorData.DewPoint ?? false;
                            const humidity = sensorData.Humidity ?? false;
                            const pressure = sensorData.Pressure ?? false;
                            const gas = sensorData.Gas ?? false;
                            const carbonDioxyde = sensorData.CarbonDioxyde ?? false;
                            const ambientLight = sensorData.Ambient ?? false;
                            const motion = sensorData === 'ON';

                            //energy
                            const energyTotalStartTime = sensorData.TotalStartTime ?? '';
                            const energyTotal = sensorData.Total ?? 0;
                            const energyPeriod = sensorData.Period ?? 0;
                            const energyYesterday = sensorData.Yesterday ?? 0;
                            const energyToday = sensorData.Today ?? 0;
                            const power = sensorData.Power ?? 0;
                            const apparentPower = sensorData.ApparentPower ?? 0;
                            const reactivePower = sensorData.ReactivePower ?? 0;
                            const factor = sensorData.Factor ?? 0;
                            const voltage = sensorData.Voltage ?? 0;
                            const current = sensorData.Current ?? 0;
                            const load = sensorData.Load ?? 0;

                            //push to array
                            this.sensorsName.push(sensorName);
                            const push1 = temperature ? this.sensorsTemperature.push(temperature) : false;
                            const push2 = referenceTemperature ? this.sensorsReferenceTemperature.push(referenceTemperature) : false;
                            const push3 = objTemperature ? this.sensorsAmbTemperature.push(objTemperature) : false;
                            const push4 = ambTemperature ? this.sensorsAmbTemperature.push(ambTemperature) : false;
                            const push5 = dewPointTemperature ? this.sensorsDewPointTemperature.push(dewPointTemperature) : false;
                            const push6 = humidity ? this.sensorsHumidity.push(humidity) : false;
                            const push7 = pressure ? this.sensorsPressure.push(pressure) : false;
                            const push8 = gas ? this.sensorsGas.push(gas) : false;
                            const push9 = carbonDioxyde ? this.sensorsCarbonDioxyde.push(carbonDioxyde) : false;
                            const push10 = ambientLight ? this.sensorsAmbientLight.push(ambientLight) : false;
                            const push11 = motion ? this.sensorsMotion.push(motion) : false;
                        };

                        this.time = sensorStatus.Time ?? '';
                        this.tempUnit = sensorStatus.TempUnit === 'C' ? '°C' : 'F';
                        this.pressureUnit = sensorStatus.PressureUnit ?? 'hPa';
                        this.sensorsTemperatureCount = this.sensorsTemperature.length;
                        this.sensorsReferenceTemperatureCount = this.sensorsReferenceTemperature.length;
                        this.sensorsObjTemperatureCount = this.sensorsObjTemperature.length;
                        this.sensorsAmbTemperatureCount = this.sensorsAmbTemperature.length;
                        this.sensorsDewPointTemperatureCount = this.sensorsDewPointTemperature.length;
                        this.sensorsHumidityCount = this.sensorsHumidity.length;
                        this.sensorsPressureCount = this.sensorsPressure.length;
                        this.sensorsGasCount = this.sensorsGas.length;
                        this.sensorsCarbonDioxydeCount = this.sensorsCarbonDioxyde.length;
                        this.sensorsAmbientLightCount = this.sensorsAmbientLight.length;
                        this.sensorsMotionCount = this.sensorsMotion.length;
                        this.sensorsCount = this.sensorsName.length;


                        //update characteristics
                        if (this.sensorTemperatureServices) {
                            for (let i = 0; i < this.sensorsTemperatureCount; i++) {
                                const value = this.sensorsTemperature[i];
                                this.sensorTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorReferenceTemperatureServices) {
                            for (let i = 0; i < this.sensorsReferenceTemperatureCount; i++) {
                                const value = this.sensorsReferenceTemperature[i];
                                this.sensorReferenceTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorObjTemperatureServices) {
                            for (let i = 0; i < this.sensorsObjTemperatureCount; i++) {
                                const value = this.sensorsObjTemperature[i];
                                this.sensorObjTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorAmbTemperatureServices) {
                            for (let i = 0; i < this.sensorsAmbTemperatureCount; i++) {
                                const value = this.sensorsAmbTemperature[i];
                                this.sensorAmbTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorDewPointTemperatureServices) {
                            for (let i = 0; i < this.sensorsDewPointTemperatureCount; i++) {
                                const value = this.sensorsDewPointTemperature[i];
                                this.sensorDewPointTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorHumidityServices) {
                            for (let i = 0; i < this.sensorsHumidityCount; i++) {
                                const value = this.sensorsHumidity[i];
                                this.sensorHumidityServices[i].updateCharacteristic(Characteristic.CurrentRelativeHumidity, value);
                            };
                        };

                        if (this.sensorCarbonDioxydeServices) {
                            for (let i = 0; i < this.sensorsCarbonDioxydeCount; i++) {
                                const state = this.sensorsCarbonDioxyde[i] > 1000;
                                const value = this.sensorsCarbonDioxyde[i];
                                this.sensorCarbonDioxydeServices[i]
                                    .updateCharacteristic(Characteristic.CarbonDioxideDetected, state)
                                    .updateCharacteristic(Characteristic.CarbonDioxideLevel, value)
                                    .updateCharacteristic(Characteristic.CarbonDioxidePeakLevel, value);
                            };
                        };

                        if (this.sensorAmbientLightServices) {
                            for (let i = 0; i < this.sensorsAmbientLightCount; i++) {
                                const value = this.sensorsAmbientLight[i];
                                this.sensorAmbientLightServices[i].updateCharacteristic(Characteristic.CurrentAmbientLightLevel, value);
                            };
                        };

                        if (this.sensorMotionServices) {
                            for (let i = 0; i < this.sensorsMotionCount; i++) {
                                const state = this.sensorsMotion[i];
                                this.sensorMotionServices[i].updateCharacteristic(Characteristic.MotionDetected, state);
                            };
                        };
                    };
                    break;
                case 2: //lights
                    if (relaysCount > 0) {
                        this.lights = [];

                        for (let i = 0; i < relaysCount; i++) {
                            const friendlyName = this.friendlyNames[i];
                            const powerNr = i + 1;
                            const powerKey = relaysCount === 1 ? 'POWER' : `POWER${powerNr}`;
                            const power = powerStatus[powerKey] === 'ON';

                            //dimmer
                            const dimmer = statusSts.Dimmer ?? false;

                            //color temperature scale tasmota 153..500 to homekit 140..500
                            const colorTemp = statusSts.CT ?? false;
                            const colorTemperature = colorTemp !== false ? await this.scaleValue(colorTemp, 153, 500, 140, 500) : false;

                            //hasb color map to array number
                            const hsbColor = statusSts.HSBColor ? statusSts.HSBColor.split(',').map((value) => Number(value.trim())) : false;

                            //extract hsb colors
                            const [hue, saturation, brightness] = hsbColor !== false ? hsbColor : [false, false, false];

                            //brightness type and brightness
                            const brightnessType = brightness !== false ? 2 : dimmer !== false ? 1 : 0;
                            const bright = [0, dimmer, brightness][brightnessType];

                            //push to array
                            const light = {
                                friendlyName: friendlyName,
                                power: power,
                                brightness: bright,
                                colorTemperature: colorTemperature,
                                hue: hue,
                                saturation: saturation,
                                brightnessType: brightnessType
                            };
                            this.lights.push(light);

                            //update characteristics
                            if (this.switchOutletLightServices) {
                                this.switchOutletLightServices[i].updateCharacteristic(Characteristic.On, power);

                                if (brightnessType > 0) {
                                    this.switchOutletLightServices[i].updateCharacteristic(Characteristic.Brightness, bright);
                                };
                                if (colorTemperature !== false) {
                                    this.switchOutletLightServices[i].updateCharacteristic(Characteristic.ColorTemperature, colorTemperature);
                                };
                                if (hue !== false) {
                                    this.switchOutletLightServices[i].updateCharacteristic(Characteristic.Hue, hue);
                                };
                                if (saturation !== false) {
                                    this.switchOutletLightServices[i].updateCharacteristic(Characteristic.Saturation, saturation);
                                };
                            };

                            //log info
                            if (!this.disableLogInfo) {
                                this.emit('message', `${friendlyName}, state: ${power ? 'ON' : 'OFF'}`);
                                const logInfo = brightnessType === 0 ? false : this.emit('message', `brightness: ${bright} %`);
                                const logInfo1 = colorTemperature === false ? false : this.emit('message', `color temperatur: ${colorTemperature}`);
                                const logInfo2 = hue === false ? false : this.emit('message', `hue: ${hue} %`);
                                const logInfo3 = saturation === false ? false : this.emit('message', `saturation: ${saturation} %`);
                            };
                        };
                    };

                    //status SNS
                    if (statusSnsSupported) {
                        this.sensorsName = [];
                        this.sensorsTemperature = [];
                        this.sensorsReferenceTemperature = [];
                        this.sensorsObjTemperature = [];
                        this.sensorsAmbTemperature = [];
                        this.sensorsDewPointTemperature = [];
                        this.sensorsHumidity = [];
                        this.sensorsPressure = [];
                        this.sensorsGas = [];
                        this.sensorsCarbonDioxyde = [];
                        this.sensorsAmbientLight = [];
                        this.sensorsMotion = [];

                        const sensor = Object.entries(statusSns)
                            .filter(([key]) => SensorKeys.some(type => key.includes(type)))
                            .reduce((obj, [key, value]) => {
                                obj[key] = value;
                                return obj;
                            }, {});

                        for (const [key, value] of Object.entries(sensor)) {
                            const sensorName = key ?? `Sensor`;
                            const sensorData = value;

                            //sensors
                            const temperature = sensorData.Temperature ?? false;
                            const referenceTemperature = sensorData.ReferenceTemperature ?? false;
                            const objTemperature = sensorData.OBJTMP ?? false;
                            const ambTemperature = sensorData.AMBTMP ?? false;
                            const dewPointTemperature = sensorData.DewPoint ?? false;
                            const humidity = sensorData.Humidity ?? false;
                            const pressure = sensorData.Pressure ?? false;
                            const gas = sensorData.Gas ?? false;
                            const carbonDioxyde = sensorData.CarbonDioxyde ?? false;
                            const ambientLight = sensorData.Ambient ?? false;
                            const motion = sensorData === 'ON';

                            //energy
                            const energyTotalStartTime = sensorData.TotalStartTime ?? '';
                            const energyTotal = sensorData.Total ?? 0;
                            const energyPeriod = sensorData.Period ?? 0;
                            const energyYesterday = sensorData.Yesterday ?? 0;
                            const energyToday = sensorData.Today ?? 0;
                            const power = sensorData.Power ?? 0;
                            const apparentPower = sensorData.ApparentPower ?? 0;
                            const reactivePower = sensorData.ReactivePower ?? 0;
                            const factor = sensorData.Factor ?? 0;
                            const voltage = sensorData.Voltage ?? 0;
                            const current = sensorData.Current ?? 0;
                            const load = sensorData.Load ?? 0;

                            //push to array
                            this.sensorsName.push(sensorName);
                            const push1 = temperature ? this.sensorsTemperature.push(temperature) : false;
                            const push2 = referenceTemperature ? this.sensorsReferenceTemperature.push(referenceTemperature) : false;
                            const push3 = objTemperature ? this.sensorsAmbTemperature.push(objTemperature) : false;
                            const push4 = ambTemperature ? this.sensorsAmbTemperature.push(ambTemperature) : false;
                            const push5 = dewPointTemperature ? this.sensorsDewPointTemperature.push(dewPointTemperature) : false;
                            const push6 = humidity ? this.sensorsHumidity.push(humidity) : false;
                            const push7 = pressure ? this.sensorsPressure.push(pressure) : false;
                            const push8 = gas ? this.sensorsGas.push(gas) : false;
                            const push9 = carbonDioxyde ? this.sensorsCarbonDioxyde.push(carbonDioxyde) : false;
                            const push10 = ambientLight ? this.sensorsAmbientLight.push(ambientLight) : false;
                            const push11 = motion ? this.sensorsMotion.push(motion) : false;
                        };

                        this.time = sensorStatus.Time ?? '';
                        this.tempUnit = sensorStatus.TempUnit === 'C' ? '°C' : 'F';
                        this.pressureUnit = sensorStatus.PressureUnit ?? 'hPa';
                        this.sensorsTemperatureCount = this.sensorsTemperature.length;
                        this.sensorsReferenceTemperatureCount = this.sensorsReferenceTemperature.length;
                        this.sensorsObjTemperatureCount = this.sensorsObjTemperature.length;
                        this.sensorsAmbTemperatureCount = this.sensorsAmbTemperature.length;
                        this.sensorsDewPointTemperatureCount = this.sensorsDewPointTemperature.length;
                        this.sensorsHumidityCount = this.sensorsHumidity.length;
                        this.sensorsPressureCount = this.sensorsPressure.length;
                        this.sensorsGasCount = this.sensorsGas.length;
                        this.sensorsCarbonDioxydeCount = this.sensorsCarbonDioxyde.length;
                        this.sensorsAmbientLightCount = this.sensorsAmbientLight.length;
                        this.sensorsMotionCount = this.sensorsMotion.length;
                        this.sensorsCount = this.sensorsName.length;


                        //update characteristics
                        if (this.sensorTemperatureServices) {
                            for (let i = 0; i < this.sensorsTemperatureCount; i++) {
                                const value = this.sensorsTemperature[i];
                                this.sensorTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorReferenceTemperatureServices) {
                            for (let i = 0; i < this.sensorsReferenceTemperatureCount; i++) {
                                const value = this.sensorsReferenceTemperature[i];
                                this.sensorReferenceTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorObjTemperatureServices) {
                            for (let i = 0; i < this.sensorsObjTemperatureCount; i++) {
                                const value = this.sensorsObjTemperature[i];
                                this.sensorObjTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorAmbTemperatureServices) {
                            for (let i = 0; i < this.sensorsAmbTemperatureCount; i++) {
                                const value = this.sensorsAmbTemperature[i];
                                this.sensorAmbTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorDewPointTemperatureServices) {
                            for (let i = 0; i < this.sensorsDewPointTemperatureCount; i++) {
                                const value = this.sensorsDewPointTemperature[i];
                                this.sensorDewPointTemperatureServices[i].updateCharacteristic(Characteristic.CurrentTemperature, value);
                            };
                        };

                        if (this.sensorHumidityServices) {
                            for (let i = 0; i < this.sensorsHumidityCount; i++) {
                                const value = this.sensorsHumidity[i];
                                this.sensorHumidityServices[i].updateCharacteristic(Characteristic.CurrentRelativeHumidity, value);
                            };
                        };

                        if (this.sensorCarbonDioxydeServices) {
                            for (let i = 0; i < this.sensorsCarbonDioxydeCount; i++) {
                                const state = this.sensorsCarbonDioxyde[i] > 1000;
                                const value = this.sensorsCarbonDioxyde[i];
                                this.sensorCarbonDioxydeServices[i]
                                    .updateCharacteristic(Characteristic.CarbonDioxideDetected, state)
                                    .updateCharacteristic(Characteristic.CarbonDioxideLevel, value)
                                    .updateCharacteristic(Characteristic.CarbonDioxidePeakLevel, value);
                            };
                        };

                        if (this.sensorAmbientLightServices) {
                            for (let i = 0; i < this.sensorsAmbientLightCount; i++) {
                                const value = this.sensorsAmbientLight[i];
                                this.sensorAmbientLightServices[i].updateCharacteristic(Characteristic.CurrentAmbientLightLevel, value);
                            };
                        };

                        if (this.sensorMotionServices) {
                            for (let i = 0; i < this.sensorsMotionCount; i++) {
                                const state = this.sensorsMotion[i];
                                this.sensorMotionServices[i].updateCharacteristic(Characteristic.MotionDetected, state);
                            };
                        };
                    };

                    break;
            };

            return true;
        } catch (error) {
            throw new Error(`Check state error: ${error}`);
        };
    };

    async updateRemoteTemp() {
        try {
            //get remote temp
            const rmoteTempData = await this.axiosInstanceRemoteTemp();
            const remoteTemp = rmoteTempData.data ?? false;
            const debug = this.enableDebugMode ? this.emit('debug', `Remote temp: ${JSON.stringify(remoteTemp, null, 2)}`) : false;

            //set remote temp
            const temp = `${MiElHVAC.RemoteTemp}${remoteTemp}`
            await this.axiosInstance(temp);

            return true
        } catch (error) {
            throw new Error(`Update remote temperature error: ${error}`);
        };
    }

    async scaleValue(value, inMin, inMax, outMin, outMax) {
        const scaledValue = parseFloat((((Math.max(inMin, Math.min(inMax, value)) - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin).toFixed(0));
        return scaledValue;
    }

    async saveData(path, data) {
        try {
            data = JSON.stringify(data, null, 2);
            await fsPromises.writeFile(path, data);
            const debug = !this.enableDebugMode ? false : this.emit('debug', `Saved data: ${data}`);
            return true;
        } catch (error) {
            throw new Error(`Save data error: ${error}`);
        };
    }

    async readData(path) {
        try {
            const data = await fsPromises.readFile(path);
            return data;
        } catch (error) {
            throw new Error(`Read data error: ${error}`);
        };
    }

    async startImpulseGenerator() {
        try {
            //start impulse generator 
            const timers = [{ name: 'checkDeviceState', sampling: this.refreshInterval }];
            const remoteTempSensor = this.remoteTemperatureSensorEnable ? timers.push({ name: 'updateRemoteTemp', sampling: this.remoteTemperatureSensorRefreshInterval }) : false;
            await this.impulseGenerator.start(timers);
            return true;
        } catch (error) {
            throw new Error(`Impulse generator start error: ${error}`);
        };
    }

    deviceInfo() {
        this.emit('devInfo', `----- ${this.deviceName} -----`);
        this.emit('devInfo', `Manufacturer: Tasmota`);
        this.emit('devInfo', `Hardware: ${this.modelName}`);
        this.emit('devInfo', `Serialnr: ${this.serialNumber}`);
        this.emit('devInfo', `Firmware: ${this.firmwareRevision}`);
        const log = this.device === 0 ? this.emit('devInfo', `Sensor: MiELHVAC`) : false;
        const log1 = this.device > 0 && this.relaysCount > 0 ? this.emit('devInfo', `Relays: ${this.relaysCount}`) : false;
        const log2 = this.device > 0 && this.sensorsCount > 0 ? this.emit('devInfo', `Sensors: ${this.sensorsCount}`) : false;
        this.emit('devInfo', `----------------------------------`);
    };

    //prepare accessory
    async prepareAccessory() {
        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Accessory`) : false;

        try {
            //accessory
            const accessoryName = this.deviceName;
            const accessoryUUID = AccessoryUUID.generate(this.serialNumber);
            const accessoryCategory = this.device === 0 ? Categories.AIR_CONDITIONER : this.device === 1 ? (this.relaysDisplayType == 0 ? Categories.OUTLET : Categories.SWITCH) : this.device === 2 ? Categories.LIGHTBULB : Categories.OTHER;
            const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

            //Prepare information service
            const debug1 = this.enableDebugMode ? this.emit('debug', `Prepare Information Service`) : false;
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, this.mymanufacturer)
                .setCharacteristic(Characteristic.Model, this.modelName ?? 'Model Name')
                .setCharacteristic(Characteristic.SerialNumber, this.serialNumber ?? 'Serial Number')
                .setCharacteristic(Characteristic.FirmwareRevision, this.firmwareRevision.replace(/[a-zA-Z]/g, '') ?? '0')
                .setCharacteristic(Characteristic.ConfiguredName, accessoryName);

            //Prepare services 
            const debug2 = this.enableDebugMode ? this.emit('debug', `Prepare Services`) : false;
            switch (this.device) {
                case 0: //mielhvac
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare mitsubishi hvac service`) : false;
                    const autoDryFanMode = [MiElHVAC.SetMode.auto, MiElHVAC.SetMode.auto, MiElHVAC.SetMode.dry, MiElHVAC.SetMode.fan][this.autoDryFanMode]; //NONE, AUTO, DRY, FAN
                    const heatDryFanMode = [MiElHVAC.SetMode.heat, MiElHVAC.SetMode.heat, MiElHVAC.SetMode.dry, MiElHVAC.SetMode.fan][this.heatDryFanMode]; //NONE, HEAT, DRY, FAN
                    const coolDryFanMode = [MiElHVAC.SetMode.cool, MiElHVAC.SetMode.cool, MiElHVAC.SetMode.dry, MiElHVAC.SetMode.fan][this.coolDryFanMode]; //NONE, COOL, DRY, FAN

                    //services
                    this.miElHvacService = new Service.HeaterCooler(accessoryName, `HeaterCooler ${this.serialNumber}`);
                    this.miElHvacService.getCharacteristic(Characteristic.Active)
                        .onGet(async () => {
                            const state = MiElHVAC.powerstate; //this.accessory.power;
                            return state;
                        })
                        .onSet(async (state) => {
                            try {
                                // Only send "PowerOn" if the current powerstate is 0
                                if (state === 1 && MiElHVAC.powerstate === 0) {
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                    await this.axiosInstance(MiElHVAC.sendCommand());
                                    this.emit('warn', `Sendcommand TURNON`);
                                } else if (state === 0) {
                                    await this.axiosInstance(MiElHVAC.PowerOff);
                                    this.emit('warn', `Sendcommand TURNOFF`);
                                }
                                // Update stored powerstate
                                MiElHVAC.powerstate = state;
                    
                                if (!this.disableLogInfo) {
                                    this.emit('message', `Set power: ${state ? 'ON' : 'OFF'}`);
                                }
                            } catch (error) {
                                this.emit('warn', `Set power error: ${error}`);
                            }
                        });
                    
                    this.miElHvacService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
                        .onGet(async () => {
                            const value = MiElHVAC.lastSetModeInt + 1; // Inactive (0), Idle (1), Heating (2), Cooling (3) // this.accessory.currentOperationMode;
                            return value;
                        });
                    this.miElHvacService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
                        .setProps({
                            minValue: this.accessory.operationModeSetPropsMinValue,
                            maxValue: this.accessory.operationModeSetPropsMaxValue,
                            validValues: this.accessory.operationModeSetPropsValidValues
                        })
                        .onGet(async () => {
                            const value = MiElHVAC.lastSetModeInt; // this.accessory.targetOperationMode; //1 = HEAT, 2 = DRY 3 = COOL, 7 = FAN, 8 = AUTO Auto (0), Heat (1), Cool (2)
                            return value;
                        })
                        .onSet(async (value) => {
                            try {
                                switch (value) {
                                    case 0: //AUTO
                                        MiElHVAC.lastSetMode = "Auto";
                                        MiElHVAC.lastSetModeInt = 0;
                                        break;
                                    case 1: //HEAT
                                        MiElHVAC.lastSetMode = "Heat";
                                        MiElHVAC.lastSetModeInt = 1;
                                        MiElHVAC.lastSetTemp = MiElHVAC.lastSetTempHeat;
                                        break;
                                    case 2: //COOL
                                        MiElHVAC.lastSetMode = "Cool";
                                        MiElHVAC.lastSetModeInt = 2;
                                        MiElHVAC.lastSetTemp = MiElHVAC.lastSetTempCool;
                                        break;
                                };
                                
                                if (MiElHVAC.powerstate === 1) {
                                    await this.axiosInstance(MiElHVAC.sendCommand());
                                    this.emit('warn', `Sendcommand MODECHANGE`);
                                }

                                this.miElHvacService
                                        .updateCharacteristic(Characteristic.TargetHeaterCoolerState, value)
                                        .updateCharacteristic(Characteristic.CurrentHeaterCoolerState, value + 1)
                                        .updateCharacteristic(Characteristic.CurrentTemperature, MiElHVAC.lastSetTemp);

                                const info = this.disableLogInfo ? false : this.emit('message', `Set operation mode: ${MiElHVAC.OperationMode[value]}`);
                            } catch (error) {
                                this.emit('warn', `Set operation mode error: ${error}`);
                            };
                        });
                    this.miElHvacService.getCharacteristic(Characteristic.CurrentTemperature)
                        .onGet(async () => {
                            const value = MiElHVAC.lastSetTemp; //this.accessory.roomTemperature;
                            return value;
                        });
                    if (this.accessory.modelSupportsFanSpeed) {
                        this.miElHvacService.getCharacteristic(Characteristic.RotationSpeed)
                            .setProps({
                                minValue: 0,
                                maxValue: 4, //this.accessory.fanSpeedSetPropsMaxValue,
                                minStep: 1
                            })
                            .onGet(async () => {
                                const value = MiElHVAC.lastSetFan; //this.accessory.fanSpeed; //AUTO, 1, 2, 3, 4, 5
                                return value;
                            })
                            .onSet(async (value) => {
                                try { //fan speed mode
                                    MiElHVAC.lastSetFan = value;

                                    if (MiElHVAC.powerstate === 1) {
                                        await this.axiosInstance(MiElHVAC.sendCommand());
                                        this.emit('warn', `Sendcommand FANSPEED`);
                                    };
                                    
                                    // update fanspeed 4 button
                                    if (this.buttonsConfiguredCount > 0) {
                                        for (let i = 0; i < this.buttonsConfiguredCount; i++) {
                                            const button = this.buttonsConfigured[i];
                                            const mode = button.mode; //get button mode
                                            
                                            if (this.buttonsServices) { //update services
                                                if (mode === 34){
                                                    if (value === 4){
                                                        button.state = true;
                                                        this.emit('warn', `BUTTON FULLSPEED ON`);
                                                    } else {
                                                        button.state = false;
                                                        this.emit('warn', `BUTTON FULLSPEED OFF`);
                                                    };

                                                    const characteristicType = button.characteristicType;
                                                    this.buttonsServices[i].updateCharacteristic(characteristicType, button.state);
                                                };
                                            };
                                        };
                                    };
                                    

                                    const info = this.disableLogInfo ? false : this.emit('message', `Set fan speed: ${MiElHVAC.fanSpeeds[value]}`);
                                } catch (error) {
                                    this.emit('warn', `Set fan speed mode error: ${error}`);
                                };
                            });
                    };
                    if (this.accessory.swingMode) {
                        this.miElHvacService.getCharacteristic(Characteristic.SwingMode)
                            .onGet(async () => {
                                const value = this.accessory.swingMode;
                                return value;
                            })
                            .onSet(async (value) => {
                                try {
                                    switch (value) {
                                        case 0:
                                            await this.axiosInstance(MiElHVAC.SetSwingV[this.previousStateSwingV]);
                                            await this.axiosInstance(MiElHVAC.SetSwingH[this.previousStateSwingH]);
                                            break;
                                        case 1:
                                            //set vane v
                                            this.previousStateSwingV = this.accessory.vaneVerticalDirection;
                                            await this.axiosInstance(MiElHVAC.SetSwingV.swing);

                                            //set vane h
                                            this.previousStateSwingH = this.accessory.vaneHorizontalDirection;
                                            await this.axiosInstance(MiElHVAC.SetSwingH.swing);
                                            break;
                                    }
                                    const info = this.disableLogInfo ? false : this.emit('message', `Set air direction mode: ${MiElHVAC.SwingMode[value]}`);
                                } catch (error) {
                                    this.emit('warn', `Set vane swing mode error: ${error}`);
                                };
                            });
                    };
                    this.miElHvacService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
                        .setProps({
                            minValue: 16,
                            maxValue: 22,
                            minStep: this.accessory.temperatureIncrement
                        })
                        .onGet(async () => {
                            const value = MiElHVAC.lastSetTempCool; // this.accessory.operationMode === 'auto' ? this.accessory.defaultCoolingSetTemperature : this.accessory.setTemperature;
                            return value;
                        })
                        .onSet(async (value) => {
                            try {
                                if (this.accessory.operationMode === 'auto') {
                                    await this.saveData(this.defaultCoolingSetTemperatureFile, value);
                                    value = (value + this.accessory.defaultHeatingSetTemperature) / 2;
                                }

                                MiElHVAC.lastSetTemp = value;
                                MiElHVAC.lastSetTempCool = value;

                                this.miElHvacService
                                        .updateCharacteristic(Characteristic.CurrentTemperature, value)
                                        .updateCharacteristic(Characteristic.CoolingThresholdTemperature, value);
                                
                                if (MiElHVAC.powerstate === 1) {
                                    await this.axiosInstance(MiElHVAC.sendCommand());
                                    this.emit('warn', `Sendcommand COOLTEMPSET`);
                                }

                                const info = this.disableLogInfo ? false : this.emit('message', `Set ${this.accessory.operationMode === 'auto' ? 'cooling threshold temperature' : 'temperature'}: ${value}${this.accessory.temperatureUnit}`);
                            } catch (error) {
                                this.emit('warn', `Set cooling threshold temperature error: ${error}`);
                            };
                        });
                    if (this.accessory.modelSupportsHeat) {
                        this.miElHvacService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
                            .setProps({
                                minValue: 18,
                                maxValue: 30,
                                minStep: this.accessory.temperatureIncrement
                            })
                            .onGet(async () => {
                                const value =  MiElHVAC.lastSetTempHeat; //this.accessory.operationMode === 'auto' ? this.accessory.defaultHeatingSetTemperature : this.accessory.setTemperature;
                                return value;
                            })
                            .onSet(async (value) => {
                                try {
                                    if (this.accessory.operationMode === 'auto') {
                                        await this.saveData(this.defaultHeatingSetTemperatureFile, value);
                                        value = (value + this.accessory.defaultCoolingSetTemperature) / 2;
                                    }

                                    MiElHVAC.lastSetTemp = value;
                                    MiElHVAC.lastSetTempHeat = value;

                                    this.miElHvacService
                                            .updateCharacteristic(Characteristic.CurrentTemperature, value)
                                            .updateCharacteristic(Characteristic.HeatingThresholdTemperature, value);
                                
                                    if (MiElHVAC.powerstate === 1) {
                                        await this.axiosInstance(MiElHVAC.sendCommand());
                                        this.emit('warn', `Sendcommand HEATTEMPSET`);
                                    }

                                    const info = this.disableLogInfo ? false : this.emit('message', `Set ${this.accessory.operationMode === 'auto' ? 'heating threshold temperature' : 'temperature'}: ${value}${this.accessory.temperatureUnit}`);
                                } catch (error) {
                                    this.emit('warn', `Set heating threshold temperature error: ${error}`);
                                };
                            });
                    };
                    this.miElHvacService.getCharacteristic(Characteristic.LockPhysicalControls)
                        .onGet(async () => {
                            const value = 0; //this.accessory.lockPhysicalControl;
                            return value;
                        })
                        .onSet(async (value) => {
                            try {
                                const lock = [MiElHVAC.SetProhibit.off, MiElHVAC.SetProhibit.all][value];
                                await this.axiosInstance(lock);
                                const info = this.disableLogInfo ? false : this.emit('message', `Set local physical controls: ${value ? 'LOCK' : 'UNLOCK'}`);
                            } catch (error) {
                                this.emit('warn', `Set lock physical controls error: ${error}`);
                            };
                        });
                    this.miElHvacService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
                        .onGet(async () => {
                            const value = 0; // this.accessory.useFahrenheit;
                            return value;
                        })
                        .onSet(async (value) => {
                            try {
                                const unit = [MiElHVAC.SetDisplayUnit.c, MiElHVAC.SetDisplayUnit.f][value];
                                //await this.axiosInstance(unit);
                                const info = this.disableLogInfo ? false : this.emit('message', `Set temperature display unit: ${TemperatureDisplayUnits[value]}`);
                            } catch (error) {
                                this.emit('warn', `Set temperature display unit error: ${error}`);
                            };
                        });
                    accessory.addService(this.miElHvacService);

                    //presets services
                    if (this.presetsConfiguredCount > 0) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare presets services`) : false;
                        this.presetsServices = [];

                        for (let i = 0; i < this.presetsConfiguredCount; i++) {
                            const preset = this.presetsConfigured[i];

                            //get preset name
                            const presetName = preset.name;

                            //get preset name prefix
                            const presetNamePrefix = preset.namePrefix;

                            const serviceName = presetNamePrefix ? `${accessoryName} ${presetName}` : presetName;
                            const serviceType = preset.serviceType;
                            const characteristicType = preset.characteristicType;
                            const presetService = new serviceType(serviceName, `Preset ${i}`);
                            presetService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            presetService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            presetService.getCharacteristic(characteristicType)
                                .onGet(async () => {
                                    const state = preset.state;
                                    return state;
                                })
                                .onSet(async (state) => {
                                    try {
                                        let data = '';
                                        switch (state) {
                                            case true:
                                                // const setPower = !this.accessory.power ? await this.axiosInstance(MiElHVAC.PowerOn) : false;
                                                data = MiElHVAC.SetMode[preset.mode];
                                                await this.axiosInstance(data);
                                                data = `${MiElHVAC.SetTemp}${preset.setTemp}`;
                                                await this.axiosInstance(data);
                                                data = MiElHVAC.SetFanSpeed[preset.fanSpeed];
                                                await this.axiosInstance(data);
                                                data = MiElHVAC.SetSwingV[preset.swingV];
                                                await this.axiosInstance(data);
                                                data = MiElHVAC.SetSwingH[preset.swingH];
                                                await this.axiosInstance(data);
                                                break;
                                            case false:
                                                break;
                                        };

                                        const info = this.disableLogInfo || !state ? false : this.emit('message', `Set: ${presetName}`);
                                        await new Promise(resolve => setTimeout(resolve, 250));
                                    } catch (error) {
                                        this.emit('warn', `Set preset error: ${error}`);
                                    };
                                });
                            this.presetsServices.push(presetService);
                            accessory.addService(presetService);
                        };
                    };

                    //buttons services
                    if (this.buttonsConfiguredCount > 0) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare buttons services`) : false;
                        this.buttonsServices = [];

                        for (let i = 0; i < this.buttonsConfiguredCount; i++) {
                            const button = this.buttonsConfigured[i];

                            //get button mode
                            const mode = button.mode;

                            //get button name
                            const buttonName = button.name;

                            //get button name prefix
                            const buttonNamePrefix = button.namePrefix;

                            const serviceName = buttonNamePrefix ? `${accessoryName} ${buttonName}` : buttonName;
                            const serviceType = button.serviceType;
                            const characteristicType = button.characteristicType;
                            const buttonService = new serviceType(serviceName, `Button ${i}`);
                            buttonService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            buttonService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            buttonService.getCharacteristic(characteristicType)
                                .onGet(async () => {
                                    const state = button.state;
                                    return state;
                                })
                                .onSet(async (state) => {
                                    try {
                                        let data = '';
                                        switch (mode) {
                                            case 0: //POWER ON,OFF
                                                // data = state ? MiElHVAC.PowerOn : MiElHVAC.PowerOff;
                                                break;
                                            case 1: //OPERATING MODE HEAT
                                                button.previousValue = state ? MiElHVAC.SetMode[this.accessory.operationMode] : button.previousValue;
                                                data = state ? MiElHVAC.SetMode.heat : button.previousValue;
                                                break;
                                            case 2: //OPERATING MODE DRY
                                                button.previousValue = state ? MiElHVAC.SetMode[this.accessory.operationMode] : button.previousValue;
                                                data = state ? MiElHVAC.SetMode.dry : button.previousValue;
                                                break
                                            case 3: //OPERATING MODE COOL
                                                button.previousValue = state ? MiElHVAC.SetMode[this.accessory.operationMode] : button.previousValue;
                                                data = state ? MiElHVAC.SetMode.cool : button.previousValue;
                                                break;
                                            case 4: //OPERATING MODE FAN
                                                button.previousValue = state ? MiElHVAC.SetMode[this.accessory.operationMode] : button.previousValue;
                                                data = state ? MiElHVAC.SetMode.fan : button.previousValue;
                                                break;
                                            case 5: //OPERATING MODE AUTO
                                                button.previousValue = state ? MiElHVAC.SetMode[this.accessory.operationMode] : button.previousValue;
                                                data = state ? MiElHVAC.SetMode.auto : button.previousValue;
                                                break;
                                            case 6: //OPERATING MODE PURIFY
                                                button.previousValue = state ? MiElHVAC.SetMode[this.accessory.operationMode] : button.previousValue;
                                                data = state ? MiElHVAC.SetMode.purify : button.previousValue;
                                                break;
                                            case 10: //VANE H AUTO
                                                button.previousValue = state ? MiElHVAC.SetSwingH[this.accessory.vaneHorizontalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingH.auto : button.previousValue;
                                                break;
                                            case 11: //VANE H LEFT
                                                button.previousValue = state ? MiElHVAC.SetSwingH[this.accessory.vaneHorizontalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingH.left : button.previousValue;
                                                break;
                                            case 12: //VANE H LEFT MIDDLE
                                                button.previousValue = state ? MiElHVAC.SetSwingH[this.accessory.vaneHorizontalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingH.left_middle : button.previousValue;
                                                break;
                                            case 13: //VANE H CENTER
                                                button.previousValue = state ? MiElHVAC.SetSwingH[this.accessory.vaneHorizontalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingH.center : button.previousValue;
                                                break;
                                            case 14: //VANE H RIGHT MIDDLE
                                                button.previousValue = state ? MiElHVAC.SetSwingH[this.accessory.vaneHorizontalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingH.right_middle : button.previousValue;
                                                break;
                                            case 15: //VANE H RIGHT
                                                button.previousValue = state ? MiElHVAC.SetSwingH[this.accessory.vaneHorizontalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingH.right : button.previousValue;
                                                break;
                                            case 16: //VANE H SPLIT
                                                button.previousValue = state ? MiElHVAC.SetSwingH[this.accessory.vaneHorizontalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingH.split : button.previousValue;
                                                break;
                                            case 17: //VANE H SWING
                                                button.previousValue = state ? MiElHVAC.SetSwingH[this.accessory.vaneHorizontalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingH.swing : button.previousValue;
                                                break;
                                            case 20: //VANE V AUTO
                                                button.previousValue = state ? MiElHVAC.SetSwingV[this.accessory.vaneVerticalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingV.auto : button.previousValue;
                                                break;
                                            case 21: //VANE V UP
                                                button.previousValue = state ? MiElHVAC.SetSwingV[this.accessory.vaneVerticalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingV.up : button.previousValue;
                                                break;
                                            case 22: //VANE V UP MIDDLE
                                                button.previousValue = state ? MiElHVAC.SetSwingV[this.accessory.vaneVerticalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingV.up_middle : button.previousValue;
                                                break;
                                            case 23: //VANE V CENTER
                                                button.previousValue = state ? MiElHVAC.SetSwingV[this.accessory.vaneVerticalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingV.center : button.previousValue;
                                                break;
                                            case 24: //VANE V DOWN MIDDLE
                                                button.previousValue = state ? MiElHVAC.SetSwingV[this.accessory.vaneVerticalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingV.down_middle : button.previousValue;
                                                break;
                                            case 25: //VANE V DOWN
                                                button.previousValue = state ? MiElHVAC.SetSwingV[this.accessory.vaneVerticalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingV.down : button.previousValue;
                                                break;
                                            case 26: //VANE V SWING
                                                button.previousValue = state ? MiElHVAC.SetSwingV[this.accessory.vaneVerticalDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetSwingV.swing : button.previousValue;
                                                break;
                                            case 30: //FAN SPEED AUTO
                                                button.previousValue = state ? MiElHVAC.SetFanSpeed[this.accessory.fanSpeed] : button.previousValue;
                                                data = state ? MiElHVAC.SetFanSpeed.auto : button.previousValue;
                                                break;
                                            case 31: //FAN SPEED QUIET
                                                button.previousValue = state ? MiElHVAC.SetFanSpeed[this.accessory.fanSpeed] : button.previousValue;
                                                data = state ? MiElHVAC.SetFanSpeed.quiet : button.previousValue;
                                                break;
                                            case 32: //FAN SPEED 1
                                                button.previousValue = state ? MiElHVAC.SetFanSpeed[this.accessory.fanSpeed] : button.previousValue;
                                                data = state ? MiElHVAC.SetFanSpeed['1'] : button.previousValue;
                                                break;
                                            case 33: //FAN SPEED 2
                                                button.previousValue = state ? MiElHVAC.SetFanSpeed[this.accessory.fanSpeed] : button.previousValue;
                                                data = state ? MiElHVAC.SetFanSpeed['2'] : button.previousValue;
                                                break;
                                            case 34: //FAN 3
                                                if (state){
                                                    MiElHVAC.lastSetFan = 4;
                                                } else if (!state) { 
                                                    MiElHVAC.lastSetFan = 0;
                                                }
                                                break;
                                            case 35: //FAN SPEED 4
                                                button.previousValue = state ? MiElHVAC.SetFanSpeed[this.accessory.fanSpeed] : button.previousValue;
                                                data = state ? MiElHVAC.SetFanSpeed['4'] : button.previousValue;
                                                break;
                                            case 40: //AIR DIRECTION EVEN
                                                button.previousValue = state ? MiElHVAC.SetAirDirection[this.accessory.airDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetAirDirection.even : button.previousValue;
                                                break;
                                            case 41: //AIR DIRECTION INDIRECT
                                                button.previousValue = state ? MiElHVAC.SetAirDirection[this.accessory.airDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetAirDirection.indirect : button.previousValue;
                                                break;
                                            case 42: //AIR DIRECTION DIRECT
                                                button.previousValue = state ? MiElHVAC.SetAirDirection[this.accessory.airDirection] : button.previousValue;
                                                data = state ? MiElHVAC.SetAirDirection.direct : button.previousValue;
                                                break;
                                            case 50: //PHYSICAL LOCK CONTROLS
                                                button.previousValue = state ? MiElHVAC.SetProhibit[this.accessory.prohibit] : button.previousValue;
                                                data = state ? MiElHVAC.SetProhibit.all : button.previousValue;
                                                break;
                                            case 51: //PHYSICAL LOCK CONTROLS POWER
                                                button.previousValue = state ? MiElHVAC.SetProhibit[this.accessory.prohibit] : button.previousValue;
                                                data = state ? MiElHVAC.SetProhibit.power : button.previousValue;
                                                break;
                                            case 52: //PHYSICAL LOCK CONTROLS MODE
                                                button.previousValue = state ? MiElHVAC.SetProhibit[this.accessory.prohibit] : button.previousValue;
                                                data = state ? MiElHVAC.SetProhibit.mode : button.previousValue;
                                                break;
                                            case 53: //PHYSICAL LOCK CONTROLS TEMP
                                                button.previousValue = state ? MiElHVAC.SetProhibit[this.accessory.prohibit] : button.previousValue;
                                                data = state ? MiElHVAC.SetProhibit.temp : button.previousValue;
                                                break;
                                            default:
                                                this.emit('message', `Unknown button mode: ${mode}`);
                                                return
                                        };
                                        if (MiElHVAC.powerstate === 1){
                                            data = MiElHVAC.sendCommand()
                                            this.emit('warn', `Sendcommand BUTTON`);
                                            await this.axiosInstance(data);
                                        }
                                        button.state = state
                                        const info = this.disableLogInfo ? false : mode > 0 ? this.emit('message', `${state ? `Set: ${buttonName}` : `Unset: ${buttonName}, Set: ${button.previousValue}`}`) : `Set: ${buttonName}`;
                                        await new Promise(resolve => setTimeout(resolve, 250));
                                    } catch (error) {
                                        this.emit('warn', `Set button error: ${error}`);
                                    };
                                });
                            this.buttonsServices.push(buttonService);
                            accessory.addService(buttonService);
                        };
                    };

                    //sensors services
                    if (this.sensorsConfiguredCount > 0) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare sensors services`) : false;
                        this.sensorsServices = [];

                        for (let i = 0; i < this.sensorsConfiguredCount; i++) {
                            const sensor = this.sensorsConfigured[i];

                            //get sensor mode
                            const mode = sensor.mode;

                            //get sensor name
                            const sensorName = sensor.name;

                            //get sensor name prefix
                            const sensorNamePrefix = sensor.namePrefix;

                            const serviceName = sensorNamePrefix ? `${accessoryName} ${sensorName}` : sensorName;
                            const serviceType = sensor.serviceType;
                            const characteristicType = sensor.characteristicType;
                            const sensorService = new serviceType(serviceName, `Sensor ${i}`);
                            sensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            sensorService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            sensorService.getCharacteristic(characteristicType)
                                .onGet(async () => {
                                    const state = sensor.state;
                                    return state;
                                });
                            this.sensorsServices.push(sensorService);
                            accessory.addService(sensorService);
                        };
                    };

                    //room temperature sensor service
                    if (this.temperatureSensor && this.accessory.roomTemperature !== null) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare room temperature sensor service`) : false;
                        this.roomTemperatureSensorService = new Service.TemperatureSensor(`${serviceName} Room`, `Room Temperature Sensor`);
                        this.roomTemperatureSensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        this.roomTemperatureSensorService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Room`);
                        this.roomTemperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature)
                            .setProps({
                                minValue: -35,
                                maxValue: 150,
                                minStep: 0.5
                            })
                            .onGet(async () => {
                                const state = this.accessory.roomTemperature;
                                return state;
                            })
                        accessory.addService(this.roomTemperatureSensorService);
                    };

                    //outdoor temperature sensor service
                    if (this.temperatureSensorOutdoor && this.accessory.hasOutdoorTemperature && this.accessory.outdoorTemperature !== null) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare outdoor temperature sensor service`) : false;
                        this.outdoorTemperatureSensorService = new Service.TemperatureSensor(`${serviceName} Outdoor`, `Outdoor Temperature Sensor`);
                        this.outdoorTemperatureSensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        this.outdoorTemperatureSensorService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Outdoor`);
                        this.outdoorTemperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature)
                            .setProps({
                                minValue: -35,
                                maxValue: 150,
                                minStep: 0.5
                            })
                            .onGet(async () => {
                                const state = this.accessory.outdoorTemperature;
                                return state;
                            })
                        accessory.addService(this.outdoorTemperatureSensorService);
                    };
                    break;
                case 1: //switches, outlets
                    if (this.switchesOutlets.length > 0) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Switch/Outlet Services`) : false;
                        this.switchOutletLightServices = [];

                        for (let i = 0; i < this.switchesOutlets.length; i++) {
                            const friendlyName = this.switchesOutlets[i].friendlyName;
                            const serviceNameSwitchOutlet = this.relaysNamePrefix ? `${accessoryName} ${friendlyName}` : friendlyName;
                            const serviceSwitchOutlet = [Service.Outlet, Service.Switch][this.relaysDisplayType];
                            const switchOutletLightService = accessory.addService(serviceSwitchOutlet, serviceNameSwitchOutlet, `Power ${i}`)
                            switchOutletLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            switchOutletLightService.setCharacteristic(Characteristic.ConfiguredName, serviceNameSwitchOutlet);
                            switchOutletLightService.getCharacteristic(Characteristic.On)
                                .onGet(async () => {
                                    const state = this.switchesOutlets[i].power ?? false;
                                    return state;
                                })
                                .onSet(async (state) => {
                                    try {
                                        const relayNr = i + 1;
                                        const powerOn = this.switchesOutlets.length === 1 ? ApiCommands.PowerOn : `${ApiCommands.Power}${relayNr}${ApiCommands.On}`;
                                        const powerOff = this.switchesOutlets.length === 1 ? ApiCommands.PowerOff : `${ApiCommands.Power}${relayNr}${ApiCommands.Off}`;
                                        state = state ? powerOn : powerOff;

                                        await this.axiosInstance(state);
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
                                    } catch (error) {
                                        this.emit('warn', `${friendlyName}, set state error: ${error}`);
                                    }
                                });
                            this.switchOutletLightServices.push(switchOutletLightService);
                        };
                    };

                    //sensors
                    if (this.sensorsCount > 0) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Sensor Services`) : false;

                        //temperature
                        const sensorsTemperatureCount = this.sensorsTemperatureCount;
                        if (sensorsTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Temperature Sensor Services`) : false;
                            this.sensorTemperatureServices = [];
                            for (let i = 0; i < sensorsTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Temperature` : `${sensorName} Temperature`;
                                const sensorTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Temperature Sensor ${i}`);
                                sensorTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} temperature: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorTemperatureServices.push(sensorTemperatureService);
                            };
                        }

                        //reference temperature
                        const sensorsReferenceTemperatureCount = this.sensorsReferenceTemperatureCount;
                        if (sensorsReferenceTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Reference Temperature Sensor Services`) : false;
                            this.sensorReferenceTemperatureServices = [];
                            for (let i = 0; i < sensorsReferenceTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Reference Temperature` : `${sensorName} Reference Temperature`;
                                const sensorReferenceTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Reference Temperature Sensor ${i}`);
                                sensorReferenceTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorReferenceTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorReferenceTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsReferenceTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} reference temperature: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorReferenceTemperatureServices.push(sensorReferenceTemperatureService);
                            };
                        }

                        //object temperature
                        const sensorsObjTemperatureCount = this.sensorsObjTemperatureCount;
                        if (sensorsObjTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Obj Temperature Sensor Services`) : false;
                            this.sensorObjTemperatureServices = [];
                            for (let i = 0; i < sensorsObjTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Obj Temperature` : `${sensorName} Obj Temperature`;
                                const sensorObjTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Obj Temperature Sensor ${i}`);
                                sensorObjTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorObjTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorObjTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsObjTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} obj temperature: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorObjTemperatureServices.push(sensorObjTemperatureService);
                            };
                        }

                        //ambient temperature
                        const sensorsAmbTemperatureCount = this.sensorsAmbTemperatureCount;
                        if (sensorsAmbTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Amb Temperature Sensor Services`) : false;
                            this.sensorAmbTemperatureServices = [];
                            for (let i = 0; i < sensorsAmbTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Amb Temperature` : `${sensorName} Amb Temperature`;
                                const sensorAmbTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Amb Temperature Sensor ${i}`);
                                sensorAmbTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorAmbTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorAmbTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsAmbTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} amb temperature: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorAmbTemperatureServices.push(sensorAmbTemperatureService);
                            };
                        }

                        //dew point temperature
                        const sensorsDewPointTemperatureCount = this.sensorsDewPointTemperatureCount;
                        if (sensorsDewPointTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Dew Point Temperature Sensor Services`) : false;
                            this.sensorDewPointTemperatureServices = [];
                            for (let i = 0; i < sensorsDewPointTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Dew Point` : `${sensorName} Dew Point`;
                                const sensorDewPointTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Dew Point Temperature Sensor ${i}`);
                                sensorDewPointTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorDewPointTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorDewPointTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsDewPointTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} dew point: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorDewPointTemperatureServices.push(sensorDewPointTemperatureService);
                            };
                        }

                        //humidity
                        const sensorsHumidityCount = this.sensorsHumidityCount;
                        if (sensorsHumidityCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Humidity Sensor Services`) : false;
                            this.sensorHumidityServices = [];
                            for (let i = 0; i < sensorsHumidityCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Humidity` : `${sensorName} Humidity`;
                                const sensorHumidityService = accessory.addService(Service.HumiditySensor, serviceName, `Humidity Sensor ${i}`);
                                sensorHumidityService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorHumidityService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorHumidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                                    .onGet(async () => {
                                        const value = this.sensorsHumidity[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} humidity: ${value} %`);
                                        return value;
                                    });
                                this.sensorHumidityServices.push(sensorHumidityService);
                            };
                        }

                        //pressure

                        //gas

                        //carbon dioxyde
                        const sensorsCarbonDioxydeCount = this.sensorsCarbonDioxydeCount;
                        if (sensorsCarbonDioxydeCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Carbon Dioxyde Sensor Services`) : false;
                            this.sensorCarbonDioxydeServices = [];
                            for (let i = 0; i < sensorsCarbonDioxydeCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Carbon Dioxyde` : `${sensorName} Carbon Dioxyde`;
                                const sensorCarbonDioxydeService = accessory.addService(Service.CarbonDioxideSensor, serviceName, `Carbon Dioxyde Sensor ${i}`);
                                sensorCarbonDioxydeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorCarbonDioxydeService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideDetected)
                                    .onGet(async () => {
                                        const state = this.sensorsCarbonDioxyde[i] > 1000;
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} carbon dioxyde detected: ${state ? 'Yes' : 'No'}`);
                                        return state;
                                    });
                                sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideLevel)
                                    .onGet(async () => {
                                        const value = this.sensorsCarbonDioxyde[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} carbon dioxyde level: ${value} ppm`);
                                        return value;
                                    });
                                sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxidePeakLevel)
                                    .onGet(async () => {
                                        const value = this.sensorsCarbonDioxyde[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} carbon dioxyde peak level: ${value} ppm`);
                                        return value;
                                    });
                                this.sensorCarbonDioxydeServices.push(sensorCarbonDioxydeService);
                            };
                        }

                        //ambient light
                        const sensorsAmbientLightCount = this.sensorsAmbientLightCount;
                        if (sensorsAmbientLightCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Ambient Light Sensor Services`) : false;
                            this.sensorAmbientLightServices = [];
                            for (let i = 0; i < sensorsAmbientLightCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Ambient Light` : `${sensorName} Ambient Light`;
                                const sensorAmbientLightService = accessory.addService(Service.LightSensor, serviceName, `Ambient Light Sensor ${i}`);
                                sensorAmbientLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorAmbientLightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorAmbientLightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                                    .onGet(async () => {
                                        const value = this.sensorsAmbientLight[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} ambient light: ${value} lx`);
                                        return value;
                                    });
                                this.sensorAmbientLightServices.push(sensorAmbientLightService);
                            };
                        }

                        //motion
                        const sensorsMotionCount = this.sensorsMotionCount;
                        if (sensorsMotionCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Motion Sensor Services`) : false;
                            this.sensorMotionServices = [];
                            for (let i = 0; i < sensorsMotionCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Motion` : `${sensorName} Motion`;
                                const sensorMotionService = accessory.addService(Service.MotionSensor, serviceName, `Motion Sensor ${i}`);
                                sensorMotionService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorMotionService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorMotionService.getCharacteristic(Characteristic.MotionDetected)
                                    .onGet(async () => {
                                        const state = this.sensorsMotion[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} motion: ${state ? 'ON' : 'OFF'}`);
                                        return state;
                                    });
                                this.sensorMotionServices.push(sensorMotionService);
                            };
                        }
                    };
                    break;
                case 2: //lights
                    if (this.lights.length > 0) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Light Services`) : false;
                        this.switchOutletLightServices = [];

                        for (let i = 0; i < this.lights.length; i++) {
                            const friendlyName = this.lights[i].friendlyName;
                            const serviceNameLightbulb = this.lightsNamePrefix ? `${accessoryName} ${friendlyName}` : friendlyName;
                            const switchOutletLightService = accessory.addService(Service.Lightbulb, serviceNameLightbulb, `Light ${i}`)
                            switchOutletLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            switchOutletLightService.setCharacteristic(Characteristic.ConfiguredName, serviceNameLightbulb);
                            switchOutletLightService.getCharacteristic(Characteristic.On)
                                .onGet(async () => {
                                    const state = this.lights[i].power;
                                    return state;
                                })
                                .onSet(async (state) => {
                                    try {
                                        const relayNr = i + 1;
                                        const powerOn = this.lights.length === 1 ? ApiCommands.PowerOn : `${ApiCommands.Power}${relayNr}${ApiCommands.On}`;
                                        const powerOff = this.lights.length === 1 ? ApiCommands.PowerOff : `${ApiCommands.Power}${relayNr}${ApiCommands.Off}`;
                                        state = state ? powerOn : powerOff;

                                        await this.axiosInstance(state);
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
                                    } catch (error) {
                                        this.emit('warn', `${friendlyName}, set state error: ${error}`);
                                    }
                                });
                            if (this.lights[i].brightnessType > 0) {
                                switchOutletLightService.getCharacteristic(Characteristic.Brightness)
                                    .onGet(async () => {
                                        const value = this.lights[i].brightness;
                                        return value;
                                    })
                                    .onSet(async (value) => {
                                        try {
                                            const brightness = ['', `${ApiCommands.Dimmer}${value}`, `${ApiCommands.HSBBrightness}${value}`][this.lights[i].brightnessType]; //0..100
                                            await this.axiosInstance(brightness);
                                            const logInfo = this.disableLogInfo ? false : this.emit('message', `set brightness: ${value} %`);
                                        } catch (error) {
                                            this.emit('warn', `set brightness error: ${error}`);
                                        }
                                    });
                            };
                            if (this.lights[i].colorTemperature !== false) {
                                switchOutletLightService.getCharacteristic(Characteristic.ColorTemperature)
                                    .onGet(async () => {
                                        const value = this.lights[i].colorTemperature;
                                        return value;
                                    })
                                    .onSet(async (value) => {
                                        try {
                                            value = await this.scaleValue(value, 140, 500, 153, 500);
                                            const colorTemperature = `${ApiCommands.ColorTemperature}${value}`; //153..500
                                            await this.axiosInstance(colorTemperature);
                                            const logInfo = this.disableLogInfo ? false : this.emit('message', `set color temperatur: ${value} °`);
                                        } catch (error) {
                                            this.emit('warn', `set color temperatur error: ${error}`);
                                        }
                                    });
                            };
                            if (this.lights[i].hue !== false) {
                                switchOutletLightService.getCharacteristic(Characteristic.Hue)
                                    .onGet(async () => {
                                        const value = this.lights[i].hue;
                                        return value;
                                    })
                                    .onSet(async (value) => {
                                        try {
                                            const hue = `${ApiCommands.HSBHue}${value}`; //0..360
                                            await this.axiosInstance(hue);
                                            const logInfo = this.disableLogInfo ? false : this.emit('message', `set hue: ${value} %`);
                                        } catch (error) {
                                            this.emit('warn', `set hue error: ${error}`);
                                        }
                                    });
                            };
                            if (this.lights[i].saturation !== false) {
                                switchOutletLightService.getCharacteristic(Characteristic.Saturation)
                                    .onGet(async () => {
                                        const value = this.lights[i].saturation;
                                        return value;
                                    })
                                    .onSet(async (value) => {
                                        try {
                                            const saturation = `${ApiCommands.HSBSaturation}${value}`; //0..100
                                            await this.axiosInstance(saturation);
                                            const logInfo = this.disableLogInfo ? false : this.emit('message', `set saturation: ${value} °`);
                                        } catch (error) {
                                            this.emit('warn', `set saturation error: ${error}`);
                                        }
                                    });
                            };
                            this.switchOutletLightServices.push(switchOutletLightService);
                        };
                    };

                    //sensors
                    if (this.sensorsCount > 0) {
                        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Sensor Services`) : false;

                        //temperature
                        const sensorsTemperatureCount = this.sensorsTemperatureCount;
                        if (sensorsTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Temperature Sensor Services`) : false;
                            this.sensorTemperatureServices = [];
                            for (let i = 0; i < sensorsTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Temperature` : `${sensorName} Temperature`;
                                const sensorTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Temperature Sensor ${i}`);
                                sensorTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} temperature: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorTemperatureServices.push(sensorTemperatureService);
                            };
                        }

                        //reference temperature
                        const sensorsReferenceTemperatureCount = this.sensorsReferenceTemperatureCount;
                        if (sensorsReferenceTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Reference Temperature Sensor Services`) : false;
                            this.sensorReferenceTemperatureServices = [];
                            for (let i = 0; i < sensorsReferenceTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Reference Temperature` : `${sensorName} Reference Temperature`;
                                const sensorReferenceTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Reference Temperature Sensor ${i}`);
                                sensorReferenceTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorReferenceTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorReferenceTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsReferenceTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} reference temperature: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorReferenceTemperatureServices.push(sensorReferenceTemperatureService);
                            };
                        }

                        //object temperature
                        const sensorsObjTemperatureCount = this.sensorsObjTemperatureCount;
                        if (sensorsObjTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Obj Temperature Sensor Services`) : false;
                            this.sensorObjTemperatureServices = [];
                            for (let i = 0; i < sensorsObjTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Obj Temperature` : `${sensorName} Obj Temperature`;
                                const sensorObjTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Obj Temperature Sensor ${i}`);
                                sensorObjTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorObjTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorObjTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsObjTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} obj temperature: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorObjTemperatureServices.push(sensorObjTemperatureService);
                            };
                        }

                        //ambient temperature
                        const sensorsAmbTemperatureCount = this.sensorsAmbTemperatureCount;
                        if (sensorsAmbTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Amb Temperature Sensor Services`) : false;
                            this.sensorAmbTemperatureServices = [];
                            for (let i = 0; i < sensorsAmbTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Amb Temperature` : `${sensorName} Amb Temperature`;
                                const sensorAmbTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Amb Temperature Sensor ${i}`);
                                sensorAmbTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorAmbTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorAmbTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsAmbTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} amb temperature: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorAmbTemperatureServices.push(sensorAmbTemperatureService);
                            };
                        }

                        //dew point temperature
                        const sensorsDewPointTemperatureCount = this.sensorsDewPointTemperatureCount;
                        if (sensorsDewPointTemperatureCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Dew Point Temperature Sensor Services`) : false;
                            this.sensorDewPointTemperatureServices = [];
                            for (let i = 0; i < sensorsDewPointTemperatureCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Dew Point` : `${sensorName} Dew Point`;
                                const sensorDewPointTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Dew Point Temperature Sensor ${i}`);
                                sensorDewPointTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorDewPointTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorDewPointTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                    .onGet(async () => {
                                        const value = this.sensorsDewPointTemperature[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} dew point: ${value} °${this.tempUnit}`);
                                        return value;
                                    });
                                this.sensorDewPointTemperatureServices.push(sensorDewPointTemperatureService);
                            };
                        }

                        //humidity
                        const sensorsHumidityCount = this.sensorsHumidityCount;
                        if (sensorsHumidityCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Humidity Sensor Services`) : false;
                            this.sensorHumidityServices = [];
                            for (let i = 0; i < sensorsHumidityCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Humidity` : `${sensorName} Humidity`;
                                const sensorHumidityService = accessory.addService(Service.HumiditySensor, serviceName, `Humidity Sensor ${i}`);
                                sensorHumidityService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorHumidityService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorHumidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                                    .onGet(async () => {
                                        const value = this.sensorsHumidity[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} humidity: ${value} %`);
                                        return value;
                                    });
                                this.sensorHumidityServices.push(sensorHumidityService);
                            };
                        }

                        //pressure

                        //gas

                        //carbon dioxyde
                        const sensorsCarbonDioxydeCount = this.sensorsCarbonDioxydeCount;
                        if (sensorsCarbonDioxydeCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Carbon Dioxyde Sensor Services`) : false;
                            this.sensorCarbonDioxydeServices = [];
                            for (let i = 0; i < sensorsCarbonDioxydeCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Carbon Dioxyde` : `${sensorName} Carbon Dioxyde`;
                                const sensorCarbonDioxydeService = accessory.addService(Service.CarbonDioxideSensor, serviceName, `Carbon Dioxyde Sensor ${i}`);
                                sensorCarbonDioxydeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorCarbonDioxydeService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideDetected)
                                    .onGet(async () => {
                                        const state = this.sensorsCarbonDioxyde[i] > 1000;
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} carbon dioxyde detected: ${state ? 'Yes' : 'No'}`);
                                        return state;
                                    });
                                sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideLevel)
                                    .onGet(async () => {
                                        const value = this.sensorsCarbonDioxyde[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} carbon dioxyde level: ${value} ppm`);
                                        return value;
                                    });
                                sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxidePeakLevel)
                                    .onGet(async () => {
                                        const value = this.sensorsCarbonDioxyde[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} carbon dioxyde peak level: ${value} ppm`);
                                        return value;
                                    });
                                this.sensorCarbonDioxydeServices.push(sensorCarbonDioxydeService);
                            };
                        }

                        //ambient light
                        const sensorsAmbientLightCount = this.sensorsAmbientLightCount;
                        if (sensorsAmbientLightCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Ambient Light Sensor Services`) : false;
                            this.sensorAmbientLightServices = [];
                            for (let i = 0; i < sensorsAmbientLightCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Ambient Light` : `${sensorName} Ambient Light`;
                                const sensorAmbientLightService = accessory.addService(Service.LightSensor, serviceName, `Ambient Light Sensor ${i}`);
                                sensorAmbientLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorAmbientLightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorAmbientLightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                                    .onGet(async () => {
                                        const value = this.sensorsAmbientLight[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} ambient light: ${value} lx`);
                                        return value;
                                    });
                                this.sensorAmbientLightServices.push(sensorAmbientLightService);
                            };
                        }

                        //motion
                        const sensorsMotionCount = this.sensorsMotionCount;
                        if (sensorsMotionCount > 0) {
                            const debug = this.enableDebugMode ? this.emit('debug', `Prepare Motion Sensor Services`) : false;
                            this.sensorMotionServices = [];
                            for (let i = 0; i < sensorsMotionCount; i++) {
                                const sensorName = this.sensorsName[i];
                                const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Motion` : `${sensorName} Motion`;
                                const sensorMotionService = accessory.addService(Service.MotionSensor, serviceName, `Motion Sensor ${i}`);
                                sensorMotionService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                                sensorMotionService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                                sensorMotionService.getCharacteristic(Characteristic.MotionDetected)
                                    .onGet(async () => {
                                        const state = this.sensorsMotion[i];
                                        const logInfo = this.disableLogInfo ? false : this.emit('message', `sensor: ${sensorName} motion: ${state ? 'ON' : 'OFF'}`);
                                        return state;
                                    });
                                this.sensorMotionServices.push(sensorMotionService);
                            };
                        }
                    };
                    break;
            };

            return accessory;
        } catch (error) {
            throw new Error(`Prepare accessory error: ${error}`)
        };
    }

    //start
    async start() {
        try {
            const addressMac = await this.getDeviceInfo();
            if (!addressMac) {
                this.emit('warn', `Serial number not found`);
                return false;
            };

            //check device state 
            await this.checkDeviceState();

            //connect to deice success
            this.emit('success', `Connect Success`)

            //check device info 
            const devInfo = !this.disableLogDeviceInfo ? this.deviceInfo() : false;

            //start prepare accessory
            if (this.startPrepareAccessory) {
                const accessory = await this.prepareAccessory();
                const publishAccessory = this.emit('publishAccessory', accessory);
                this.startPrepareAccessory = false;
            }

            return true;
        } catch (error) {
            throw new Error(`Start error: ${error}`);
        };
    };
};
export default TasmotaDevice;
