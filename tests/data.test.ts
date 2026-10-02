import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dataSchema } from '../src/schemas/tripSchemas'
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
function fixture() {
  return {
    trip: read('trip.json'),
    days: read('days.json'),
    places: read('places.json'),
    stops: read('stops.json'),
    segments: read('route-segments.json'),
    lodgings: read('lodgings.json'),
    geo: readdirSync(new URL('../src/data/geo/', import.meta.url)).map((f) => read(`geo/${f}`)),
  }
}
describe('trip integrity', () => {
  it('accepts the five-day itinerary and unmapped candidates', () => {
    const d = dataSchema.parse(fixture())
    expect(d.days).toHaveLength(5)
    expect(d.places.some((p) => p.coordinates === null)).toBe(true)
  })
  it('preserves the confirmed 2027 flight schedule', () => {
    const d = dataSchema.parse(fixture())
    expect([d.trip.startDate, d.trip.endDate]).toEqual(['2027-01-08', '2027-01-12'])
    expect(d.days.map((day) => day.date)).toEqual([
      '2027-01-08',
      '2027-01-09',
      '2027-01-10',
      '2027-01-11',
      '2027-01-12',
    ])
    expect(d.stops.find((stop) => stop.id === 'd1-1')).toMatchObject({
      startTime: '14:20',
      status: 'confirmed',
      notes: expect.arrayContaining([expect.stringContaining('JX802')]),
    })
    expect(d.stops.find((stop) => stop.id === 'd5-9')).toMatchObject({
      startTime: '15:40',
      status: 'confirmed',
      notes: expect.arrayContaining([expect.stringContaining('JX803')]),
    })
  })
  it('rejects duplicate identifiers', () => {
    const d = fixture()
    d.places.push(d.places[0])
    expect(dataSchema.safeParse(d).success).toBe(false)
  })
  it('rejects orphan stops and cross-day references', () => {
    const d = fixture()
    d.stops[0].placeId = 'missing'
    d.days[1].stopIds.push(d.stops[0].id)
    expect(dataSchema.safeParse(d).success).toBe(false)
  })
  it('rejects confirmed places without coordinates', () => {
    const d = fixture()
    d.places.find((p: any) => p.coordinates === null).status = 'confirmed'
    expect(dataSchema.safeParse(d).success).toBe(false)
  })
  it('rejects out-of-range coordinates', () => {
    const d = fixture()
    d.places[0].coordinates = [181, 91]
    expect(dataSchema.safeParse(d).success).toBe(false)
  })
  it('rejects missing route geometry', () => {
    const d = fixture()
    d.segments[0].geometryId = 'missing'
    expect(dataSchema.safeParse(d).success).toBe(false)
  })
  it('rejects geometry with mismatched endpoints', () => {
    const d = fixture()
    d.geo[0].features[0].geometry.coordinates[0] = [0, 0]
    expect(dataSchema.safeParse(d).success).toBe(false)
  })
  it('rejects reversed lodging dates', () => {
    const d = fixture()
    d.lodgings[0].checkOutDayId = 1
    expect(dataSchema.safeParse(d).success).toBe(false)
  })

  it('rejects a gap in trip dates', () => {
    const d = fixture()
    d.days[2].date = '2027-01-11'
    expect(dataSchema.safeParse(d).success).toBe(false)
  })

  it('keeps JR, Tokyo Metro and Keisei Ueno as separate stations', () => {
    const d = dataSchema.parse(fixture())
    const jrUeno = d.places.find((place) => place.id === 'ueno')
    const metroUeno = d.places.find((place) => place.id === 'metro-ueno')
    const keiseiUeno = d.places.find((place) => place.id === 'keisei-ueno')
    expect(jrUeno?.coordinates).not.toEqual(keiseiUeno?.coordinates)
    expect(jrUeno?.coordinates).not.toEqual(metroUeno?.coordinates)
    expect(metroUeno?.coordinates).not.toEqual(keiseiUeno?.coordinates)
    expect(d.segments.find((segment) => segment.id === 'route-1')?.toPlaceId).toBe('keisei-ueno')
    expect(d.segments.find((segment) => segment.id === 'route-3')).toMatchObject({
      fromPlaceId: 'keisei-ueno',
      toPlaceId: 'hotel-ueno',
      mode: 'walk',
    })
    expect(d.segments.find((segment) => segment.id === 'route-2')).toMatchObject({
      fromPlaceId: 'hotel-ueno',
      toPlaceId: 'inaricho',
      mode: 'walk',
    })
    expect(d.segments.find((segment) => segment.id === 'route-4')).toMatchObject({
      fromPlaceId: 'inaricho',
      toPlaceId: 'asakusa-station',
      mode: 'subway',
    })
    expect(d.stops.find((stop) => stop.id === 'd1-3')).toBeUndefined()
    expect(d.stops.find((stop) => stop.id === 'd1-6')?.placeId).toBe('inaricho')
    expect(
      read('transit-network.json').stations.find((station: any) => station.id === 'nippori'),
    ).not.toHaveProperty('journey')
  })

  it('keeps transit station notes linked to valid lines, places and trip days', () => {
    const trip = fixture()
    const network = read('transit-network.json')
    const lineIds = new Set(network.lines.map((line: any) => line.id))
    const placeIds = new Set(trip.places.map((place: any) => place.id))
    for (const line of network.lines) {
      expect(line.days.length).toBeGreaterThan(0)
      expect(line.days.every((dayId: number) => trip.trip.dayIds.includes(dayId))).toBe(true)
    }
    for (const station of network.stations) {
      expect(station.lines.length).toBeGreaterThan(0)
      expect(station.lines.every((lineId: string) => lineIds.has(lineId))).toBe(true)
      if (station.placeId) expect(placeIds.has(station.placeId)).toBe(true)
      if (station.journey)
        expect(
          station.journey.days.every((dayId: number) => trip.trip.dayIds.includes(dayId)),
        ).toBe(true)
    }
    expect(network.stations.find((station: any) => station.id === 'ueno').journey.reason).toContain(
      '交通樞紐',
    )
    expect(network.stations.find((station: any) => station.id === 'keisei-ueno')).toBeTruthy()
    expect(network.walkLinks).toHaveLength(2)
  })
})
