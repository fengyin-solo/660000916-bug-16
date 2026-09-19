<template>
  <MonitorDashboard v-if="isDashboardMode" @close="exitDashboard" />
  <div v-else style="display:flex;height:100vh;font-family:sans-serif">
    <nav style="width:60px;background:#1b5e20;display:flex;flex-direction:column;align-items:center;padding-top:16px;gap:8px">
      <div style="color:#fff;font-size:20px">📡</div>
      <div style="color:#fff;font-size:10px;text-align:center">IoT<br/>Monitor</div>
      <hr style="width:36px;border-color:rgba(255,255,255,0.2);margin:8px 0"/>
      <button @click="handlePanelClick('devices')"
        :style="{ width:'44px', height:'44px', borderRadius:'8px', border:'none', cursor:'pointer',
          background: activePanel === 'devices' ? '#fff' : 'transparent',
          color: activePanel === 'devices' ? '#1b5e20' : '#fff',
          fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }"
        title="设备监控">
        📱
      </button>
      <button @click="handlePanelClick('fences')"
        :style="{ width:'44px', height:'44px', borderRadius:'8px', border:'none', cursor:'pointer',
          background: activePanel === 'fences' ? '#fff' : 'transparent',
          color: activePanel === 'fences' ? '#1b5e20' : '#fff',
          fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }"
        title="围栏工作台">
        🗺️
      </button>
      <div style="position:relative">
        <button @click="handlePanelClick('alarms')"
          :style="{ width:'44px', height:'44px', borderRadius:'8px', border:'none', cursor:'pointer',
            background: activePanel === 'alarms' ? '#fff' : 'transparent',
            color: activePanel === 'alarms' ? '#1b5e20' : '#fff',
            fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }"
          title="告警中心">
          🔔
        </button>
        <span v-if="store.alertCount > 0"
          :style="{ position:'absolute', top:'2px', right:'2px', minWidth:'16px', height:'16px',
            borderRadius:'8px', background:'#e53935', color:'#fff', fontSize:'10px',
            display:'flex', alignItems:'center', justifyContent:'center', fontWeight:600,
            padding:'0 4px', lineHeight:'1' }">
          {{ store.alertCount > 99 ? '99+' : store.alertCount }}
        </span>
      </div>
      <button @click="handlePanelClick('track')"
        :style="{ width:'44px', height:'44px', borderRadius:'8px', border:'none', cursor:'pointer',
          background: activePanel === 'track' ? '#fff' : 'transparent',
          color: activePanel === 'track' ? '#1b5e20' : '#fff',
          fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }"
        title="轨迹回放">
        🎥
      </button>
      <button @click="handlePanelClick('health')"
        :style="{ width:'44px', height:'44px', borderRadius:'8px', border:'none', cursor:'pointer',
          background: activePanel === 'health' ? '#fff' : 'transparent',
          color: activePanel === 'health' ? '#1b5e20' : '#fff',
          fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }"
        title="健康诊断">
        🏥
      </button>
      <hr style="width:36px;border-color:rgba(255,255,255,0.2);margin:8px 0"/>
      <button @click="handleAddDevice"
        :style="{ width:'44px', height:'44px', borderRadius:'8px', border:'none', cursor:'pointer',
          background: store.isRegisteringDevice ? '#fff' : 'transparent',
          color: store.isRegisteringDevice ? '#1b5e20' : '#fff',
          fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }"
        title="注册新设备">
        ➕
      </button>
      <hr style="width:36px;border-color:rgba(255,255,255,0.2);margin:8px 0"/>
      <button @click="enterDashboard"
        :style="{ width:'44px', height:'44px', borderRadius:'8px', border:'none', cursor:'pointer',
          background:'#e65100', color:'#fff',
          fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }"
        title="监控大屏">
        🖥️
      </button>
    </nav>
    <MapView />
    <DeviceRegistration v-if="store.isRegisteringDevice" @registered="handleDeviceRegistered" @cancel="handleRegistrationCancel" />
    <DevicePanel v-else-if="activePanel === 'devices'" @add-device="handleAddDevice" />
    <FenceEditor v-if="activePanel === 'fences' && !store.isRegisteringDevice" />
    <AlarmCenter v-if="activePanel === 'alarms' && !store.isRegisteringDevice" />
    <TrackPlayer v-if="activePanel === 'track' && !store.isRegisteringDevice" @close="handleTrackClose" />
    <DeviceHealthDiagnosis v-if="activePanel === 'health' && !store.isRegisteringDevice" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MapView from './components/MapView.vue';
import DevicePanel from './components/DevicePanel.vue';
import FenceEditor from './components/FenceEditor.vue';
import AlarmCenter from './components/AlarmCenter.vue';
import DeviceRegistration from './components/DeviceRegistration.vue';
import TrackPlayer from './components/TrackPlayer.vue';
import MonitorDashboard from './components/MonitorDashboard.vue';
import DeviceHealthDiagnosis from './components/DeviceHealthDiagnosis.vue';
import { useIotStore } from './stores/iot';

const store = useIotStore();
const activePanel = ref<'devices' | 'fences' | 'alarms' | 'track' | 'health'>('alarms');
const isDashboardMode = ref(false);

function handlePanelClick(panel: 'devices' | 'fences' | 'alarms' | 'track' | 'health') {
  if (activePanel.value === 'track' && panel !== 'track') {
    // 离开回放面板：暂停播放但保留数据与进度，再次进入仍一致
    store.disableTrackPlayback();
  }
  if (panel === 'track') {
    store.enableTrackPlayback();
  }
  activePanel.value = panel;
}
function handleAddDevice() {
  store.startDeviceRegistration();
  activePanel.value = 'devices';
}

function handleDeviceRegistered(deviceId: string) {
  activePanel.value = 'devices';
}

function handleRegistrationCancel() {
  store.cancelDeviceRegistration();
}

function handleTrackClose() {
  activePanel.value = 'devices';
}

function enterDashboard() {
  if (activePanel.value === 'track') {
    store.disableTrackPlayback();
  }
  isDashboardMode.value = true;
}

function exitDashboard() {
  isDashboardMode.value = false;
}
</script>
