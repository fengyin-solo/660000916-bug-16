import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { Device, Geofence, Alert, AlertType, AlertSeverity, DeviceGroup, DeviceThresholds, TrackData, TrackPoint, StayPoint, TrackSegment, HealthDataPoint, DeviceHealth, HealthSummary } from '../types';

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

  // 'idle' 未查询 | 'loading' 加载中 | 'ready' 有数据 | 'empty' 暂无数据 | 'error' 加载失败
  const trackStatus = ref<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const trackError = ref<string>('');
  const trackPlaybackEnabled = ref(false);
  const trackData = ref<TrackData | null>(null);
  const playbackDeviceId = ref<string>('');
  const playbackStartTime = ref<string>('');
  const playbackEndTime = ref<string>('');
  // 小数播放位置：允许倍速为小数（如 0.5），采样点通过 floor 取用，
  // 标记位置/时间在相邻采样点之间做线性插值，保证半速平滑推进。
  const playbackPosition = ref(0);
  const isPlaying = ref(false);
  const playbackSpeed = ref(1);
  const showTrack = ref(true);
  const showStayPoints = ref(true);
  const showBreachEvents = ref(true);

  const TICK_INTERVAL_MS = 100;
  // 1x 速度下每真实秒推进 5 个采样点（即 200ms 一个点，与既有节奏一致）；
  // 0.5x 时 400ms 一个点，标记/时间在点间插值平滑移动。
  const BASE_POINTS_PER_SECOND = 5;
  let playbackTimer: number | null = null;
  let loadRequestToken = 0;
  let lastQuery: { deviceId: string; startTime: string; endTime: string } | null = null;

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

  const playbackPointCount = computed(() => trackData.value?.points.length ?? 0);

  // 当前展示的采样点下标（整数），始终落在有效范围内
  const playbackCurrentIndex = computed(() => {
    const count = playbackPointCount.value;
    if (count === 0) return 0;
    return Math.min(Math.floor(playbackPosition.value + 1e-9), count - 1);
  });

  const playbackCurrentPoint = computed(() => {
    if (!trackData.value || playbackPointCount.value === 0) return null;
    return trackData.value.points[playbackCurrentIndex.value] ?? null;
  });

  const playbackProgress = computed(() => {
    const count = playbackPointCount.value;
    if (count <= 1) return 0;
    return (playbackPosition.value / (count - 1)) * 100;
  });

  // 在相邻采样点之间线性插值得到的地图坐标，0.5x 时标记平滑移动而非逐点跳动
  const playbackLocation = computed<{ lat: number; lng: number } | null>(() => {
    if (!trackData.value || playbackPointCount.value === 0) return null;
    const points = trackData.value.points;
    const pos = Math.max(0, Math.min(playbackPosition.value, points.length - 1));
    const i0 = Math.floor(pos + 1e-9);
    if (i0 >= points.length - 1) {
      return { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng };
    }
    const frac = pos - i0;
    const p0 = points[i0];
    const p1 = points[i0 + 1];
    return {
      lat: p0.lat + (p1.lat - p0.lat) * frac,
      lng: p0.lng + (p1.lng - p0.lng) * frac
    };
  });

  // 时间轴时间同样按插值时间推进，半速下连续不跳变
  const playbackCurrentTime = computed(() => {
    if (!trackData.value || playbackPointCount.value === 0) return '';
    const points = trackData.value.points;
    const pos = Math.max(0, Math.min(playbackPosition.value, points.length - 1));
    const i0 = Math.floor(pos + 1e-9);
    const t0 = new Date(points[i0].timestamp).getTime();
    if (i0 >= points.length - 1 || Number.isNaN(t0)) return points[i0].timestamp;
    const t1 = new Date(points[i0 + 1].timestamp).getTime();
    if (Number.isNaN(t1)) return points[i0].timestamp;
    return new Date(t0 + (t1 - t0) * (pos - i0)).toISOString();
  });

  const isPlaybackEnded = computed(() =>
    playbackPointCount.value > 1 &&
    playbackPosition.value >= playbackPointCount.value - 1 - 1e-9
  );

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

  function stopPlaybackTimer() {
    if (playbackTimer !== null) {
      window.clearInterval(playbackTimer);
      playbackTimer = null;
    }
  }

  // 单一 ticker：播放期间固定节奏运行，倍速变化即时生效，无需重启定时器，
  // 避免播放中切换倍速造成的跳动与错位。
  function ensurePlaybackTimer() {
    if (playbackTimer !== null) return;
    playbackTimer = window.setInterval(() => {
      if (!isPlaying.value || !trackData.value) return;
      const count = trackData.value.points.length;
      if (count <= 1) {
        isPlaying.value = false;
        return;
      }
      const advance = playbackSpeed.value * BASE_POINTS_PER_SECOND * (TICK_INTERVAL_MS / 1000);
      const next = playbackPosition.value + advance;
      if (next >= count - 1 - 1e-9) {
        playbackPosition.value = count - 1;
        isPlaying.value = false;
        savePlaybackState();
      } else {
        playbackPosition.value = next;
      }
    }, TICK_INTERVAL_MS);
  }

  // 模拟异步请求；保留随机轨迹生成，但加一层网络/服务异常处理
  function fetchTrackData(deviceId: string, startTime: string, endTime: string): Promise<TrackData> {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        try {
          const data = generateMockTrackData(deviceId, startTime, endTime);
          resolve(data);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('轨迹数据生成失败'));
        }
      }, 300);
    });
  }

  async function loadTrackData(deviceId: string, startTime: string, endTime: string) {
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();

    if (!deviceId) {
      trackStatus.value = 'error';
      trackError.value = '请先选择设备';
      return;
    }
    if (!startTime || !endTime || Number.isNaN(startMs) || Number.isNaN(endMs)) {
      trackStatus.value = 'error';
      trackError.value = '请选择有效的开始与结束时间';
      return;
    }
    if (startMs >= endMs) {
      trackStatus.value = 'error';
      trackError.value = '开始时间需早于结束时间';
      return;
    }

    // 使上一次未完成的请求失效：快速重新查询/中断时不被旧响应覆盖
    const token = ++loadRequestToken;
    lastQuery = { deviceId, startTime, endTime };
    playbackDeviceId.value = deviceId;
    playbackStartTime.value = startTime;
    playbackEndTime.value = endTime;
    pausePlayback();
    trackData.value = null;
    trackError.value = '';
    trackStatus.value = 'loading';
    saveTrackSession();

    try {
      const data = await fetchTrackData(deviceId, startTime, endTime);
      if (token !== loadRequestToken) return; // 已被新查询或关闭中断
      trackData.value = data;
      playbackPosition.value = 0;
      trackStatus.value = data.points.length > 0 ? 'ready' : 'empty';
      saveTrackSession();
      savePlaybackState();
    } catch (err) {
      if (token !== loadRequestToken) return;
      trackStatus.value = 'error';
      trackError.value = err instanceof Error ? err.message : '轨迹数据加载失败';
      trackData.value = null;
    }
  }

  async function retryLoadTrack() {
    if (lastQuery) {
      await loadTrackData(lastQuery.deviceId, lastQuery.startTime, lastQuery.endTime);
    }
  }

  function startPlayback() {
    if (!trackData.value || playbackPointCount.value === 0) return;
    if (playbackPointCount.value === 1) return; // 单点轨迹无可播放内容

    // 播放结束后再次播放：从头重新开始
    if (playbackPosition.value >= playbackPointCount.value - 1 - 1e-9) {
      playbackPosition.value = 0;
    }
    isPlaying.value = true;
    ensurePlaybackTimer();
    savePlaybackState();
  }

  function pausePlayback() {
    isPlaying.value = false;
    savePlaybackState();
  }

  function stopPlayback() {
    isPlaying.value = false;
    playbackPosition.value = 0;
    savePlaybackState();
  }

  function seekToPosition(position: number) {
    if (!trackData.value || playbackPointCount.value === 0) return;
    const max = playbackPointCount.value - 1;
    playbackPosition.value = Math.max(0, Math.min(position, max));
    savePlaybackState();
  }

  function seekToIndex(index: number) {
    seekToPosition(Math.round(index));
  }

  function seekToProgress(progress: number) {
    if (!trackData.value || playbackPointCount.value <= 1) return;
    const position = (Math.max(0, Math.min(progress, 100)) / 100) * (playbackPointCount.value - 1);
    seekToPosition(position);
  }

  // 倍速只改变推进速率，不触碰播放位置，播放中切换同样平滑
  function setPlaybackSpeed(speed: number) {
    playbackSpeed.value = speed;
    if (isPlaying.value) ensurePlaybackTimer();
    savePlaybackState();
  }

  function jumpToStayPoint(stayPoint: StayPoint) {
    if (!trackData.value || playbackPointCount.value === 0) return;
    const idx = trackData.value.points.findIndex(p => p.timestamp >= stayPoint.startTime);
    if (idx !== -1) seekToIndex(idx);
  }

  function jumpToBreachEvent(breachPoint: TrackPoint) {
    if (!trackData.value || playbackPointCount.value === 0) return;
    const idx = trackData.value.points.findIndex(
      p => Math.abs(new Date(p.timestamp).getTime() - new Date(breachPoint.timestamp).getTime()) < 1000
    );
    if (idx !== -1) seekToIndex(idx);
  }

  const SESSION_STORAGE_KEY = 'iot-track-playback-session';
  const STATE_STORAGE_KEY = 'iot-track-playback-state';

  function saveTrackSession() {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        deviceId: playbackDeviceId.value,
        startTime: playbackStartTime.value,
        endTime: playbackEndTime.value,
        data: trackData.value
      }));
    } catch {
      // localStorage 不可用（隐私模式等）时静默降级
    }
  }

  function savePlaybackState() {
    try {
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify({
        position: playbackPosition.value,
        speed: playbackSpeed.value,
        isPlaying: isPlaying.value,
        showTrack: showTrack.value,
        showStayPoints: showStayPoints.value,
        showBreachEvents: showBreachEvents.value
      }));
    } catch {
      // ignore
    }
  }

  function restorePlaybackSession() {
    try {
      const sessionRaw = localStorage.getItem(SESSION_STORAGE_KEY);
      const stateRaw = localStorage.getItem(STATE_STORAGE_KEY);
      if (!sessionRaw) return false;
      const session = JSON.parse(sessionRaw);
      if (!session?.data?.points || !Array.isArray(session.data.points)) return false;
      trackData.value = session.data as TrackData;
      playbackDeviceId.value = session.deviceId || '';
      playbackStartTime.value = session.startTime || '';
      playbackEndTime.value = session.endTime || '';
      trackStatus.value = session.data.points.length > 0 ? 'ready' : 'empty';

      if (stateRaw) {
        const state = JSON.parse(stateRaw);
        const max = Math.max(0, session.data.points.length - 1);
        playbackPosition.value = Math.max(0, Math.min(Number(state.position) || 0, max));
        playbackSpeed.value = [0.5, 1, 2, 4, 8].includes(Number(state.speed)) ? Number(state.speed) : 1;
        showTrack.value = state.showTrack !== false;
        showStayPoints.value = state.showStayPoints !== false;
        showBreachEvents.value = state.showBreachEvents !== false;
        // 刷新前正在播放：恢复后继续，保证刷新后回放状态一致
        if (state.isPlaying === true && session.data.points.length > 1 &&
            playbackPosition.value < max - 1e-9) {
          isPlaying.value = true;
          ensurePlaybackTimer();
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  function clearPlaybackSession() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(STATE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  // 返回回放列表（关闭面板）：保留数据与播放进度，再次打开仍一致
  function enableTrackPlayback() {
    trackPlaybackEnabled.value = true;
    if (trackData.value && isPlaying.value) ensurePlaybackTimer();
  }

  function disableTrackPlayback() {
    trackPlaybackEnabled.value = false;
    pausePlayback();
  }

  // 放弃当前查询/会话（设备或时间条件变化后的显式重置）
  function resetTrackSession() {
    loadRequestToken++; // 中断进行中的加载
    pausePlayback();
    stopPlaybackTimer();
    trackData.value = null;
    playbackDeviceId.value = '';
    playbackStartTime.value = '';
    playbackEndTime.value = '';
    playbackPosition.value = 0;
    trackStatus.value = 'idle';
    trackError.value = '';
    lastQuery = null;
    clearPlaybackSession();
  }

  // 刷新页面后恢复上次回放会话；状态变化时持久化
  restorePlaybackSession();

  watch([showTrack, showStayPoints, showBreachEvents, playbackSpeed], savePlaybackState);

  let positionSaveTimer: number | null = null;
  watch(playbackPosition, () => {
    if (positionSaveTimer !== null) window.clearTimeout(positionSaveTimer);
    positionSaveTimer = window.setTimeout(savePlaybackState, 400);
  });

  // 页面关闭前确保最新播放位置已写入
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', savePlaybackState);
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
    if (!Number.isFinite(seconds) || seconds < 0) return '0秒';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
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
    playbackStartTime, playbackEndTime, playbackCurrentIndex,
    isPlaying, playbackSpeed, showTrack, showStayPoints, showBreachEvents,
    trackStatus, trackError, playbackPointCount, isPlaybackEnded,
    playbackCurrentPoint, playbackProgress, playbackLocation, playbackCurrentTime,
    deviceHealthList, priorityInspectionList, healthSummary, recentAbnormalRecords,
    getDeviceById, getFenceById, getGroupById, getDeviceHealth,
    acknowledgeAlert, batchAcknowledgeAlerts, acknowledgeAllAlerts,
    setHighlightedDevice, addAlert, generateMockAlert,
    startMockAlertStream, stopMockAlertStream,
    addFence, updateFence, deleteFence, selectFence, setEditMode,
    addDevice, startDeviceRegistration, cancelDeviceRegistration, setRegistrationLocation,
    loadTrackData, retryLoadTrack, resetTrackSession, startPlayback, pausePlayback, stopPlayback,
    seekToIndex, seekToProgress, seekToPosition, setPlaybackSpeed,
    jumpToStayPoint, jumpToBreachEvent,
    enableTrackPlayback, disableTrackPlayback,
    toggleTrackVisibility, toggleStayPointsVisibility, toggleBreachEventsVisibility,
    formatDuration, formatDistance
  };
});
