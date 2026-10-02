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
const mapLayerLabels = Object.fromEntries(
  Object.entries(layerLabels).filter(([id]) => id !== 'subway'),
)
const lastGeographicMode = ref<'street' | 'custom'>(
  store.mapMode === 'street' ? 'street' : 'custom',
)
let map: MapInstance | undefined,
  markers: Marker[] = [],
  routeLabels: Marker[] = [],
  uenoClusterMarker: Marker | undefined,
  resizeObserver: ResizeObserver | undefined,
  styleRequest = 0,
  disposed = false,
  initialFit = false,
  styleReady = false,
  externalStyle = false,
  uenoManuallyExpandedAt: number | undefined
const hasPoints = computed(() => store.focusedPlaces.some((p) => p.coordinates))
const UENO_STATION_IDS = ['ueno', 'metro-ueno', 'keisei-ueno'] as const
const UENO_EXPANDED_ZOOM = 13
const UENO_GEOGRAPHIC_ZOOM = 5
const UENO_SELECTED_ZOOM = 15 // zoom used when a Ueno station is picked
const MARKER_LABEL_MIN_ZOOM = 10 // zoomed out further than this, markers show only their dot
const uenoFanOffsets: Record<(typeof UENO_STATION_IDS)[number], [number, number]> = {
  ueno: [0, -34],
  'metro-ueno': [0, 0],
  'keisei-ueno': [0, 34],
}
const uenoStationCodes: Record<(typeof UENO_STATION_IDS)[number], string> = {
  ueno: 'JR',
  'metro-ueno': 'G16/H18',
  'keisei-ueno': 'KS01',
}
const uenoStationShortNames: Record<(typeof UENO_STATION_IDS)[number], string> = {
  ueno: 'JR 上野',
  'metro-ueno': 'Metro 上野',
  'keisei-ueno': '京成上野',
}
const rideModes = new Set(['train', 'subway', 'monorail', 'bus', 'flight'])
const showsUenoGroup = computed(() => uenoGroupPlaces().length === UENO_STATION_IDS.length)
const showsSubway = computed(
  () => store.selectedDayId === 'all' || store.selectedDayId === 1 || store.selectedDayId === 2,
)
const subwaySegments = [
  {
    id: 'ginza-east',
    segmentId: 'route-4',
    days: [1],
    coordinates: [
      [139.775972, 35.71175],
      [139.7984, 35.7107],
    ],
  },
  {
    id: 'ginza-west',
    segmentId: null,
    days: [2],
    coordinates: [
      [139.7005, 35.6595],
      [139.7086, 35.6674],
    ],
  },
]
const symbols: Record<string, string> = {
  attraction: '✦',
  restaurant: '●',
  hotel: '⌂',
  airport: '✈',
  station: '駅',
  shopping: '◇',
  area: '○',
}
function isUenoStation(id: string): id is (typeof UENO_STATION_IDS)[number] {
  return UENO_STATION_IDS.includes(id as (typeof UENO_STATION_IDS)[number])
}
function uenoGroupPlaces() {
  return store.visiblePlaces.filter(
    (place) =>
      isUenoStation(place.id) &&
      place.coordinates &&
      (store.selectedDayId === 'all' || place.dayIds.includes(store.selectedDayId)),
  )
}
function uenoGroupCenter(): [number, number] {
  const places = uenoGroupPlaces()
  return [
    places.reduce((sum, place) => sum + place.coordinates![0], 0) / places.length,
    places.reduce((sum, place) => sum + place.coordinates![1], 0) / places.length,
  ]
}
function isUenoGroupExpanded() {
  return (
    !showsUenoGroup.value ||
    uenoManuallyExpandedAt !== undefined ||
    (map?.getZoom() || 0) >= UENO_EXPANDED_ZOOM ||
    (store.selectedPlaceId !== null && isUenoStation(store.selectedPlaceId))
  )
}
function expandUenoGroup() {
  uenoManuallyExpandedAt = map?.getZoom()
  updateMarkerLabels()
}
function uenoFanOffset(marker: Marker): [number, number] {
  const id = marker.getElement().dataset.placeId
  if (
    !map ||
    !id ||
    !isUenoStation(id) ||
    !showsUenoGroup.value ||
    map.getZoom() >= UENO_GEOGRAPHIC_ZOOM
  )
    return [0, 0]
  const center = map.project(uenoGroupCenter())
  const point = map.project(marker.getLngLat())
  const [x, y] = uenoFanOffsets[id]
  return [center.x + x - point.x, center.y + y - point.y]
}
function uenoTransferData(): FeatureCollection<LineString> {
  if (!showsUenoGroup.value) return { type: 'FeatureCollection', features: [] }
  const coordinates = Object.fromEntries(
    uenoGroupPlaces().map((place) => [place.id, place.coordinates!]),
  )
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: 'keisei-metro-ueno-transfer' },
        geometry: {
          type: 'LineString',
          coordinates: [coordinates['keisei-ueno']!, coordinates['metro-ueno']!],
        },
      },
      {
        type: 'Feature',
        properties: { id: 'metro-jr-ueno-transfer' },
        geometry: {
          type: 'LineString',
          coordinates: [coordinates['metro-ueno']!, coordinates.ueno!],
        },
      },
    ],
  }
}
function routeData(): FeatureCollection<LineString> {
  const features = store.data!.geo.flatMap((g) => g.features)
  return {
    type: 'FeatureCollection',
    features: store.visibleSegments.flatMap((s) => {
      if (!rideModes.has(s.mode) || s.layerId === 'subway') return []
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
                routeLabel: s.layerId === 'jr' ? 'JR' : s.layerId === 'skyliner' ? 'Skyliner' : '',
              },
            },
          ]
        : []
    }),
  }
}
function midpoint(coordinates: number[][]): [number, number] {
  if (coordinates.length < 2) return coordinates[0] as [number, number]
  const lengths = coordinates.slice(1).map((point, index) => {
    const previous = coordinates[index]!
    return Math.hypot(point[0]! - previous[0]!, point[1]! - previous[1]!)
  })
  const halfway = lengths.reduce((sum, length) => sum + length, 0) / 2
  let travelled = 0
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!
    if (travelled + length >= halfway) {
      const start = coordinates[index]!
      const end = coordinates[index + 1]!
      const ratio = length ? (halfway - travelled) / length : 0
      return [start[0]! + (end[0]! - start[0]!) * ratio, start[1]! + (end[1]! - start[1]!) * ratio]
    }
    travelled += length
  }
  return coordinates.at(-1) as [number, number]
}
function subwayData(): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: subwaySegments
      .filter(
        (segment) => store.selectedDayId === 'all' || segment.days.includes(store.selectedDayId),
      )
      .map((segment) => ({
        type: 'Feature' as const,
        properties: {
          id: segment.id,
          segmentId: segment.segmentId,
          label: 'G 銀座線',
          color: '#f39700',
        },
        geometry: { type: 'LineString' as const, coordinates: segment.coordinates },
      })),
  }
}
function renderSubwayOverlay() {
  if (!map || !styleReady) return
  const source = map.getSource('subway-overlay') as GeoJSONSource | undefined
  if (source) source.setData(subwayData())
  else {
    map.addSource('subway-overlay', { type: 'geojson', data: subwayData() })
    map.addLayer({
      id: 'subway-overlay-halo',
      type: 'line',
      source: 'subway-overlay',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.55 },
    })
    map.addLayer({
      id: 'subway-overlay-line',
      type: 'line',
      source: 'subway-overlay',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#e69618',
        'line-width': 3.5,
        'line-opacity': 0.78,
        'line-dasharray': [2, 1.5],
      },
    })
  }
}
function renderUenoTransfers() {
  if (!map || !styleReady) return
  const source = map.getSource('ueno-transfers') as GeoJSONSource | undefined
  if (source) source.setData(uenoTransferData())
  else {
    map.addSource('ueno-transfers', { type: 'geojson', data: uenoTransferData() })
    map.addLayer({
      id: 'ueno-transfer-halo',
      type: 'line',
      source: 'ueno-transfers',
      minzoom: UENO_GEOGRAPHIC_ZOOM,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.82 },
    })
    map.addLayer({
      id: 'ueno-transfer-line',
      type: 'line',
      source: 'ueno-transfers',
      minzoom: UENO_GEOGRAPHIC_ZOOM,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#52675b',
        'line-width': 2.5,
        'line-opacity': 0.76,
      },
    })
  }
}
function renderRouteLabels() {
  if (!map) return
  routeLabels.forEach((label) => label.remove())
  routeLabels = []
  const features = store.data!.geo.flatMap((collection) => collection.features)
  for (const segment of store.visibleSegments) {
    const text = segment.layerId === 'jr' ? 'JR' : segment.layerId === 'skyliner' ? 'Skyliner' : ''
    if (!text || (store.selectedDayId !== 'all' && segment.dayId !== store.selectedDayId)) continue
    const feature = features.find((item) => item.properties.id === segment.geometryId)
    if (!feature) continue
    const label = document.createElement('span')
    label.className = `map-route-label map-route-label-${segment.layerId}`
    label.dataset.route = segment.id
    label.textContent = text
    label.style.setProperty('--route-label-color', segment.lineColor)
    routeLabels.push(
      new maplibregl.Marker({ element: label, anchor: 'center' })
        .setLngLat(midpoint(feature.geometry.coordinates))
        .addTo(map),
    )
  }
  for (const feature of subwayData().features) {
    const label = document.createElement('span')
    label.className = 'map-route-label map-route-label-subway'
    label.dataset.route = String(feature.properties?.id)
    label.textContent = 'G 銀座線'
    label.style.setProperty('--route-label-color', '#e69618')
    routeLabels.push(
      new maplibregl.Marker({ element: label, anchor: 'center' })
        .setLngLat(midpoint(feature.geometry.coordinates))
        .addTo(map),
    )
  }
  if (showsUenoGroup.value) {
    const label = document.createElement('span')
    label.className = 'ueno-transfer-label'
    label.textContent = '步行轉乘'
    routeLabels.push(
      new maplibregl.Marker({ element: label, anchor: 'center' })
        .setLngLat(
          midpoint(
            ['keisei-ueno', 'metro-ueno'].map(
              (id) => uenoGroupPlaces().find((place) => place.id === id)!.coordinates!,
            ),
          ),
        )
        .addTo(map),
    )
  }
  updateMarkerLabels()
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
  renderSubwayOverlay()
  renderUenoTransfers()
  renderRouteLabels()
}
// Markers are anchored at their left-middle edge; shift left by half the dot so the
// dot's centre (not its corner) sits on the coordinate where route lines end.
function centerDotOn(marker: Marker, [x, y]: [number, number]) {
  const dot = marker.getElement().querySelector('.marker-dot') as HTMLElement | null
  marker.setOffset([x - (dot?.offsetWidth || 0) / 2, y])
}
function updateMarkerLabels() {
  if (!map) return
  // A clicked-open Ueno group folds back once the user zooms out past where they opened it.
  if (uenoManuallyExpandedAt !== undefined && map.getZoom() < uenoManuallyExpandedAt - 0.75)
    uenoManuallyExpandedAt = undefined
  const uenoExpanded = isUenoGroupExpanded()
  const uenoGeographic = map.getZoom() >= UENO_GEOGRAPHIC_ZOOM
  const compactRouteLabels = map.getZoom() < 11.5
  uenoClusterMarker?.getElement().classList.toggle('is-map-hidden', uenoExpanded)
  uenoClusterMarker?.getElement().setAttribute('aria-expanded', String(uenoExpanded))
  const showLabels = map.getZoom() >= MARKER_LABEL_MIN_ZOOM
  if (uenoClusterMarker) centerDotOn(uenoClusterMarker, [0, 0])
  routeLabels.forEach((label) => {
    const element = label.getElement()
    element.classList.toggle(
      'is-map-hidden',
      element.classList.contains('ueno-transfer-label')
        ? !uenoExpanded || !uenoGeographic
        : compactRouteLabels,
    )
  })
  const occupied: { x: number; y: number; width: number }[] = []
  for (const marker of markers) {
    const el = marker.getElement()
    const uenoStation = el.dataset.uenoStation === 'true'
    const groupedUenoStation = uenoStation && showsUenoGroup.value
    el.classList.toggle(
      'is-map-hidden',
      (groupedUenoStation && !uenoExpanded) ||
        (uenoStation && !showsUenoGroup.value && el.classList.contains('dimmed')),
    )
    if (el.classList.contains('is-map-hidden')) continue
    el.classList.toggle('compact', map.getZoom() < 11)
    const offset = uenoFanOffset(marker)
    centerDotOn(marker, offset)
    const label = el.querySelector('.marker-label') as HTMLElement
    const projected = map.project(marker.getLngLat())
    const point = { x: projected.x + offset[0], y: projected.y + offset[1] }
    const width = Math.min(160, label.textContent!.length * 11 + 20)
    const overlaps = occupied.some(
      (p) =>
        Math.abs(p.y - point.y) < 30 && point.x < p.x + p.width + 15 && point.x + width + 15 > p.x,
    )
    const selected = el.classList.contains('is-selected')
    label.style.display =
      showLabels && (!overlaps || selected) && !el.classList.contains('dimmed') ? '' : 'none'
    if (!overlaps || selected) occupied.push({ x: point.x, y: point.y, width })
  }
}
function renderMarkers() {
  if (!map) return
  markers.forEach((m) => m.remove())
  markers = []
  uenoClusterMarker?.remove()
  uenoClusterMarker = undefined
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
    const uenoStation = isUenoStation(p.id)
    button.className = `map-marker category-${p.category} ${uenoStation ? `ueno-station-marker operator-${p.id}` : ''} ${focused ? '' : 'dimmed'} ${store.selectedPlaceId === p.id ? 'is-selected' : ''} ${p.status === 'confirmed' ? 'confirmed' : 'candidate'}`
    button.dataset.uenoStation = String(uenoStation)
    button.dataset.placeId = p.id
    button.style.setProperty('--marker-color', d?.color || '#cbd8cc')
    button.setAttribute('aria-label', `查看${p.name}`)
    button.title = p.name
    const dot = document.createElement('span')
    dot.className = 'marker-dot'
    const showsStopOrder = !uenoStation && store.selectedDayId !== 'all' && focused && stop
    dot.textContent = uenoStation
      ? uenoStationCodes[p.id as (typeof UENO_STATION_IDS)[number]]
      : showsStopOrder
        ? String(stop.order)
        : symbols[p.category] || '●'
    const label = document.createElement('span')
    label.className = 'marker-label'
    label.textContent = uenoStation
      ? uenoStationShortNames[p.id as (typeof UENO_STATION_IDS)[number]]
      : p.category === 'station'
        ? `車站 · ${p.name}`
        : p.name
    if (p.id === 'metro-ueno') {
      const lineBadge = document.createElement('i')
      lineBadge.className = 'marker-line-badge line-ginza'
      lineBadge.textContent = 'G'
      lineBadge.title = '東京 Metro 銀座線'
      label.prepend(lineBadge)
    }
    button.append(dot)
    if (p.category === 'station' && showsStopOrder) {
      const categoryBadge = document.createElement('span')
      categoryBadge.className = 'marker-category-badge'
      categoryBadge.textContent = '駅'
      button.append(categoryBadge)
    }
    button.append(label)
    button.addEventListener('click', (event) => {
      // Route lines end under the dot, so keep the click from also selecting the line below.
      event.stopPropagation()
      if (store.selectedDayId !== 'all' && !p.dayIds.includes(store.selectedDayId)) {
        const targetDay = p.dayIds[0]
        if (targetDay) {
          store.selectDay(targetDay)
          if (route.path.startsWith('/day/')) void router.push(`/day/${targetDay}`)
        }
      }
      store.selectPlace(p.id)
      if (window.innerWidth < 760) {
        store.panelOpen = false
        controlsOpen.value = false
        layersOpen.value = false
      }
    })
    markers.push(
      new maplibregl.Marker({ element: button, anchor: 'left' })
        .setLngLat(p.coordinates)
        .addTo(map),
    )
  }
  if (showsUenoGroup.value) {
    const button = document.createElement('button')
    button.className = 'map-marker ueno-cluster-marker'
    button.setAttribute('aria-label', '展開上野站群，包含 3 個車站')
    button.setAttribute('aria-expanded', 'false')
    button.title = '上野站群：JR、東京 Metro、京成'
    const dot = document.createElement('span')
    dot.className = 'marker-dot'
    dot.textContent = '駅×3'
    button.append(dot)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      expandUenoGroup()
    })
    uenoClusterMarker = new maplibregl.Marker({ element: button, anchor: 'left' })
      .setLngLat(uenoGroupCenter())
      .addTo(map)
  }
  updateMarkerLabels()
}
function fit() {
  if (!map) return
  const features = store.data!.geo.flatMap((g) => g.features)
  const routeCoords = store.visibleSegments
    .filter((s) => store.selectedDayId === 'all' || s.dayId === store.selectedDayId)
    .flatMap(
      (s) => features.find((f) => f.properties.id === s.geometryId)?.geometry.coordinates || [],
    )
  const coords = [
    ...store.focusedPlaces.flatMap((p) => (p.coordinates ? [p.coordinates] : [])),
    ...routeCoords,
  ]
  if (!coords.length) return
  const bounds = new maplibregl.LngLatBounds()
  coords.forEach((c) => bounds.extend(c as [number, number]))
  // Leave room for the title card, the right-hand controls and the bottom legend;
  // markers anchor bottom-left, so their labels also extend up and to the right.
  map.fitBounds(bounds, {
    padding:
      window.innerWidth < 760
        ? { top: 110, bottom: 90, left: 34, right: 150 }
        : { top: 150, bottom: 130, left: 70, right: 240 },
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
              'background-color': '#f7f7f2',
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
    map.on('click', 'subway-overlay-line', (e) => {
      const id = e.features?.[0]?.properties?.segmentId
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
    map.on('mouseenter', 'subway-overlay-line', () => {
      if (map) map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'subway-overlay-line', () => {
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
  () => store.selectedDayId,
  () => {
    uenoManuallyExpandedAt = undefined
    updateMarkerLabels()
  },
)
watch(
  () => store.selectedPlaceId,
  () => {
    const p = store.selectedPlace
    if (p?.coordinates)
      map?.flyTo({
        center: p.coordinates,
        zoom: Math.max(map.getZoom(), isUenoStation(p.id) ? UENO_SELECTED_ZOOM : 14),
        offset: window.innerWidth < 760 ? [0, -105] : [0, 0],
        duration: 700,
      })
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
  routeLabels.forEach((label) => label.remove())
  uenoClusterMarker?.remove()
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
    <label v-for="(label, id) in mapLayerLabels" :key="id"
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
    <div class="map-symbol-legend control" aria-label="地圖圖示說明">
      <span><i class="station-symbol">駅</i>車站</span>
      <span v-if="showsSubway"><i class="subway-symbol" />G 銀座線</span>
      <span v-if="showsUenoGroup"><i class="walking-transfer-symbol" />步行轉乘</span>
    </div>
    <span class="route-disclaimer">交通虛線為搭乘示意，非導航路線</span>
  </div>
</template>
