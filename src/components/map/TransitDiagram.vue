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

const store = useTripStore()
const viewBox = transitNetwork.viewBox.join(' ')
const stations = transitNetwork.stations as TransitStation[]
const scroller = ref<HTMLDivElement>()
const selectedStation = ref<TransitStation>()
const zoom = ref(1)
const baseSize = ref({ width: 1100, height: 720 })
const dragging = ref(false)
const mapSize = computed(() => ({
  width: Math.round(baseSize.value.width * zoom.value),
  height: Math.round(baseSize.value.height * zoom.value),
}))
const selectedStationId = computed(() => selectedStation.value?.id)
const selectedLines = computed(() =>
  transitNetwork.lines.filter((line) => selectedStation.value?.lines.includes(line.id)),
)
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
    transitNetwork.lines.some(
      (line) => station.lines.includes(line.id) && line.days.includes(selectedDay.value!),
    )
  )
}

function isSecondary(station: TransitStation) {
  return !station.journey
}

function updateBaseSize() {
  if (!scroller.value) return
  const width = scroller.value.clientWidth
  const height = scroller.value.clientHeight
  const minimumWidth = window.innerWidth < 760 ? 860 : 760
  const scale = Math.max(Math.min(width / 1100, height / 720), minimumWidth / 1100)
  baseSize.value = { width: Math.round(1100 * scale), height: Math.round(720 * scale) }
}

async function setZoom(next: number) {
  const el = scroller.value
  const oldSize = mapSize.value
  const centerX = el ? (el.scrollLeft + el.clientWidth / 2) / oldSize.width : 0.5
  const centerY = el ? (el.scrollTop + el.clientHeight / 2) / oldSize.height : 0.5
  zoom.value = Math.min(2.4, Math.max(1, Number(next.toFixed(2))))
  await nextTick()
  if (el) {
    el.scrollLeft = centerX * mapSize.value.width - el.clientWidth / 2
    el.scrollTop = centerY * mapSize.value.height - el.clientHeight / 2
  }
}

async function resetView() {
  await setZoom(1)
  scroller.value?.scrollTo({ left: 0, top: 0, behavior: 'smooth' })
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

onMounted(() => {
  updateBaseSize()
  if (scroller.value) {
    resizeObserver = new ResizeObserver(updateBaseSize)
    resizeObserver.observe(scroller.value)
  }
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
        :style="{ width: `${mapSize.width}px`, height: `${mapSize.height}px` }"
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
          <template v-for="line in transitNetwork.lines" :key="line.id">
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
        :disabled="zoom >= 2.4"
        @click="setZoom(zoom + 0.25)"
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
        :disabled="zoom <= 1"
        @click="setZoom(zoom - 0.25)"
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
      <span v-for="line in transitNetwork.lines" :key="line.id">
        <i :style="{ background: line.color }" />{{ line.shortName }}
      </span>
      <span class="transfer-key"><i class="transfer-symbol" />站內轉乘</span>
      <span class="transfer-key"><i class="walk-symbol" />步行轉乘</span>
    </div>
    <p class="transit-diagram-note">
      <Hand :size="14" /> 拖曳與縮放查看路網 · 125% 顯示次要站 · 點擊車站查看用途
    </p>
  </section>
</template>
