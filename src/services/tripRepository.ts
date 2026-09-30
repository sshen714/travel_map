import trip from '../data/trip.json'
import days from '../data/days.json'
import places from '../data/places.json'
import stops from '../data/stops.json'
import segments from '../data/route-segments.json'
import lodgings from '../data/lodgings.json'
import { dataSchema } from '../schemas/tripSchemas'
const geoFiles = import.meta.glob('../data/geo/*.geojson', {
  query: '?raw',
  import: 'default',
  eager: true,
})
export class StaticTripRepository {
  private data = dataSchema.parse({
    trip,
    days,
    places,
    stops,
    segments,
    lodgings,
    geo: Object.values(geoFiles).map((raw) => JSON.parse(raw as string)),
  })
  async getAll() {
    return this.data
  }
  async getTrip() {
    return this.data.trip
  }
  async getDays() {
    return this.data.days
  }
  async getPlaces() {
    return this.data.places
  }
  async getStops() {
    return this.data.stops
  }
  async getRouteSegments() {
    return this.data.segments
  }
  async getLodgings() {
    return this.data.lodgings
  }
}
export const tripRepository = new StaticTripRepository()
