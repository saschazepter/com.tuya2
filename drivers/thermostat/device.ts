import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device';
import * as Util from '../../lib/TuyaOAuth2Util';
import { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes';
import { constIncludes, filterTuyaSettings, getFromMap } from '../../lib/TuyaOAuth2Util';
import {
  HomeyThermostatSettings,
  THERMOSTAT_CAPABILITIES,
  THERMOSTAT_CAPABILITIES_MAPPING,
  THERMOSTAT_FLOWS,
  TuyaThermostatSettings,
} from './TuyaThermostatConstants';

module.exports = class TuyaOAuth2DeviceThermostat extends TuyaOAuth2Device {
  async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    for (const tuyaCapability of THERMOSTAT_CAPABILITIES.read_write) {
      const homeyCapability = THERMOSTAT_CAPABILITIES_MAPPING[tuyaCapability];
      if (this.hasCapability(homeyCapability)) {
        this.registerCapabilityListener(homeyCapability, value => this.sendCommand({ code: tuyaCapability, value }));
      }
    }

    if (this.hasCapability('target_temperature')) {
      this.registerCapabilityListener('target_temperature', value => {
        const settingId = 'target_temperature_scaling';
        const setting = this.getSetting(settingId) as string;
        const scaling = setting.startsWith('value')
          ? parseFloat(setting.slice('value'.length)) // Use the value directly
          : 10.0 ** Number.parseInt(setting, 10); // Use the value as an exponent of 10 (like the Tuya API)
        return this.sendCommand({ code: 'temp_set', value: Math.round(value * scaling) });
      });
    }
  }

  async onTuyaStatus(status: TuyaStatus, changed: string[]): Promise<void> {
    await super.onTuyaStatus(status, changed);

    for (const tuyaCapability in status) {
      const value = status[tuyaCapability];
      const homeyCapability = getFromMap(THERMOSTAT_CAPABILITIES_MAPPING, tuyaCapability);

      if (
        constIncludes(THERMOSTAT_CAPABILITIES.read_write, tuyaCapability) ||
        constIncludes(THERMOSTAT_CAPABILITIES.read_only, tuyaCapability)
      ) {
        await this.safeSetCapabilityValue(homeyCapability, value);
      }

      if (constIncludes(THERMOSTAT_CAPABILITIES.read_scaled, tuyaCapability)) {
        const settingId = `${homeyCapability}_scaling`;
        const setting = this.getSetting(settingId) as string;
        const scaling = setting.startsWith('value')
          ? parseFloat(setting.slice('value'.length)) // Use the value directly
          : 10.0 ** Number.parseInt(setting, 10); // Use the value as an exponent of 10 (like the Tuya API)
        await this.safeSetCapabilityValue(homeyCapability, (value as number) / scaling);
      }

      if (constIncludes(THERMOSTAT_CAPABILITIES.setting, tuyaCapability)) {
        await this.safeSetSettingValue(tuyaCapability, value);
      }

      if (tuyaCapability === 'work_state' && !this.hasTuyaCapability('mode')) {
        await this.safeSetCapabilityValue(homeyCapability, value);
      }
    }

    for (const tuyaCapability of changed) {
      if (constIncludes(THERMOSTAT_FLOWS.boolean_capability_trigger, tuyaCapability)) {
        const value = status[tuyaCapability] as boolean;
        const homeyCapability = getFromMap(THERMOSTAT_CAPABILITIES_MAPPING, tuyaCapability);
        await this.homey.flow
          .getDeviceTriggerCard(`thermostat_${homeyCapability}_${value}`)
          .trigger(this)
          .catch(this.error);
      }
    }
  }

  async onSettings(event: SettingsEvent<HomeyThermostatSettings>): Promise<string | void> {
    for (const homeyCapability of [
      'target_temperature',
      'measure_temperature',
      'measure_humidity',
      'measure_power',
    ] as const) {
      await Util.handleScaleSetting(this, event, `${homeyCapability}_scaling`, homeyCapability).catch(this.error);
    }

    const tuyaSettings = filterTuyaSettings<HomeyThermostatSettings, TuyaThermostatSettings>(
      event,
      THERMOSTAT_CAPABILITIES.setting,
    );

    return Util.onSettings(this, tuyaSettings, this.SETTING_LABELS);
  }
};
