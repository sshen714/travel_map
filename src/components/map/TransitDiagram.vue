<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowRight,
  CalendarDays,
  CircleHelp,
  Hand,
  Maximize2,
  Minus,
  Plus,
  Signpost,
  TrainFront,
  X,
} from '@lucide/vue'
import transitNetwork from '../../data/transit-network.json'
import { useTripStore } from '../../stores/tripStore'

type LabelPosition = 'top' | 'right' | 'bottom' | 'left'
interface JourneyNote {
  days: number[]
  reason: string
  toward: string
  tip: string
}
interface TransitStation {
  id: string
  name: string
  x: number
  y: number
  position: LabelPosition
  lines: string[]
  placeId?: string
  transfer?: boolean
  code?: string
  journey?: JourneyNote
}
interface WalkLink {
  id: string
  from: number[]
  to: number[]
  label: string
  days: number[]
}
interface TransitLineLabel {
  text: string
  x: number
  y: number
  width: number
}
interface TransitLine {
  id: string
  name: string
  shortName: string
  color: string
  path: string
  labels?: TransitLineLabel[]
  days: number[]
}

const store = useTripStore()
const viewBox = transitNetwork.viewBox.join(' ')
const stations = transitNetwork.stations as TransitStation[]
const lines = transitNetwork.lines as TransitLine[]
const scroller = ref<HTMLDivElement>()
const selectedStation = ref<TransitStation>()
const zoom = ref(1)
const baseSize = ref({ width: 1100, height: 720 })
const viewportSize = ref({ width: 0, height: 0 })
const dragging = ref(false)
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.25
const mapSize = computed(() => ({
  width: Math.round(baseSize.value.width * zoom.value),
  height: Math.round(baseSize.value.height * zoom.value),
}))
const mapStyle = computed(() => ({
  width: `${mapSize.value.width}px`,
  height: `${mapSize.value.height}px`,
  marginLeft: `${Math.max(0, (viewportSize.value.width - mapSize.value.width) / 2)}px`,
  marginTop: `${Math.max(0, (viewportSize.value.height - mapSize.value.height) / 2)}px`,
}))
const selectedStationId = computed(() => selectedStation.value?.id)
const selectedLines = computed(() =>
  lines.filter((line) => selectedStation.value?.lines.includes(line.id)),
)
const legendGroups = [
  { label: 'JR', lineIds: ['yamanote', 'chuo-sobu', 'yokosuka'] },
  { label: 'Metro', lineIds: ['ginza'] },
  { label: '京成', lineIds: ['skyliner', 'keisei'] },
  { label: '湘南・鎌倉', lineIds: ['shonan-monorail', 'enoden'] },
].map((group) => ({
  label: group.label,
  lines: group.lineIds.map((id) => lines.find((line) => line.id === id)!),
}))
const selectedDay = computed(() =>
  store.selectedDayId === 'all' ? undefined : store.selectedDayId,
)
const showSecondaryStations = computed(() => zoom.value >= 1.25)
const walkLinks = transitNetwork.walkLinks as WalkLink[]
let resizeObserver: ResizeObserver | undefined
let dragStart = { x: 0, y: 0, left: 0, top: 0 }

function label(station: TransitStation) {
  const offsets: Record<LabelPosition, { x: number; y: number; anchor: string }> = {
    top: { x: 0, y: -19, anchor: 'middle' },
    right: { x: 18, y: 5, anchor: 'start' },
    bottom: { x: 0, y: 27, anchor: 'middle' },
    left: { x: -18, y: 5, anchor: 'end' },
  }
  return offsets[station.position]
}

function lineIsActive(days: number[]) {
  return !selectedDay.value || days.includes(selectedDay.value)
}

function stationIsActive(station: TransitStation) {
  return (
    !selectedDay.value ||
    station.journey?.days.includes(selectedDay.value) ||
    lines.some((line) => station.lines.includes(line.id) && line.days.includes(selectedDay.value!))
  )
}

function pathEndpoints(path: string) {
  const tokens = path.match(/[MLHV]|-?\d+(?:\.\d+)?/g) || []
  const points: string[] = []
  let x = 0,
    y = 0
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++]
    if (command === 'M' || command === 'L') {
      x = Number(tokens[index++])
      y = Number(tokens[index++])
    } else if (command === 'H') x = Number(tokens[index++])
    else if (command === 'V') y = Number(tokens[index++])
    points.push(`${x},${y}`)
  }
  return [points[0], points.at(-1)]
}

const terminalPoints = new Set(lines.flatMap((line) => pathEndpoints(line.path)))

function isSecondary(station: TransitStation) {
  return !station.journey && !terminalPoints.has(`${station.x},${station.y}`)
}

function updateBaseSize() {
  if (!scroller.value) return
  const width = scroller.value.clientWidth
  const height = scroller.value.clientHeight
  viewportSize.value = { width, height }
  const minimumWidth = window.innerWidth < 760 ? 860 : 760
  const scale = Math.max(Math.min(width / 1100, height / 720), minimumWidth / 1100)
  baseSize.value = { width: Math.round(1100 * scale), height: Math.round(720 * scale) }
}

async function setZoom(next: number) {
  const el = scroller.value
  const oldSize = mapSize.value
  const oldOffsetX = el ? Math.max(0, (el.clientWidth - oldSize.width) / 2) : 0
  const oldOffsetY = el ? Math.max(0, (el.clientHeight - oldSize.height) / 2) : 0
  const centerX = el ? (el.scrollLeft + el.clientWidth / 2 - oldOffsetX) / oldSize.width : 0.5
  const centerY = el ? (el.scrollTop + el.clientHeight / 2 - oldOffsetY) / oldSize.height : 0.5
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(next.toFixed(2))))
  await nextTick()
  if (el) {
    const newOffsetX = Math.max(0, (el.clientWidth - mapSize.value.width) / 2)
    const newOffsetY = Math.max(0, (el.clientHeight - mapSize.value.height) / 2)
    el.scrollLeft = newOffsetX + centerX * mapSize.value.width - el.clientWidth / 2
    el.scrollTop = newOffsetY + centerY * mapSize.value.height - el.clientHeight / 2
  }
}

async function resetView() {
  await setZoom(1)
  scrollHome('smooth')
}

function scrollHome(behavior: ScrollBehavior = 'auto') {
  scroller.value?.scrollTo({
    left: window.innerWidth < 760 ? mapSize.value.width * 0.2 : 0,
    top: 0,
    behavior,
  })
}

function startDrag(event: PointerEvent) {
  if (event.button !== 0 || (event.target as Element).closest('.transit-station')) return
  const el = scroller.value
  if (!el) return
  dragging.value = true
  dragStart = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop }
  el.setPointerCapture(event.pointerId)
}

function moveDrag(event: PointerEvent) {
  if (!dragging.value || !scroller.value) return
  scroller.value.scrollLeft = dragStart.left - (event.clientX - dragStart.x)
  scroller.value.scrollTop = dragStart.top - (event.clientY - dragStart.y)
}

function stopDrag(event: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  scroller.value?.releasePointerCapture(event.pointerId)
}

function selectStation(station: TransitStation) {
  selectedStation.value = station
  store.selectedPlaceId = null
}

function openPlace() {
  const placeId = selectedStation.value?.placeId
  if (!placeId) return
  selectedStation.value = undefined
  store.selectPlace(placeId)
}

onMounted(async () => {
  updateBaseSize()
  if (scroller.value) {
    resizeObserver = new ResizeObserver(updateBaseSize)
    resizeObserver.observe(scroller.value)
  }
  await nextTick()
  scrollHome()
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <section class="transit-diagram" aria-labelledby="transit-diagram-title">
    <div
      ref="scroller"
      :class="['transit-diagram-scroll', { dragging }]"
      @pointerdown="startDrag"
      @pointermove="moveDrag"
      @pointerup="stopDrag"
      @pointercancel="stopDrag"
    >
      <svg
        class="transit-diagram-map"
        :viewBox="viewBox"
        :style="mapStyle"
        role="img"
        aria-labelledby="transit-diagram-title transit-diagram-description"
      >
        <title id="transit-diagram-title">{{ transitNetwork.title }}</title>
        <desc id="transit-diagram-description">
          顯示本次旅程會使用的東京、成田、鎌倉與江之島主要交通路線。
        </desc>
        <g class="transit-grid" aria-hidden="true">
          <path
            d="M 70 115 H 1030 M 70 245 H 1030 M 70 375 H 1030 M 70 505 H 1030 M 70 635 H 1030"
          />
          <path d="M 150 70 V 680 M 350 70 V 680 M 550 70 V 680 M 750 70 V 680 M 950 70 V 680" />
        </g>
        <g class="transit-walk-links" aria-hidden="true">
          <g v-for="link in walkLinks" :key="link.id" :class="{ dimmed: !lineIsActive(link.days) }">
            <line
              class="walk-link"
              :x1="link.from[0]"
              :y1="link.from[1]"
              :x2="link.to[0]"
              :y2="link.to[1]"
            />
            <text
              v-if="showSecondaryStations"
              class="walk-link-label"
              :x="(link.from[0] + link.to[0]) / 2"
              :y="(link.from[1] + link.to[1]) / 2 - 9"
              text-anchor="middle"
            >
              {{ link.label }}
            </text>
          </g>
        </g>
        <g aria-hidden="true">
          <template v-for="line in lines" :key="line.id">
            <path
              :class="['transit-line-halo', { dimmed: !lineIsActive(line.days) }]"
              :d="line.path"
            />
            <path
              :class="['transit-line', { dimmed: !lineIsActive(line.days) }]"
              :d="line.path"
              :stroke="line.color"
              :data-line="line.id"
            />
          </template>
        </g>
        <g class="transit-route-labels" aria-hidden="true">
          <template v-for="line in lines" :key="line.id">
            <g
              v-for="routeLabel in line.labels || []"
              :key="`${line.id}-${routeLabel.text}-${routeLabel.x}`"
              :class="['transit-route-label', { dimmed: !lineIsActive(line.days) }]"
              :transform="`translate(${routeLabel.x} ${routeLabel.y})`"
              :data-line="line.id"
            >
              <rect
                :x="-routeLabel.width / 2"
                y="-12"
                :width="routeLabel.width"
                height="24"
                rx="8"
                :stroke="line.color"
              />
              <text y="4" text-anchor="middle">{{ routeLabel.text }}</text>
            </g>
          </template>
        </g>
        <g class="transit-stations">
          <g
            v-for="station in stations"
            :key="station.id"
            v-show="showSecondaryStations || !isSecondary(station)"
            :class="['transit-station-group', { dimmed: !stationIsActive(station) }]"
            :transform="`translate(${station.x} ${station.y})`"
            :data-secondary="isSecondary(station)"
          >
            <g
              :class="[
                'transit-station',
                {
                  'is-transfer': station.transfer,
                  selected: selectedStationId === station.id,
                },
              ]"
              role="button"
              tabindex="0"
              :aria-label="`查看${station.name}交通資訊`"
              @click="selectStation(station)"
              @keydown.enter.prevent="selectStation(station)"
              @keydown.space.prevent="selectStation(station)"
            >
              <circle class="station-hit-area" r="20" />
              <circle v-if="station.transfer" class="station-transfer-ring" r="12" />
              <circle class="station-node" :r="station.code ? 10 : 7" />
              <text v-if="station.code" class="station-code" y="3.5">{{ station.code }}</text>
            </g>
            <text
              :class="['station-name', { selected: selectedStationId === station.id }]"
              :x="label(station).x"
              :y="label(station).y"
              :text-anchor="label(station).anchor"
            >
              {{ station.name }}
            </text>
          </g>
        </g>
      </svg>
    </div>

    <div class="transit-zoom-controls control" aria-label="交通圖縮放控制">
      <button
        class="icon-button"
        aria-label="放大交通圖"
        :disabled="zoom >= MAX_ZOOM"
        @click="setZoom(zoom + ZOOM_STEP)"
      >
        <Plus :size="18" />
      </button>
      <span>{{ Math.round(zoom * 100) }}%</span>
      <button class="icon-button" aria-label="重設交通圖縮放" @click="resetView">
        <Maximize2 :size="17" />
      </button>
      <button
        class="icon-button"
        aria-label="縮小交通圖"
        :disabled="zoom <= MIN_ZOOM"
        @click="setZoom(zoom - ZOOM_STEP)"
      >
        <Minus :size="18" />
      </button>
    </div>

    <aside
      v-if="selectedStation"
      class="transit-station-detail control"
      aria-labelledby="transit-station-title"
    >
      <button
        class="icon-button transit-detail-close"
        aria-label="關閉交通資訊"
        @click="selectedStation = undefined"
      >
        <X :size="17" />
      </button>
      <div class="eyebrow">
        <CalendarDays :size="14" />
        {{
          selectedStation.journey?.days.length
            ? `DAY ${selectedStation.journey.days.join(' · ')}`
            : '交通備案'
        }}
      </div>
      <h2 id="transit-station-title">{{ selectedStation.name }}</h2>
      <div class="transit-line-chips">
        <span v-for="line in selectedLines" :key="line.id">
          <i :style="{ background: line.color }" />{{ line.name }}
        </span>
      </div>
      <div class="transit-detail-block">
        <h3><CircleHelp :size="15" /> 為什麼在這裡搭？</h3>
        <p>{{ selectedStation.journey?.reason || '這個站點用來理解路線位置與轉乘關係。' }}</p>
      </div>
      <div v-if="selectedStation.journey" class="transit-detail-block">
        <h3><Signpost :size="15" /> 接著去哪裡？</h3>
        <p>{{ selectedStation.journey.toward }}</p>
      </div>
      <p v-if="selectedStation.journey" class="transit-tip">
        <TrainFront :size="14" /> {{ selectedStation.journey.tip }}
      </p>
      <button v-if="selectedStation.placeId" class="transit-place-link" @click="openPlace">
        查看地點、備註與導航 <ArrowRight :size="15" />
      </button>
    </aside>

    <div class="transit-diagram-legend">
      <div v-for="group in legendGroups" :key="group.label" class="transit-legend-group">
        <strong>{{ group.label }}</strong>
        <span v-for="line in group.lines" :key="line.id">
          <i :style="{ background: line.color }" />{{ line.shortName }}
        </span>
      </div>
      <div class="transit-legend-group transit-transfer-group">
        <strong>轉乘</strong>
        <span class="transfer-key"><i class="transfer-symbol" />站內</span>
        <span class="transfer-key"><i class="walk-symbol" />步行</span>
      </div>
    </div>
    <p class="transit-diagram-note">
      <Hand :size="14" /> 可縮放 50%–250% · 100% 為適合視窗 · 125% 顯示次要站
    </p>
  </section>
</template>
