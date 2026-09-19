<template>
  <div style="width:340px;padding:16px;overflow:auto;border-left:1px solid #e0e0e0;display:flex;flex-direction:column;height:100vh;box-sizing:border-box;background:#fafafa">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px">
        🎥 轨迹回放
      </h3>
      <button @click="handleClose"
        style="padding:4px 10px;border-radius:4px;border:1px solid #ccc;background:#fff;color:#666;cursor:pointer;font-size:12px">
        ✕
      </button>
    </div>

    <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e0e0e0;margin-bottom:12px">
      <label style="font-size:12px;color:#666;display:block;margin-bottom:6px">选择设备</label>
      <select v-model="selectedDeviceId"
        :disabled="isLoading"
        style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:12px;margin-bottom:10px;box-sizing:border-box">
        <option value="">-- 请选择设备 --</option>
        <option v-for="d in store.devices" :key="d.id" :value="d.id">
          {{ d.name }} ({{ d.status === 'online' ? '在线' : d.status === 'alert' ? '告警' : '离线' }})
        </option>
      </select>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <label style="font-size:12px;color:#666">
          开始时间
          <input type="datetime-local" v-model="startTimeStr" :disabled="isLoading"
            style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:11px;margin-top:4px;box-sizing:border-box">
        </label>
        <label style="font-size:12px;color:#666">
          结束时间
          <input type="datetime-local" v-model="endTimeStr" :disabled="isLoading"
            style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:11px;margin-top:4px;box-sizing:border-box">
        </label>
      </div>

      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button v-for="p in quickPeriods" :key="p.label" @click="setQuickPeriod(p.hours)"
          :disabled="isLoading"
          :style="{ flex:1, padding:'6px 4px', borderRadius:'4px', border:'1px solid ' + (isQuickPeriodActive(p.hours) ? '#1976d2' : '#ddd'),
            background: isQuickPeriodActive(p.hours) ? '#e3f2fd' : '#fff', color: isQuickPeriodActive(p.hours) ? '#1976d2' : '#666',
            cursor: isLoading ? 'not-allowed' : 'pointer', fontSize:'11px' }">
          {{ p.label }}
        </button>
      </div>

      <div style="display:flex;gap:6px">
        <button @click="handleLoadTrack" :disabled="!selectedDeviceId || isLoading"
          :style="{ flex:1, padding:'10px', borderRadius:'6px', border:'none',
            background: (!selectedDeviceId || isLoading) ? '#ccc' : '#1976d2', color:'#fff',
            cursor: (!selectedDeviceId || isLoading) ? 'not-allowed' : 'pointer', fontSize:'13px', fontWeight:500 }">
          {{ isLoading ? '⏳ 查询中…' : '🔍 查询轨迹' }}
        </button>
        <button v-if="isLoading" @click="handleCancelLoad"
          style="padding:10px 14px;borderRadius:6px;border:1px solid #ccc;background:#fff;color:#666;cursor:pointer;fontSize:12px">
          取消
        </button>
      </div>

      <div v-if="trackStatus === 'error'"
        style="margin-top:8px;padding:8px 10px;border-radius:6px;background:#ffebee;border:1px solid #ffcdd2;font-size:11px;color:#c62828;display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>⚠️ {{ trackError || '轨迹加载失败' }}</span>
        <button v-if="canRetry" @click="handleRetry"
          style="flex:none;padding:4px 10px;border-radius:4px;border:1px solid #e53935;background:#fff;color:#e53935;cursor:pointer;font-size:11px">
          重试
        </button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="isLoading" style="background:#fff;padding:32px 16px;border-radius:8px;border:1px solid #e0e0e0;margin-bottom:12px;text-align:center;color:#1976d2;font-size:13px">
      <div style="font-size:28px;margin-bottom:8px">⏳</div>
      <div>轨迹数据加载中…</div>
    </div>

    <!-- 空态：未查询 -->
    <div v-else-if="trackStatus === 'idle'" style="text-align:center;padding:40px 20px;color:#999;font-size:13px">
      <div style="font-size:40px;margin-bottom:8px">📊</div>
      <div>选择设备和时间范围</div>
      <div style="font-size:11px;margin-top:4px">查询历史轨迹数据</div>
    </div>

    <!-- 空态：查询成功但暂无数据 -->
    <div v-else-if="trackStatus === 'empty'" style="background:#fff;text-align:center;padding:40px 20px;border-radius:8px;border:1px solid #e0e0e0;margin-bottom:12px;color:#999;font-size:13px">
      <div style="font-size:40px;margin-bottom:8px">🗺️</div>
      <div>该时间段内暂无轨迹数据</div>
      <div style="font-size:11px;margin-top:4px">请更换时间范围或设备后重试</div>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="trackStatus === 'error' && !hasTrack"
      style="background:#fff;text-align:center;padding:32px 20px;border-radius:8px;border:1px solid #ffcdd2;margin-bottom:12px;color:#c62828;font-size:13px">
      <div style="font-size:36px;margin-bottom:8px">⚠️</div>
      <div>轨迹加载失败</div>
      <div style="font-size:11px;margin:4px 0 12px;color:#999">{{ trackError || '网络异常，请稍后重试' }}</div>
      <button v-if="canRetry" @click="handleRetry"
        style="padding:8px 20px;border-radius:6px;border:1px solid #e53935;background:#fff;color:#e53935;cursor:pointer;font-size:12px">
        🔄 重试
      </button>
    </div>

    <template v-else-if="hasTrack">
    <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e0e0e0;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0">
        <span style="color:#666">设备:</span>
        <span style="font-weight:500">{{ store.trackData!.deviceName }}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px">
        <div style="display:flex;justify-content:space-between">
          <span style="color:#888">总距离</span>
          <span style="font-weight:500">{{ store.formatDistance(store.trackData!.totalDistance) }}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#888">总时长</span>
          <span style="font-weight:500">{{ store.formatDuration(store.trackData!.totalDuration) }}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#888">轨迹点</span>
          <span style="font-weight:500">{{ pointCount }}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#888">停留点</span>
          <span style="font-weight:500;color:#ff9800">{{ store.trackData!.stayPoints.length }}</span>
        </div>
        <div style="display:flex;justify-content:space-between;grid-column:span 2">
          <span style="color:#888">越界事件</span>
          <span style="font-weight:500;color:#e53935">{{ store.trackData!.breachEvents.length }}</span>
        </div>
      </div>
    </div>

    <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e0e0e0;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:11px;color:#666">播放控制</span>
        <span style="font-size:11px">
          <span :style="{ color: playbackStatusColor, fontWeight:500, marginRight:'8px' }">{{ playbackStatusText }}</span>
          <span style="color:#1976d2;font-weight:500">
            {{ formatTime(store.playbackCurrentTime) || '--:--:--' }}
          </span>
        </span>
      </div>

      <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
        <button @click="handleSkipBack" :disabled="!canSeek"
          :style="skipButtonStyle(!canSeek)">
          ⏮
        </button>
        <button @click="togglePlay" :disabled="!canPlay"
          :style="{ width:'44px', height:'44px', borderRadius:'50%', border:'none',
            background: canPlay ? '#1976d2' : '#ccc', color:'#fff',
            cursor: canPlay ? 'pointer' : 'not-allowed', fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }">
          {{ store.isPlaying ? '⏸' : '▶' }}
        </button>
        <button @click="handleSkipForward" :disabled="!canSeek"
          :style="skipButtonStyle(!canSeek)">
          ⏭
        </button>
        <button @click="handleStop" :disabled="!canSeek"
          :style="skipButtonStyle(!canSeek)">
          ⏹
        </button>
        <div style="flex:1"></div>
        <select v-model="speedValue" @change="handleSpeedChange" :disabled="!canPlay"
          style="padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:11px;cursor:pointer">
          <option :value="0.5">0.5x</option>
          <option :value="1">1x</option>
          <option :value="2">2x</option>
          <option :value="4">4x</option>
          <option :value="8">8x</option>
        </select>
      </div>

      <div style="position:relative">
        <input type="range" min="0" max="100" step="0.1" :value="store.playbackProgress"
          @input="handleProgressChange" :disabled="!canSeek"
          :style="{ width:'100%', height:'6px', WebkitAppearance:'none', appearance:'none',
            background:'#e0e0e0', borderRadius:'3px', outline:'none',
            cursor: canSeek ? 'pointer' : 'not-allowed' }">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#999;margin-top:4px">
          <span>{{ formatTime(store.trackData!.startTime) }}</span>
          <span>{{ formatTime(store.trackData!.endTime) }}</span>
        </div>
      </div>

      <div v-if="pointCount === 1" style="margin-top:8px;font-size:11px;color:#999;text-align:center">
        该轨迹仅含 1 个采样点，无法播放，可拖动时间轴或在地图查看位置
      </div>
    </div>

    <div style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e0e0e0;margin-bottom:12px">
      <div style="font-size:12px;font-weight:500;margin-bottom:8px;color:#333">图层显示</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
          <input type="checkbox" :checked="store.showTrack" @change="store.toggleTrackVisibility" style="cursor:pointer">
          <span>📍 行驶轨迹</span>
          <span style="margin-left:auto;display:flex;gap:4px">
            <span style="width:20px;height:3px;background:#4caf50;border-radius:2px"></span>
            <span style="width:20px;height:3px;background:#e53935;border-radius:2px"></span>
          </span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
          <input type="checkbox" :checked="store.showStayPoints" @change="store.toggleStayPointsVisibility" style="cursor:pointer">
          <span>⏸️ 停留点 ({{ store.trackData!.stayPoints.length }})</span>
          <span style="margin-left:auto;width:12px;height:12px;background:#ff9800;border-radius:50%"></span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
          <input type="checkbox" :checked="store.showBreachEvents" @change="store.toggleBreachEventsVisibility" style="cursor:pointer">
          <span>🚨 越界事件 ({{ store.trackData!.breachEvents.length }})</span>
          <span style="margin-left:auto;width:12px;height:12px;background:#e53935;border-radius:50%"></span>
        </label>
      </div>
    </div>

    <div v-if="store.trackData!.stayPoints.length > 0"
      style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e0e0e0;margin-bottom:12px;flex:1;overflow:auto;min-height:0">
      <div style="font-size:12px;font-weight:500;margin-bottom:8px;color:#333;display:flex;justify-content:space-between;align-items:center">
        <span>⏸️ 停留点记录</span>
        <span style="font-size:10px;color:#ff9800">{{ store.trackData!.stayPoints.length }} 处</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div v-for="(sp, idx) in store.trackData!.stayPoints" :key="idx"
          @click="store.jumpToStayPoint(sp)"
          class="stay-point-item"
          :style="{ padding:'8px 10px', borderRadius:'6px', border:'1px solid #ffe0b2',
            background:'#fff3e0', cursor:'pointer', fontSize:'11px',
            transition:'all 0.2s' }">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:500;color:#e65100">{{ sp.name }}</span>
            <span style="color:#ff9800">⏱ {{ formatDuration(sp.duration) }}</span>
          </div>
          <div style="color:#888;font-size:10px">
            {{ formatTime(sp.startTime) }} - {{ formatTime(sp.endTime) }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="store.trackData!.breachEvents.length > 0"
      style="background:#fff;padding:12px;border-radius:8px;border:1px solid #e0e0e0;margin-bottom:12px;flex:1;overflow:auto;min-height:0">
      <div style="font-size:12px;font-weight:500;margin-bottom:8px;color:#333;display:flex;justify-content:space-between;align-items:center">
        <span>🚨 越界事件</span>
        <span style="font-size:10px;color:#e53935">{{ store.trackData!.breachEvents.length }} 次</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div v-for="(be, idx) in store.trackData!.breachEvents" :key="idx"
          @click="store.jumpToBreachEvent(be)"
          :style="{ padding:'8px 10px', borderRadius:'6px', border:'1px solid #ffcdd2',
            background:'#ffebee', cursor:'pointer', fontSize:'11px' }">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:500;color:#c62828">{{ be.abnormalMessage || '越界告警' }}</span>
            <span style="color:#e53935">🚨</span>
          </div>
          <div style="color:#888;font-size:10px">
            {{ formatTime(be.timestamp) }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="store.playbackCurrentPoint" style="background:#fff;padding:12px;border-radius:8px;border:1px solid #1976d2">
      <div style="font-size:12px;font-weight:500;margin-bottom:8px;color:#1976d2">📍 当前位置</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">
        <div>
          <span style="color:#888">速度</span>
          <div style="font-weight:500">{{ store.playbackCurrentPoint.speed?.toFixed(1) || '0' }} km/h</div>
        </div>
        <div>
          <span style="color:#888">电量</span>
          <div :style="{ fontWeight:500, color: (store.playbackCurrentPoint.battery ?? 100) < 20 ? '#e53935' : '#333' }">
            {{ store.playbackCurrentPoint.battery ?? '--' }}%
          </div>
        </div>
        <div>
          <span style="color:#888">温度</span>
          <div style="font-weight:500">{{ store.playbackCurrentPoint.temperature?.toFixed(1) || '--' }}°C</div>
        </div>
        <div>
          <span style="color:#888">状态</span>
          <div :style="{ fontWeight:500, color: store.playbackCurrentPoint.isAbnormal ? '#e53935' : '#4caf50' }">
            {{ store.playbackCurrentPoint.isAbnormal ? '异常' : '正常' }}
          </div>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useIotStore } from '../stores/iot';

const store = useIotStore();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// 初始化时若存在已恢复的会话，回填查询条件，保证刷新/返回后一致
const selectedDeviceId = ref<string>(store.playbackDeviceId || '');
const startTimeStr = ref<string>(store.playbackStartTime ? toDateTimeLocal(store.playbackStartTime) : '');
const endTimeStr = ref<string>(store.playbackEndTime ? toDateTimeLocal(store.playbackEndTime) : '');
const speedValue = ref<number>(store.playbackSpeed || 1);

const quickPeriods = [
  { label: '1小时', hours: 1 },
  { label: '6小时', hours: 6 },
  { label: '12小时', hours: 12 },
  { label: '24小时', hours: 24 },
];

const selectedQuickPeriod = ref<number | null>(1);

const isLoading = computed(() => store.trackStatus === 'loading');
const hasTrack = computed(() => store.trackStatus === 'ready' && !!store.trackData && store.trackData.points.length > 0);
const trackStatus = computed(() => store.trackStatus);
const trackError = computed(() => store.trackError);
const canRetry = computed(() => trackStatus.value === 'error');
const pointCount = computed(() => store.playbackPointCount);
const canPlay = computed(() => pointCount.value > 1);
const canSeek = computed(() => pointCount.value > 0);

const playbackStatusText = computed(() => {
  if (isLoading.value) return '加载中';
  if (store.isPlaying) return '▶ 播放中';
  if (store.isPlaybackEnded) return '■ 播放结束';
  if (pointCount.value > 0) return '⏸ 已暂停';
  return '';
});

const playbackStatusColor = computed(() => {
  if (store.isPlaying) return '#4caf50';
  if (store.isPlaybackEnded) return '#999';
  return '#ff9800';
});

function skipButtonStyle(disabled: boolean) {
  return {
    width: '36px', height: '36px', borderRadius: '50%',
    border: '1px solid #ddd', background: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '14px', opacity: disabled ? 0.5 : 1
  };
}

function isQuickPeriodActive(hours: number): boolean {
  return selectedQuickPeriod.value === hours;
}

function setQuickPeriod(hours: number) {
  selectedQuickPeriod.value = hours;
  const now = new Date();
  const start = new Date(now.getTime() - hours * 3600000);
  startTimeStr.value = formatDateTimeLocal(start);
  endTimeStr.value = formatDateTimeLocal(now);
}

function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toDateTimeLocal(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateTimeLocal(date);
}

function formatTime(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0秒';
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${minutes}分`;
  } else if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}分${secs}秒`;
  }
  return `${Math.round(seconds)}秒`;
}

function handleLoadTrack() {
  if (!selectedDeviceId.value || !startTimeStr.value || !endTimeStr.value) return;
  selectedQuickPeriod.value = null;
  const start = new Date(startTimeStr.value).toISOString();
  const end = new Date(endTimeStr.value).toISOString();
  store.loadTrackData(selectedDeviceId.value, start, end);
}

function handleRetry() {
  store.retryLoadTrack();
}

function handleCancelLoad() {
  // 中断进行中的查询，回到待查询空态（不清空已选条件）
  store.resetTrackSession();
  selectedQuickPeriod.value = null;
}

function togglePlay() {
  if (store.isPlaying) {
    store.pausePlayback();
  } else {
    store.startPlayback();
  }
}

function handleStop() {
  store.stopPlayback();
}

function handleSkipBack() {
  const step = Math.max(1, Math.floor(pointCount.value / 20));
  store.seekToIndex(store.playbackCurrentIndex - step);
}

function handleSkipForward() {
  const step = Math.max(1, Math.floor(pointCount.value / 20));
  store.seekToIndex(store.playbackCurrentIndex + step);
}

function handleProgressChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const progress = parseFloat(target.value);
  store.seekToProgress(progress);
}

function handleSpeedChange() {
  store.setPlaybackSpeed(speedValue.value);
}

function handleClose() {
  // 保留轨迹数据与播放进度，再次进入回放仍一致
  store.disableTrackPlayback();
  emit('close');
}

watch(() => store.playbackSpeed, (speed) => {
  speedValue.value = speed;
});

// 首次挂载无恢复会话时给一个默认查询范围
if (!store.playbackStartTime) {
  setQuickPeriod(1);
}
</script>

<style scoped>
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #1976d2;
  cursor: pointer;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #1976d2;
  cursor: pointer;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

.stay-point-item:hover {
  background: #ffe0b2 !important;
}
</style>
