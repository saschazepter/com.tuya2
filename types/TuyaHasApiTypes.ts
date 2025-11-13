export type TuyaHasResponse<Result> = {
  success: boolean;
  tid: string;
  t: number;
  msg?: string;
  code?: string;
  result?: Result;
};

export type TuyaQrCodeResponse = TuyaHasResponse<{ qrcode: string }>;

export type TuyaTokenRefreshResponse = {
  accessToken: string;
  expireTime: number;
  refreshToken: string;
  uid: string;
};

export type TuyaHasHome = {
  background: string;
  geoName: string;
  gmtCreate: number;
  gmtModified: number;
  groupId: number;
  id: number;
  lat: number;
  lon: number;
  name: string;
  ownerId: string;
  status: boolean;
  uid: string;
};

export type TuyaMqttConfigResponse = {
  clientId: string;
  expireTime: number;
  password: string;
  topic: {
    devId: { pub: string; sub: string };
    ownerId: { sub: string };
  };
  url: string;
  username: string;
};

export type TuyaMqttMessage = {
  protocol: number;
  data: {
    devId: string;
    dataId: string;
    productKey: string;
    status: TuyaMqttStatus;
  };
  t: number;
};

export type TuyaMqttStatus = TuyaMqttStatusDataPoint[];
export type TuyaMqttStatusDataPoint = { '1': boolean; code: string; t: number; value: unknown };

export type TuyaHasStatusResponse = {
  category: string;
  dpStatusRelationDTOS: TuyaHasStatus[];
  productKey: string;
};

export type TuyaHasStatus = {
  dpCode: string;
  dpId: number;
  enumMappingMap: {
    [enumKey: string]: { code: string; value: string }; // code is same as dpCode
  };
  statusCode: string;
  statusFormat: string; // JSON string
  supportLocal: true;
  valueConvert: string;
  valueDesc: string; // JSON string
  valueType: string;
};

export type TuyaHasScenesResponse = TuyaHasScene[];

export type TuyaHasScene = {
  actions: TuyaHasSceneAction[];
  enabled: boolean;
  name: string;
  scene_id: string;
};

export type TuyaHasSceneAction = {
  action_executor: string;
  entity_id: string;
  executor_property: { [key: string]: unknown };
};
