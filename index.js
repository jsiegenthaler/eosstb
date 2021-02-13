'use strict';



const mqtt = require('mqtt');  
const request = require('request-promise');

// having trouble with fetch due to cookies...
//const nodeFetch = require('node-fetch')
//const tough = require('tough-cookie')
//const fetch = require('fetch-cookie/node-fetch')(nodeFetch)
//const fetch = require('fetch-cookie')(nodeFetch, new tough.CookieJar(), false) // default value is true
// false - doesn't ignore errors, throws when an error occurs in setting cookies and breaks the request and execution
// true - silently ignores errors and continues to make requests/redirections

// try axios instead of fetch
const axios = require('axios'); // .default; does removing default help?
axios.defaults.xsrfCookieName = undefined;

const axiosCookieJarSupport = require('axios-cookiejar-support').default;
const tough = require('tough-cookie');


// create a new instance called axiosWS
// add withCredentials: true to ensure credential cookie support
// remove default header in axios that causes trouble with Telenet
const axiosWS = axios.create({
	withCredentials: true, // IMPORTANT!
});
delete axiosWS.defaults.headers.common["Accept"];

// setup the cookieJar
axiosCookieJarSupport(axiosWS);
const cookieJar = new tough.CookieJar();



const qs = require('qs')

const _ = require('underscore');
const bodyParser = require('body-parser');
const varClientId = makeId(30);

// name and version
const PLUGIN_NAME = 'homebridge-eosstb';
const PLATFORM_NAME = 'eosstb';
const PLUGIN_VERSION = '0.0.5';


// different settop box names per country
const settopBoxName = {
    'nl':     'Mediabox Next (4K)',
    'ch':     'UPC TV Box',
    'be-nl':  'Telenet TV-Box',
    'be-fr':  'Telenet TV-Box',
    'at':     'Entertain Box 4K',
    'gb':     'Virgin Media 360'
};

// base url varies by country
const countryBaseUrlArray = {
    'nl': 		'https://web-api-prod-obo.horizon.tv/oesp/v4/NL/nld/web',
    'ch': 		'https://web-api-prod-obo.horizon.tv/oesp/v4/CH/eng/web', // v3 and v4 works
    'be-nl': 	'https://web-api-prod-obo.horizon.tv/oesp/v4/BE/nld/web',
    'be-fr': 	'https://web-api-prod-obo.horizon.tv/oesp/v4/BE/fr/web',
    'at': 		'https://prod.oesp.magentatv.at/oesp/v4/AT/deu/web', // v3 and v4 works
    'gb':       'https://web-api-prod-obo.horizon.tv/oesp/v4/GB/eng/web'
};

// session and jwt are based on countryBaseUrlArray
//const sessionUrl = 	'https://web-api-prod-obo.horizon.tv/oesp/v3/CH/eng/web/session';
//const channelsUrl = 'https://web-api-prod-obo.horizon.tv/oesp/v3/CH/eng/web/channels';
//const jwtUrl = 			'https://web-api-prod-obo.horizon.tv/oesp/v3/CH/eng/web/tokens/jwt';


// different mqtt endpoints per country
const mqttUrlArray = {
    'nl': 		'wss://obomsg.prod.nl.horizon.tv:443/mqtt',
    'ch': 		'wss://obomsg.prod.ch.horizon.tv:443/mqtt',
    'be-nl': 	'wss://obomsg.prod.be.horizon.tv:443/mqtt',
    'be-fr':  	'wss://obomsg.prod.be.horizon.tv:443/mqtt',
    'at':		'wss://obomsg.prod.at.horizon.tv:443/mqtt',
    'gb':       'wss://obomsg.prod.gb.horizon.tv:443/mqtt'
};

// openid logon url used in Telenet.be Belgium for be-nl and be-fr sessions
const BE_AUTH_URL = 'https://login.prd.telenet.be/openid/login.do';

// oidc logon url used in VirginMedia for gb sessions
const GB_AUTH_URL = 'https://id.virginmedia.com/sign-in/?protocol=oidc';

// settop box identifiers
let smartCardId = '';
let physicalDeviceId = '';

// general constants
const NO_INPUT = 999999; // an input id that does not exist
const MAX_INPUT_SOURCES = 90; // max input services. Default = 90. Cannot be more than 97 (100 - all other services)
const STB_STATE_POLLING_INTERVAL_MS = 5000; // pollling interval in millisec. Default = 5000



// exec spawns child process to run a bash script
var exec = require("child_process").exec;

let mqttClient = {};

let myUpcUsername;
let myUpcPassword;
let console;

let Service;
let Characteristic;

let mqttUsername;
let mqttPassword;
let settopboxId;
let settopboxState;
let stations = [];
let uiStatus;
let currentChannel;
let currentChannelId;
let currentPowerState;

const sessionRequestOptions = {
	method: 'POST',
	uri: '',
	body: {
		username: myUpcUsername,
		password: myUpcPassword
	},
	json: true
};



function makeId(length) {
	let result	= '';
	let characters	= 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let charactersLength = characters.length;
	for ( let i = 0; i < length; i++ ) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
};




// --== MAIN SETUP ==--
function eosTvPlatform(log, config) {
	console = log;
	this.log = log;
	this.log('In eosTvPlatform');
	this.log('eosTvPlatform physicalDeviceId:',physicalDeviceId);
	this.config = config;
}



/* Initialise Accessory */
function tvAccessory(log, config) {
	this.log = log;
	this.log('In tvAccessory');
	this.log('tvAccessory physicalDeviceId:',physicalDeviceId);

	this.config = config;
	this.sysConfig = null;
	
	this.name = config.name || settopBoxName[this.config.country]; // market specific box name as default

	this.log('clearing inputs and services');
	this.inputs = [];
	this.enabledServices = [];
	this.inputServices = [];
	this.playing = true;

	// Configuration
	myUpcUsername = this.config.username || '';
	myUpcPassword = this.config.password || '';

	// this.getChannels();
	this.log('Creating session...');
	switch(this.config.country) {
		case 'be-nl': case 'be-fr':
			this.log('Calling getSessionBE');
			this.getSessionBE();
			break;
		case 'gb':
			this.log('Calling getSessionBE');
			this.getSessionBE();
			break;
		  break;
		default:
			this.log('Calling getSession');
			this.getSession();
	  }
	this.log('Session should be created now');
	this.log('tvAccessory after session physicalDeviceId:',physicalDeviceId);

	this.log('Loading inputs...');
	this.setInputs();
	this.log('Inputs loaded');
	
	// Check & Update Accessory Status every STB_STATE_POLLING_INTERVAL_MS (Default: 5000 ms)
	this.checkStateInterval = setInterval(this.updateTvState.bind(this),STB_STATE_POLLING_INTERVAL_MS);
}


module.exports = (homebridge) => {
	({ Service, Characteristic } = homebridge.hap);
	homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, eosTvPlatform);
};


eosTvPlatform.prototype = {
  	accessories(callback) {
		callback([
			new tvAccessory(
			this.log,
			this.config
			),
		]);
	},
};


// all code is defined in the tvAccessory sub
tvAccessory.prototype = {
	/* Services */
	// max 100 services possible
	// test the sleep function
	getServices() {
		this.log('start of getServices');
		this.prepareInformationService();			// service 1
		this.prepareTelevisionService();			// service 2
		this.prepareTelevisionSpeakerService();		// service 3
		this.prepareInputSourceServices();			// services 4 to max 100
		//this.volumeService(); // try and enable
		this.log('getServices: all services have been prepared');
		return this.enabledServices;
	},


	/* START: Prepare the Services */
	// informationService is the name, manufacturer etc of the accessory
	prepareInformationService() {
		// Create Information Service
		this.log('start of prepareInformationService, physicalDeviceId',physicalDeviceId);

		this.informationService = new Service.AccessoryInformation();

		let boxName = 'DCX960 ('.concat(settopBoxName[this.config.country]).concat(')'); // market specific box name
		
		this.informationService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Manufacturer, 'ARRIS Global Limited')
			.setCharacteristic(Characteristic.SerialNumber, 'unknown') // this should be the mac or the ca address	
			.setCharacteristic(Characteristic.Model, boxName)
			.setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

		this.log('end of prepareInformationService, physicalDeviceId',physicalDeviceId);
		this.enabledServices.push(this.informationService);
	}, // end of prepareInformationService


	// prepare the tv service
	prepareTelevisionService() {
		// Create Television Service (AVR)
		this.tvService = new Service.Television(this.name, 'tvService');

		this.tvService
			.setCharacteristic(Characteristic.ConfiguredName, this.name)
			.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		this.tvService
			.getCharacteristic(Characteristic.Active)
			.on('get', this.getPowerState.bind(this))
			.on('set', this.setPowerState.bind(this));

    //this.tvService
    //  .setCharacteristic(Characteristic.ActiveIdentifier, NO_INPUT); // default to no input at the start

		this.tvService
			.getCharacteristic(Characteristic.ActiveIdentifier)
			.on('get', this.getInputState.bind(this))
			.on('set', (inputIdentifier, callback) => {
					this.setInputState(this.inputs[inputIdentifier], callback);
				}
			);

		this.tvService
			.getCharacteristic(Characteristic.RemoteKey)
			.on('set', this.remoteKeyPress.bind(this));

		// PowerModeSelection enables the View TV Settings option in the Homekit TV accessory
		this.tvService
			.getCharacteristic(Characteristic.PowerModeSelection)
			.on('set', this.viewTvSettings.bind(this));

		this.enabledServices.push(this.tvService);
	}, // end of prepareTelevisionService


	// prepare the tv speaker service, this includes the volume selector
	prepareTelevisionSpeakerService() {
		this.tvSpeakerService = new Service.TelevisionSpeaker(`${this.name} Speaker`, 'tvSpeakerService');
		this.tvSpeakerService
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.RELATIVE);
		this.tvSpeakerService.getCharacteristic(Characteristic.VolumeSelector) // the volume selector allows the iOS device keys to be used to change volume
			.on('set', (direction, callback) => {	this.setVolume(direction, callback); });
			//.on('set', this.setVolumeSelector.bind(this)); // from denon code
		this.tvSpeakerService.getCharacteristic(Characteristic.Volume)
			.on('get', this.getVolume.bind(this))
			.on('set', this.setVolume.bind(this));
		this.tvSpeakerService.getCharacteristic(Characteristic.Mute) // not supported in remote but maybe by Siri
			//.on('get', this.getMute.bind(this)) // not supported by tv
			.on('set', this.setMute.bind(this));
	
	
		this.tvService.addLinkedService(this.tvSpeakerService);
		this.enabledServices.push(this.tvSpeakerService);
	}, // end of prepareTelevisionSpeakerService


	// prepare the input selection service. 
	// This is the channel list, each input is a service, max 100 services less the services created so far
	prepareInputSourceServices() {
		// loop MAX_INPUT_SOURCES times to get the first MAX_INPUT_SOURCES channels
		// absolute max 100 services
		let maxSources = this.config.maxChannels || MAX_INPUT_SOURCES;
		for (let i = 0; i < Math.min(maxSources, MAX_INPUT_SOURCES); i++) {
			const inputService = new Service.InputSource(i, `inputSource_${i}`);

			inputService
				// identifier is the channel index number
				.setCharacteristic(Characteristic.Identifier, i)
				.setCharacteristic(Characteristic.ConfiguredName, `Input ${i < 9 ? `0${i + 1}` : i + 1}`)
				// initially not configured
				.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.NOT_CONFIGURED)
				// set default to application as no other type fits, except maybe tuner
				// TUNER = 2; APPLICATION = 10;
				.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.TV)
				// hidden until config is loaded my mqtt
				.setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.HIDDEN);

			inputService
				.getCharacteristic(Characteristic.ConfiguredName)
				.on('set', (value, callback) => {
					callback(null, value);
				}
			);

			this.tvService.addLinkedService(inputService);
			this.inputServices.push(inputService);
			this.enabledServices.push(inputService);
		} // end of for loop getting the inputSource
	}, // end of prepareInputSourceServices
	/* END: Prepare the Services */



	getSession() {
		this.log.warn('getSession');

		sessionRequestOptions.uri = countryBaseUrlArray[this.config.country].concat('/session');
		this.log.warn('getSession sessionRequestOptions.uri:',sessionRequestOptions.uri);
		
		sessionRequestOptions.body.username = this.config.username;
		sessionRequestOptions.body.password = this.config.password;
		this.log.warn('getSession: sessionRequestOptions',sessionRequestOptions);
		
		request(sessionRequestOptions)
			.then((json) => {
				//this.log(json);
				var sessionJson = json;
				//this.log('getSession: sessionJson.customer',sessionJson.customer);

				smartCardId = sessionJson.customer.smartCardId;
				physicalDeviceId = sessionJson.customer.physicalDeviceId;

				this.getJwtTokenReq(sessionJson.oespToken, sessionJson.customer.householdId);
				this.log.warn('getSession: Session created');			
			})
			.catch((err) => {
				this.log.warn('getSession Error:', err.message); // likely invalid credentials
				this.log.warn('getSession Error:', err);
			});
		//return sessionJson || false;
	}, // end of getSession




	getSessionBE() {
			// only for be-nl and be-fr users, as the session logon using openid is different
			// looks like also for gb users:
			// https://web-api-prod-obo.horizon.tv/oesp/v4/GB/eng/web/authorization
		this.log.warn('getSessionBE');


		// axios interceptors to log request and response for debugging
		// works on all following requests (everywhere or in this sub?)
		axios.interceptors.request.use(req => {
			this.log.warn('+++INTERCEPTOR HTTP REQUEST:', 
			'\nMethod:',req.method, '\nURL:', req.url, 
			'\nBaseURL:', req.baseURL, '\nHeaders:', req.headers, '\nWithCredentials:', req.withCredentials, 
			//'\nParams:', req.params, '\nData:', req.data
			);
			this.log('+++INTERCEPTED SESSION COOKIEJAR:\n', cookieJar.getCookies(req.url)); 
			return req; // must return request
		});
		axios.interceptors.response.use(res => {
			this.log('+++INTERCEPTED HTTP RESPONSE:', res.status, res.statusText, 
			'\nHeaders:', res.headers, 
			//'\nData:', res.data, 
			//'\nLast Request:', res.request
			);
			this.log('+++INTERCEPTED SESSION COOKIEJAR:\n', cookieJar.getCookies(res.url)); 
			return res; // must return response
		});
	

		// Step 1: # get authentication details
		let apiAuthorizationUrl = countryBaseUrlArray[this.config.country] + '/authorization';
		this.log.warn('Step 1: get authentication details from',apiAuthorizationUrl);
		axiosWS.get(apiAuthorizationUrl)
			.then(response => {	
				this.log.warn('Step 1 got apiAuthorizationUrl response');
				this.log('Step 1 response.status:',response.status, response.statusText);
				
				// get the data we need for further steps
				let auth = response.data;
				let authState = auth.session.state;
				let authAuthorizationUri = auth.session.authorizationUri;
				let authValidtyToken = auth.session.validityToken;

				// Step 2: # follow authorizationUri to get AUTH cookie
				this.log.warn('Step 2 get AUTH cookie from',authAuthorizationUri);
				axiosWS.get(authAuthorizationUri, {
						jar: cookieJar,
						// unsure what minimum headers will here
						headers: {
							Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
						},
					})
					.then(response => {	
						this.log('Step 2 response.status:',response.status, response.statusText);
		
						// Step 3: # login
						this.log.warn('Step 3 post login to',BE_AUTH_URL);
						//this.log('Cookies for the auth url:',cookieJar.getCookies(BE_AUTH_URL));
						var payload = qs.stringify({
							j_username: this.config.username,
							j_password: this.config.password,
							rememberme: 'true'
						});
						axiosWS.post(BE_AUTH_URL,payload,{
							jar: cookieJar,
							maxRedirects: 0, // do not follow redirects
							validateStatus: function (status) {
								return ((status >= 200 && status < 300) || status == 302) ; // allow 302 redirect as OK
							 	},
							})
							.then(response => {	
								this.log('Step 3 response.status:',response.status, response.statusText);
								this.log('Step 3 response.headers.location:',response.headers.location); 
								//this.log('Step 3 response.headers:',response.headers);
								var url = response.headers.location;
								//location is https://login.prd.telenet.be/openid/login?response_type=code&state=... if success
								//location is https://login.prd.telenet.be/openid/login?authentication_error=true if not authorised
								if (url.indexOf('authentication_error=true') > 0 ) { // >0 if found
									this.log.warn('Step 3 Unable to login, wrong credentials');
								} else {
									this.log.warn('Step 3 login successful');

									// Step 4: # follow redirect url
									this.log.warn('Step 4 follow redirect url');
									this.log('Cookies for the redirect url:',cookieJar.getCookies(url));
									axiosWS.get(url,{
										//method: 'get',
										//url: url,
										jar: cookieJar,
										maxRedirects: 0, // do not follow redirects
										validateStatus: function (status) {
											return ((status >= 200 && status < 300) || status == 302) ; // allow 302 redirect as OK
											},
										})
										.then(response => {	
											this.log('Step 4 response.status:',response.status, response.statusText);
											this.log('Step 4 response.headers.location:',response.headers.location); // is https://www.telenet.be/nl/login_success_code=... if success
											//this.log('Step 4 response.headers:',response.headers);
											url = response.headers.location;
											// look for login_success?code=
											if (url.indexOf('login_success?code=') < 0 ) { // <0 if not found
												this.log.warn('Step 4 Unable to login, wrong credentials');
											} else {

												// Step 5: # obtain authorizationCode
												this.log.warn('Step 5 extract authorizationCode');
												url = response.headers.location;
												var codeMatches = url.match(/code=(?:[^&]+)/g)[0].split('=');
												var authorizationCode = codeMatches[1];
												if (codeMatches.length != 2 ) { // length must be 2 if code found
													this.log.warn('Step 5 Unable to extract authorizationCode');
												} else {
													this.log('Step 5 authorizationCode:',authorizationCode);

													// Step 6: # authorize again
													this.log.warn('Step 6 post auth data to',apiAuthorizationUrl);
													payload = {'authorizationGrant':{
														'authorizationCode':authorizationCode,
														'validityToken':authValidtyToken,
														'state':authState
													}};
													this.log('Cookies for the session:',cookieJar.getCookies(apiAuthorizationUrl));
													axiosWS.post(apiAuthorizationUrl, payload, {jar: cookieJar})
														.then(response => {	
															this.log('Step 6 response.status:',response.status, response.statusText);
															
															auth = response.data;
															//var refreshToken = auth.refreshToken // cleanup? don't need extra variable here
															this.log('Step 6 refreshToken:',auth.refreshToken);

															// Step 7: # get OESP code
															this.log.warn('Step 7 post refreshToken request to',apiAuthorizationUrl);
															payload = {'refreshToken':auth.refreshToken,'username':auth.username};
															var sessionUrl = countryBaseUrlArray[this.config.country].concat('/session');
															axiosWS.post(sessionUrl + "?token=true", payload, {jar: cookieJar})
																.then(response => {	
																	this.log('Step 7 response.status:',response.status, response.statusText);
																	this.log.warn('Successfully authenticated'); 

																	this.log('Step 7 response.headers:',response.headers); 
																	this.log('Step 7 response.data:',response.data); 
																	this.log('Cookies for the session:',cookieJar.getCookies(sessionUrl));

																	smartCardId = response.data.customer.smartCardId;
																	physicalDeviceId = response.data.customer.physicalDeviceId;

																	// now get the Jwt token
																	// all subscriber data is in the response.data.customer
																	// can get smartCardId, physicalDeviceId, stbType, and more
																	this.log('Getting jwtToken for householdId',response.data.customer.householdId);
																	this.getJwtTokenAxios(response.data.oespToken, response.data.customer.householdId);
																	this.log('Session created');
													
																})
																// Step 7 http errors
																.catch(error => {
																	this.log.warn("Step 7 Unable to get OESP token, http error:",error);
																});
														})
														// Step 6 http errors
														.catch(error => {
															this.log.warn("Step 6 Unable to authorize with oauth code, http error:",error);
														});	
												};
											};
										})
										// Step 4 http errors
										.catch(error => {
											this.log.warn("Step 4 Unable to oauth authorize, http error:",error);
										});
								};
							})
							// Step 3 http errors
							.catch(error => {
								this.log.warn("Step 3 Unable to login, http error:",error);
							});
					})
					// Step 2 http errors
					.catch(error => {
						this.log.warn("Step 2 Could not get authorizationUri, http error:",error);
					});
			})
			// Step 1 http errors
			.catch(error => {
				this.log.warn("Step 1 Could not get apiAuthorizationUrl, http error:",error);
			});

		this.log.warn('end of getSessionBE');

		//return sessionJson || false;
	}, // end of getSessionBE





	getJwtTokenAxios(oespToken, householdId){
		// axios version, working
		// get a JSON web token from the supplied oespToken and householdId
		this.log.debug('getJwtTokenAxios version');
		const jwtAxiosConfig = {
			method: 'GET',
			url: countryBaseUrlArray[this.config.country].concat('/tokens/jwt'),
			headers: {
				'X-OESP-Token': oespToken,
				'X-OESP-Username': myUpcUsername
			}
		};
		axiosWS(jwtAxiosConfig)
			.then(response => {	
				mqttUsername = householdId;
				mqttPassword = response.data.token;
				this.startMqttClient(this);
			})
			.catch(error => {
				this.log.warn('getJwtTokenAxios error:', error);
				return false;
			});			
	}, // end of getJwtTokenAxios



	getJwtTokenReq(oespToken, householdId){
		// Request version
		// get a JSON web token from the supplied oespToken and householdId
		this.log.debug('getJwtTokenReq');
		const jwtRequestOptions = {
			method: 'GET',
			uri: countryBaseUrlArray[this.config.country].concat('/tokens/jwt'),
			headers: {
				'X-OESP-Token': oespToken,
				'X-OESP-Username': myUpcUsername
			},
			json: true
		};

		request(jwtRequestOptions)
			.then(json => {
				jwtJson = json;
				mqttUsername = householdId;
				mqttPassword = jwtJson.token;
				this.startMqttClient(this);
			})
			.catch(function (err) {
				//this.log('getJwtTokenReq: ', err.message);
				return false;
			});
	}, // end of getJwtTokenReq






	startMqttClient(parent) {
		parent.log.warn('startMqttClient');		
		let mqttUrl = mqttUrlArray[this.config.country];
		parent.log.warn('startMqttClient: connecting to',mqttUrl);		
		mqttClient = mqtt.connect(mqttUrl, {
			connectTimeout: 10*1000, //10 seconds
			clientId: varClientId,
			username: mqttUsername,
			password: mqttPassword
		});

		// mqtt client event: connect
		mqttClient.on('connect', function () {
			parent.log.debug('mqttClient: connect event');
			/*
			mqttClient.subscribe(mqttUsername, function (err) {
				if(err){
					parent.log('mqttClient subscribe: Error:',err);
					return false;
				} else {
					parent.log('Subscribed to',mqttUsername);
				}
			});
			*/

			mqttClient.subscribe(mqttUsername +'/+/status', function (err) {
				if(err){
					parent.log('mqttClient connect: subscribe to status: Error:',err);
					return false;
				} else {
					parent.log('Subscribed to topic',mqttUsername +'/+/status');
				}
			});

			mqttClient.subscribe(mqttUsername +'/personalizationService', function (err) {
				if(err){
					parent.log('mqttClient connect: subscribe to personalizationService: Error:',err);
					return false;
				} else {
					parent.log('Subscribed to topic',mqttUsername +'/personalizationService');
				}
			});
			
			
			mqttClient.subscribe(mqttUsername +'/watchlistService', function (err) {
				if(err){
					parent.log('mqttClient connect: subscribe to personalizationService: Error:',err);
					return false;
				} else {
					parent.log('Subscribed to topic',mqttUsername +'/watchlistService');
				}
			});
			
			// mqtt client event: message received
			mqttClient.on('message', function (topic, payload) {
				parent.log.debug('mqttClient message event');
				let payloadValue = JSON.parse(payload);
				
				// check if this status message is for the desired EOSSTB
				if(topic.startsWith(mqttUsername) && topic.includes('-EOSSTB-')){
					parent.log('mqtt EOSSTB topic detected:',topic)
				};
				//if(topic.includes(parent.config.settopboxId)){
				//	parent.log('Wanted EOSSTB topic detected:',topic)
				//};
				
				//parent.log('mqttClient: Received Message: Topic:',topic);
				//parent.log('mqttClient.on.message payload',payload);
				//if(topic = mqttUsername +'/personalizationService'){
				//	parent.log('mqttClient: Received Message: Topic:',topic);
				//	parent.log('mqttClient: Received Message: Message:',payloadValue);
				//	let playerStatus = payloadValue.status
				//	parent.log('mqttClient: Received Message: Message:',payloadValue.status);
					//let playerSource = playerStatus.playerState.source
					//parent.log('mqttClient: Received Message: Message:',playerSource);
				//	}
				
				//parent.log('mqttClient: Received Message: Topic:',topic);
				//parent.log('mqttClient: Received Message: Message:',payloadValue);
				
				//parent.log('mqttClient message: payloadValue.type',payloadValue.type);
				//parent.log('mqttClient message: payloadValue.status',payloadValue.status);
				// debugging power state
				//parent.log('mqttClient message: payloadValue:',payloadValue);
				//parent.log('mqttClient message: payloadValue.status',payloadValue.status);
				//parent.log('mqttClient message: payloadValue.deviceType',payloadValue.deviceType);
				//parent.log('mqttClient message: payloadValue.source',payloadValue.source); // use as serial number
				//parent.log('mqttClient message: payloadValue.mac',payloadValue.mac);
				//parent.log('mqttClient message: payloadValue.state',payloadValue.state);

				// check if payloadValue.deviceType exists
				// deviceType exists in Topic: 1076582_ch/2E59F6E9-8E23-41D2-921D-C13CA269A3BC/status
				// Topic: 1076582_ch/3C36E4-EOSSTB-003656579806/status  
				// multiple devices can exist! how to handle them?
				if (payloadValue.deviceType){
					// got some deviceType, but which one?
						
					// check if this is the wanted settopboxId and that payloadValue.deviceType value = STB
					// wanted = defined and correct, or not defined
					//if(((payloadValue.source == parent.config.settopboxId) || (typeof parent.config.settopboxId === 'undefined'))
					//	&& (payloadValue.deviceType == 'STB')) {
					if (payloadValue.deviceType == 'STB'){
						// got the STB device type, but which STB?
						
						// set or detect the settopboxId but only once
						if (typeof settopboxId === 'undefined'){
							if (typeof parent.config.settopboxId === 'undefined') {
								settopboxId = payloadValue.source;
								parent.log('Auto-configured settopboxId to',settopboxId);
							} else {
								settopboxId = parent.config.settopboxId;
								parent.log('settopboxId configured, using', settopboxId);
							}
						};
						parent.log('Using settopBoxId',settopboxId);

						
						// set serial number to the box
						//parent.log('mqttClient: Received Message STB status: SerialNumber',parent.informationService.getCharacteristic(Characteristic.SerialNumber).value);
						if (parent.informationService.getCharacteristic(Characteristic.SerialNumber).value === 'unknown') {
								parent.log('mqttClient: Calling updateInformationService with',payloadValue.source);
								parent.informationService.updateCharacteristic(Characteristic.SerialNumber,payloadValue.source);
						};
						//parent.informationService.getCharacteristic(Characteristic.SerialNumber).updateValue(payloadValue.source);
						
						// detect power state
						/*
						settopboxState = payloadValue.state;
						parent.log('Detecting settopbox currentPowerState');
						if (settopboxState == 'ONLINE_RUNNING') // ONLINE_RUNNING means power is turned on
							currentPowerState = 1;
						else if ((settopboxState == 'ONLINE_STANDBY') || (settopboxState == 'OFFLINE')) // ONLINE_STANDBY or OFFLINE: power is off
							currentPowerState = 0;
						parent.log('Settopbox power is',(currentPowerState ? "On" : "Off"));
						*/

						// subscribe to our own generated unique varClientId
						mqttClient.subscribe(mqttUsername + '/' + varClientId, function (err) {
							if(err){
								parent.log('mqttClient subscribe to varClientId Error:',err);
								return false;
							} else {
								parent.log('Subscribed to topic',mqttUsername + '/' + varClientId);
							}
						});

						mqttClient.subscribe(mqttUsername + '/' + settopboxId, function (err) {
							if(err){
								parent.log('mqttClient subscribe to settopboxId Error:',err);
								return false;
							} else {
								parent.log('Subscribed to topic',mqttUsername + '/' + settopboxId);
							}
						});

						mqttClient.subscribe(mqttUsername + '/' + settopboxId +'/status', function (err) {
							if(err){
								parent.log('mqttClient subscribe to settopbox status Error:',err);
								return false;
							} else {
								parent.log('Subscribed to topic',mqttUsername + '/' + settopboxId +'/status');
							}
						});

						parent.log.debug('mqttClient: Received Message STB status: currentPowerState:',currentPowerState);
						//parent.getUiStatus();
					} // end of if deviceType=STB
				}


				// check if payloadValue.type exists, look for CPE.uiStatus, make sure it is for the wanted settopboxId
				// CPE.uiStatus shows us the currently selected channel on the stb, and occurs in many topics
				// Topic: 1076582_ch/3C36E4-EOSSTB-003656579806/status
				// Message: {"deviceType":"STB","source":"3C36E4-EOSSTB-003656579806","state":"ONLINE_RUNNING","mac":"F8:F5:32:45:DE:52","ipAddress":"192.168.0.33/255.255.255.0"}
				if((payloadValue.deviceType == 'STB') && (payloadValue.source == settopboxId)) {
						parent.log.debug('mqttClient: Received Message of type CPE.uiStatus for',payloadValue.source,'Detecting currentPowerState');
						if ((payloadValue.state == 'ONLINE_RUNNING') && (currentPowerState != 1)){ // ONLINE_RUNNING: power is on
							currentPowerState = 1;
							parent.log('Settopbox power:',(currentPowerState ? "On" : "Off"));
						}          
						else if (((payloadValue.state == 'ONLINE_STANDBY') || (payloadValue.state == 'OFFLINE')) // ONLINE_STANDBY or OFFLINE: power is off
							 && (currentPowerState != 0)){
							currentPowerState = 0;
							parent.log('Settopbox power:',(currentPowerState ? "On" : "Off"));
						};
						//parent.log('Settopbox power is',(currentPowerState ? "On" : "Off"));
				};


				
				// check if payloadValue.type exists, look for CPE.uiStatus, make sure it is for the wanted settopboxId
				// type exists in Topic: 1076582_ch/jrtmev583ijsntldvrk1fl95c6nrai
				// CPE.uiStatus shows us the currently selected channel on the stb, and occurs in many topics
				// Topic: 1076582_ch/vy9hvvxo8n6r1t3f4e05tgg590p8s0
				// Message: {"version":"1.3.10","type":"CPE.uiStatus","source":"3C36E4-EOSSTB-003656579806","messageTimeStamp":1607205483257,"status":{"uiStatus":"mainUI","playerState":{"sourceType":"linear","speed":1,"lastSpeedChangeTime":1607203130936,"source":{"channelId":"SV09259","eventId":"crid:~~2F~~2Fbds.tv~~2F394850976,imi:3ef107f9a95f37e5fde84ee780c834b502be1226"}},"uiState":{}},"id":"fms4mjb9uf"}
				if((payloadValue.type == 'CPE.uiStatus') && (payloadValue.source == settopboxId)) {
						parent.log.debug('mqttClient: Received Message of type CPE.uiStatus for',payloadValue.source,'Detecting currentChannelId');
						if(payloadValue.status.uiStatus == 'mainUI'){
							parent.log.debug('mqttClient: Received Message CPE.uiStatus for mainUI');
							// grab the status part of the payloadValue object as we cannot go any deeper with json
							let playerStateSource = payloadValue.status.playerState.source;
							// store the current channelId of the TV in currentChannelId
							// as this routine is listening to mqtt messages sent by the polling, this will
							// update the currentChannelId if the user changes it with the physical TV remote control
							currentChannelId = playerStateSource.channelId;
							parent.log.debug('mqttClient: Received Message CPE.uiStatus: Current channel:', currentChannelId);
					};
				};
				

				parent.log.debug('mqttClient: Received Message end of event: currentPowerState:',currentPowerState);
				parent.log.debug('mqttClient: Received Message end of event: currentChannelId:',currentChannelId);
				parent.getUiStatus();

			}); // mqtt client event: message received

			// mqtt client event: error
			mqttClient.on('error', function(err) {
				parent.log.error('mqttClient: Error:', err);
				mqttClient.end();
				return false;
			}); // end of mqtt client event: error

			// mqtt client event: close
			mqttClient.on('close', function () {
				parent.log.warn('mqttClient: Connection closed');
				mqttClient.end();
				return false;
			});
		}); // end of mqttClient.on('connect' ...
		
	}, // end of startMqttClient


	// send a channel change request to the settopbox via mqtt
	switchChannel(channelId) {
		this.log.debug('Switch to', channelId);
		mqttClient.publish(mqttUsername + '/' + settopboxId, '{"id":"' + makeId(8) + '","type":"CPE.pushToTV","source":{"clientId":"' + varClientId + '","friendlyDeviceName":"HomeKit"},"status":{"sourceType":"linear","source":{"channelId":"' + channelId + '"},"relativePosition":0,"speed":1}}');
	}, // end of switchChannel
	

	// request profile details via mqtt
	getProfilesUpdate(keyName) {
		this.log('getProfilesUpdate');
		let mqttCmd = '{"action":"OPS.getProfilesUpdate","source":"' + varClientId + '"}';
		this.log('sending:', mqttCmd);
		mqttClient.publish(mqttUsername +'/personalizationService', mqttCmd);

//		mqttClient.publish(mqttUsername +'/personalizationService', '{"action":"OPS.getProfilesUpdate","source":"' + varClientId + '"}');
	}, // end of switchChannel
		

	// send a remote control keypress to the settopbox via mqtt
	sendKey(keyName) {
		this.log('Remote key:', keyName);
		mqttClient.publish(mqttUsername + '/' + settopboxId, '{"id":"' + makeId(8) + '","type":"CPE.KeyEvent","source":"' + varClientId + '","status":{"w3cKey":"' + keyName + '","eventType":"keyDownUp"}}');
		
		// added here to get profiles when I hit a button
		this.getProfilesUpdate;
	}, // end of sendKey
	

	// get the settopbox UI status from the settopbox via mqtt
	getUiStatus() {
		//this.log('Get UI status');
		mqttClient.publish(mqttUsername + '/' + settopboxId, '{"id":"' + makeId(8) + '","type":"CPE.getUiStatus","source":"' + varClientId + '"}')
		//this.log('Get UI status mqttClient payload',mqttClient); // see the mqtt full detail if needed
		//let mqttPayloadValue = JSON.parse(mqttClient);
		//this.log('getUiStatus: mqtt connected:',mqttClient['connected']);
		//this.log('getUiStatus: mqtt disconnecting:',mqttClient['disconnecting']);
		//this.log('getUiStatus: mqtt reconnecting:',mqttClient['reconnecting']);

	}, // end of getUiStatus




	/* State Handlers */
	updateTvState(error, status) {
		// runs at the very start, and then every 5 seconds, so don't log it unless debugging
		// doesn't get the data direct from the settop box, but rather gets it from the currentPowerState and currentChannelId
		// which are received by the mqtt messages, which occurs very often
		this.log.debug('updateTvState: currentChannelId:', currentChannelId, 'currentPowerState:', currentPowerState);
		this.setInputs(); // set tvService inputs.

		if (this.tvService) {
			// update power status value (currentPowerState, 0=off, 1=on)
			if (this.tvService.getCharacteristic(Characteristic.Active).value !== currentPowerState) {
					this.tvService.getCharacteristic(Characteristic.Active).updateValue(currentPowerState == 1);
			}
			
			// log the entire object to see the data!
			//this.log('TV ActiveIdentifier:',this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)),

			this.inputs.filter((input, index) => {
				//this.log('updateTvState: input:',input, 'index', index); // log to view the inputs
				// input: { id: 'SV09029', name: 'SRF info HD', index: 2 }
				// loop through all inputs until the input.id is found that matches the currentChannelId 
				if (input.id === currentChannelId) {
					// Update HomeKit accessory with the current input if it has changed
					if (this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).value !== index) {
						this.log(`Current channel: ${input.name} (${input.id})`);
						return this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(index);
					}
				}
			return null;
			});
		} // end of if (this.tvService)
	}, // end of updateTvState


	setInputs() {
		// called by updateTvState (state handler), thus runs at polling interval
		// set the tvService inputs if they are empty

		if (this.inputServices && this.inputServices.length) {
			// this.log('setInputs: loading channels: this.inputServices.length',this.inputServices.length);
			// this.log('setInputs: loading channels: this.inputServices',this.inputServices);
			// channels can be retrieved for the country without having a mqtt session going
			let channelsUrl = countryBaseUrlArray[this.config.country].concat('/channels');
			this.log.debug('setInputs: channelsUrl:',channelsUrl);
			
			request({ url: channelsUrl, json: true}).then(availableInputs => {
				const sanitizedInputs = [];
				//this.log('setInputs: availableInputs.channels',availableInputs.channels.length);
				//this.log('channel data',availableInputs.channels[197]);
	
				let i = 0;
				let maxSources = this.config.maxChannels || MAX_INPUT_SOURCES;
				availableInputs.channels.forEach(function (channel) {
					if (i < Math.min(maxSources, MAX_INPUT_SOURCES)){ // limit to the amount of channels applicable
						sanitizedInputs.push({id: channel.stationSchedules[0].station.serviceId, name: channel.title, index: i});
					}
					i++;
				});

				this.inputs = sanitizedInputs;
				
				// need to cater for not-available channels. maybe??
				this.inputs.forEach((input, i) => {
				const inputService = this.inputServices[i];
				// possible characteristics:
				/*
				characteristics: [
					[Name],
					[ConfiguredName],
					[InputSourceType],
					[IsConfigured],
					[CurrentVisibilityState],
					[Identifier]
				],
				optionalCharacteristics: [ [Identifier], [InputDeviceType], [TargetVisibilityState]
				*/
				inputService.getCharacteristic(Characteristic.ConfiguredName).updateValue( `${i < 9 ? `0${i + 1}` : i + 1}` + ". " + input.name);
				inputService.getCharacteristic(Characteristic.IsConfigured).updateValue(Characteristic.IsConfigured.CONFIGURED);
				
				// CurrentVisibilityState and TargetVisibilityState: SHOWN = 0; HIDDEN = 1;
				inputService.getCharacteristic(Characteristic.CurrentVisibilityState).updateValue(Characteristic.CurrentVisibilityState.SHOWN);
				
				// InputDeviceType 
				// OTHER = 0; TV = 1; RECORDING = 2; TUNER = 3; PLAYBACK = 4; AUDIO_SYSTEM = 5; UNKNOWN_6 = 6; 
				// introduce in iOS 14; "UNKNOWN_6" is not stable API, changes as soon as the type is known
				/*
				this.log('setInputs index',i);
				this.log('setInputs Name',i,inputService.getCharacteristic(Characteristic.Name).value);
				this.log('setInputs ConfiguredName',i,inputService.getCharacteristic(Characteristic.ConfiguredName).value);
				this.log('setInputs InputSourceType',i,inputService.getCharacteristic(Characteristic.InputSourceType).value);
				this.log('setInputs IsConfigured',i,inputService.getCharacteristic(Characteristic.IsConfigured).value);
				this.log('setInputs CurrentVisibilityState',i,inputService.getCharacteristic(Characteristic.CurrentVisibilityState).value);
				this.log('setInputs Identifier',i,inputService.getCharacteristic(Characteristic.Identifier).value);
				this.log('setInputs InputDeviceType',i,inputService.getCharacteristic(Characteristic.InputDeviceType).value);
				this.log('setInputs TargetVisibilityState',i,inputService.getCharacteristic(Characteristic.TargetVisibilityState).value
				*/
				});
			},
			error => {
				this.log.warn(`Failed to get available inputs from ${this.config.name}. Please verify the EOS settopbox is connected to the LAN`);
			}
			);
		}
	}, // end of setInputs


	getPowerState(callback) {
		// fired when the user clicks away from the Remote Control, regardless of which TV was selected
		// fired when Homekit wants to refresh the TV tile in Homekit. Refresh occurs when tile is displayed.
		// currentPowerState is updated by the polling mechanisn
		//this.log('getPowerState current power state:', currentPowerState);
		callback(null, currentPowerState); // return current state: 0=off, 1=on
	}, // end of getPowerState

	setPowerState(wantedPowerState, callback) {
		// fired when the user clicks the power button in the TV accessory in Homekit
		// fired when the user clicks the TV tile in Homekit
		// fired when the first key is pressed after opening the Remote Control
		// wantedPowerState is the wanted power state: 0=off, 1=on
		if(wantedPowerState !== currentPowerState){
			// wanted power state is different to current power state, so send the power key to change state
			this.sendKey('Power');
		}

		callback();
	}, // end of setPowerState


	getInputState(callback) {
		// fired when the user clicks away from the iOS Device TV Remote Control, regardless of which TV was selected
		// fired when the icon is clicked in Homekit and Homekit requests a refresh
		// currentChannelId is updated by the polling mechanisn
		//this.log('getInputState');
		var isDone = false;
		this.inputs.filter((input, index) => {
			// getInputState input { id: 'SV00044', name: 'RTL plus', index: 44 }
			//this.log(`getInputState: ${input.index} ${input.name} (${input.id})`);
			if (input.id === currentChannelId) {
				this.log('Current channel:', index, input.name, input.id);
				isDone = true;
				return callback(null, index);
				}
			});
		if (!isDone)
			return callback(null, null);
	}, // end of getInputState


	setInputState(input, callback) {
		this.log.debug('setInputState');
		this.log(`Change channel to: ${input.name} (${input.id})`);
		this.switchChannel(input.id);
		callback();
	}, // end of setInputState


	//getVolume
	getVolume(callback) {
		this.log.debug("getVolume");
		callback(true);
	}, // end of getVolume


	// set the volume of the TV using bash scripts
	// the ARRIS box remote control commmunicates with the stereo via IR commands, not over mqtt
	// so volume must be handled over a different method
	// here we send execute a bash command on the raspberry pi using the samsungctl command
	// to control the authors samsung stereo at 192.168.0.152
	setVolume(direction, callback) {
		// direction: only 2 values possible: INCREMENT: 0,	DECREMENT: 1,
		const INCREMENT = 0;
		const DECREMENT = 1;
		this.log('Volume control: %s', (direction === DECREMENT) ? 'Down' : 'Up');
		var self = this;

		// Execute command to change volume
		exec((direction === DECREMENT) ? this.config.volDownCommand : this.config.volUpCommand, function (error, stdout, stderr) {
			// Error detection. error is true when an exec error occured
			if (error) {
					self.log.warn('setVolume Error:',stderr.trim());
			}
		});

		callback(true);
	}, // end of setVolume


	

	
	//setMute
	setMute(state, callback) {
		// sends the mute command when called// works for TVs that accept a mute toggle command
		const NOT_MUTED = 0;
		const MUTED = 1;
		this.log('setMute', state);
		var self = this;

		// Execute command to toggle mute
		exec(this.config.muteCommand, function (error, stdout, stderr) {
			// Error detection. error is true when an exec error occured
			if (error) {
					self.log.warn('setMute Error:',stderr.trim());
			} else {
					self.log('setMute succeeded:',stdout);
			}
		});

		callback(true);
	}, // end of setMute



	// fired by the View TV Settings command in the Homekit TV accessory Settings
	viewTvSettings(input, callback) {
		this.log('Menu command: View TV Settings');
		this.sendKey('Help'); // puts SETTINGS.INFO on the screen
		setTimeout(() => { this.sendKey('ArrowRight'); }, 600); // move right to select SETTINGS.PROFILES, send after 600ms
		callback(true);
	}, // end of viewTvSettings



	remoteKeyPress(remoteKey, callback) {
	this.log.debug('Remote Key Press:',remoteKey); // added log entry Jochen
		// remoteKey is the key pressed on the Apple TV Remote in the Control Center
		switch (remoteKey) {
			case Characteristic.RemoteKey.REWIND: // 0
				this.sendKey('MediaRewind');
				callback();
				break;
			case Characteristic.RemoteKey.FAST_FORWARD: // 1
				this.sendKey('MediaFastForward');
				callback();
				break;
			case Characteristic.RemoteKey.NEXT_TRACK: // 2
				this.sendKey('DisplaySwap');
				callback();
				break;
			case Characteristic.RemoteKey.PREVIOUS_TRACK: // 3
				this.sendKey('DisplaySwap');
				callback();
				break;
			case Characteristic.RemoteKey.ARROW_UP: // 4
				this.sendKey('ArrowUp');
				callback();
				break;
			case Characteristic.RemoteKey.ARROW_DOWN: // 5
				this.sendKey('ArrowDown');
				callback();
				break;
			case Characteristic.RemoteKey.ARROW_LEFT: // 6
				this.sendKey('ArrowLeft');
				callback();
				break;
			case Characteristic.RemoteKey.ARROW_RIGHT: // 7
				this.sendKey('ArrowRight');
				callback();
				break;
			case Characteristic.RemoteKey.SELECT: // 8
				this.sendKey('Enter');
				callback();
				break;
			case Characteristic.RemoteKey.BACK: // 9
				this.sendKey(this.config.backButton || "Escape");
				callback();
				break;
			case Characteristic.RemoteKey.EXIT: // 10
				this.sendKey(this.config.backButton || "Escape");
				callback();
				break;
			case Characteristic.RemoteKey.PLAY_PAUSE: // 11
				this.sendKey(this.config.playPauseButton || "MediaPause");
				callback();
				break;
			case Characteristic.RemoteKey.INFORMATION: // 15
				// this is the button that can be used to access the menu
				// Options:
				// ContextMenu: the [...] button on the remote
				// Info: displays the INFO screenm same as the [...] button then Info on the remote
				// Help: displays the SETTINGS INFO page
				// Guide: displays the TV GUIDE page, same as the Guide button on the remote,
				// MediaTopMenu: displazs the top menu (home) page, same as the HOME button on the remote
				// nothing: settings, menu, 
				this.sendKey(this.config.infoButton || "MediaTopMenu");
				callback();
				break;
			default:
				callback();
				break;
		}
	}, // end of remoteKeyPress

}; // end of the tvAccessory.prototype
