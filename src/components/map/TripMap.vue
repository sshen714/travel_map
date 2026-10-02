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
  uenoTransferOverlay: SVGSVGElement | undefined,
  uenoTransferLines: [SVGLineElement, SVGLineElement][] = [],
  resizeObserver: ResizeObserver | undefined,
  styleRequest = 0,
  disposed = false,
  initialFit = false,
  styleReady = false,
  externalStyle = false,
  transferFrame: number | undefined,
  uenoManuallyExpanded = false
const hasPoints = computed(() => store.focusedPlaces.some((p) => p.coordinates))
const UENO_STATION_IDS = ['ueno', 'metro-ueno', 'keisei-ueno'] as const
const UENO_EXPANDED_ZOOM = 12
const UENO_SELECTED_ZOOM = 10 // zoom used when a Ueno station is picked
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
      [139.7825, 35.7113],
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
    uenoManuallyExpanded ||
    (map?.getZoom() || 0) >= UENO_EXPANDED_ZOOM ||
    (store.selectedPlaceId !== null && isUenoStation(store.selectedPlaceId))
  )
}
function expandUenoGroup() {
  uenoManuallyExpanded = true
  if (map && map.getZoom() < UENO_SELECTED_ZOOM)
    map.easeTo({ center: uenoGroupCenter(), zoom: UENO_SELECTED_ZOOM, duration: 600 })
  updateMarkerLabels()
}
function uenoFanOffset(marker: Marker): [number, number] {
  const id = marker.getElement().dataset.placeId
  if (
    !id ||
    !isUenoStation(id) ||
    !showsUenoGroup.value ||
    !map ||
    map.getZoom() >= UENO_EXPANDED_ZOOM
  )
    return [0, 0]
  return uenoFanOffsets[id]
}
function renderUenoTransfers() {
  if (!map || uenoTransferOverlay) return
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  overlay.classList.add('ueno-transfer-overlay')
  overlay.setAttribute('aria-hidden', 'true')
  for (let index = 0; index < 2; index++) {
    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    halo.classList.add('ueno-transfer-halo')
    line.classList.add('ueno-transfer-line')
    overlay.append(halo, line)
    uenoTransferLines.push([halo, line])
  }
  map.getCanvasContainer().append(overlay)
  uenoTransferOverlay = overlay
}
function updateUenoTransferLines() {
  if (!map || !uenoTransferOverlay) return
  const visible = showsUenoGroup.value && isUenoGroupExpanded()
  uenoTransferOverlay.style.display = visible ? '' : 'none'
  if (!visible) return
  const canvasRect = map.getCanvasContainer().getBoundingClientRect()
  const markerPosition = (id: (typeof UENO_STATION_IDS)[number]) => {
    const dot = markers
      .find((marker) => marker.getElement().dataset.placeId === id)
      ?.getElement()
      .querySelector('.marker-dot')
    if (!dot) return null
    const rect = dot.getBoundingClientRect()
    return [
      rect.left + rect.width / 2 - canvasRect.left,
      rect.top + rect.height / 2 - canvasRect.top,
    ]
  }
  const links = [
    [markerPosition('keisei-ueno'), markerPosition('metro-ueno')],
    [markerPosition('metro-ueno'), markerPosition('ueno')],
  ]
  if (links.some(([from, to]) => !from || !to)) {
    uenoTransferOverlay.style.display = 'none'
    return
  }
  links.forEach(([from, to], index) => {
    for (const line of uenoTransferLines[index]!) {
      line.setAttribute('x1', String(from![0]))
      line.setAttribute('y1', String(from![1]))
      line.setAttribute('x2', String(to![0]))
      line.setAttribute('y2', String(to![1]))
    }
  })
}
function scheduleUenoTransferLines() {
  if (transferFrame !== undefined) return
  transferFrame = requestAnimationFrame(() => {
    transferFrame = undefined
    updateUenoTransferLines()
  })
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
function pointAlong(coordinates: number[][], fraction = 0.5): [number, number] {
  if (coordinates.length < 2) return coordinates[0] as [number, number]
  const lengths = coordinates.slice(1).map((point, index) => {
    const previous = coordinates[index]!
    return Math.hypot(point[0]! - previous[0]!, point[1]! - previous[1]!)
  })
  const target = lengths.reduce((sum, length) => sum + length, 0) * fraction
  let travelled = 0
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!
    if (travelled + length >= target) {
      const start = coordinates[index]!
      const end = coordinates[index + 1]!
      const ratio = length ? (target - travelled) / length : 0
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
        .setLngLat(pointAlong(feature.geometry.coordinates))
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
        .setLngLat(
          pointAlong(
            feature.geometry.coordinates,
            feature.properties?.id === 'ginza-east' ? 0.72 : 0.5,
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
  renderRouteLabels()
}
function updateMarkerLabels() {
  if (!map) return
  const uenoExpanded = isUenoGroupExpanded()
  const zoom = map.getZoom()
  // Long rail lines (Skyliner, JR) span the whole day view, so label them early;
  // the short Ginza overlay only gets its label once zoomed into the city.
  const routeLabelMinZoom = (element: HTMLElement) =>
    element.classList.contains('map-route-label-subway') ? 11.5 : 7
  uenoClusterMarker?.getElement().classList.toggle('is-map-hidden', uenoExpanded)
  uenoClusterMarker?.getElement().setAttribute('aria-expanded', String(uenoExpanded))
  const showLabels = zoom >= MARKER_LABEL_MIN_ZOOM
  routeLabels.forEach((label) => {
    const element = label.getElement()
    element.classList.toggle('is-map-hidden', zoom < routeLabelMinZoom(element))
  })
  const occupied: { left: number; right: number; top: number; bottom: number }[] = []
  const prioritizedMarkers = [...markers].sort((a, b) => {
    const priority = (marker: Marker) => {
      const el = marker.getElement()
      if (el.classList.contains('is-selected')) return 5
      if (el.dataset.placeId === 'inaricho') return 4
      if (el.dataset.placeId === 'hotel-ueno') return 3
      if (el.dataset.uenoStation === 'true') return 2
      if (el.dataset.placeId === 'asakusa-station') return 1
      return 0
    }
    return priority(b) - priority(a)
  })
  for (const marker of prioritizedMarkers) {
    const el = marker.getElement()
    const uenoStation = el.dataset.uenoStation === 'true'
    const groupedUenoStation = uenoStation && showsUenoGroup.value
    el.classList.toggle(
      'is-map-hidden',
      (groupedUenoStation && !uenoExpanded) ||
        (uenoStation && !showsUenoGroup.value && el.classList.contains('dimmed')),
    )
    if (el.classList.contains('is-map-hidden')) continue
    el.classList.toggle('compact', zoom < 11)
    const offset = uenoFanOffset(marker)
    marker.setOffset(offset)
    const label = el.querySelector('.marker-label') as HTMLElement
    label.style.display = ''
    const projected = map.project(marker.getLngLat())
    const point = { x: projected.x + offset[0], y: projected.y + offset[1] }
    const dot = el.querySelector('.marker-dot') as HTMLElement
    const below = el.dataset.placeId === 'inaricho'
    const width = label.offsetWidth
    const height = label.offsetHeight
    const bounds = below
      ? {
          left: point.x - width / 2,
          right: point.x + width / 2,
          top: point.y + dot.offsetHeight / 2 + 4,
          bottom: point.y + dot.offsetHeight / 2 + 4 + height,
        }
      : {
          left: point.x + dot.offsetWidth / 2 + 6,
          right: point.x + dot.offsetWidth / 2 + 6 + width,
          top: point.y - height / 2,
          bottom: point.y + height / 2,
        }
    const overlaps = occupied.some(
      (p) =>
        bounds.left < p.right + 8 &&
        bounds.right + 8 > p.left &&
        bounds.top < p.bottom + 6 &&
        bounds.bottom + 6 > p.top,
    )
    const selected = el.classList.contains('is-selected')
    const isSecondaryLabel =
      store.selectedDayId !== 'all' &&
      !selected &&
      !uenoStation &&
      (el.dataset.placeId !== 'hotel-ueno' || window.innerWidth < 760) &&
      el.dataset.placeId !== 'asakusa-station'
    const labelMinZoom = window.innerWidth < 760 && el.dataset.placeId === 'hotel-ueno' ? 15 : 14
    label.style.display =
      showLabels &&
      (!isSecondaryLabel || zoom >= labelMinZoom) &&
      (!overlaps || selected) &&
      !el.classList.contains('dimmed')
        ? ''
        : 'none'
    if (label.style.display !== 'none') occupied.push(bounds)
  }
  scheduleUenoTransferLines()
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
    label.textContent =
      p.id === 'inaricho'
        ? 'G17 稻荷町站'
        : uenoStation
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
    if (p.category === 'station' && showsStopOrder && p.id !== 'inaricho') {
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
      new maplibregl.Marker({ element: button, anchor: 'center' })
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
    uenoClusterMarker = new maplibregl.Marker({ element: button, anchor: 'center' })
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
    renderUenoTransfers()
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
    // Markers reposition in their own 'move' listeners; 'render' fires after them,
    // so reading the dots' screen positions here keeps the lines in step while panning.
    map.on('render', updateUenoTransferLines)
    map.on('zoomend', () => {
      if (map && map.getZoom() < UENO_SELECTED_ZOOM - 0.5 && uenoManuallyExpanded) {
        uenoManuallyExpanded = false
        updateMarkerLabels()
      }
    })
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
    resizeObserver = new ResizeObserver(() => {
      map?.resize()
      scheduleUenoTransferLines()
    })
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
  if (transferFrame !== undefined) cancelAnimationFrame(transferFrame)
  uenoTransferOverlay?.remove()
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
