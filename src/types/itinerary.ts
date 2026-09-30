import type { TripData } from '../schemas/tripSchemas'
export type { TripData }
export type Place = TripData['places'][number]
export type TripDay = TripData['days'][number]
export type ItineraryStop = TripData['stops'][number]
export type RouteSegment = TripData['segments'][number]
export type PlanningStatus = Place['status']
