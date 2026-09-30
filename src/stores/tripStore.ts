import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { TripData, Place } from '../types/itinerary'
import { tripRepository } from '../services/tripRepository'
import { layerLabels } from '../services/labels'
export const useTripStore = defineStore('trip', () => {
  const data = ref<TripData | null>(null),
    error = ref('')
  const selectedDayId = ref<number | 'all'>('all'),
    selectedPlaceId = ref<string | null>(null),
    selectedStopId = ref<string | null>(null),
    selectedSegmentId = ref<string | null>(null)
  const mapMode = ref<'street' | 'custom' | 'transit'>('custom'),
    visibleLayerIds = ref<string[]>(Object.keys(layerLabels)),
    panelOpen = ref(false),
    fitRequest = ref(0)
  const day = computed(() => data.value?.days.find((d) => d.id === selectedDayId.value))
  const selectedPlace = computed(() =>
    data.value?.places.find((p) => p.id === selectedPlaceId.value),
  )
  const stops = computed(
    () =>
      data.value?.stops
        .filter((s) => selectedDayId.value === 'all' || s.dayId === selectedDayId.value)
        .sort((a, b) => a.dayId - b.dayId || a.order - b.order) || [],
  )
  function placeVisible(p: Place) {
    return (
      p.status !== 'cancelled' &&
      visibleLayerIds.value.includes(p.category) &&
      (p.status === 'confirmed' || visibleLayerIds.value.includes('candidates'))
    )
  }
  const visiblePlaces = computed(() => data.value?.places.filter(placeVisible) || [])
  const focusedPlaces = computed(() =>
    visiblePlaces.value.filter(
      (p) => selectedDayId.value === 'all' || p.dayIds.includes(selectedDayId.value),
    ),
  )
  const visibleSegments = computed(
    () =>
      data.value?.segments.filter(
        (s) =>
          s.status !== 'cancelled' &&
          visibleLayerIds.value.includes(s.layerId) &&
          (s.status !== 'optional' || visibleLayerIds.value.includes('candidates')),
      ) || [],
  )
  async function load() {
    try {
      data.value = await tripRepository.getAll()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '無法載入行程'
    }
  }
  function selectDay(id: number | 'all') {
    selectedDayId.value = id
    selectedPlaceId.value = null
    selectedStopId.value = null
    selectedSegmentId.value = null
    fitRequest.value++
  }
  function selectPlace(id: string, stopId?: string) {
    selectedPlaceId.value = id
    selectedSegmentId.value = null
    selectedStopId.value = stopId || stops.value.find((s) => s.placeId === id)?.id || null
    panelOpen.value = true
  }
  function toggleLayer(id: string) {
    visibleLayerIds.value = visibleLayerIds.value.includes(id)
      ? visibleLayerIds.value.filter((x) => x !== id)
      : [...visibleLayerIds.value, id]
    fitRequest.value++
  }
  return {
    data,
    error,
    load,
    selectedDayId,
    selectedPlaceId,
    selectedStopId,
    selectedSegmentId,
    mapMode,
    visibleLayerIds,
    panelOpen,
    fitRequest,
    day,
    selectedPlace,
    stops,
    visiblePlaces,
    focusedPlaces,
    visibleSegments,
    selectDay,
    selectPlace,
    toggleLayer,
  }
})
