<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight } from '@lucide/vue'
import { useTripStore } from '../stores/tripStore'
import DayTimeline from '../components/itinerary/DayTimeline.vue'
const store = useTripStore(),
  route = useRoute(),
  router = useRouter()
const shortDate = (date?: string) => (date ? date.replaceAll('-', '.') : '')
watch(
  () => [route.params.dayId, store.data] as const,
  () => {
    if (!store.data) return
    const id = Number(route.params.dayId)
    if (!store.data.days.some((d) => d.id === id)) {
      router.replace('/')
      return
    }
    if (store.selectedDayId !== id) store.selectDay(id)
  },
  { immediate: true },
)
</script>
<template>
  <div v-if="store.day">
    <div class="panel-heading">
      <RouterLink to="/" class="back-link" @click="store.selectDay('all')"
        ><ArrowLeft :size="14" /> 旅程總覽</RouterLink
      ><span class="eyebrow" :style="{ color: store.day.color }"
        >DAY {{ store.day.id }} · {{ shortDate(store.day.date) }} / {{ store.day.eyebrow }}</span
      >
      <div
        class="day-progress"
        :aria-label="`第 ${store.day.id} 天，共 ${store.data!.days.length} 天`"
      >
        <span
          v-for="day in store.data!.days"
          :key="day.id"
          :class="{ active: day.id === store.day!.id, complete: day.id < store.day!.id }"
          :style="{ '--progress-color': day.color }"
        />
        <small>{{ store.day.id }} / {{ store.data!.days.length }}</small>
      </div>
      <h1 class="day-title">{{ store.day.shortTitle }}</h1>
      <p>{{ store.day.summary }}</p>
      <div class="day-nav">
        <RouterLink v-if="store.day.id > 1" :to="`/day/${store.day.id - 1}`"
          ><ArrowLeft :size="14" /> 上一天</RouterLink
        ><RouterLink v-if="store.day.id < store.data!.days.length" :to="`/day/${store.day.id + 1}`"
          >下一天 <ArrowRight :size="14"
        /></RouterLink>
      </div>
    </div>
    <DayTimeline />
  </div>
</template>
