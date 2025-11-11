import { fetch, OAuth2Client } from 'homey-oauth2app';
import { nanoid } from 'nanoid';

import { URL } from 'url';
import {
  TuyaCommand,
  type TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
  TuyaHome,
  TuyaScenesResponse,
  TuyaStatusResponse,
  TuyaUserInfo,
  TuyaWebRTC,
} from '../types/TuyaApiTypes';
import * as TuyaOAuth2Util from './TuyaOAuth2Util';
import TuyaHasToken from './TuyaHasToken';
import { TuyaHasHome, TuyaMqttConfigResponse, TuyaMqttMessage } from '../types/TuyaHasApiTypes';
import crypto from 'crypto';
import TuyaOAuth2Error from './TuyaOAuth2Error';
import { DeviceRegistration } from '../types/TuyaTypes';
import { Response } from 'node-fetch';
import * as TuyaOAuth2Constants from './TuyaOAuth2Constants';
import mqtt from 'mqtt';

type OAuth2SessionInformation = { id: string; title: string };

export default class TuyaHasClient extends OAuth2Client<TuyaHasToken> {
  static TOKEN = TuyaHasToken;
  static API_URL = '<dummy>';
  static TOKEN_URL = '<dummy>';
  static AUTHORIZATION_URL = 'https://openapi.tuyaus.com/login';
  static REDIRECT_URL = 'https://tuya.athom.com/callback';

  mqttPromise?: Promise<void>;
  mqttConfig?: TuyaMqttConfigResponse;
  mqttClient?: mqtt.MqttClient;

  resolveReadyPromise!: () => void;
  readyPromise = new Promise<void>(resolve => {
    this.resolveReadyPromise = resolve;
  });

  // We save this information to eventually enable OAUTH2_MULTI_SESSION.
  // We can then list all authenticated users by name, e-mail and country flag.
  // This is useful for multiple account across Tuya brands & regions.
  async onGetOAuth2SessionInformation(): Promise<OAuth2SessionInformation> {
    const token = this.getToken();
    return {
      id: token.uid,
      title: token.username,
    };
  }

  async onInit(): Promise<void> {
    this.resolveReadyPromise();
    this.connectToMqtt().catch(error => this.error(error));
  }

  // Sign the request
  async _executeRequest(
    {
      method,
      path,
      json,
      query = {},
      headers = {},
    }: {
      method: string;
      path: string;
      json: object;
      query: object;
      headers: object;
    },
    didRefreshToken = false,
  ): Promise<void> {
    await this.readyPromise;
    if (this._refreshingToken) {
      await this._refreshingToken;
    }

    const token = this.getToken();

    const requestUrl = new URL(`${token.endpoint}${path}`);
    const requestOptions = {
      method,
      headers,
      body: undefined as string | undefined,
    };

    const t = Date.now(); // Timestamp in milliseconds
    const rid = crypto.randomUUID(); // Request ID
    const sid = ''; // Session ID
    const hashKey = crypto.createHash('md5').update(`${rid}${token.refresh_token}`).digest('hex');
    const secret = TuyaOAuth2Util.secretGenerating(rid, sid, hashKey);

    let queryEncdata = '';
    if (Object.keys(query).length > 0) {
      queryEncdata = JSON.stringify(query);
      queryEncdata = TuyaOAuth2Util.aesGcmEncrypt(queryEncdata, secret);
      requestUrl.searchParams.append('encdata', queryEncdata);
    }

    let bodyEncdata = '';
    if (json && Object.keys(json).length > 0) {
      bodyEncdata = JSON.stringify(json);
      bodyEncdata = TuyaOAuth2Util.aesGcmEncrypt(bodyEncdata, secret);
      requestOptions.body = JSON.stringify({ encdata: bodyEncdata });
    }

    requestOptions.headers = {
      'X-appKey': 'HA_3y9q4ak7g4ephrvke',
      'X-requestId': rid,
      'X-token': token.access_token,
      'X-sid': sid,
      'X-time': `${t}`,
      'X-sign': TuyaOAuth2Util.restfulSign(hashKey, queryEncdata, bodyEncdata, {
        'X-appKey': 'HA_3y9q4ak7g4ephrvke',
        'X-requestId': rid,
        'X-sid': sid,
        'X-time': `${t}`,
        'X-token': token.access_token,
      }),
      'Content-Type': 'application/json',
    };

    const response = await fetch(requestUrl.toString(), requestOptions);
    const responseBodyJson = await response.json();

    if (responseBodyJson.success === false) {
      // TODO: Check if we should refresh the token
      if (responseBodyJson.msg === 'TODO_access_token_expired') {
        if (didRefreshToken) {
          throw new TuyaOAuth2Error('Access token expired, even after refresh', response.status, responseBodyJson.code);
        }

        await this.refreshToken();
        return this._executeRequest({ method, path, json, query, headers }, true);
      }
      throw new Error(`[${responseBodyJson.code}] ${responseBodyJson.msg}`);
    }

    const responseBodyDecrypted = TuyaOAuth2Util.aesGcmDecrypt(responseBodyJson.result, secret);
    const responseBodyDecryptedJson = JSON.parse(responseBodyDecrypted);

    return responseBodyDecryptedJson;
  }

  /*
   * API Methods
   */

  async getMqttConfigHA(): Promise<TuyaMqttConfigResponse> {
    const linkId = crypto.randomUUID();
    return this._post('/v1.0/m/life/ha/access/config', {
      linkId: `tuya-device-sharing-sdk-python.${linkId}`,
    });
  }

  async getHomesHA(): Promise<TuyaHasHome[]> {
    return this._get(`/v1.0/m/life/users/homes`);
  }

  async getDevicesHA({ ownerId }: { ownerId: string }): Promise<TuyaDeviceResponse[]> {
    return this.get({
      path: `/v1.0/m/life/ha/home/devices`,
      query: { homeId: ownerId },
    });
  }

  async getScenesHA({ homeId }: { homeId: string }): Promise<TuyaScenesResponse> {
    return this.get({
      path: `/v1.0/m/scene/ha/home/scenes`,
      query: { homeId },
    });
  }

  async getMQTTConfigurationHA(): Promise<any> {
    return this.post({
      path: '/v1.0/m/life/ha/access/config',
      json: {
        linkId: `tuya-device-sharing-sdk-python.26301f1a-ae93-11f0-8de9-0242ac120002`,
      },
    });
  }

  async getHomes(): Promise<TuyaHome[]> {
    throw new Error('Not implemented');
  }

  async getUserInfo(): Promise<TuyaUserInfo> {
    throw new Error('Not implemented');
  }

  async getDevices(): Promise<TuyaDeviceResponse[]> {
    const devices: TuyaDeviceResponse[] = [];
    const hasHomes = await this.getHomesHA();
    for (const hasHome of hasHomes) {
      await this.getDevicesHA(hasHome)
        .then(res => devices.push(...res))
        .catch(this.error);
    }
    return devices;
  }

  async getDevice({ deviceId }: { deviceId: string }): Promise<TuyaDeviceResponse> {
    throw new Error('Not implemented');
  }

  async getScenes(spaceId: string | number): Promise<TuyaScenesResponse> {
    throw new Error('Not implemented');
  }

  async triggerScene(sceneId: string): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async getSpecification(deviceId: string): Promise<TuyaDeviceSpecificationResponse> {
    throw new Error('Not implemented');
  }

  async queryDataPoints(deviceId: string): Promise<TuyaDeviceDataPointResponse> {
    throw new Error('Not implemented');
  }

  async setDataPoint(deviceId: string, dataPointId: string, value: unknown): Promise<void> {
    throw new Error('Not implemented');
  }

  async getWebRTCConfiguration({ deviceId }: { deviceId: string }): Promise<TuyaWebRTC> {
    throw new Error('Not implemented');
  }

  async getStreamingLink(
    deviceId: string,
    type: 'RTSP' | 'HLS',
  ): Promise<{
    url: string;
  }> {
    throw new Error('Not implemented');
  }

  async getDeviceStatus({ deviceId }: { deviceId: string }): Promise<TuyaStatusResponse> {
    throw new Error('Not implemented');
  }

  async sendCommands({ deviceId, commands = [] }: { deviceId: string; commands: TuyaCommand[] }): Promise<boolean> {
    throw new Error('Not implemented');
  }

  private async _get<T>(path: string): Promise<T> {
    const requestId = nanoid();
    this.log('GET', requestId, path);
    return await this.get<T>({ path }).then(result => {
      this.log('GET Response', requestId, JSON.stringify(result));
      return result;
    });
  }

  private async _post<T>(path: string, payload?: unknown): Promise<T> {
    const requestId = nanoid();
    this.log('POST', requestId, path, JSON.stringify(payload));
    return await this.post<T>({ path, json: payload }).then(result => {
      this.log('POST Response', requestId, JSON.stringify(result));

      return result;
    });
  }

  /*
   * MQTT
   */
  private registeredDevices = new Map<string, DeviceRegistration>();
  // Devices that are added as 'other' may be duplicates
  private registeredOtherDevices = new Map<string, DeviceRegistration>();

  registerDevice(
    {
      productId,
      deviceId,
      onStatus = async (): Promise<void> => {
        /* empty */
      },
    }: DeviceRegistration,
    other = false,
  ): void {
    const register = other ? this.registeredOtherDevices : this.registeredDevices;
    register.set(deviceId, {
      productId,
      deviceId,
      onStatus,
    });
    // Only subscribe once for each device, so check if device is already in the other register
    if (!this.isRegistered(productId, deviceId, !other)) {
      // We need an anonymous function here, as the this in this.error is apparently not always bound
      this.subscribeToMqtt(deviceId).catch(error => this.error(error));
    }
  }

  unregisterDevice({ productId, deviceId }: { productId: string; deviceId: string }, other = false): void {
    const register = other ? this.registeredOtherDevices : this.registeredDevices;
    register.delete(deviceId);
    // Only unsubscribe if there are no registrations for the device left, so check if device is still in the other register
    if (!this.isRegistered(productId, deviceId, !other)) {
      this.unsubscribeFromMqtt(deviceId).catch(error => this.error(error));
    }
  }

  isRegistered(productId: string, deviceId: string, other = false): boolean {
    const register = other ? this.registeredOtherDevices : this.registeredDevices;
    return register.has(deviceId);
  }

  async connectToMqtt(): Promise<void> {
    if (this.mqttPromise !== undefined) {
      return this.mqttPromise;
    }
    let resolveMqttPromise: () => void = () => {
      return;
    };
    this.mqttPromise = new Promise<void>(resolve => {
      resolveMqttPromise = resolve;
    });
    this.log('Connecting to Mqtt');
    const mqttConfig = await this.getMqttConfigHA();
    this.mqttConfig = mqttConfig;
    this.mqttClient = await mqtt.connectAsync(mqttConfig.url, {
      clientId: mqttConfig.clientId,
      username: mqttConfig.username,
      password: mqttConfig.password,
    });
    this.mqttClient.on('message', async (topic, message, packet) => {
      const json = JSON.parse(message.toString()) as TuyaMqttMessage;
      const deviceId = json.data.devId;
      const dataPoints = json.data.status ?? [];

      const status: { [key: string]: unknown } = {};
      const changedStatusCodes: string[] = [];

      for (const dataPoint of dataPoints) {
        status[dataPoint.code] = dataPoint.value;
        changedStatusCodes.push(dataPoint.code);
      }

      this.log('Incoming MQTT:', json.data);

      const registeredDevice = this.registeredDevices.get(deviceId);
      const registeredOtherDevice = this.registeredOtherDevices.get(deviceId);
      if (registeredDevice === undefined && registeredOtherDevice === undefined) {
        this.log('No matching devices found for webhook data');
        return;
      }

      if (registeredDevice !== undefined) {
        await registeredDevice.onStatus('status', status, changedStatusCodes);
      }
      if (registeredOtherDevice !== undefined) {
        await registeredOtherDevice.onStatus('status', status, changedStatusCodes);
      }
    });
    resolveMqttPromise();
  }

  async subscribeToMqtt(deviceId: string): Promise<void> {
    if (!this.mqttClient) {
      await this.connectToMqtt();
    }
    const topicTemplate = this.mqttConfig!.topic.devId.sub;
    const topic = topicTemplate.replace('{devId}', deviceId);
    await this.mqttClient!.subscribeAsync(topic);
    this.log('Subscribed to MQTT channel for device:', deviceId);
  }

  async unsubscribeFromMqtt(deviceId: string): Promise<void> {
    if (!this.mqttClient) {
      return;
    }
    const topicTemplate = this.mqttConfig!.topic.devId.sub;
    const topic = topicTemplate.replace('{devId}', deviceId);
    await this.mqttClient!.unsubscribeAsync(topic);
    this.log('Unsubscribed from MQTT channel for device:', deviceId);
  }
}

TuyaHasClient.setMaxListeners(Infinity);
module.exports = TuyaHasClient;
