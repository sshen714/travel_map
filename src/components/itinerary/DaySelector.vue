<script setup lang="ts">
import { useTripStore } from '../../stores/tripStore'
import { useRoute, useRouter } from 'vue-router'
const store = useTripStore(),
  route = useRoute(),
  router = useRouter()
function select(id: number | 'all') {
  store.selectDay(id)
  if (route.path.startsWith('/day/')) router.push(id === 'all' ? '/' : `/day/${id}`)
}
const shortDate = (date?: string) => (date ? date.slice(5).replace('-', '/') : '')
</script>
<template>
  <nav class="day-selector" aria-label="選擇旅程日期">
    <button
      :class="{ active: store.selectedDayId === 'all' }"
      :aria-pressed="store.selectedDayId === 'all'"
      @click="select('all')"
    >
      全部旅程</button
    ><button
      v-for="day in store.data?.days"
      :key="day.id"
      :aria-label="`Day ${day.id} ${day.title}`"
      :style="{ '--day-color': day.color }"
      :class="{ active: store.selectedDayId === day.id }"
      :aria-pressed="store.selectedDayId === day.id"
      @click="select(day.id)"
    >
      <i />Day {{ day.id }}<span>{{ shortDate(day.date) }} · {{ day.title.split('・')[0] }}</span>
    </button>
  </nav>
</template>
