<script setup lang="ts">
import { computed, watch, nextTick, ref } from 'vue'
import { X, MapPin, ArrowUpRight, Ticket } from '@lucide/vue'
import { useTripStore } from '../../stores/tripStore'
import { categories, statusLabels } from '../../services/labels'
const store = useTripStore(),
  closeButton = ref<HTMLButtonElement>()
const place = computed(() => store.selectedPlace)
const navigation = computed(() =>
  place.value?.coordinates
    ? `https://www.google.com/maps/search/?api=1&query=${place.value.coordinates[1]},${place.value.coordinates[0]}`
    : null,
)
watch(
  () => place.value?.id,
  async () => {
    await nextTick()
    closeButton.value?.focus({ preventScroll: true })
  },
)
function close() {
  const id = store.selectedStopId
  store.selectedPlaceId = null
  nextTick(() => {
    if (id)
      (document.querySelector(`#stop-${id} button`) as HTMLButtonElement)?.focus({
        preventScroll: true,
      })
  })
}
</script>
<template>
  <section
    v-if="place"
    class="place-details"
    role="region"
    aria-labelledby="place-title"
    @keydown.esc="close"
  >
    <button
      ref="closeButton"
      class="icon-button close-detail"
      aria-label="關閉地點資訊"
      @click="close"
    >
      <X :size="18" />
    </button>
    <div class="eyebrow"><MapPin :size="14" /> {{ categories[place.category] }} · PLACE NOTES</div>
    <h2 id="place-title">{{ place.name }}</h2>
    <div class="detail-tags">
      <span :class="['status', place.status]">{{ statusLabels[place.status] }}</span
      ><span v-if="place.reservationRequired"><Ticket :size="14" /> 需預約</span>
    </div>
    <p v-if="place.address">{{ place.address }}</p>
    <p v-if="!place.coordinates" class="pending-location">位置待確認 · 暫不顯示地圖標記</p>
    <ul>
      <li v-for="note in place.notes" :key="note">{{ note }}</li>
    </ul>
    <p
      v-for="lodging in store.data?.lodgings.filter((l) => l.placeId === place!.id)"
      :key="lodging.id"
      class="small"
    >
      住宿規劃：Day {{ lodging.checkInDayId }} 入住 → Day {{ lodging.checkOutDayId }} 退房
    </p>
    <a
      v-if="navigation"
      :href="navigation"
      target="_blank"
      rel="noopener noreferrer"
      class="text-link"
      >在 Google Maps 開啟參考位置 <ArrowUpRight :size="15" /></a
    ><a
      v-for="link in place.externalLinks"
      :key="link.url"
      :href="link.url"
      target="_blank"
      rel="noopener noreferrer"
      class="text-link"
      >{{ link.label }} <ArrowUpRight :size="15"
    /></a>
  </section>
</template>
