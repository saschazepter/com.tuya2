export type TuyaQrCodeResponse = {
  success: boolean;
  tid: string;
  t: number;
  msg?: string;
  code?: string;
  result?: { qrcode: string };
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
