<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapInstance, GeoJSONSource, Marker } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
maplibregl.setWorkerUrl(workerUrl)
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Layers,
  LocateFixed,
  Plus,
  Minus,
  Compass,
  X,
  RefreshCw,
  TrainFront,
  SlidersHorizontal,
} from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import { useTripStore } from '../../stores/tripStore'
import { layerLabels } from '../../services/labels'
import { getMapStyle } from '../../services/mapStyleService'
import TransitDiagram from './TransitDiagram.vue'
import type { FeatureCollection, LineString } from 'geojson'
const router = useRouter(),
  route = useRoute()
const store = useTripStore(),
  container = ref<HTMLDivElement>(),
  layersOpen = ref(false),
  controlsOpen = ref(false),
  mapError = ref(''),
  loading = ref(true)
const lastGeographicMode = ref<'street' | 'custom'>(
  store.mapMode === 'street' ? 'street' : 'custom',
)
let map: MapInstance | undefined,
  markers: Marker[] = [],
  resizeObserver: ResizeObserver | undefined,
  styleRequest = 0,
  disposed = false,
  initialFit = false,
  styleReady = false,
  externalStyle = false
const hasPoints = computed(() => store.focusedPlaces.some((p) => p.coordinates))
const symbols: Record<string, string> = {
  attraction: '✦',
  restaurant: '●',
  hotel: '⌂',
  airport: '✈',
  station: '▣',
  shopping: '◇',
  area: '○',
}
function routeData(): FeatureCollection<LineString> {
  const features = store.data!.geo.flatMap((g) => g.features)
  return {
    type: 'FeatureCollection',
    features: store.visibleSegments.flatMap((s) => {
      const f = features.find((f) => f.properties.id === s.geometryId)
      return f
        ? [
            {
              ...f,
              properties: {
                ...f.properties,
                color: store.day?.color || s.lineColor,
                opacity:
                  store.selectedDayId === 'all' || s.dayId === store.selectedDayId ? 0.85 : 0.12,
                width: store.selectedSegmentId === s.id ? 6 : 2.5,
              },
            },
          ]
        : []
    }),
  }
}
function renderRoutes() {
  if (!map || !styleReady) return
  const source = map.getSource('trip-routes') as GeoJSONSource | undefined
  if (source) source.setData(routeData())
  else {
    map.addSource('trip-routes', { type: 'geojson', data: routeData() })
    map.addLayer({
      id: 'trip-lines',
      type: 'line',
      source: 'trip-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
        'line-opacity': ['get', 'opacity'],
        'line-dasharray': [2, 2],
      },
    })
  }
}
function updateMarkerLabels() {
  if (!map) return
  const occupied: { x: number; y: number; width: number }[] = []
  for (const marker of markers) {
    const el = marker.getElement(),
      label = el.querySelector('.marker-label') as HTMLElement
    const point = map.project(marker.getLngLat())
    el.classList.toggle('compact', map.getZoom() < 11)
    const width = Math.min(160, label.textContent!.length * 11 + 20)
    const overlaps = occupied.some(
      (p) =>
        Math.abs(p.y - point.y) < 30 && point.x < p.x + p.width + 15 && point.x + width + 15 > p.x,
    )
    const selected = el.classList.contains('is-selected')
    label.style.display = (!overlaps || selected) && !el.classList.contains('dimmed') ? '' : 'none'
    if (!overlaps || selected) occupied.push({ x: point.x, y: point.y, width })
  }
}
function renderMarkers() {
  if (!map) return
  markers.forEach((m) => m.remove())
  markers = []
  for (const p of store.visiblePlaces) {
    if (!p.coordinates) continue
    const focused = store.selectedDayId === 'all' || p.dayIds.includes(store.selectedDayId)
    const d = store.data!.days.find(
      (d) =>
        d.id ===
        (store.selectedDayId !== 'all' && p.dayIds.includes(store.selectedDayId)
          ? store.selectedDayId
          : p.dayIds[0]),
    )
    const stop = store.stops.find((s) => s.placeId === p.id)
    const button = document.createElement('button')
    button.className = `map-marker ${focused ? '' : 'dimmed'} ${store.selectedPlaceId === p.id ? 'is-selected' : ''} ${p.status === 'confirmed' ? 'confirmed' : 'candidate'}`
    button.style.setProperty('--marker-color', d?.color || '#cbd8cc')
    button.setAttribute('aria-label', `查看${p.name}`)
    button.title = p.name
    const dot = document.createElement('span')
    dot.className = 'marker-dot'
    dot.textContent =
      store.selectedDayId !== 'all' && focused && stop
        ? String(stop.order)
        : symbols[p.category] || '●'
    const label = document.createElement('span')
    label.className = 'marker-label'
    label.textContent = p.name
    button.append(dot, label)
    button.addEventListener('click', () => {
      if (store.selectedDayId !== 'all' && !p.dayIds.includes(store.selectedDayId)) {
        const targetDay = p.dayIds[0]
        if (targetDay) {
          store.selectDay(targetDay)
          if (route.path.startsWith('/day/')) void router.push(`/day/${targetDay}`)
        }
      }
      store.selectPlace(p.id)
    })
    markers.push(
      new maplibregl.Marker({ element: button, anchor: 'bottom-left' })
        .setLngLat(p.coordinates)
        .addTo(map),
    )
  }
  updateMarkerLabels()
}
function fit() {
  if (!map) return
  const coords = store.focusedPlaces.flatMap((p) => (p.coordinates ? [p.coordinates] : []))
  if (!coords.length) return
  const bounds = new maplibregl.LngLatBounds()
  coords.forEach((c) => bounds.extend(c))
  map.fitBounds(bounds, {
    padding:
      window.innerWidth < 760
        ? { top: 78, bottom: 48, left: 34, right: 92 }
        : { top: 110, bottom: 100, left: 90, right: 90 },
    maxZoom: 14,
    duration: 600,
  })
}
async function loadStyle() {
  if (store.mapMode === 'transit') {
    styleRequest++
    loading.value = false
    mapError.value = ''
    layersOpen.value = false
    controlsOpen.value = false
    return
  }
  const request = ++styleRequest
  loading.value = true
  mapError.value = ''
  externalStyle = false
  try {
    const style = await getMapStyle(store.mapMode)
    if (disposed || request !== styleRequest) return
    styleReady = false
    externalStyle = true
    map?.setStyle(style)
  } catch {
    if (request === styleRequest) {
      mapError.value = '底圖暫時無法載入，仍可查看行程與位置標記。請檢查網路後重試。'
      loading.value = false
    }
  }
}
onMounted(async () => {
  try {
    map = new maplibregl.Map({
      container: container.value!,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color':
                document.documentElement.dataset.theme === 'light' ? '#f7f7f2' : '#17211f',
            },
          },
        ],
      },
      center: store.data!.trip.defaultViewport.center,
      zoom: store.data!.trip.defaultViewport.zoom,
      attributionControl: { compact: true },
    })
    map.on('style.load', () => {
      styleReady = true
      renderRoutes()
      renderMarkers()
      if (!initialFit) {
        fit()
        initialFit = true
      }
    })
    map.on('idle', () => {
      if (externalStyle) loading.value = false
    })
    map.on('move', updateMarkerLabels)
    map.on('error', () => {
      mapError.value = '部分地圖內容未能載入；可重試底圖，或繼續查看行程。'
      loading.value = false
    })
    map.on('click', 'trip-lines', (e) => {
      const id = e.features?.[0]?.properties?.id
      if (id) {
        store.selectedSegmentId = id
        store.selectedPlaceId = null
      }
    })
    map.on('mouseenter', 'trip-lines', () => {
      if (map) map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'trip-lines', () => {
      if (map) map.getCanvas().style.cursor = ''
    })
    resizeObserver = new ResizeObserver(() => map?.resize())
    resizeObserver.observe(container.value!)
    await loadStyle()
  } catch {
    mapError.value = '此瀏覽器無法啟用互動地圖。請使用支援 WebGL 的瀏覽器；行程清單仍可使用。'
    loading.value = false
  }
})
watch(
  () => store.mapMode,
  (mode) => {
    if (mode === 'street' || mode === 'custom') lastGeographicMode.value = mode
    void loadStyle()
  },
)
watch(() => [store.visiblePlaces, store.selectedDayId, store.selectedPlaceId], renderMarkers, {
  deep: true,
})
watch(() => [store.visibleSegments, store.selectedDayId, store.selectedSegmentId], renderRoutes, {
  deep: true,
})
watch(() => store.fitRequest, fit)
watch(
  () => store.selectedPlaceId,
  () => {
    const p = store.selectedPlace
    if (p?.coordinates)
      map?.flyTo({ center: p.coordinates, zoom: Math.max(map.getZoom(), 14), duration: 700 })
  },
)
watch(
  () => store.selectedSegmentId,
  (id) => {
    const s = store.data?.segments.find((s) => s.id === id),
      points = store.data?.geo
        .flatMap((g) => g.features)
        .find((f) => f.properties.id === s?.geometryId)?.geometry.coordinates
    if (points?.length && map) {
      const bounds = new maplibregl.LngLatBounds()
      points.forEach((p) => bounds.extend(p))
      map.fitBounds(bounds, { padding: 100, maxZoom: 15 })
    }
  },
)
onBeforeUnmount(() => {
  disposed = true
  styleRequest++
  resizeObserver?.disconnect()
  markers.forEach((m) => m.remove())
  map?.remove()
})
const selectedSegment = computed(() =>
  store.data?.segments.find((s) => s.id === store.selectedSegmentId),
)
function showGeographicMap() {
  store.mapMode = lastGeographicMode.value
}
function selectBasemap(mode: 'street' | 'custom') {
  store.mapMode = mode
  controlsOpen.value = false
}
function toggleLayers() {
  layersOpen.value = !layersOpen.value
  controlsOpen.value = false
}
</script>
<template>
  <div
    v-show="store.mapMode !== 'transit'"
    ref="container"
    class="map-canvas"
    data-testid="map-canvas"
    :data-ready="!loading"
  />
  <TransitDiagram v-if="store.mapMode === 'transit'" />
  <div class="map-topbar">
    <div class="map-context">
      <span class="live-dot" />{{
        store.mapMode === 'transit'
          ? '旅程精選交通圖'
          : store.day
            ? `DAY ${store.day.id} · ${store.day.title}`
            : '東京 ＋ 鎌倉'
      }}<small>{{
        store.mapMode === 'transit'
          ? 'CURATED TRANSIT NETWORK'
          : store.selectedDayId === 'all'
            ? 'THE WHOLE JOURNEY'
            : 'DAILY EXPLORATION'
      }}</small>
    </div>
    <div class="map-switches">
      <div class="mode-toggle view-toggle control" aria-label="檢視模式">
        <button
          :class="{ active: store.mapMode !== 'transit' }"
          :aria-pressed="store.mapMode !== 'transit'"
          @click="showGeographicMap"
        >
          地圖</button
        ><button
          :class="{ active: store.mapMode === 'transit' }"
          :aria-pressed="store.mapMode === 'transit'"
          @click="store.mapMode = 'transit'"
        >
          交通圖
        </button>
      </div>
      <div
        v-if="store.mapMode !== 'transit'"
        class="mode-toggle basemap-toggle desktop-basemap-toggle control"
        aria-label="地圖樣式"
      >
        <button
          aria-label="道路地圖"
          :class="{ active: store.mapMode === 'street' }"
          :aria-pressed="store.mapMode === 'street'"
          @click="selectBasemap('street')"
        >
          道路地圖</button
        ><button
          aria-label="簡化地圖"
          :class="{ active: store.mapMode === 'custom' }"
          :aria-pressed="store.mapMode === 'custom'"
          @click="selectBasemap('custom')"
        >
          簡化地圖
        </button>
      </div>
    </div>
  </div>
  <div v-if="loading" class="map-message" role="status">正在載入地圖…</div>
  <div v-if="mapError" class="map-message error" role="status">
    {{ mapError
    }}<button class="text-link" @click="loadStyle"><RefreshCw :size="14" /> 重試底圖</button>
  </div>
  <div v-if="!hasPoints && !loading" class="map-message" role="status">
    此篩選下沒有可定位的地點。
  </div>
  <div v-if="store.mapMode !== 'transit'" :class="['map-controls', { open: controlsOpen }]">
    <button
      class="control mobile-map-tools"
      aria-label="地圖工具"
      :aria-expanded="controlsOpen"
      @click="controlsOpen = !controlsOpen"
    >
      <SlidersHorizontal :size="18" /><span>工具</span>
    </button>
    <div class="map-control-items">
      <div class="mobile-basemap-toggle" aria-label="地圖樣式">
        <button
          aria-label="道路地圖"
          :class="{ active: store.mapMode === 'street' }"
          :aria-pressed="store.mapMode === 'street'"
          @click="selectBasemap('street')"
        >
          道路</button
        ><button
          aria-label="簡化地圖"
          :class="{ active: store.mapMode === 'custom' }"
          :aria-pressed="store.mapMode === 'custom'"
          @click="selectBasemap('custom')"
        >
          簡化
        </button>
      </div>
      <button
        class="control transit-toggle"
        :class="{ active: store.visibleLayerIds.includes('subway') }"
        :aria-pressed="store.visibleLayerIds.includes('subway')"
        :aria-label="store.visibleLayerIds.includes('subway') ? '隱藏地鐵路線' : '顯示地鐵路線'"
        @click="store.toggleLayer('subway')"
      >
        <TrainFront :size="18" /><span>地鐵路線</span>
      </button>
      <button class="control icon-button" aria-label="縮放至目前行程" @click="fit">
        <LocateFixed :size="19" />
      </button>
      <div class="control zoom-buttons">
        <button class="icon-button" aria-label="放大地圖" @click="map?.zoomIn()">
          <Plus :size="19" /></button
        ><button class="icon-button" aria-label="縮小地圖" @click="map?.zoomOut()">
          <Minus :size="19" />
        </button>
      </div>
      <button class="control icon-button" aria-label="地圖朝北" @click="map?.resetNorth()">
        <Compass :size="19" /></button
      ><button
        class="control icon-button"
        aria-label="圖層設定"
        :aria-expanded="layersOpen"
        @click="toggleLayers"
      >
        <Layers :size="19" />
      </button>
    </div>
  </div>
  <section
    v-if="layersOpen && store.mapMode !== 'transit'"
    class="layer-panel control"
    aria-label="圖層設定"
  >
    <div class="layer-heading">
      <strong>地圖圖層</strong
      ><button class="icon-button" aria-label="關閉圖層設定" @click="layersOpen = false">
        <X :size="16" />
      </button>
    </div>
    <label v-for="(label, id) in layerLabels" :key="id"
      ><input
        type="checkbox"
        :checked="store.visibleLayerIds.includes(id)"
        @change="store.toggleLayer(id)"
      />{{ label }}</label
    >
    <p>未定位項目仍可從行程查看。</p>
  </section>
  <div v-if="selectedSegment && store.mapMode !== 'transit'" class="segment-detail control">
    <button class="icon-button" aria-label="關閉路線資訊" @click="store.selectedSegmentId = null">
      <X :size="16" /></button
    ><strong>{{ selectedSegment.lineName }}</strong>
    <p v-for="note in selectedSegment.notes" :key="note">{{ note }}</p>
  </div>
  <div v-if="store.mapMode !== 'transit'" class="map-bottom">
    <div v-if="store.selectedDayId === 'all'" class="map-legend control">
      <span v-for="day in store.data?.days" :key="day.id"
        ><i :style="{ background: day.color }" />Day {{ day.id }}</span
      ><span class="legend-candidate">◌ 暫定／可選</span>
    </div>
    <span class="route-disclaimer">虛線為移動示意，非導航路線</span>
  </div>
</template>
