import type { StyleSpecification } from 'maplibre-gl'
export async function getMapStyle(mode: 'street' | 'custom'): Promise<StyleSpecification> {
  const endpoint =
    mode === 'street'
      ? import.meta.env.VITE_STREET_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty'
      : import.meta.env.VITE_CUSTOM_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron'
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('底圖服務暫時無法使用')
  const style = (await response.json()) as StyleSpecification
  if (mode === 'custom') {
    style.layers = style.layers.filter((l) => !/poi|housenumber|building|aeroway/.test(l.id))
    for (const layer of style.layers) {
      if (layer.type === 'background')
        layer.paint = { ...layer.paint, 'background-color': '#f7f7f2' }
      if (layer.type === 'fill' && /water/.test(layer.id))
        layer.paint = { ...layer.paint, 'fill-color': '#dcecf1' }
      if (layer.type === 'line' && /minor|service|path/.test(layer.id))
        layer.paint = { ...layer.paint, 'line-opacity': 0.25 }
    }
  }
  return style
}
