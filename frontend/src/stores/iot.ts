import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Device, Geofence, Alert, AlertType, AlertSeverity, DeviceGroup, DeviceThresholds, TrackData, TrackPoint, StayPoint, TrackSegment, HealthDataPoint, DeviceHealth, HealthSummary, TrackLoadState } from '../types';

function generateId(prefix: string) {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6);
}

export const useIotStore = defineStore('iot', () => {
  const devices = ref<Device[]>([
    { id: 'd1', name: '传感器-A01', lat: 39.9042, lng: 116.4074, status: 'online', lastSeen: new Date().toISOString(), battery: 85, temperature: 24.5 },
    { id: 'd2', name: '传感器-B02', lat: 39.9142, lng: 116.3974, status: 'alert', lastSeen: new Date().toISOString(), battery: 12, temperature: 38.2 },
    { id: 'd3', name: '追踪器-C03', lat: 39.8942, lng: 116.4174, status: 'offline', lastSeen: new Date(Date.now() - 3600000).toISOString(), battery: 0, temperature: 0 },
    { id: 'd4', name: '传感器-D04', lat: 39.9082, lng: 116.4024, status: 'online', lastSeen: new Date().toISOString(), battery: 45, temperature: 26.1 },
    { id: 'd5', name: '追踪器-E05', lat: 39.8992, lng: 116.4104, status: 'online', lastSeen: new Date().toISOString(), battery: 92, temperature: 23.8 },
  ]);
  const fences = ref<Geofence[]>([
    { id: 'f1', name: '办公区域', center: { lat: 39.9042, lng: 116.4074 }, radius: 500, type: 'circle', alertOnEnter: false, alertOnExit: true, color: '#4caf50' },
    { id: 'f2', name: '危险区域', center: { lat: 39.9142, lng: 116.3974 }, radius: 200, type: 'circle', alertOnEnter: true, alertOnExit: false, color: '#e53935' },
    { id: 'f3', name: '仓库区域', center: { lat: 39.8992, lng: 116.4124 }, radius: 0, type: 'polygon',
      paths: [
        { lat: 39.9012, lng: 116.4094 },
        { lat: 39.9012, lng: 116.4154 },
        { lat: 39.8972, lng: 116.4154 },
        { lat: 39.8972, lng: 116.4094 },
      ], alertOnEnter: true, alertOnExit: true, color: '#1976d2' },
  ]);
  const alerts = ref<Alert[]>([
    {
      id: generateId('a'),
      deviceId: 'd2',
      type: 'low_battery',
      severity: 'warning',
      timestamp: new Date(Date.now() - 300000).toISOString(),
      message: '设备电量过低，请及时充电',
      acknowledged: false
    },
    {
      id: generateId('a'),
      deviceId: 'd3',
      type: 'offline',
      severity: 'critical',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      message: '设备离线超过1小时',
      acknowledged: false
    },
    {
      id: generateId('a'),
      deviceId: 'd2',
      fenceId: 'f2',
      type: 'enter',
      severity: 'critical',
      timestamp: new Date(Date.now() - 600000).toISOString(),
      message: '设备进入危险区域',
      acknowledged: false
    }
  ]);
  const selectedFenceId = ref<string | null>(null);
  const editMode = ref<'none' | 'draw-circle' | 'draw-polygon' | 'edit'>('none');
  const highlightedDeviceId = ref<string | null>(null);
  const isRegisteringDevice = ref(false);
  const registrationLocation = ref<{ lat: number; lng: number } | null>(null);

  const trackPlaybackEnabled = ref(false);
  const trackData = ref<TrackData | null>(null);
  const playbackDeviceId = ref<string | null>(null);
  const playbackStartTime = ref<string>('');
  const playbackEndTime = ref<string>('');
  // 虚拟播放头：采样点之间的浮点下标 [0, points.length - 1]，由真实时间差驱动
  const playbackPosition = ref(0);
  const isPlaying = ref(false);
  const playbackSpeed = ref(1);
  const showTrack = ref(true);
  const showStayPoints = ref(true);
  const showBreachEvents = ref(true);
  const trackLoadState = ref<TrackLoadState>('idle');
  const trackLoadError = ref('');

  const groups = ref<DeviceGroup[]>([
    { id: 'g1', name: '生产车间', color: '#1976d2', description: '生产线设备' },
    { id: 'g2', name: '仓储区域', color: '#388e3c', description: '仓库监控设备' },
    { id: 'g3', name: '办公区域', color: '#f57c00', description: '办公环境监测' },
    { id: 'g4', name: '室外设施', color: '#7b1fa2', description: '户外设备' },
  ]);

  const onlineCount = computed(() => devices.value.filter(d => d.status === 'online').length);
  const offlineCount = computed(() => devices.value.filter(d => d.status === 'offline').length);
  const alertDeviceCount = computed(() => devices.value.filter(d => d.status === 'alert').length);
  const deviceCount = computed(() => devices.value.length);
  const fenceCount = computed(() => fences.value.length);
  const alertCount = computed(() => alerts.value.filter(a => !a.acknowledged).length);
  const selectedFence = computed(() => fences.value.find(f => f.id === selectedFenceId.value) || null);

  const avgBattery = computed(() => {
    const onlineDevices = devices.value.filter(d => d.status !== 'offline');
    if (onlineDevices.length === 0) return 0;
    return Math.round(onlineDevices.reduce((sum, d) => sum + d.battery, 0) / onlineDevices.length);
  });

  const avgTemperature = computed(() => {
    const onlineDevices = devices.value.filter(d => d.status !== 'offline');
    if (onlineDevices.length === 0) return 0;
    return Number((onlineDevices.reduce((sum, d) => sum + d.temperature, 0) / onlineDevices.length).toFixed(1));
  });

  const lowBatteryCount = computed(() => devices.value.filter(d => d.battery < 20 && d.status !== 'offline').length);

  const devicesRanked = computed(() => {
    return [...devices.value].sort((a, b) => {
      const statusOrder = { alert: 0, offline: 1, online: 2 };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.battery - a.battery;
    });
  });

  const recentAlerts = computed(() => {
    return [...alerts.value]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 50);
  });

  const unacknowledgedAlerts = computed(() => alerts.value.filter(a => !a.acknowledged));

  const criticalAlerts = computed(() => unacknowledgedAlerts.value.filter(a => a.severity === 'critical'));
  const warningAlerts = computed(() => unacknowledgedAlerts.value.filter(a => a.severity === 'warning'));
  const infoAlerts = computed(() => unacknowledgedAlerts.value.filter(a => a.severity === 'info'));

  const criticalCount = computed(() => criticalAlerts.value.length);
  const warningCount = computed(() => warningAlerts.value.length);
  const infoCount = computed(() => infoAlerts.value.length);

  const playbackCurrentIndex = computed(() => {
    if (!trackData.value || trackData.value.points.length === 0) return 0;
    return Math.max(0, Math.min(trackData.value.points.length - 1, Math.round(playbackPosition.value)));
  });

  // 两个采样点之间做线性插值，0.5 倍速时播放头仍能平滑推进
  const playbackCurrentPoint = computed<TrackPoint | null>(() => {
    const points = trackData.value?.points;
    if (!points || points.length === 0) return null;
    const pos = playbackPosition.value;
    const last = points.length - 1;
    if (pos <= 0) return points[0];
    if (pos >= last) return points[last];

    const i = Math.floor(pos);
    const fraction = pos - i;
    const a = points[i];
    const b = points[i + 1];
    const lerp = (x?: number, y?: number) => {
      if (x === undefined) return y;
      if (y === undefined) return x;
      return x + (y - x) * fraction;
    };
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();

    return {
      lat: a.lat + (b.lat - a.lat) * fraction,
      lng: a.lng + (b.lng - a.lng) * fraction,
      timestamp: new Date(ta + (tb - ta) * fraction).toISOString(),
      speed: lerp(a.speed, b.speed),
      battery: lerp(a.battery, b.battery),
      temperature: lerp(a.temperature, b.temperature),
      isAbnormal: fraction >= 0.5 ? b.isAbnormal : a.isAbnormal,
      abnormalType: fraction >= 0.5 ? b.abnormalType : a.abnormalType,
      abnormalMessage: fraction >= 0.5 ? b.abnormalMessage : a.abnormalMessage
    };
  });

  const playbackProgress = computed(() => {
    const points = trackData.value?.points;
    if (!points || points.length <= 1) return 0;
    return (playbackPosition.value / (points.length - 1)) * 100;
  });

  const playbackCurrentTime = computed(() => {
    return playbackCurrentPoint.value?.timestamp || '';
  });

  function getDeviceById(id: string) {
    return devices.value.find(d => d.id === id);
  }

  function getFenceById(id: string) {
    return fences.value.find(f => f.id === id);
  }

  function acknowledgeAlert(id: string) {
    const a = alerts.value.find(a => a.id === id);
    if (a) a.acknowledged = true;
  }

  function batchAcknowledgeAlerts(ids: string[]) {
    ids.forEach(id => {
      const a = alerts.value.find(a => a.id === id);
      if (a) a.acknowledged = true;
    });
  }

  function acknowledgeAllAlerts() {
    alerts.value.forEach(a => {
      a.acknowledged = true;
    });
  }

  function setHighlightedDevice(id: string | null) {
    highlightedDeviceId.value = id;
  }

  function addAlert(alert: Omit<Alert, 'id' | 'acknowledged'>) {
    const newAlert: Alert = {
      ...alert,
      id: generateId('a'),
      acknowledged: false
    };
    alerts.value.unshift(newAlert);
    if (alerts.value.length > 200) {
      alerts.value = alerts.value.slice(0, 200);
    }
    return newAlert.id;
  }

  function generateMockAlert() {
    const alertTypes: Array<{ type: AlertType; severity: AlertSeverity; weight: number }> = [
      { type: 'enter', severity: 'critical', weight: 2 },
      { type: 'exit', severity: 'warning', weight: 2 },
      { type: 'low_battery', severity: 'warning', weight: 3 },
      { type: 'offline', severity: 'critical', weight: 1 },
    ];

    const totalWeight = alertTypes.reduce((sum, t) => sum + t.weight, 0);
    let random = Math.random() * totalWeight;
    let selectedType = alertTypes[0];
    for (const t of alertTypes) {
      random -= t.weight;
      if (random <= 0) {
        selectedType = t;
        break;
      }
    }

    const randomDevice = devices.value[Math.floor(Math.random() * devices.value.length)];
    const randomFence = fences.value[Math.floor(Math.random() * fences.value.length)];

    let message = '';
    let fenceId: string | undefined = undefined;

    switch (selectedType.type) {
      case 'enter':
        fenceId = randomFence.id;
        message = `${randomDevice.name} 进入 ${randomFence.name}`;
        break;
      case 'exit':
        fenceId = randomFence.id;
        message = `${randomDevice.name} 离开 ${randomFence.name}`;
        break;
      case 'low_battery':
        message = `${randomDevice.name} 电量过低 (${Math.floor(Math.random() * 15)}%)`;
        break;
      case 'offline':
        message = `${randomDevice.name} 设备离线`;
        break;
    }

    addAlert({
      deviceId: randomDevice.id,
      fenceId,
      type: selectedType.type,
      severity: selectedType.severity,
      timestamp: new Date().toISOString(),
      message
    });
  }

  let mockAlertInterval: number | null = null;

  function startMockAlertStream() {
    if (mockAlertInterval) return;
    mockAlertInterval = window.setInterval(() => {
      if (Math.random() < 0.3) {
        generateMockAlert();
      }
    }, 5000);
  }

  function stopMockAlertStream() {
    if (mockAlertInterval) {
      clearInterval(mockAlertInterval);
      mockAlertInterval = null;
    }
  }

  function addFence(fence: Omit<Geofence, 'id'>) {
    const id = 'f' + Date.now();
    fences.value.push({ ...fence, id });
    return id;
  }

  function addDevice(device: Omit<Device, 'id' | 'status' | 'lastSeen'>) {
    const id = generateId('d');
    const newDevice: Device = {
      ...device,
      id,
      status: 'online',
      lastSeen: new Date().toISOString()
    };
    devices.value.push(newDevice);
    return id;
  }

  function getGroupById(id: string) {
    return groups.value.find(g => g.id === id);
  }

  function startDeviceRegistration() {
    isRegisteringDevice.value = true;
    registrationLocation.value = null;
  }

  function cancelDeviceRegistration() {
    isRegisteringDevice.value = false;
    registrationLocation.value = null;
  }

  function setRegistrationLocation(lat: number, lng: number) {
    registrationLocation.value = { lat, lng };
  }

  function updateFence(id: string, updates: Partial<Geofence>) {
    const idx = fences.value.findIndex(f => f.id === id);
    if (idx !== -1) {
      fences.value[idx] = { ...fences.value[idx], ...updates };
    }
  }

  function deleteFence(id: string) {
    const idx = fences.value.findIndex(f => f.id === id);
    if (idx !== -1) {
      fences.value.splice(idx, 1);
      if (selectedFenceId.value === id) {
        selectedFenceId.value = null;
        editMode.value = 'none';
      }
    }
  }

  function selectFence(id: string | null) {
    selectedFenceId.value = id;
    if (id) {
      editMode.value = 'edit';
    }
  }

  function setEditMode(mode: 'none' | 'draw-circle' | 'draw-polygon' | 'edit') {
    editMode.value = mode;
    if (mode === 'none') {
      selectedFenceId.value = null;
    }
  }

  function generateMockTrackData(deviceId: string, startTime: string, endTime: string): TrackData {
    const device = getDeviceById(deviceId);
    if (!device) {
      return {
        deviceId,
        deviceName: '未知设备',
        startTime,
        endTime,
        points: [],
        segments: [],
        stayPoints: [],
        breachEvents: [],
        totalDistance: 0,
        totalDuration: 0
      };
    }

    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const interval = 30000;
    const points: TrackPoint[] = [];

    let currentLat = device.lat;
    let currentLng = device.lng;

    const routePatterns = [
      { lat: 39.9042, lng: 116.4074 },
      { lat: 39.9082, lng: 116.4024 },
      { lat: 39.9142, lng: 116.3974 },
      { lat: 39.9102, lng: 116.4104 },
      { lat: 39.8992, lng: 116.4124 },
      { lat: 39.8942, lng: 116.4174 },
      { lat: 39.9012, lng: 116.4094 },
    ];

    let patternIndex = 0;
    let stayCounter = 0;
    let breachCounter = 0;

    for (let time = start; time <= end; time += interval) {
      const target = routePatterns[patternIndex % routePatterns.length];
      const latDiff = target.lat - currentLat;
      const lngDiff = target.lng - currentLng;
      const dist = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

      if (dist < 0.001) {
        patternIndex++;
        stayCounter = 6;
      }

      let isAbnormal = false;
      let abnormalType: TrackPoint['abnormalType'] = undefined;
      let abnormalMessage = '';

      if (stayCounter > 0) {
        stayCounter--;
      } else {
        currentLat += latDiff * 0.1 + (Math.random() - 0.5) * 0.0005;
        currentLng += lngDiff * 0.1 + (Math.random() - 0.5) * 0.0005;
      }

      breachCounter++;
      if (breachCounter > 40 && Math.random() < 0.15) {
        isAbnormal = true;
        abnormalType = 'fence_breach';
        abnormalMessage = '越界告警：进入危险区域';
        breachCounter = 0;
      }

      const battery = Math.max(5, device.battery - Math.floor((time - start) / 3600000) * 5);
      const temperature = device.temperature + (Math.random() - 0.5) * 3;
      const speed = stayCounter > 0 ? 0 : Math.random() * 20 + 5;

      points.push({
        lat: currentLat,
        lng: currentLng,
        timestamp: new Date(time).toISOString(),
        speed,
        battery,
        temperature,
        isAbnormal,
        abnormalType,
        abnormalMessage
      });
    }

    const segments: TrackSegment[] = [];
    let currentSegment: TrackPoint[] = [];
    let currentIsNormal = true;

    points.forEach((point, idx) => {
      const isNormal = !point.isAbnormal;
      if (idx === 0) {
        currentSegment = [point];
        currentIsNormal = isNormal;
      } else if (isNormal !== currentIsNormal) {
        segments.push({
          points: currentSegment,
          isNormal: currentIsNormal,
          abnormalType: currentSegment[0].abnormalType,
          startTime: currentSegment[0].timestamp,
          endTime: currentSegment[currentSegment.length - 1].timestamp
        });
        currentSegment = [point];
        currentIsNormal = isNormal;
      } else {
        currentSegment.push(point);
      }
    });

    if (currentSegment.length > 0) {
      segments.push({
        points: currentSegment,
        isNormal: currentIsNormal,
        abnormalType: currentSegment[0].abnormalType,
        startTime: currentSegment[0].timestamp,
        endTime: currentSegment[currentSegment.length - 1].timestamp
      });
    }

    const stayPoints: StayPoint[] = [];
    let stayStart: TrackPoint | null = null;
    let stayDuration = 0;

    points.forEach((point, idx) => {
      if (point.speed !== undefined && point.speed < 1) {
        if (!stayStart) {
          stayStart = point;
          stayDuration = 0;
        } else {
          stayDuration += 30;
        }
      } else {
        if (stayStart && stayDuration >= 120) {
          stayPoints.push({
            lat: stayStart.lat,
            lng: stayStart.lng,
            startTime: stayStart.timestamp,
            endTime: point.timestamp,
            duration: stayDuration,
            name: `停留点 ${stayPoints.length + 1}`
          });
        }
        stayStart = null;
        stayDuration = 0;
      }
    });

    const breachEvents = points.filter(p => p.isAbnormal && p.abnormalType === 'fence_breach');

    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      const R = 6371000;
      const rad = Math.PI / 180;
      const dLat = (points[i].lat - points[i - 1].lat) * rad;
      const dLng = (points[i].lng - points[i - 1].lng) * rad;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(points[i - 1].lat * rad) * Math.cos(points[i].lat * rad) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      totalDistance += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    return {
      deviceId,
      deviceName: device.name,
      startTime,
      endTime,
      points,
      segments,
      stayPoints,
      breachEvents,
      totalDistance: Math.round(totalDistance),
      totalDuration: Math.floor((end - start) / 1000)
    };
  }

  // ---- 轨迹回放：时间驱动播放引擎 + 状态持久化 ----
  const SAMPLE_INTERVAL_MS = 30000; // 采样点间隔（与 mock 数据一致）
  const TICK_MS = 1000 / 30;        // 30fps 刷新
  const MAX_FRAME_JUMP_MS = 1000;   // 后台标签页等造成的异常大跳变，丢弃
  const STORAGE_KEY = 'iot-track-playback-v1';

  let rafHandle: number | null = null;
  let lastFrameTime = 0;
  let loadToken = 0;
  let lastPersistTime = 0;

  function persistPlayback(force = false) {
    const now = Date.now();
    if (!force && now - lastPersistTime < 1000) return;
    lastPersistTime = now;
    try {
      const snapshot = {
        deviceId: playbackDeviceId.value,
        startTime: playbackStartTime.value,
        endTime: playbackEndTime.value,
        speed: playbackSpeed.value,
        position: playbackPosition.value,
        trackData: trackData.value
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // 存储不可用（隐私模式/配额不足）时忽略，不影响回放
    }
  }

  function restorePlayback() {
    let snapshot: any = null;
    try {
      snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      snapshot = null;
    }
    if (!snapshot || !snapshot.deviceId || !Array.isArray(snapshot.trackData?.points)) {
      return false;
    }
    playbackDeviceId.value = snapshot.deviceId;
    playbackStartTime.value = snapshot.startTime || '';
    playbackEndTime.value = snapshot.endTime || '';
    playbackSpeed.value = typeof snapshot.speed === 'number' ? snapshot.speed : 1;
    trackData.value = snapshot.trackData as TrackData;
    const maxPos = Math.max(0, trackData.value.points.length - 1);
    playbackPosition.value = Math.max(0, Math.min(snapshot.position ?? 0, maxPos));
    trackLoadState.value = 'success';
    trackLoadError.value = '';
    isPlaying.value = false; // 刷新后保持暂停，播放头位置连续
    return true;
  }

  function clearPersistedPlayback() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function fetchTrackData(deviceId: string, startTime: string, endTime: string): Promise<TrackData> {
    // 模拟网络请求：有延迟、可能失败，便于覆盖加载/失败/重试状态
    return new Promise((resolve, reject) => {
      const delay = 300 + Math.random() * 300;
      setTimeout(() => {
        if (Math.random() < 0.1) {
          reject(new Error('网络异常，轨迹数据加载失败'));
          return;
        }
        resolve(generateMockTrackData(deviceId, startTime, endTime));
      }, delay);
    });
  }

  async function loadTrackData(deviceId: string, startTime: string, endTime: string) {
    if (!deviceId || !startTime || !endTime) {
      trackLoadState.value = 'error';
      trackLoadError.value = '请选择设备和完整的查询时间范围';
      return;
    }
    if (new Date(startTime).getTime() >= new Date(endTime).getTime()) {
      trackLoadState.value = 'error';
      trackLoadError.value = '开始时间必须早于结束时间';
      return;
    }

    stopPlayback();
    const token = ++loadToken;
    playbackDeviceId.value = deviceId;
    playbackStartTime.value = startTime;
    playbackEndTime.value = endTime;
    trackLoadState.value = 'loading';
    trackLoadError.value = '';

    try {
      const data = await fetchTrackData(deviceId, startTime, endTime);
      if (token !== loadToken) return; // 已被更新的请求取代或已退出回放

      if (!data.points || data.points.length === 0) {
        trackData.value = null;
        playbackPosition.value = 0;
        trackLoadState.value = 'empty';
        clearPersistedPlayback();
        return;
      }

      trackData.value = data;
      playbackPosition.value = 0;
      trackLoadState.value = 'success';
      persistPlayback(true);
    } catch (err) {
      if (token !== loadToken) return;
      // 已有轨迹时保留旧轨迹（面板不空白），由面板顶部软提示引导重试；否则显示失败态
      trackLoadState.value = 'error';
      trackLoadError.value = err instanceof Error ? err.message : '轨迹数据加载失败';
    }
  }

  function retryLoadTrack() {
    if (playbackDeviceId.value && playbackStartTime.value && playbackEndTime.value) {
      loadTrackData(playbackDeviceId.value, playbackStartTime.value, playbackEndTime.value);
    }
  }

  function frameTick(now: number) {
    if (!isPlaying.value || !trackData.value) return;
    const elapsed = now - lastFrameTime;
    lastFrameTime = now;
    if (elapsed > 0 && elapsed <= MAX_FRAME_JUMP_MS) {
      // 真实流逝时间 × 倍速，换算为虚拟采样点步长
      const step = (elapsed / SAMPLE_INTERVAL_MS) * playbackSpeed.value;
      const last = trackData.value.points.length - 1;
      const next = playbackPosition.value + step;
      if (next >= last) {
        playbackPosition.value = last;
        stopPlayback();
        persistPlayback(true);
        return;
      }
      playbackPosition.value = next;
      persistPlayback();
    }
    rafHandle = requestAnimationFrame(frameTick);
  }

  function startPlayback() {
    const points = trackData.value?.points;
    if (!points || points.length < 2) return;

    // 播放结束后再按播放：从头重新开始
    if (playbackPosition.value >= points.length - 1) {
      playbackPosition.value = 0;
    }

    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    isPlaying.value = true;
    lastFrameTime = performance.now();
    rafHandle = requestAnimationFrame(frameTick);
  }

  function pausePlayback() {
    isPlaying.value = false;
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    persistPlayback(true);
  }

  function stopPlayback() {
    isPlaying.value = false;
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  function seekToPosition(position: number) {
    if (!trackData.value || trackData.value.points.length === 0) return;
    const last = trackData.value.points.length - 1;
    playbackPosition.value = Math.max(0, Math.min(position, last));
    persistPlayback(true);
  }

  function seekToIndex(index: number) {
    seekToPosition(Math.round(index));
  }

  function seekToProgress(progress: number) {
    if (!trackData.value || trackData.value.points.length === 0) return;
    seekToPosition((progress / 100) * (trackData.value.points.length - 1));
  }

  // 播放中切倍速无需重启定时器：下一帧自然按新倍速推进，画面不跳不闪
  function setPlaybackSpeed(speed: number) {
    playbackSpeed.value = speed;
    persistPlayback(true);
  }

  function jumpToStayPoint(stayPoint: StayPoint) {
    if (!trackData.value) return;
    const startMs = new Date(stayPoint.startTime).getTime();
    let best = 0;
    let bestDiff = Infinity;
    trackData.value.points.forEach((p, i) => {
      const diff = Math.abs(new Date(p.timestamp).getTime() - startMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    seekToIndex(best);
  }

  function jumpToBreachEvent(breachPoint: TrackPoint) {
    if (!trackData.value) return;
    const targetMs = new Date(breachPoint.timestamp).getTime();
    let best = 0;
    let bestDiff = Infinity;
    trackData.value.points.forEach((p, i) => {
      const diff = Math.abs(new Date(p.timestamp).getTime() - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    seekToIndex(best);
  }

  function enableTrackPlayback() {
    trackPlaybackEnabled.value = true;
  }

  function disableTrackPlayback() {
    // 离开回放面板：停止播放，但保留查询条件与轨迹，返回时状态连续
    trackPlaybackEnabled.value = false;
    stopPlayback();
    persistPlayback(true);
  }

  function resetTrackPlayback() {
    // 返回回放列表：清空当前轨迹与缓存
    stopPlayback();
    loadToken++;
    trackPlaybackEnabled.value = false;
    trackData.value = null;
    playbackDeviceId.value = null;
    playbackStartTime.value = '';
    playbackEndTime.value = '';
    playbackPosition.value = 0;
    isPlaying.value = false;
    trackLoadState.value = 'idle';
    trackLoadError.value = '';
    clearPersistedPlayback();
  }

  function toggleTrackVisibility() {
    showTrack.value = !showTrack.value;
  }

  function toggleStayPointsVisibility() {
    showStayPoints.value = !showStayPoints.value;
  }

  function toggleBreachEventsVisibility() {
    showBreachEvents.value = !showBreachEvents.value;
  }

  function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}小时${minutes}分${secs}秒`;
    } else if (minutes > 0) {
      return `${minutes}分${secs}秒`;
    }
    return `${secs}秒`;
  }

  function formatDistance(meters: number): string {
    if (meters >= 1000) {
      return (meters / 1000).toFixed(2) + ' 公里';
    }
    return meters + ' 米';
  }

  function generateHealthHistory(device: Device, hours: number = 24): HealthDataPoint[] {
    const points: HealthDataPoint[] = [];
    const now = new Date();
    const interval = 30 * 60 * 1000;

    let currentBattery = device.battery;
    let currentTemp = device.temperature;

    for (let i = hours * 2; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * interval);

      currentBattery = Math.max(0, Math.min(100, currentBattery + (Math.random() - 0.6) * 2));
      currentTemp = Math.max(0, Math.min(60, currentTemp + (Math.random() - 0.5) * 3));

      const isOnline = device.status !== 'offline' || Math.random() > 0.1;

      points.push({
        timestamp: timestamp.toISOString(),
        battery: Math.round(currentBattery * 10) / 10,
        temperature: Math.round(currentTemp * 10) / 10,
        isOnline
      });
    }

    return points;
  }

  function calculateHealthScore(device: Device): number {
    let score = 100;

    if (device.status === 'offline') {
      score -= 50;
    } else if (device.status === 'alert') {
      score -= 25;
    }

    if (device.battery < 10) {
      score -= 30;
    } else if (device.battery < 20) {
      score -= 20;
    } else if (device.battery < 30) {
      score -= 10;
    } else if (device.battery < 50) {
      score -= 5;
    }

    if (device.temperature > 45) {
      score -= 25;
    } else if (device.temperature > 38) {
      score -= 15;
    } else if (device.temperature > 35) {
      score -= 5;
    }

    const deviceAlerts = alerts.value.filter(a => a.deviceId === device.id && !a.acknowledged);
    if (deviceAlerts.length > 0) {
      const criticalCount = deviceAlerts.filter(a => a.severity === 'critical').length;
      const warningCount = deviceAlerts.filter(a => a.severity === 'warning').length;
      score -= criticalCount * 15 + warningCount * 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  function calculateHealthTrend(history: HealthDataPoint[]): 'improving' | 'stable' | 'declining' {
    const recentData = history.slice(-8);
    const olderData = history.slice(-16, -8);

    if (recentData.length < 4 || olderData.length < 4) return 'stable';

    const recentAvg = recentData.reduce((sum, p) => sum + p.battery, 0) / recentData.length;
    const olderAvg = olderData.reduce((sum, p) => sum + p.battery, 0) / olderData.length;

    const diff = recentAvg - olderAvg;

    if (diff > 2) return 'improving';
    if (diff < -2) return 'declining';
    return 'stable';
  }

  function generateRecommendations(device: Device, healthScore: number): string[] {
    const recommendations: string[] = [];

    if (device.status === 'offline') {
      recommendations.push('设备离线，需立即检查连接状态');
    }

    if (device.battery < 10) {
      recommendations.push('电量严重不足，请立即充电或更换电池');
    } else if (device.battery < 20) {
      recommendations.push('电量偏低，建议尽快充电');
    }

    if (device.temperature > 45) {
      recommendations.push('温度过高，存在过热风险，请检查设备散热');
    } else if (device.temperature > 38) {
      recommendations.push('温度偏高，建议检查设备运行环境');
    }

    if (healthScore < 40) {
      recommendations.push('设备健康状态差，建议优先巡检');
    } else if (healthScore < 60) {
      recommendations.push('设备健康状态一般，建议近期安排巡检');
    }

    if (recommendations.length === 0) {
      recommendations.push('设备运行正常，继续保持观察');
    }

    return recommendations;
  }

  function getDeviceAlertsCount(deviceId: string): number {
    return alerts.value.filter(a => a.deviceId === deviceId && !a.acknowledged).length;
  }

  function getLastAbnormal(deviceId: string): { time: string; type: AlertType } | null {
    const deviceAlerts = alerts.value
      .filter(a => a.deviceId === deviceId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (deviceAlerts.length > 0) {
      return { time: deviceAlerts[0].timestamp, type: deviceAlerts[0].type };
    }
    return null;
  }

  function calculateOnlineHours(history: HealthDataPoint[]): { online: number; offline: number } {
    const onlinePoints = history.filter(p => p.isOnline).length;
    const totalPoints = history.length;
    const totalHours = totalPoints * 0.5;
    return {
      online: Math.round((onlinePoints / totalPoints) * totalHours * 10) / 10,
      offline: Math.round(((totalPoints - onlinePoints) / totalPoints) * totalHours * 10) / 10
    };
  }

  const deviceHealthList = computed<DeviceHealth[]>(() => {
    const healthData = devices.value.map((device) => {
      const historyData = generateHealthHistory(device);
      const healthScore = calculateHealthScore(device);
      const healthTrend = calculateHealthTrend(historyData);
      const recommendations = generateRecommendations(device, healthScore);
      const alertCount = getDeviceAlertsCount(device.id);
      const lastAbnormal = getLastAbnormal(device.id);
      const { online, offline } = calculateOnlineHours(historyData);

      return {
        deviceId: device.id,
        deviceName: device.name,
        healthScore,
        batteryLevel: device.battery,
        temperatureLevel: device.temperature,
        onlineHours: online,
        offlineHours: offline,
        alertCount,
        healthTrend,
        lastAbnormalTime: lastAbnormal?.time,
        lastAbnormalType: lastAbnormal?.type,
        priorityRank: 0,
        recommendations,
        historyData
      };
    });

    healthData.sort((a, b) => {
      if (a.healthScore !== b.healthScore) {
        return a.healthScore - b.healthScore;
      }
      if (a.alertCount !== b.alertCount) {
        return b.alertCount - a.alertCount;
      }
      return a.batteryLevel - b.batteryLevel;
    });

    return healthData.map((h, idx) => ({ ...h, priorityRank: idx + 1 }));
  });

  const priorityInspectionList = computed(() => {
    return deviceHealthList.value.filter(h => h.healthScore < 60);
  });

  const healthSummary = computed<HealthSummary>(() => {
    const list = deviceHealthList.value;
    if (list.length === 0) {
      return {
        avgHealthScore: 0,
        totalAlertCount: 0,
        avgOnlineRate: 0,
        avgBatteryLevel: 0,
        highPriorityCount: 0,
        mediumPriorityCount: 0,
        lowPriorityCount: 0
      };
    }

    const avgHealthScore = Math.round(list.reduce((sum, h) => sum + h.healthScore, 0) / list.length);
    const totalAlertCount = list.reduce((sum, h) => sum + h.alertCount, 0);
    const avgOnlineRate = Math.round((list.reduce((sum, h) => sum + (h.onlineHours / (h.onlineHours + h.offlineHours)), 0) / list.length) * 100);
    const avgBatteryLevel = Math.round(list.reduce((sum, h) => sum + h.batteryLevel, 0) / list.length);

    const highPriorityCount = list.filter(h => h.healthScore < 40).length;
    const mediumPriorityCount = list.filter(h => h.healthScore >= 40 && h.healthScore < 70).length;
    const lowPriorityCount = list.filter(h => h.healthScore >= 70).length;

    return {
      avgHealthScore,
      totalAlertCount,
      avgOnlineRate,
      avgBatteryLevel,
      highPriorityCount,
      mediumPriorityCount,
      lowPriorityCount
    };
  });

  const recentAbnormalRecords = computed(() => {
    return [...alerts.value]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20);
  });

  function getDeviceHealth(deviceId: string): DeviceHealth | undefined {
    return deviceHealthList.value.find(h => h.deviceId === deviceId);
  }

  return {
    devices, fences, alerts, selectedFenceId, editMode, highlightedDeviceId,
    isRegisteringDevice, registrationLocation, groups,
    onlineCount, offlineCount, alertDeviceCount, deviceCount, fenceCount, alertCount, selectedFence,
    avgBattery, avgTemperature, lowBatteryCount, devicesRanked, recentAlerts,
    unacknowledgedAlerts, criticalAlerts, warningAlerts, infoAlerts,
    criticalCount, warningCount, infoCount,
    trackPlaybackEnabled, trackData, playbackDeviceId,
    playbackStartTime, playbackEndTime, playbackPosition, playbackCurrentIndex,
    isPlaying, playbackSpeed, showTrack, showStayPoints, showBreachEvents,
    trackLoadState, trackLoadError,
    playbackCurrentPoint, playbackProgress, playbackCurrentTime,
    deviceHealthList, priorityInspectionList, healthSummary, recentAbnormalRecords,
    getDeviceById, getFenceById, getGroupById, getDeviceHealth,
    acknowledgeAlert, batchAcknowledgeAlerts, acknowledgeAllAlerts,
    setHighlightedDevice, addAlert, generateMockAlert,
    startMockAlertStream, stopMockAlertStream,
    addFence, updateFence, deleteFence, selectFence, setEditMode,
    addDevice, startDeviceRegistration, cancelDeviceRegistration, setRegistrationLocation,
    loadTrackData, retryLoadTrack,
    startPlayback, pausePlayback, stopPlayback,
    seekToIndex, seekToProgress, seekToPosition, setPlaybackSpeed,
    jumpToStayPoint, jumpToBreachEvent,
    enableTrackPlayback, disableTrackPlayback, resetTrackPlayback,
    restorePlayback, persistPlayback,
    toggleTrackVisibility, toggleStayPointsVisibility, toggleBreachEventsVisibility,
    formatDuration, formatDistance
  };
});
