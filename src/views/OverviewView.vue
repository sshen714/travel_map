<script setup lang="ts">
import { ArrowUpRight, MapPin, MoveRight, CalendarDays } from '@lucide/vue'
import { useTripStore } from '../stores/tripStore'
import DayTimeline from '../components/itinerary/DayTimeline.vue'
const store = useTripStore()
const shortDate = (date?: string) => (date ? date.replaceAll('-', '.') : '')
</script>
<template>
  <div class="overview">
    <template v-if="store.day"
      ><div class="panel-heading">
        <span class="eyebrow" :style="{ color: store.day.color }"
          >DAY {{ store.day.id }} · {{ shortDate(store.day.date) }} / {{ store.day.eyebrow }}</span
        >
        <h2>{{ store.day.shortTitle }}</h2>
        <p>{{ store.day.summary }}</p>
        <RouterLink class="text-link" :to="`/day/${store.day.id}`"
          >開啟每日行程 <ArrowUpRight :size="15"
        /></RouterLink>
      </div>
      <DayTimeline /></template
    ><template v-else
      ><div class="panel-heading">
        <div class="hero-topline">
          <div class="eyebrow">A LITTLE ESCAPE TO JAPAN</div>
          <span class="year-badge">{{ store.data?.trip.startDate?.slice(0, 4) }}</span>
        </div>
        <h1>東京慢遊<span>沿途，都是風景。</span></h1>
        <p>{{ store.data?.trip.subtitle }}<br />從東京的街角，到鎌倉的海邊。</p>
        <div class="trip-stats">
          <span><CalendarDays :size="15" /> 2027.01.08–01.12</span
          ><span><MapPin :size="15" /> 東京 ＋ 鎌倉</span><span class="planning-dot">規劃中</span>
        </div>
      </div>
      <div class="section-caption"><span>THE FIVE-DAY JOURNEY</span><span>旅程總覽</span></div>
      <div class="day-cards">
        <button
          v-for="day in store.data?.days"
          :key="day.id"
          class="day-card"
          :style="{ '--day-color': day.color }"
          @click="store.selectDay(day.id)"
        >
          <span class="day-number">0{{ day.id }}</span
          ><span class="day-card-copy"
            ><span class="eyebrow"
              >DAY {{ day.id }} · {{ shortDate(day.date) }} ·
              {{ day.eyebrow.split(' / ')[0] }}</span
            ><strong>{{ day.title }}</strong
            ><small
              >{{ day.shortTitle }} <span>· {{ day.stopIds.length }} 個停留點</span></small
            ></span
          ><MoveRight :size="18" />
        </button>
      </div>
      <section class="planning-note">
        <span class="note-icon">✳</span>
        <div>
          <h3>讓旅程保留一點彈性</h3>
          <p>往返航班與住宿位置已確認。虛線標記是暫定或可選地點，餐廳預約與交通請於出發前確認。</p>
        </div>
      </section>
      <div class="panel-footer">
        TOKYO, AT YOUR OWN PACE.<span>35°40′ N　139°45′ E</span>
      </div></template
    >
  </div>
</template>
