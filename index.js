'use strict';

// eosstbPlatform

const axios = require('axios').default;
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const parseStringPromise = require('xml2js').parseStringPromise;

const PLUGIN_NAME = 'homebridge-eosstb';
const PLATFORM_NAME = 'eosstb';
const ZONE_NAME = ['Main Zone', 'Zone 2', 'Zone 3', 'All Zones'];
const ZONE_NUMBER = ['MainZone_MainZone', 'Zone2_Zone2', 'Zone3_Zone3', 'MainZone_MainZone'];

let Accessory, Characteristic, Service, Categories, UUID;

module.exports = (api) => {
	Accessory = api.platformAccessory;
	Characteristic = api.hap.Characteristic;
	Service = api.hap.Service;
	Categories = api.hap.Categories;
	UUID = api.hap.uuid;
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, denonTvPlatform, true);
};

class denonTvPlatform {
	constructor(log, config, api) {
		// only load if configured
		if (!config || !Array.isArray(config.devices)) {
			log('No configuration found for %s', PLUGIN_NAME);
			return;
		}
		this.log = log;
		this.config = config;
		this.api = api;
		this.devices = config.devices || [];

		this.api.on('didFinishLaunching', () => {
			this.log.debug('didFinishLaunching');
			for (let i = 0, len = this.devices.length; i < len; i++) {
				let deviceName = this.devices[i];
				if (!deviceName.name) {
					this.log.warn('Device Name Missing')
				} else {
					new denonTvDevice(this.log, deviceName, this.api);
				}
			}
		});
	}

	configureAccessory(platformAccessory) {
		this.log.debug('configurePlatformAccessory');
	}

	removeAccessory(platformAccessory) {
		this.log.debug('removePlatformAccessory');
		this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
	}
}

class denonTvDevice {
	constructor(log, config, api) {
		this.log = log;
		this.api = api;
		this.config = config;

		//device configuration
		this.name = config.name;
		this.host = config.host;
		this.port = config.port;
		this.refreshInterval = config.refreshInterval || 5;
		this.zoneControl = config.zoneControl;
		this.masterPower = config.masterPower;
		this.volumeControl = config.volumeControl;
		this.switchInfoMenu = config.switchInfoMenu;
		this.inputs = config.inputs;

		//get Device info
		this.manufacturer = config.manufacturer || 'Denon/Marantz';
		this.modelName = config.modelName || 'Model Name';
		this.serialNumber = config.serialNumber || 'Serial Number';
		this.firmwareRevision = config.firmwareRevision || 'Firmware Revision';
		this.zones = 1;
		this.apiVersion = null;

		//zones
		this.zoneName = ZONE_NAME[this.zoneControl];
		this.zoneNumber = ZONE_NUMBER[this.zoneControl];

		//setup variables
		this.checkDeviceInfo = false;
		this.checkDeviceState = false;
		this.currentPowerState = false;
		this.inputNames = new Array();
		this.inputReferences = new Array();
		this.inputTypes = new Array();
		this.inputModes = new Array();
		this.currentMuteState = false;
		this.currentVolume = 0;
		this.currentInputName = '';
		this.currentInputReference = '';
		this.currentInputIdentifier = 0;
		this.currentPlayPause = false;
		this.prefDir = path.join(api.user.storagePath(), 'denonTv');
		this.inputsFile = this.prefDir + '/' + 'inputs_' + this.host.split('.').join('');
		this.customInputsFile = this.prefDir + '/' + 'customInputs_' + this.host.split('.').join('');
		this.devInfoFile = this.prefDir + '/' + 'devInfo_' + this.host.split('.').join('');
		this.url = ('http://' + this.host + ':' + this.port);

		if (!Array.isArray(this.inputs) || this.inputs === undefined || this.inputs === null) {
			let defaultInputs = [
				{
					name: 'No inputs configured',
					reference: 'No references configured',
					type: 'No types configured',
					mode: 'No modes configured'
				}
			];
			this.inputs = defaultInputs;
		}

		//check if prefs directory ends with a /, if not then add it
		if (this.prefDir.endsWith('/') === false) {
			this.prefDir = this.prefDir + '/';
		}

		//check if the directory exists, if not then create it
		if (fs.existsSync(this.prefDir) === false) {
			fs.mkdir(this.prefDir, { recursive: false }, (error) => {
				if (error) {
					this.log.error('Device: %s %s, create directory: %s, error: %s', this.host, this.name, this.prefDir, error);
				} else {
					this.log.debug('Device: %s %s, create directory successful: %s', this.host, this.name, this.prefDir);
				}
			});
		}

		//update device state
		setInterval(function () {
			if (this.checkDeviceInfo) {
				this.getDeviceInfo();
			}
			if (this.checkDeviceState) {
				this.updateDeviceState();
			}
		}.bind(this), this.refreshInterval * 1000);

		this.prepareAccessory();
	}

	//Prepare accessory
	prepareAccessory() {
		this.log.debug('prepareAccessory');
		const accessoryName = this.name;
		const accessoryUUID = UUID.generate(accessoryName);
		const accessoryCategory = Categories.AUDIO_RECEIVER;
		this.accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

		this.prepareInformationService();
		this.prepareTelevisionService();
		this.prepareSpeakerService();
		if (this.volumeControl >= 1) {
			this.prepareVolumeService();
		}
		this.prepareInputsService();

		this.log.debug('Device: %s %s, publishExternalAccessories.', this.host, accessoryName);
		this.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
	}

	//Prepare information service
	prepareInformationService() {
		this.log.debug('prepareInformationService');
		this.getDeviceInfo();

		let manufacturer = this.manufacturer;
		let modelName = this.modelName;
		let serialNumber = this.serialNumber;
		let firmwareRevision = this.firmwareRevision;

		this.accessory.removeService(this.accessory.getService(Service.AccessoryInformation));
		const informationService = new Service.AccessoryInformation();
		informationService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Manufacturer, manufacturer)
			.setCharacteristic(Characteristic.Model, modelName)
			.setCharacteristic(Characteristic.SerialNumber, serialNumber)
			.setCharacteristic(Characteristic.FirmwareRevision, firmwareRevision);

		this.accessory.addService(informationService);
	}

	//Prepare television service
	prepareTelevisionService() {
		this.log.debug('prepareTelevisionService');
		this.televisionService = new Service.Television(this.name, 'televisionService');
		this.televisionService.setCharacteristic(Characteristic.ConfiguredName, this.name);
		this.televisionService.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		this.televisionService.getCharacteristic(Characteristic.Active)
			.on('get', this.getPower.bind(this))
			.on('set', this.setPower.bind(this));

		this.televisionService.getCharacteristic(Characteristic.ActiveIdentifier)
			.on('get', this.getInput.bind(this))
			.on('set', this.setInput.bind(this));

		this.televisionService.getCharacteristic(Characteristic.RemoteKey)
			.on('set', this.setRemoteKey.bind(this));

		this.televisionService.getCharacteristic(Characteristic.PowerModeSelection)
			.on('set', this.setPowerModeSelection.bind(this));

		this.televisionService.getCharacteristic(Characteristic.PictureMode)
			.on('set', this.setPictureMode.bind(this));

		this.accessory.addService(this.televisionService);
	}

	//Prepare speaker service
	prepareSpeakerService() {
		this.log.debug('prepareSpeakerService');
		this.speakerService = new Service.TelevisionSpeaker(this.name + ' Speaker', 'speakerService');
		this.speakerService
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
		this.speakerService.getCharacteristic(Characteristic.VolumeSelector)
			.on('set', this.setVolumeSelector.bind(this));
		this.speakerService.getCharacteristic(Characteristic.Volume)
			.on('get', this.getVolume.bind(this))
			.on('set', this.setVolume.bind(this));
		this.speakerService.getCharacteristic(Characteristic.Mute)
			.on('get', this.getMute.bind(this))
			.on('set', this.setMute.bind(this));

		this.accessory.addService(this.speakerService);
		this.televisionService.addLinkedService(this.speakerService);
	}

	//Prepare volume service
	prepareVolumeService() {
		this.log.debug('prepareVolumeService');
		if (this.volumeControl == 1) {
			this.volumeService = new Service.Lightbulb(this.name + ' Volume', 'volumeService');
			this.volumeService.getCharacteristic(Characteristic.Brightness)
				.on('get', this.getVolume.bind(this))
				.on('set', (volume, callback) => {
					this.speakerService.setCharacteristic(Characteristic.Volume, volume);
					callback(null);
				});
		}
		if (this.volumeControl == 2) {
			this.volumeService = new Service.Fan(this.name + ' Volume', 'volumeService');
			this.volumeService.getCharacteristic(Characteristic.RotationSpeed)
				.on('get', this.getVolume.bind(this))
				.on('set', (volume, callback) => {
					this.speakerService.setCharacteristic(Characteristic.Volume, volume);
					callback(null);
				});
		}
		this.volumeService.getCharacteristic(Characteristic.On)
			.on('get', (callback) => {
				let state = !this.currentMuteState;
				callback(null, state);
			})
			.on('set', (state, callback) => {
				this.speakerService.setCharacteristic(Characteristic.Mute, !state);
				callback(null);
			});

		this.accessory.addService(this.volumeService);
		this.televisionService.addLinkedService(this.volumeService);
	}

	//Prepare inputs services
	prepareInputsService() {
		this.log.debug('prepareInputsService');

		let savedNames = {};
		try {
			savedNames = JSON.parse(fs.readFileSync(this.customInputsFile));
		} catch (error) {
			this.log.debug('Device: %s %s, customInputs file does not exist', this.host, this.name)
		}

		this.inputs.forEach((input, i) => {

			//get input reference
			let inputReference = input.reference;

			//get input name		
			let inputName = input.name;

			if (savedNames && savedNames[inputReference]) {
				inputName = savedNames[inputReference];
			};

			//get input type
			let inputType = input.type;

			//get input mode
			let inputMode = input.mode;

			this.inputsService = new Service.InputSource(inputReference, 'input' + i);
			this.inputsService
				.setCharacteristic(Characteristic.Identifier, i)
				.setCharacteristic(Characteristic.ConfiguredName, inputName)
				.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
				.setCharacteristic(Characteristic.InputSourceType, inputType)
				.setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN);

			this.inputsService
				.getCharacteristic(Characteristic.ConfiguredName)
				.on('set', (name, callback) => {
					savedNames[inputReference] = name;
					fs.writeFile(this.customInputsFile, JSON.stringify(savedNames, null, 2), (error) => {
						if (error) {
							this.log.error('Device: %s %s, can not write new Input name, error: %s', this.host, this.name, error);
						} else {
							this.log.info('Device: %s %s, saved new Input successful, name: %s reference: %s', this.host, this.name, name, inputReference);
						}
					});
					callback(null)
				});
			this.inputReferences.push(inputReference);
			this.inputNames.push(inputName);
			this.inputTypes.push(inputType);
			this.inputModes.push(inputMode);

			this.accessory.addService(this.inputsService);
			this.televisionService.addLinkedService(this.inputsService);
		});
	}

	async getDeviceInfo() {
		var me = this;
		me.log.debug('Device: %s %s, requesting Device information.', me.host, me.name);
		try {
			const response = await axios.get(me.url + '/goform/Deviceinfo.xml');
			try {
				const result = await parseStringPromise(response.data);
				me.log.info('Device: %s %s %s, state: Online.', me.host, me.name, me.zoneName);
				if (typeof result.Device_Info !== 'undefined') {
					if (typeof result.Device_Info.BrandCode[0] !== 'undefined') {
						me.manufacturer = ['Denon', 'Marantz'][result.Device_Info.BrandCode[0]];
					} else {
						me.manufacturer = me.manufacturer;
					};
					if (typeof result.Device_Info.ModelName[0] !== 'undefined') {
						me.modelName = result.Device_Info.ModelName[0];
					} else {
						me.modelName = me.modelName;
					};
					if (typeof result.Device_Info.MacAddress[0] !== 'undefined') {
						me.serialNumber = result.Device_Info.MacAddress[0];
					} else {
						me.serialNumber = me.serialNumber;
					};
					if (typeof result.Device_Info.UpgradeVersion[0] !== 'undefined') {
						me.firmwareRevision = result.Device_Info.UpgradeVersion[0];
					} else {
						me.firmwareRevision = me.firmwareRevision;
					};
					me.zones = result.Device_Info.DeviceZones[0];
					me.apiVersion = result.Device_Info.CommApiVers[0];
				}
				if (me.zoneControl == 0 || me.zoneControl == 3) {
					if (fs.existsSync(me.devInfoFile) === false) {
						try {
							await fsPromises.writeFile(me.devInfoFile, JSON.stringify(result, null, 2));
							me.log.debug('Device: %s %s, devInfoFile saved successful in: %s %s', me.host, me.name, me.prefDir, JSON.stringify(result, null, 2));
						} catch (error) {
							me.log.error('Device: %s %s, could not write devInfoFile, error: %s', me.host, me.name, error);
						}
					}
					me.log('-------- %s --------', me.name);
					me.log('Manufacturer: %s', me.manufacturer);
					me.log('Model: %s', me.modelName);
					me.log('Zones: %s', me.zones);
					me.log('Api version: %s', me.apiVersion);
					me.log('Serialnr: %s', me.serialNumber);
					me.log('Firmware: %s', me.firmwareRevision);
					me.log('----------------------------------');
				}
				if (me.zoneControl == 1) {
					me.log('-------- %s --------', me.name);
					me.log('Manufacturer: %s', me.manufacturer);
					me.log('Model: %s', me.modelName);
					me.log('Zone: 2');
					me.log('----------------------------------');
				}
				if (me.zoneControl == 2) {
					me.log('-------- %s --------', me.name);
					me.log('Manufacturer: %s', me.manufacturer);
					me.log('Model: %s', me.modelName);
					me.log('Zone: 3');
					me.log('----------------------------------');
				}
				me.updateDeviceState();
			} catch (error) {
				me.log.error('Device %s %s, getDeviceInfo parse string error: %s', me.host, me.name, error);
				me.checkDeviceInfo = true;
			};
		} catch (error) {
			me.log.error('Device: %s %s, getDeviceInfo eror: %s, state: Offline', me.host, me.name, error);
			me.checkDeviceInfo = true;
		};
	}

	async updateDeviceState() {
		var me = this;
		me.log.debug('Device: %s %s, requesting Device state.', me.host, me.name);
		try {
			const response = await axios.get(me.url + '/goform/form' + me.zoneNumber + 'XmlStatusLite.xml');
			const result = await parseStringPromise(response.data);
			let powerState = (result.item.Power[0].value[0] === 'ON');
			if (me.televisionService && (powerState !== me.currentPowerState)) {
				me.televisionService.updateCharacteristic(Characteristic.Active, powerState ? 1 : 0);
			}
			me.log.debug('Device: %s %s, get current Power state successful: %s', me.host, me.name, powerState ? 'ON' : 'OFF');
			me.currentPowerState = powerState;

			let inputReference = result.item.InputFuncSelect[0].value[0];
			let inputIdentifier = 0;
			if (me.inputReferences.indexOf(inputReference) >= 0) {
				inputIdentifier = me.inputReferences.indexOf(inputReference);
			}
			let inputName = me.inputNames[inputIdentifier];
			if (me.televisionService && (inputReference !== me.currentInputReference)) {
				me.televisionService.updateCharacteristic(Characteristic.ActiveIdentifier, inputIdentifier);
			}
			me.log.debug('Device: %s %s %s, get current Input successful: %s %s', me.host, me.name, me.zoneName, inputName, inputReference);
			me.currentInputReference = inputReference;
			me.currentInputIdentifier = inputIdentifier;
			me.currentInputName = inputName;

			let mute = powerState ? (result.item.Mute[0].value[0] === 'on') : true;
			let volume = parseInt(result.item.MasterVolume[0].value[0]) + 80;
			if (me.speakerService) {
				me.speakerService.updateCharacteristic(Characteristic.Mute, mute);
				me.speakerService.updateCharacteristic(Characteristic.Volume, volume);
				if (me.volumeService && me.volumeControl >= 1) {
					me.volumeService.updateCharacteristic(Characteristic.On, !mute);
				}
				if (me.volumeService && me.volumeControl == 1) {
					me.volumeService.updateCharacteristic(Characteristic.Brightness, volume);
				}
				if (me.volumeService && me.volumeControl == 2) {
					me.volumeService.updateCharacteristic(Characteristic.RotationSpeed, volume);
				}
			}
			me.log.debug('Device: %s %s %s, get current Mute state: %s', me.host, me.name, me.zoneName, mute ? 'ON' : 'OFF');
			me.log.debug('Device: %s %s %s, get current Volume level: %s dB ', me.host, me.name, me.zoneName, (volume - 80));
			me.currentMuteState = mute;
			me.currentVolume = volume;
			me.checkDeviceState = true;
		} catch (error) {
			me.log.error('Device: %s %s %s, update Device state error: %s', me.host, me.name, me.zoneName, error);
		};
	}

	async getPower(callback) {
		var me = this;
		try {
			const response = await axios.get(me.url + '/goform/form' + me.zoneNumber + 'XmlStatusLite.xml');
			const result = await parseStringPromise(response.data);
			let state = (result.item.Power[0].value[0] == 'ON');
			me.log.info('Device: %s %s %s, get current Power state successful: %s', me.host, me.name, me.zoneName, state ? 'ON' : 'OFF');
			callback(null, state);
		} catch (error) {
			me.log.error('Device: %s %s %s, get current Power state error: %s', me.host, me.name, me.zoneName, error);
		};
	}

	async setPower(state, callback) {
		var me = this;
		const zControl = me.masterPower ? 3 : me.zoneControl
		me.log.debug('zControl is %s', zControl)
		if (state != me.currentPowerState) {
			try {
				let newState = [(state ? 'ZMON' : 'ZMOFF'), (state ? 'Z2ON' : 'Z2OFF'), (state ? 'Z3ON' : 'Z3OFF'), (state ? 'PWON' : 'PWSTANDBY')][zControl];
				const response = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + newState);
				me.log.info('Device: %s %s %s, set new Power state successful: %s', me.host, me.name, me.zoneName, newState);
			} catch (error) {
				me.log.error('Device: %s %s %s, can not set new Power state. Might be due to a wrong settings in config, error: %s', me.host, me.name, me.zoneName, error);
			};
		}
		callback(null);
	}

	async getMute(callback) {
		var me = this;
		try {
			const response = await axios.get(me.url + '/goform/form' + me.zoneNumber + 'XmlStatusLite.xml');
			const result = await parseStringPromise(response.data);
			let state = me.currentPowerState ? (result.item.Mute[0].value[0] === 'on') : true;
			me.log.info('Device: %s %s %s, get current Mute state successful: %s', me.host, me.name, me.zoneName, state ? 'ON' : 'OFF');
			callback(null, state);
		} catch (error) {
			me.log.error('Device: %s %s %s, get current Mute error: %s', me.host, me.name, me.zoneName, error);
		};
	}

	async setMute(state, callback) {
		var me = this;
		if (me.currentPowerState && state !== me.currentMuteState) {
			try {
				const newState = [(state ? 'MUON' : 'MUOFF'), (state ? 'Z2MUON' : 'Z2MUOFF'), (state ? 'Z3MUON' : 'Z3MUOFF'), (state ? 'MUON' : 'MUOFF')][me.zoneControl];
				const response = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + newState);
				if (me.zoneControl == 3) {
					if (me.zones >= 2) {
						newState = state ? 'Z2MUON' : 'Z2MUOFF';
						const response1 = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + newState);
					}
					if (me.zones >= 3) {
						newState = state ? 'Z3MUON' : 'Z3MUOFF';
						const response2 = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + newState);
					}
				}
				me.log.info('Device: %s %s %s, set new Mute state successful: %s', me.host, me.name, me.zoneName, state ? 'ON' : 'OFF');
			} catch (error) {
				me.log.error('Device: %s %s %s, can not set new Mute state. Might be due to a wrong settings in config, error: %s', me.host, me.name, me.zoneName, error);
			};
		}
		callback(null);
	}

	async getVolume(callback) {
		var me = this;
		try {
			const response = await axios.get(me.url + '/goform/form' + me.zoneNumber + 'XmlStatusLite.xml');
			const result = await parseStringPromise(response.data);
			let volume = parseInt(result.item.MasterVolume[0].value[0]) + 80;
			me.log.info('Device: %s %s %s, get current Volume level successful: %s dB', me.host, me.name, me.zoneName, (volume - 80));
			callback(null, volume);
		} catch (error) {
			me.log.error('Device: %s %s %s, get current Volume error: %s', me.host, me.name, me.zoneName, error);
		};
	}

	async setVolume(volume, callback) {
		var me = this;
		try {
			let currentVolume = me.currentVolume;
			let zone = ['MV', 'Z2', 'Z3', 'MV'][me.zoneControl];
			if (volume == 0 || volume == 100) {
				volume = currentVolume;
			}
			const response = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + zone + volume);
			if (me.zoneControl == 3) {
				if (me.zones >= 2) {
					const response1 = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + 'Z2' + volume);
				}
				if (me.zones >= 3) {
					const response2 = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + 'Z3' + volume);
				}
			}
			me.log.info('Device: %s %s %s, set new Volume level successful: %s', me.host, me.name, me.zoneName, volume);
		} catch (error) {
			me.log.error('Device: %s %s %s, can not set new Volume level. Might be due to a wrong settings in config, error: %s', me.host, me.name, me.zoneName, error);
		};
		callback(null);
	}

	async getInput(callback) {
		var me = this;
		try {
			const response = await axios.get(me.url + '/goform/form' + me.zoneNumber + 'XmlStatusLite.xml');
			const result = await parseStringPromise(response.data);
			let inputReference = result.item.InputFuncSelect[0].value[0];
			let inputIdentifier = 0;
			if (me.inputReferences.indexOf(inputReference) >= 0) {
				inputIdentifier = me.inputReferences.indexOf(inputReference);
			}
			let inputName = me.inputNames[inputIdentifier];
			me.log.info('Device: %s %s %s, get current Input successful: %s %s', me.host, me.name, me.zoneName, inputName, inputReference);
			callback(null, inputIdentifier);
		} catch (error) {
			me.log.error('Device: %s %s %s, get current Input error: %s', me.host, me.name, me.zoneName, error);
		};
	}

	async setInput(inputIdentifier, callback) {
		var me = this;
		try {
			let inputName = me.inputNames[inputIdentifier];
			let inputReference = me.inputReferences[inputIdentifier];
			let inputMode = me.inputModes[inputIdentifier];
			let zone = [inputMode, 'Z2', 'Z3', inputMode][me.zoneControl];
			const response = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + zone + inputReference);
			if (me.zoneControl == 3) {
				if (me.zones >= 2) {
					const response1 = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + 'Z2' + inputReference);
				}
				if (me.zones >= 3) {
					const response1 = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + 'Z3' + inputReference);
				}
			}
			me.log.info('Device: %s %s %s, set new Input successful: %s %s', me.host, me.name, me.zoneName, inputName, inputReference);
		} catch (error) {
			me.log.error('Device: %s %s %s, can not set new Input. Might be due to a wrong settings in config, error: %s', me.host, me.name, me.zoneName, error);
		};
		callback(null);
	}

	async setPictureMode(mode, callback) {
		var me = this;
		if (me.currentPowerState) {
			try {
				let command;
				switch (mode) {
					case Characteristic.PictureMode.OTHER:
						command = 'PVMOV';
						break;
					case Characteristic.PictureMode.STANDARD:
						command = 'PVSTD';
						break;
					case Characteristic.PictureMode.CALIBRATED:
						command = 'PVDAY';
						break;
					case Characteristic.PictureMode.CALIBRATED_DARK:
						command = 'PVNGT';
						break;
					case Characteristic.PictureMode.VIVID:
						command = 'PVVVD';
						break;
					case Characteristic.PictureMode.GAME:
						command = 'PVSTM';
						break;
					case Characteristic.PictureMode.COMPUTER:
						command = 'PVSTM';
						break;
					case Characteristic.PictureMode.CUSTOM:
						command = 'PVCTM';
						break;
				}
				const response = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + command);
				me.log.info('Device: %s %s, setPictureMode successful, command: %s', me.host, me.name, command);
			} catch (error) {
				me.log.error('Device: %s %s %s, can not setPictureMode command. Might be due to a wrong settings in config, error: %s', me.host, me.name, me.zoneName, error);
			};
		}
		callback(null);
	}

	async setPowerModeSelection(state, callback) {
		var me = this;
		if (me.currentPowerState) {
			try {
				let command;
				switch (state) {
					case Characteristic.PowerModeSelection.SHOW:
						command = me.switchInfoMenu ? 'MNOPT' : 'MNINF';
						break;
					case Characteristic.PowerModeSelection.HIDE:
						command = 'MNRTN';
						break;
				}
				const response = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + command);
				me.log.info('Device: %s %s, setPowerModeSelection successful, command: %s', me.host, me.name, command);
			} catch (error) {
				me.log.error('Device: %s %s %s, can not setPowerModeSelection command. Might be due to a wrong settings in config, error: %s', me.host, me.name, me.zoneName, error);
			};
		}
		callback(null);
	}

	async setVolumeSelector(state, callback) {
		var me = this;
		if (me.currentPowerState) {
			try {
				let command;
				let zone = ['MV', 'Z2', 'Z3', 'MV'][me.zoneControl];
				switch (state) {
					case Characteristic.VolumeSelector.INCREMENT:
						command = 'UP';
						break;
					case Characteristic.VolumeSelector.DECREMENT:
						command = 'DOWN';
						break;
				}
				const response = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + zone + command);
				if (me.zoneControl == 3) {
					if (me.zones >= 2) {
						const response1 = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + 'Z2' + command);
					}
					if (me.zones >= 3) {
						const response2 = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + 'Z3' + command);
					}
				}
				me.log.info('Device: %s %s %s, setVolumeSelector successful, command: %s', me.host, me.name, me.zoneName, command);
			} catch (error) {
				me.log.error('Device: %s %s %s, can not setVolumeSelector command. Might be due to a wrong settings in config, error: %s', me.host, me.name, me.zoneName, error);
			};
		}
		callback(null);
	}

	async setRemoteKey(remoteKey, callback) {
		var me = this;
		if (me.currentPowerState) {
			try {
				let command;
				if (me.currentInputReference === 'SPOTIFY' || me.currentInputReference === 'BT' || me.currentInputReference === 'USB/IPOD' || me.currentInputReference === 'NET' || me.currentInputReference === 'MPLAY') {
					switch (remoteKey) {
						case Characteristic.RemoteKey.REWIND:
							command = 'NS9E';
							break;
						case Characteristic.RemoteKey.FAST_FORWARD:
							command = 'NS9D';
							break;
						case Characteristic.RemoteKey.NEXT_TRACK:
							command = 'MN9D';
							break;
						case Characteristic.RemoteKey.PREVIOUS_TRACK:
							command = 'MN9E';
							break;
						case Characteristic.RemoteKey.ARROW_UP:
							command = 'NS90';
							break;
						case Characteristic.RemoteKey.ARROW_DOWN:
							command = 'NS91';
							break;
						case Characteristic.RemoteKey.ARROW_LEFT:
							command = 'NS92';
							break;
						case Characteristic.RemoteKey.ARROW_RIGHT:
							command = 'NS93';
							break;
						case Characteristic.RemoteKey.SELECT:
							command = 'NS94';
							break;
						case Characteristic.RemoteKey.BACK:
							command = 'MNRTN';
							break;
						case Characteristic.RemoteKey.EXIT:
							command = 'MNRTN';
							break;
						case Characteristic.RemoteKey.PLAY_PAUSE:
							command = me.currentPlayPause ? 'NS9B' : 'NS9A';
							me.currentPlayPause = !me.currentPlayPause;
							break;
						case Characteristic.RemoteKey.INFORMATION:
							command = me.switchInfoMenu ? 'MNINF' : 'MNOPT';
							break;
					}
				} else {
					switch (remoteKey) {
						case Characteristic.RemoteKey.REWIND:
							command = 'MN9E';
							break;
						case Characteristic.RemoteKey.FAST_FORWARD:
							command = 'MN9D';
							break;
						case Characteristic.RemoteKey.NEXT_TRACK:
							command = 'MN9F';
							break;
						case Characteristic.RemoteKey.PREVIOUS_TRACK:
							command = 'MN9G';
							break;
						case Characteristic.RemoteKey.ARROW_UP:
							command = 'MNCUP';
							break;
						case Characteristic.RemoteKey.ARROW_DOWN:
							command = 'MNCDN';
							break;
						case Characteristic.RemoteKey.ARROW_LEFT:
							command = 'MNCLT';
							break;
						case Characteristic.RemoteKey.ARROW_RIGHT:
							command = 'MNCRT';
							break;
						case Characteristic.RemoteKey.SELECT:
							command = 'MNENT';
							break;
						case Characteristic.RemoteKey.BACK:
							command = 'MNRTN';
							break;
						case Characteristic.RemoteKey.EXIT:
							command = 'MNRTN';
							break;
						case Characteristic.RemoteKey.PLAY_PAUSE:
							command = 'NS94';
							break;
						case Characteristic.RemoteKey.INFORMATION:
							command = me.switchInfoMenu ? 'MNINF' : 'MNOPT';
							break;
					}
				}
				const response = await axios.get(me.url + '/goform/formiPhoneAppDirect.xml?' + command);
				me.log.info('Device: %s %s, setRemoteKey successful, command: %s', me.host, me.name, command);
			} catch (error) {
				me.log.error('Device: %s %s, can not setRemoteKey command. Might be due to a wrong settings in config, error: %s', me.host, me.name, error);
			};
		}
		callback(null);
	}
};