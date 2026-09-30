import { z } from 'zod'
export const statusSchema = z.enum(['confirmed', 'tentative', 'optional', 'cancelled'])
const id = z.string().min(1),
  dayId = z.number().int().positive()
const coordinates = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
const notes = z.array(z.string()).optional()
const isoDate = z.iso.date()
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use HH:mm')
export const tripSchema = z.object({
  id,
  title: id,
  subtitle: z.string().optional(),
  timezone: z.literal('Asia/Tokyo'),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  dayIds: z.array(dayId),
  defaultViewport: z.object({ center: coordinates, zoom: z.number() }),
  notes,
})
export const daySchema = z.object({
  id: dayId,
  title: id,
  shortTitle: id,
  summary: z.string(),
  eyebrow: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  date: isoDate.optional(),
  stopIds: z.array(id),
  routeSegmentIds: z.array(id),
})
export const placeSchema = z
  .object({
    id,
    name: id,
    nameJa: z.string().optional(),
    category: z.enum([
      'attraction',
      'restaurant',
      'hotel',
      'airport',
      'station',
      'shopping',
      'area',
    ]),
    status: statusSchema,
    coordinates: coordinates.nullable(),
    address: z.string().optional(),
    dayIds: z.array(dayId),
    notes,
    reservationRequired: z.boolean().optional(),
    externalLinks: z
      .array(
        z.object({
          label: id,
          url: z
            .string()
            .url()
            .refine((v) => /^https?:/.test(v)),
        }),
      )
      .optional(),
  })
  .refine((p) => p.status !== 'confirmed' || p.coordinates !== null, {
    message: 'Confirmed places require coordinates',
  })
export const stopSchema = z.object({
  id,
  dayId,
  placeId: id,
  order: z.number().int().positive(),
  startTime: localTime.optional(),
  endTime: localTime.optional(),
  estimatedStayMinutes: z.number().nonnegative().optional(),
  status: statusSchema,
  notes,
})
export const segmentSchema = z.object({
  id,
  dayId,
  order: z.number().int().positive(),
  fromPlaceId: id,
  toPlaceId: id,
  mode: z.enum(['walk', 'subway', 'train', 'monorail', 'bus', 'flight']),
  lineName: z.string().optional(),
  layerId: z.enum(['daily', 'skyliner', 'subway', 'jr', 'enoden', 'monorail']),
  lineColor: z.string(),
  estimatedMinutes: z.number().nonnegative().optional(),
  status: statusSchema,
  geometryId: id.optional(),
  notes,
})
export const lodgingSchema = z.object({
  id,
  placeId: id.optional(),
  name: id,
  area: z.enum(['Ueno', 'Asakusa', 'Other']),
  status: statusSchema,
  checkInDayId: dayId,
  checkOutDayId: dayId,
  notes,
  bookingUrl: z.string().url().optional(),
})
export const geoSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      id: z.union([z.string(), z.number()]).optional(),
      properties: z.object({ id }),
      geometry: z.object({
        type: z.literal('LineString'),
        coordinates: z.array(coordinates).min(2),
      }),
    }),
  ),
})
export const dataSchema = z
  .object({
    trip: tripSchema,
    days: z.array(daySchema),
    places: z.array(placeSchema),
    stops: z.array(stopSchema),
    segments: z.array(segmentSchema),
    lodgings: z.array(lodgingSchema),
    geo: z.array(geoSchema),
  })
  .superRefine((data, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    for (const key of ['days', 'places', 'stops', 'segments', 'lodgings'] as const) {
      const ids = data[key].map((x) => x.id)
      if (new Set(ids).size !== ids.length) fail(`Duplicate IDs: ${key}`)
    }
    const days = new Set(data.days.map((d) => d.id)),
      places = new Set(data.places.map((p) => p.id))
    const geometryIds = data.geo.flatMap((g) => g.features.map((f) => f.properties.id))
    if (new Set(geometryIds).size !== geometryIds.length) fail('Duplicate geometry IDs')
    if (
      data.trip.dayIds.length !== days.size ||
      data.trip.dayIds.some((d) => !days.has(d)) ||
      new Set(data.trip.dayIds).size !== data.trip.dayIds.length
    )
      fail('Trip day references invalid')
    const orderedDays = [...data.days].sort((a, b) => a.id - b.id)
    if (
      data.trip.startDate &&
      data.trip.endDate &&
      (orderedDays[0]?.date !== data.trip.startDate ||
        orderedDays.at(-1)?.date !== data.trip.endDate)
    )
      fail('Trip dates must match the first and last day')
    for (let index = 1; index < orderedDays.length; index++) {
      const previous = orderedDays[index - 1]?.date
      const current = orderedDays[index]?.date
      if (previous && current) {
        const expected = new Date(`${previous}T00:00:00Z`)
        expected.setUTCDate(expected.getUTCDate() + 1)
        if (current !== expected.toISOString().slice(0, 10))
          fail(`Day dates must be consecutive: ${orderedDays[index].id}`)
      }
    }
    for (const day of data.days) {
      for (const [ids, items] of [
        [day.stopIds, data.stops],
        [day.routeSegmentIds, data.segments],
      ] as const) {
        if (new Set(ids).size !== ids.length) fail(`Duplicate references on day ${day.id}`)
        ids.forEach((id) => {
          if (!items.some((s) => s.id === id && s.dayId === day.id))
            fail(`Missing or mismatched reference: ${id}`)
        })
        const owned = items.filter((x) => x.dayId === day.id)
        if (owned.some((s) => !ids.includes(s.id))) fail(`Unlisted items on day ${day.id}`)
        if (new Set(owned.map((s) => s.order)).size !== owned.length)
          fail(`Duplicate order on day ${day.id}`)
      }
    }
    for (const p of data.places)
      if (p.dayIds.some((d) => !days.has(d))) fail(`Invalid place day: ${p.id}`)
    for (const s of data.stops) {
      if (!days.has(s.dayId) || !places.has(s.placeId)) fail(`Invalid stop: ${s.id}`)
      if (!data.places.find((p) => p.id === s.placeId)?.dayIds.includes(s.dayId))
        fail(`Place/day mismatch: ${s.id}`)
    }
    for (const s of data.segments) {
      if (!days.has(s.dayId) || !places.has(s.fromPlaceId) || !places.has(s.toPlaceId))
        fail(`Invalid segment: ${s.id}`)
      if (s.geometryId && !geometryIds.includes(s.geometryId)) fail(`Missing geometry: ${s.id}`)
      const f = data.geo.flatMap((g) => g.features).find((f) => f.properties.id === s.geometryId)
      if (f) {
        const c = f.geometry.coordinates
        const a = data.places.find((p) => p.id === s.fromPlaceId)?.coordinates,
          b = data.places.find((p) => p.id === s.toPlaceId)?.coordinates
        if (
          JSON.stringify(c[0]) !== JSON.stringify(a) ||
          JSON.stringify(c.at(-1)) !== JSON.stringify(b)
        )
          fail(`Geometry endpoints mismatch: ${s.id}`)
      }
    }
    for (const g of geometryIds)
      if (!data.segments.some((s) => s.geometryId === g)) fail(`Orphan geometry: ${g}`)
    for (const l of data.lodgings)
      if (
        (l.placeId && !places.has(l.placeId)) ||
        !days.has(l.checkInDayId) ||
        !days.has(l.checkOutDayId) ||
        l.checkOutDayId <= l.checkInDayId
      )
        fail(`Invalid lodging: ${l.id}`)
  })
export type TripData = z.infer<typeof dataSchema>
