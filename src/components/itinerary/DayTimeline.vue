<script setup lang="ts">
import { nextTick, watch } from 'vue'
import { MapPin, ArrowUpRight, Ticket, TrainFront } from '@lucide/vue'
import { useTripStore } from '../../stores/tripStore'
import { categories, statusLabels, modeLabels } from '../../services/labels'
const store = useTripStore()
function selectSegment(id: string) {
  store.selectedSegmentId = id
  store.selectedPlaceId = null
}
watch(
  () => store.selectedStopId,
  async (id) => {
    await nextTick()
    if (id)
      document
        .getElementById(`stop-${id}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  },
)
</script>
<template>
  <div class="timeline">
    <div class="section-caption">
      <span>YOUR DAILY ITINERARY</span><span>{{ store.stops.length }} 個停留點</span>
    </div>
    <ol>
      <li v-for="stop in store.stops" :key="stop.id" :id="`stop-${stop.id}`">
        <template
          v-for="place in [store.data!.places.find((p) => p.id === stop.placeId)!]"
          :key="place.id"
          ><button
            class="stop-card"
            :class="{
              selected: store.selectedStopId === stop.id,
              cancelled: stop.status === 'cancelled',
            }"
            :aria-pressed="store.selectedStopId === stop.id"
            @click="store.selectPlace(place.id, stop.id)"
          >
            <span
              class="stop-order"
              :style="{ '--day-color': store.data!.days.find((d) => d.id === stop.dayId)?.color }"
              >{{ String(stop.order).padStart(2, '0') }}</span
            ><span class="stop-body"
              ><span class="stop-meta"
                >{{ categories[place.category] }}
                <span v-if="store.selectedDayId === 'all'"> · Day {{ stop.dayId }}</span></span
              ><strong>{{ place.name }}</strong
              ><span class="stop-tags"
                ><span :class="['status', stop.status]">{{ statusLabels[stop.status] }}</span
                ><span v-if="place.reservationRequired"><Ticket :size="12" /> 需預約</span
                ><span v-if="!place.coordinates">位置待確認</span></span
              ><small v-if="stop.startTime"
                >{{ stop.startTime
                }}<template v-if="stop.endTime"> – {{ stop.endTime }}</template> ·
                {{ stop.status === 'confirmed' ? '確認時間' : '規劃時間' }}</small
              ><small v-for="note in stop.notes" :key="note">{{ note }}</small></span
            ><ArrowUpRight :size="16" /></button
        ></template>
      </li>
    </ol>
    <section class="route-list">
      <h3><TrainFront :size="17" /> 當日交通</h3>
      <p class="muted small">連線為移動示意；班次、票價與轉乘請另查。</p>
      <button
        v-for="segment in store.data?.segments.filter(
          (s) => store.selectedDayId === 'all' || s.dayId === store.selectedDayId,
        )"
        :key="segment.id"
        class="segment"
        :class="{ selected: store.selectedSegmentId === segment.id }"
        @click="selectSegment(segment.id)"
      >
        <i :style="{ background: segment.lineColor }" /><span
          ><strong>{{ segment.lineName || modeLabels[segment.mode] }}</strong
          ><small
            >{{ store.data?.places.find((p) => p.id === segment.fromPlaceId)?.name }} →
            {{ store.data?.places.find((p) => p.id === segment.toPlaceId)?.name }}</small
          ><small
            >{{ statusLabels[segment.status]
            }}<template v-if="segment.estimatedMinutes">
              · 約 {{ segment.estimatedMinutes }} 分鐘（參考）</template
            ></small
          ></span
        ><MapPin :size="14" />
      </button>
    </section>
  </div>
</template>
