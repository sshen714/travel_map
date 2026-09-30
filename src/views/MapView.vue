<script setup lang="ts">
import { useTripStore } from '../stores/tripStore'
import DayTimeline from '../components/itinerary/DayTimeline.vue'
const store = useTripStore()
</script>
<template>
  <div class="panel-heading">
    <span class="eyebrow">EXPLORE THE JOURNEY</span>
    <h2>{{ store.day?.title || '所有停留點' }}</h2>
    <p>選取地點，在地圖上探索旅程。</p>
  </div>
  <DayTimeline />
</template>
