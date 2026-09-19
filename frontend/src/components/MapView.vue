<template>
  <div style="flex:1;height:100%;position:relative">
    <div id="map" style="width:100%;height:100%"></div>
    <div v-if="store.editMode !== 'none'" :style="{ position:'absolute', top:'12px', left:'50%', transform:'translateX(-50%)',
      padding:'8px 16px', background:'#1976d2', color:'#fff', borderRadius:'20px', fontSize:'12px', zIndex:1000, boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }">
      {{ modeHint }}
    </div>
    <div v-if="store.isRegisteringDevice" :style="{ position:'absolute', top:'12px', left:'50%', transform:'translateX(-50%)',
      padding:'8px 16px', background:'#1b5e20', color:'#fff', borderRadius:'20px', fontSize:'12px', zIndex:1000, boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }">
      📍 点击地图选择设备位置
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch, ref, computed } from 'vue';
import L from 'leaflet';
import type { LatLng, LeafletMouseEvent, LeafletEvent, Marker } from 'leaflet';
import { useIotStore } from '../stores/iot';
import type { Geofence } from '../types';

const store = useIotStore();

const map = ref<any>(null);
const fenceLayers = ref<Map<string, any>>(new Map());
const markerLayers = ref<Map<string, any>>(new Map());
const deviceLayers = ref<Map<string, any>>(new Map());
const registrationMarker = ref<any>(null);
const trackLayers = ref<any[]>([]);
const trackPointMarker = ref<any>(null);
const stayPointMarkers = ref<any[]>([]);
const breachEventMarkers = ref<any[]>([]);
const playbackMarker = ref<any>(null);
const playbackPulseCircle = ref<any>(null);
const playbackTrailLayer = ref<any>(null);
const lastRenderedPointIndex = ref(-1);

const drawingTempCircle = ref<any>(null);
const drawingTempPolygon = ref<any>(null);
const drawingTempMarkers = ref<any[]>([]);
const drawingPoints = ref<{ lat: number; lng: number }[]>([]);
const drawingCircleCenter = ref<{ lat: number; lng: number } | null>(null);
const isDrawingCircleSecondClick = ref(false);
const isDragging = ref(false);
const pendingFenceUpdate = ref<{ id: string; updates: Partial<Geofence> } | null>(null);

const modeHint = computed(() => {
  if (store.editMode === 'draw-circle') {
    if (isDrawingCircleSecondClick.value) return '⭕ 移动鼠标调整半径，再次点击确认';
    return '⭕ 点击地图放置圆心';
  }
  if (store.editMode === 'draw-polygon') return `📐 点击添加顶点 (${drawingPoints.value.length})，双击完成绘制`;
  if (store.editMode === 'edit') return '✏️ 拖动围栏或顶点调整位置，在右侧编辑属性';
  return '';
});

const tempIcon = L.divIcon({
  className: 'custom-div-icon',
  html: '<div style="width:12px;height:12px;background:#1976d2;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.3)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6]
});

const vertexIcon = L.divIcon({
  className: 'vertex-div-icon',
  html: '<div style="width:10px;height:10px;background:#fff;border:2px solid #1976d2;border-radius:50%"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5]
});

const registrationIcon = L.divIcon({
  className: 'registration-div-icon',
  html: '<div style="width:20px;height:20px;background:#1b5e20;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(27,94,32,0.6)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

const stayPointIcon = L.divIcon({
  className: 'stay-point-icon',
  html: '<div style="width:16px;height:16px;background:#ff9800;border:3px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(255,152,0,0.8)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

const breachEventIcon = L.divIcon({
  className: 'breach-event-icon',
  html: '<div style="width:18px;height:18px;background:#e53935;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(229,57,53,0.8);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:bold">!</div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

const playbackIcon = L.divIcon({
  className: 'playback-icon',
  html: '<div style="width:24px;height:24px;background:#1976d2;border:4px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(25,118,210,0.8);animation:pulse 1.5s ease-in-out infinite"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

const startPointIcon = L.divIcon({
  className: 'start-point-icon',
  html: '<div style="width:14px;height:14px;background:#4caf50;border:3px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(76,175,80,0.8)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

const endPointIcon = L.divIcon({
  className: 'end-point-icon',
  html: '<div style="width:14px;height:14px;background:#f44336;border:3px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(244,67,54,0.8)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

function renderFence(fence: Geofence) {
  clearFenceLayer(fence.id);

  const isSelected = store.selectedFenceId === fence.id;
  const weight = isSelected ? 3 : 2;
  const dashArray = undefined;
  const fillOpacity = isSelected ? 0.2 : 0.1;

  if (fence.type === 'circle') {
    const circle = L.circle([fence.center.lat, fence.center.lng], {
      radius: fence.radius,
      color: fence.color,
      fillColor: fence.color,
      fillOpacity,
      weight,
      dashArray
    });
    circle.bindPopup(`<b>${fence.name}</b><br>圆形 · ${fence.radius}m<br>${fence.alertOnEnter ? '进入告警 ' : ''}${fence.alertOnExit ? '离开告警' : ''}`);
    circle.on('click', () => {
      if (store.editMode === 'none' || store.editMode === 'edit') {
        store.selectFence(fence.id);
      }
    });
    circle.on('mousedown', (e: LeafletMouseEvent) => {
      if (store.editMode === 'edit' && isSelected) {
        handleFenceDragStart(e, fence);
      }
    });

    if (isSelected) {
      addEditHandlers(fence, circle);
    }

    circle.addTo(map.value!);
    fenceLayers.value.set(fence.id, circle);
  } else if (fence.type === 'polygon' && fence.paths && fence.paths.length >= 3) {
    const latlngs = fence.paths.map(p => [p.lat, p.lng] as [number, number]);
    const polygon = L.polygon(latlngs, {
      color: fence.color,
      fillColor: fence.color,
      fillOpacity,
      weight,
      dashArray
    });
    polygon.bindPopup(`<b>${fence.name}</b><br>多边形 · ${fence.paths.length}点<br>${fence.alertOnEnter ? '进入告警 ' : ''}${fence.alertOnExit ? '离开告警' : ''}`);
    polygon.on('click', () => {
      if (store.editMode === 'none' || store.editMode === 'edit') {
        store.selectFence(fence.id);
      }
    });
    polygon.on('mousedown', (e: LeafletMouseEvent) => {
      if (store.editMode === 'edit' && isSelected) {
        handleFenceDragStart(e, fence);
      }
    });

    if (isSelected) {
      addEditHandlers(fence, polygon);
    }

    polygon.addTo(map.value!);
    fenceLayers.value.set(fence.id, polygon);
  }
}

function clearFenceLayer(id: string) {
  const layer = fenceLayers.value.get(id);
  if (layer) {
    map.value!.removeLayer(layer);
    fenceLayers.value.delete(id);
  }
  markerLayers.value.forEach((marker, key) => {
    if (key.startsWith(id + '-')) {
      map.value!.removeLayer(marker);
      markerLayers.value.delete(key);
    }
  });
}

function clearAllFenceLayers() {
  fenceLayers.value.forEach((_, id) => clearFenceLayer(id));
}

function clearAllMarkerLayers() {
  markerLayers.value.forEach((marker) => {
    map.value!.removeLayer(marker);
  });
  markerLayers.value.clear();
}

function addEditHandlers(fence: Geofence, layer: any) {
  clearAllMarkerLayers();

  let currentCenter = { lat: fence.center.lat, lng: fence.center.lng };
  let currentRadius = fence.radius;
  let currentPaths = fence.paths ? [...fence.paths] : [];

  if (fence.type === 'circle') {
    const edgePoint = destinationPoint(currentCenter, 90, currentRadius);
    const radiusMarker = L.marker([edgePoint.lat, edgePoint.lng], {
      icon: vertexIcon,
      draggable: true
    });
    radiusMarker.addTo(map.value!);
    markerLayers.value.set(fence.id + '-radius', radiusMarker);

    const centerMarker = L.marker([currentCenter.lat, currentCenter.lng], {
      icon: tempIcon,
      draggable: true
    });
    centerMarker.addTo(map.value!);
    markerLayers.value.set(fence.id + '-center', centerMarker);

    centerMarker.on('dragstart', () => {
      isDragging.value = true;
    });

    centerMarker.on('drag', (e: LeafletEvent) => {
      const latlng = (e.target as Marker).getLatLng();
      currentCenter = { lat: latlng.lat, lng: latlng.lng };
      const newEdgePoint = destinationPoint(currentCenter, 90, currentRadius);

      layer.setLatLng([currentCenter.lat, currentCenter.lng]);
      radiusMarker.setLatLng([newEdgePoint.lat, newEdgePoint.lng]);

      pendingFenceUpdate.value = {
        id: fence.id,
        updates: { center: currentCenter }
      };
    });

    centerMarker.on('dragend', () => {
      isDragging.value = false;
      if (pendingFenceUpdate.value) {
        store.updateFence(pendingFenceUpdate.value.id, pendingFenceUpdate.value.updates);
        pendingFenceUpdate.value = null;
      }
    });

    radiusMarker.on('dragstart', () => {
      isDragging.value = true;
    });

    radiusMarker.on('drag', (e: LeafletEvent) => {
      const latlng = (e.target as Marker).getLatLng();
      const center = L.latLng(currentCenter.lat, currentCenter.lng);
      const radius = map.value!.distance(center, latlng);
      currentRadius = Math.max(10, radius);

      layer.setRadius(currentRadius);

      pendingFenceUpdate.value = {
        id: fence.id,
        updates: { radius: currentRadius }
      };
    });

    radiusMarker.on('dragend', () => {
      isDragging.value = false;
      if (pendingFenceUpdate.value) {
        store.updateFence(pendingFenceUpdate.value.id, pendingFenceUpdate.value.updates);
        pendingFenceUpdate.value = null;
      }
    });
  } else if (fence.type === 'polygon' && fence.paths) {
    const vertexMarkers: any[] = [];

    currentPaths.forEach((point, idx) => {
      const vertexMarker = L.marker([point.lat, point.lng], {
        icon: vertexIcon,
        draggable: true
      });
      vertexMarker.addTo(map.value!);
      markerLayers.value.set(fence.id + '-v' + idx, vertexMarker);
      vertexMarkers.push(vertexMarker);

      vertexMarker.on('dragstart', () => {
        isDragging.value = true;
      });

      vertexMarker.on('drag', (e: LeafletEvent) => {
        const latlng = (e.target as Marker).getLatLng();
        currentPaths[idx] = { lat: latlng.lat, lng: latlng.lng };
        const latlngs = currentPaths.map(p => [p.lat, p.lng] as [number, number]);
        layer.setLatLngs(latlngs);

        const center = calculatePolygonCenter(currentPaths);
        pendingFenceUpdate.value = {
          id: fence.id,
          updates: { paths: [...currentPaths], center }
        };
      });

      vertexMarker.on('dragend', () => {
        isDragging.value = false;
        if (pendingFenceUpdate.value) {
          store.updateFence(pendingFenceUpdate.value.id, pendingFenceUpdate.value.updates);
          pendingFenceUpdate.value = null;
        }
      });
    });
  }
}

function calculatePolygonCenter(paths: { lat: number; lng: number }[]) {
  let sumLat = 0, sumLng = 0;
  paths.forEach(p => { sumLat += p.lat; sumLng += p.lng; });
  return { lat: sumLat / paths.length, lng: sumLng / paths.length };
}

function destinationPoint(start: { lat: number; lng: number }, bearing: number, distance: number) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const phi1 = start.lat * rad;
  const lambda1 = start.lng * rad;
  const brng = bearing * rad;
  const dr = distance / R;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(dr) + Math.cos(phi1) * Math.sin(dr) * Math.cos(brng));
  const lambda2 = lambda1 + Math.atan2(Math.sin(brng) * Math.sin(dr) * Math.cos(phi1), Math.cos(dr) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: phi2 * deg, lng: lambda2 * deg };
}

let dragStartLatLng: any = null;
let dragFence: Geofence | null = null;
let dragCurrentCenter: { lat: number; lng: number } | null = null;
let dragCurrentPaths: { lat: number; lng: number }[] | null = null;
let dragPendingUpdates: { center?: { lat: number; lng: number }; paths?: { lat: number; lng: number }[] } | null = null;

function handleFenceDragStart(e: any, fence: Geofence) {
  if (store.editMode !== 'edit') return;
  dragStartLatLng = e.latlng;
  dragFence = fence;
  dragCurrentCenter = { lat: fence.center.lat, lng: fence.center.lng };
  dragCurrentPaths = fence.paths ? [...fence.paths] : null;
  isDragging.value = true;
  dragPendingUpdates = null;
  L.DomEvent.stopPropagation(e);
}

function handleMapMouseMove(e: LeafletMouseEvent) {
  if (isDrawingCircleSecondClick.value && drawingCircleCenter.value && drawingTempCircle.value) {
    const center = L.latLng(drawingCircleCenter.value.lat, drawingCircleCenter.value.lng);
    const radius = map.value!.distance(center, e.latlng);
    drawingTempCircle.value.setRadius(Math.max(10, radius));
    return;
  }

  if (!dragFence || !dragStartLatLng || !dragCurrentCenter) return;

  const dLat = e.latlng.lat - dragStartLatLng.lat;
  const dLng = e.latlng.lng - dragStartLatLng.lng;

  const layer = fenceLayers.value.get(dragFence.id);
  if (!layer) return;

  if (dragFence.type === 'circle') {
    dragCurrentCenter = {
      lat: dragCurrentCenter.lat + dLat,
      lng: dragCurrentCenter.lng + dLng
    };

    layer.setLatLng([dragCurrentCenter.lat, dragCurrentCenter.lng]);

    const centerMarker = markerLayers.value.get(dragFence.id + '-center');
    const radiusMarker = markerLayers.value.get(dragFence.id + '-radius');
    if (centerMarker) {
      centerMarker.setLatLng([dragCurrentCenter.lat, dragCurrentCenter.lng]);
    }
    if (radiusMarker) {
      const newEdgePoint = destinationPoint(dragCurrentCenter, 90, dragFence.radius);
      radiusMarker.setLatLng([newEdgePoint.lat, newEdgePoint.lng]);
    }

    dragPendingUpdates = { center: dragCurrentCenter };
  } else if (dragFence.type === 'polygon' && dragCurrentPaths) {
    const fenceId = dragFence.id;
    dragCurrentPaths = dragCurrentPaths.map(p => ({
      lat: p.lat + dLat,
      lng: p.lng + dLng
    }));
    const latlngs = dragCurrentPaths.map(p => [p.lat, p.lng] as [number, number]);
    layer.setLatLngs(latlngs);

    const paths = dragCurrentPaths;
    paths.forEach((_, idx) => {
      const vertexMarker = markerLayers.value.get(fenceId + '-v' + idx);
      if (vertexMarker) {
        vertexMarker.setLatLng([paths[idx].lat, paths[idx].lng]);
      }
    });

    const center = calculatePolygonCenter(dragCurrentPaths);
    dragCurrentCenter = center;
    dragPendingUpdates = { paths: [...dragCurrentPaths], center };
  }

  dragStartLatLng = e.latlng;
}

function handleMapMouseUp() {
  dragStartLatLng = null;
  const fenceId = dragFence?.id;
  const updates = dragPendingUpdates;
  dragFence = null;
  dragCurrentCenter = null;
  dragCurrentPaths = null;
  dragPendingUpdates = null;
  isDragging.value = false;

  if (fenceId && updates) {
    store.updateFence(fenceId, updates);
  }
}

function handleMapClick(e: LeafletMouseEvent) {
  if (store.isRegisteringDevice) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    store.setRegistrationLocation(lat, lng);
    updateRegistrationMarker(lat, lng);
    return;
  }

  if (store.editMode === 'draw-circle') {
    if (!isDrawingCircleSecondClick.value) {
      drawingCircleCenter.value = { lat: e.latlng.lat, lng: e.latlng.lng };
      drawingTempCircle.value = L.circle([e.latlng.lat, e.latlng.lng], {
        radius: 10,
        color: '#1976d2',
        fillColor: '#1976d2',
        fillOpacity: 0.2,
        weight: 2,
        dashArray: '5,5'
      }).addTo(map.value!);

      const centerMarker = L.marker([e.latlng.lat, e.latlng.lng], {
        icon: tempIcon
      }).addTo(map.value!);
      drawingTempMarkers.value.push(centerMarker);

      isDrawingCircleSecondClick.value = true;
    } else {
      finishCircleDrawing();
    }
  } else if (store.editMode === 'draw-polygon') {
    drawingPoints.value.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    updateTempPolygon();

    const marker = L.marker([e.latlng.lat, e.latlng.lng], { icon: tempIcon }).addTo(map.value!);
    drawingTempMarkers.value.push(marker);
  }
}

function updateRegistrationMarker(lat: number, lng: number) {
  if (registrationMarker.value) {
    map.value!.removeLayer(registrationMarker.value);
  }
  registrationMarker.value = L.marker([lat, lng], { icon: registrationIcon })
    .bindPopup('<b>📍 新设备位置</b><br>点击确认此位置')
    .addTo(map.value!);
  registrationMarker.value.openPopup();
}

function clearRegistrationMarker() {
  if (registrationMarker.value) {
    map.value!.removeLayer(registrationMarker.value);
    registrationMarker.value = null;
  }
}

function handleMapDblClick() {
  if (store.editMode === 'draw-polygon' && drawingPoints.value.length >= 3) {
    finishPolygonDrawing();
  }
}

function updateTempPolygon() {
  if (drawingTempPolygon.value) {
    map.value!.removeLayer(drawingTempPolygon.value);
  }
  if (drawingPoints.value.length >= 2) {
    const latlngs = drawingPoints.value.map(p => [p.lat, p.lng] as [number, number]);
    drawingTempPolygon.value = L.polygon(latlngs, {
      color: '#1976d2',
      fillColor: '#1976d2',
      fillOpacity: 0.15,
      weight: 2,
      dashArray: '5,5'
    }).addTo(map.value!);
  }
}

function finishCircleDrawing() {
  if (!drawingTempCircle.value || !drawingCircleCenter.value) return;

  const radius = drawingTempCircle.value.getRadius();
  const newId = store.addFence({
    name: '新围栏 ' + (store.fences.length + 1),
    center: { lat: drawingCircleCenter.value.lat, lng: drawingCircleCenter.value.lng },
    radius,
    type: 'circle',
    alertOnEnter: true,
    alertOnExit: false,
    color: '#1976d2'
  });

  clearDrawingTemp();
  store.selectFence(newId);
}

function finishPolygonDrawing() {
  if (drawingPoints.value.length < 3) return;

  const center = calculatePolygonCenter(drawingPoints.value);
  const newId = store.addFence({
    name: '新围栏 ' + (store.fences.length + 1),
    center,
    radius: 0,
    type: 'polygon',
    paths: [...drawingPoints.value],
    alertOnEnter: true,
    alertOnExit: false,
    color: '#1976d2'
  });

  clearDrawingTemp();
  store.selectFence(newId);
}

function clearDrawingTemp() {
  if (drawingTempCircle.value) {
    map.value!.removeLayer(drawingTempCircle.value);
    drawingTempCircle.value = null;
  }
  if (drawingTempPolygon.value) {
    map.value!.removeLayer(drawingTempPolygon.value);
    drawingTempPolygon.value = null;
  }
  drawingTempMarkers.value.forEach((m: any) => map.value!.removeLayer(m));
  drawingTempMarkers.value = [];
  drawingPoints.value = [];
  drawingCircleCenter.value = null;
  isDrawingCircleSecondClick.value = false;
}

function renderAllFences() {
  clearAllFenceLayers();
  clearAllMarkerLayers();
  store.fences.forEach(f => renderFence(f));
}

function renderAllDevices() {
  deviceLayers.value.forEach(d => map.value!.removeLayer(d));
  deviceLayers.value.clear();

  store.devices.forEach(d => {
    const isHighlighted = store.highlightedDeviceId === d.id;
    const color = d.status === 'online' ? '#4caf50' : d.status === 'alert' ? '#e53935' : '#9e9e9e';
    const baseRadius = 8;
    const radius = isHighlighted ? baseRadius + 6 : baseRadius;
    const weight = isHighlighted ? 4 : 2;

    if (isHighlighted) {
      const pulseMarker = L.circleMarker([d.lat, d.lng], {
        radius: radius + 8,
        color: color,
        fillColor: color,
        fillOpacity: 0.2,
        weight: 2,
        dashArray: '5,5'
      }).addTo(map.value!);
      deviceLayers.value.set(d.id + '-pulse', pulseMarker);
    }

    const marker = L.circleMarker([d.lat, d.lng], {
      radius,
      color,
      fillColor: color,
      fillOpacity: isHighlighted ? 1 : 0.8,
      weight
    })
      .addTo(map.value!)
      .bindPopup(`<b>${d.name}</b><br>状态: ${d.status === 'online' ? '在线' : d.status === 'alert' ? '告警' : '离线'}<br>电量: ${d.battery}%<br>温度: ${d.temperature}°C`);

    if (isHighlighted) {
      marker.openPopup();
    }

    deviceLayers.value.set(d.id, marker);
  });
}

function panToDevice(deviceId: string) {
  const device = store.getDeviceById(deviceId);
  if (device && map.value) {
    map.value.panTo([device.lat, device.lng], { animate: true, duration: 0.5 });
  }
}

function clearAllTrackLayers() {
  trackLayers.value.forEach(layer => map.value!.removeLayer(layer));
  trackLayers.value = [];
  stayPointMarkers.value.forEach(marker => map.value!.removeLayer(marker));
  stayPointMarkers.value = [];
  breachEventMarkers.value.forEach(marker => map.value!.removeLayer(marker));
  breachEventMarkers.value = [];
  if (trackPointMarker.value) {
    map.value!.removeLayer(trackPointMarker.value);
    trackPointMarker.value = null;
  }
  clearPlaybackMarker();
}

function clearPlaybackMarker() {
  if (playbackMarker.value) {
    playbackMarker.value.closePopup();
    map.value!.removeLayer(playbackMarker.value);
    playbackMarker.value = null;
  }
  if (playbackPulseCircle.value) {
    map.value!.removeLayer(playbackPulseCircle.value);
    playbackPulseCircle.value = null;
  }
  if (playbackTrailLayer.value) {
    map.value!.removeLayer(playbackTrailLayer.value);
    playbackTrailLayer.value = null;
  }
  lastRenderedPointIndex.value = -1;
}

function buildPlaybackPopupContent(point: any): string {
  return `
    <b>📍 当前位置</b><br>
    时间: ${formatTrackTime(point.timestamp)}<br>
    速度: ${point.speed?.toFixed(1) || '0'} km/h<br>
    电量: ${point.battery ?? '--'}%<br>
    温度: ${point.temperature?.toFixed(1) || '--'}°C<br>
    状态: ${point.isAbnormal ? '<span style="color:#e53935">异常</span>' : '<span style="color:#4caf50">正常</span>'}
  `;
}

// 平滑更新回放标记：位置跟随插值坐标，采样点变化时才刷新 popup/轨迹尾迹，
// 不再每次 tick 销毁重建图层，避免 0.5x 时标记闪烁、popup 残留。
function renderPlaybackMarker() {
  if (!store.trackPlaybackEnabled || !store.trackData ||
      !store.playbackLocation || !store.playbackCurrentPoint) {
    clearPlaybackMarker();
    return;
  }

  const loc = store.playbackLocation;
  const point = store.playbackCurrentPoint;
  const pointIndex = store.playbackCurrentIndex;

  if (!playbackMarker.value) {
    playbackPulseCircle.value = L.circle([loc.lat, loc.lng], {
      radius: 40,
      color: '#1976d2',
      fillColor: '#1976d2',
      fillOpacity: 0.15,
      weight: 2,
      dashArray: '5,5'
    }).addTo(map.value!);

    playbackMarker.value = L.marker([loc.lat, loc.lng], { icon: playbackIcon })
      .bindPopup(buildPlaybackPopupContent(point))
      .addTo(map.value!);

    lastRenderedPointIndex.value = pointIndex;
  } else {
    playbackMarker.value.setLatLng([loc.lat, loc.lng]);
    playbackPulseCircle.value?.setLatLng([loc.lat, loc.lng]);
  }

  // 采样点切换时刷新弹窗内容与已走轨迹
  if (pointIndex !== lastRenderedPointIndex.value) {
    lastRenderedPointIndex.value = pointIndex;
    playbackMarker.value.setPopupContent(buildPlaybackPopupContent(point));

    if (playbackTrailLayer.value) {
      map.value!.removeLayer(playbackTrailLayer.value);
      playbackTrailLayer.value = null;
    }
    const points = store.trackData.points;
    if (pointIndex > 0 && points.length > 1) {
      const trailPoints = points.slice(Math.max(0, pointIndex - 20), pointIndex + 1);
      if (trailPoints.length >= 2) {
        playbackTrailLayer.value = L.polyline(
          trailPoints.map(p => [p.lat, p.lng] as [number, number]),
          { color: '#1976d2', weight: 6, opacity: 0.6, lineCap: 'round' }
        ).addTo(map.value!);
      }
    }
  }

  // 仅在标记移出当前视野时平移，播放过程中不抢占用户的地图操作
  if (!map.value!.getBounds().contains([loc.lat, loc.lng])) {
    map.value!.panTo([loc.lat, loc.lng], { animate: true, duration: 0.3 });
  }
}

function formatTrackTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderTrack() {
  clearAllTrackLayers();

  if (!store.trackData || !store.showTrack) return;

  const segments = store.trackData.segments;

  segments.forEach((segment, segIdx) => {
    if (segment.points.length < 2) return;

    const latlngs = segment.points.map(p => [p.lat, p.lng] as [number, number]);
    const color = segment.isNormal ? '#4caf50' : '#e53935';
    const weight = segment.isNormal ? 4 : 5;
    const opacity = segment.isNormal ? 0.8 : 1;
    const dashArray = segment.isNormal ? undefined : '10,5';

    const polyline = L.polyline(latlngs, {
      color,
      weight,
      opacity,
      dashArray,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map.value!);

    const startTime = formatTrackTime(segment.startTime);
    const endTime = formatTrackTime(segment.endTime);
    const statusText = segment.isNormal ? '正常行驶' : (segment.abnormalType === 'fence_breach' ? '越界异常' : '异常');

    polyline.bindPopup(`
      <b>${statusText}</b><br>
      时间: ${startTime} - ${endTime}<br>
      点数: ${segment.points.length}
    `);

    trackLayers.value.push(polyline);
  });

  const points = store.trackData.points;
  if (points.length > 0) {
    const startMarker = L.marker([points[0].lat, points[0].lng], { icon: startPointIcon })
      .bindPopup(`<b>🚩 起点</b><br>${formatTrackTime(points[0].timestamp)}`)
      .addTo(map.value!);
    trackLayers.value.push(startMarker);

    const endMarker = L.marker([points[points.length - 1].lat, points[points.length - 1].lng], { icon: endPointIcon })
      .bindPopup(`<b>🏁 终点</b><br>${formatTrackTime(points[points.length - 1].timestamp)}`)
      .addTo(map.value!);
    trackLayers.value.push(endMarker);
  }
}

function renderStayPoints() {
  stayPointMarkers.value.forEach(marker => map.value!.removeLayer(marker));
  stayPointMarkers.value = [];

  if (!store.trackData || !store.showStayPoints) return;

  store.trackData.stayPoints.forEach((sp, idx) => {
    const duration = store.formatDuration(sp.duration);
    const marker = L.marker([sp.lat, sp.lng], { icon: stayPointIcon })
      .bindPopup(`
        <b>⏸️ ${sp.name}</b><br>
        停留时长: ${duration}<br>
        开始: ${formatTrackTime(sp.startTime)}<br>
        结束: ${formatTrackTime(sp.endTime)}
      `)
      .on('click', () => {
        store.jumpToStayPoint(sp);
      })
      .addTo(map.value!);

    const circle = L.circle([sp.lat, sp.lng], {
      radius: 30,
      color: '#ff9800',
      fillColor: '#ff9800',
      fillOpacity: 0.15,
      weight: 1,
      dashArray: '5,5'
    }).addTo(map.value!);

    stayPointMarkers.value.push(marker, circle);
  });
}

function renderBreachEvents() {
  breachEventMarkers.value.forEach(marker => map.value!.removeLayer(marker));
  breachEventMarkers.value = [];

  if (!store.trackData || !store.showBreachEvents) return;

  store.trackData.breachEvents.forEach((be, idx) => {
    const marker = L.marker([be.lat, be.lng], { icon: breachEventIcon })
      .bindPopup(`
        <b>🚨 越界告警</b><br>
        ${be.abnormalMessage || '进入危险区域'}<br>
        时间: ${formatTrackTime(be.timestamp)}
      `)
      .on('click', () => {
        store.jumpToBreachEvent(be);
      })
      .addTo(map.value!);

    const circle = L.circle([be.lat, be.lng], {
      radius: 50,
      color: '#e53935',
      fillColor: '#e53935',
      fillOpacity: 0.2,
      weight: 2
    }).addTo(map.value!);

    breachEventMarkers.value.push(marker, circle);
  });
}

function fitTrackBounds() {
  if (!store.trackData || store.trackData.points.length === 0) return;

  const latlngs = store.trackData.points.map(p => [p.lat, p.lng] as [number, number]);
  const bounds = L.latLngBounds(latlngs);
  map.value!.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 0.5 });
}

watch(() => store.fences, () => {
  if (isDragging.value) return;
  renderAllFences();
}, { deep: true });

watch(() => store.selectedFenceId, () => {
  renderAllFences();
});

watch(() => store.editMode, (newMode) => {
  if (newMode === 'none') {
    clearDrawingTemp();
  }
  renderAllFences();
});

watch(() => store.devices, () => {
  renderAllDevices();
}, { deep: true });

watch(() => store.highlightedDeviceId, (newId, oldId) => {
  renderAllDevices();
  if (newId && newId !== oldId) {
    panToDevice(newId);
  }
});

watch(() => store.isRegisteringDevice, (isRegistering) => {
  if (!isRegistering) {
    clearRegistrationMarker();
  }
});

watch(() => store.registrationLocation, (loc) => {
  if (loc && store.isRegisteringDevice) {
    updateRegistrationMarker(loc.lat, loc.lng);
    map.value!.panTo([loc.lat, loc.lng], { animate: true, duration: 0.5 });
  }
});

watch(() => store.trackData, (newTrackData) => {
  if (newTrackData) {
    renderTrack();
    renderStayPoints();
    renderBreachEvents();
    fitTrackBounds();
    renderPlaybackMarker();
  } else {
    clearAllTrackLayers();
  }
});

watch(() => store.showTrack, () => {
  renderTrack();
});

watch(() => store.showStayPoints, () => {
  renderStayPoints();
});

watch(() => store.showBreachEvents, () => {
  renderBreachEvents();
});

watch(() => store.playbackLocation, () => {
  renderPlaybackMarker();
});

watch(() => store.trackPlaybackEnabled, (enabled) => {
  if (enabled) {
    renderTrack();
    renderStayPoints();
    renderBreachEvents();
    renderPlaybackMarker();
  } else {
    clearAllTrackLayers();
  }
});

onMounted(() => {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.2); opacity: 0.7; }
    }
  `;
  document.head.appendChild(style);

  map.value = L.map('map').setView([39.9042, 116.4074], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map.value);

  map.value.on('click', handleMapClick);
  map.value.on('dblclick', handleMapDblClick);
  map.value.on('mousemove', handleMapMouseMove);
  map.value.on('mouseup', handleMapMouseUp);

  renderAllFences();
  renderAllDevices();

  // 刷新恢复或面板重新挂载后，若已有回放会话则恢复图层与标记
  if (store.trackPlaybackEnabled && store.trackData) {
    renderTrack();
    renderStayPoints();
    renderBreachEvents();
    fitTrackBounds();
    renderPlaybackMarker();
  }
});

onUnmounted(() => {
  if (map.value) {
    map.value.remove();
  }
});
</script>
