<script setup lang="ts">
import { computed, onMounted, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
import { Compass, ChevronUp, ChevronDown, PanelLeftClose, PanelLeftOpen } from '@lucide/vue'
import { useTripStore } from '../stores/tripStore'
import DaySelector from '../components/itinerary/DaySelector.vue'
import PlaceDetails from '../components/itinerary/PlaceDetails.vue'
const TripMap = defineAsyncComponent(() => import('../components/map/TripMap.vue'))
const store = useTripStore(),
  route = useRoute()
const fullMap = computed(() => route.path === '/map')
onMounted(() => {
  localStorage.removeItem('tokyo-trip-theme')
  store.load()
})
</script>
<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink to="/" class="brand" @click="store.selectDay('all')"
        ><span class="brand-mark"><Compass :size="23" :stroke-width="1.4" /></span
        ><span>東京慢遊<small>TOKYO FIELD NOTES</small></span></RouterLink
      >
      <span class="header-note"><i /> 日本獨旅 <span>2027 / 01</span></span>
    </header>
    <div v-if="store.error" class="fatal-error" role="alert">
      <h1>行程資料無法載入</h1>
      <p>{{ store.error }}</p>
    </div>
    <template v-else-if="store.data"
      ><div class="toolbar">
        <div class="toolbar-label">旅程日曆<span>YOUR JOURNEY</span></div>
        <DaySelector /><span class="timezone">日本時間 <b>UTC+9</b></span>
      </div>
      <main :class="['workspace', { 'full-map': fullMap, 'panel-open': store.panelOpen }]">
        <aside class="itinerary-panel" aria-label="行程面板">
          <button
            class="mobile-panel-toggle"
            :aria-expanded="store.panelOpen"
            @click="store.panelOpen = !store.panelOpen"
          >
            <span class="drawer-handle" /><span>{{
              store.day ? `Day ${store.day.id} · ${store.day.title}` : '五天四夜 · 旅程總覽'
            }}</span
            ><ChevronDown v-if="store.panelOpen" :size="18" /><ChevronUp v-else :size="18" />
          </button>
          <PlaceDetails v-if="store.panelOpen" />
          <div class="panel-scroll"><RouterView /></div>
        </aside>
        <section
          :class="['map-region', { 'has-place-details': store.selectedPlaceId }]"
          aria-label="互動行程地圖"
        >
          <TripMap /><button
            v-if="fullMap"
            class="map-panel-toggle control"
            @click="store.panelOpen = !store.panelOpen"
          >
            <PanelLeftClose v-if="store.panelOpen" :size="17" /><PanelLeftOpen v-else :size="17" />
            {{ store.panelOpen ? '收合行程' : '顯示行程' }}
          </button>
        </section>
        <PlaceDetails v-if="!store.panelOpen" /></main
    ></template>
    <div v-else class="loading-screen">正在展開你的東京旅程…</div>
  </div>
</template>
