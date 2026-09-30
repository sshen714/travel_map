import { readFileSync, readdirSync } from 'node:fs'
import { dataSchema } from '../src/schemas/tripSchemas'
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const result = dataSchema.parse({
  trip: read('trip.json'),
  days: read('days.json'),
  places: read('places.json'),
  stops: read('stops.json'),
  segments: read('route-segments.json'),
  lodgings: read('lodgings.json'),
  geo: readdirSync(new URL('../src/data/geo/', import.meta.url))
    .filter((f) => f.endsWith('.geojson'))
    .map((f) => read(`geo/${f}`)),
})
console.log(
  `Validated ${result.days.length} days, ${result.places.length} places, ${result.stops.length} stops and ${result.segments.length} routes.`,
)
