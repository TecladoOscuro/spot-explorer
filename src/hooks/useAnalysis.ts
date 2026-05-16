import { useState, useCallback, useRef } from 'react'
import type { AnalyzedSpot, LatLng, WeightConfig } from '../types'

interface GeoFeatures {
  waterNodes: { lat: number; lng: number }[]
  pathNodes: { lat: number; lng: number }[]
  roadNodes: { lat: number; lng: number }[]
}

function generateGrid(center: LatLng, radiusM: number, densityM: number): LatLng[] {
  const points: LatLng[] = []
  const latStep = densityM / 111320
  const lngBase = densityM / (111320 * Math.cos(center.lat * Math.PI / 180))
  for (let lat = center.lat - radiusM / 111320; lat <= center.lat + radiusM / 111320; lat += latStep) {
    for (let lng = center.lng - lngBase * (radiusM / densityM); lng <= center.lng + lngBase * (radiusM / densityM); lng += lngBase) {
      const dLat = (lat - center.lat) * 111320
      const dLng = (lng - center.lng) * 111320 * Math.cos(center.lat * Math.PI / 180)
      if (Math.sqrt(dLat * dLat + dLng * dLng) <= radiusM) points.push({ lat, lng })
    }
  }
  return points
}

function getBbox(center: LatLng, radiusM: number): string {
  const dLat = radiusM / 111320
  const dLng = radiusM / (111320 * Math.cos(center.lat * Math.PI / 180))
  return `${center.lng - dLng},${center.lat - dLat},${center.lng + dLng},${center.lat + dLat}`
}

async function fetchGeoFeatures(center: LatLng, radiusM: number): Promise<GeoFeatures> {
  const bbox = getBbox(center, radiusM * 1.3)

  const waterQuery = `[out:json];(way["waterway"]( ${bbox});way["water"]( ${bbox});way["natural"~"water|bay"]( ${bbox}););out geom;`
  const pathQuery = `[out:json];(way["highway"~"path|track|footway|cycleway|bridleway|steps"]( ${bbox}););out geom;`
  const roadQuery = `[out:json];(way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified"]( ${bbox}););out geom;`

  async function queryOverpass(q: string): Promise<{ lat: number; lng: number }[]> {
    const nodes: { lat: number; lng: number }[] = []
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: q,
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return nodes
      const data = await res.json()
      for (const el of data.elements || []) {
        if (el.geometry) {
          for (const pt of el.geometry) {
            nodes.push({ lat: pt.lat, lng: pt.lon })
          }
        }
      }
    } catch { /* ignore */ }
    return nodes
  }

  const [waterNodes, pathNodes, roadNodes] = await Promise.all([
    queryOverpass(waterQuery),
    queryOverpass(pathQuery),
    queryOverpass(roadQuery),
  ])

  return { waterNodes, pathNodes, roadNodes }
}

async function fetchElevationBatch(points: LatLng[]): Promise<number[]> {
  const locs = points.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|')
  try {
    const res = await fetch(
      `https://api.opentopodata.org/v1/srtm30m?locations=${locs}`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) return points.map(() => 0)
    const data = await res.json()
    if (!data.results) return points.map(() => 0)
    return data.results.map((r: { elevation: number }) => r.elevation ?? 0)
  } catch {
    return points.map(() => 0)
  }
}

function distKm(a: LatLng, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function nearestDist(point: LatLng, nodes: { lat: number; lng: number }[]): number {
  if (nodes.length === 0) return 9999
  let min = Infinity
  for (let i = 0; i < nodes.length; i++) {
    const d = distKm(point, nodes[i])
    if (d < min) min = d
  }
  return Math.round(min * 1000)
}

function calcSunScore(aspect: string, slope: number): number {
  let score = 50
  if (aspect === 'Sur') score = 90
  else if (aspect === 'Sureste' || aspect === 'Suroeste') score = 80
  else if (aspect === 'Este' || aspect === 'Oeste') score = 65
  else if (aspect === 'Norte') score = 30
  if (slope > 3 && slope < 25) score += 8
  if (slope > 25 && slope < 35) score -= 10
  if (slope > 35) score -= 25
  return Math.max(0, Math.min(100, score))
}

function calcWaterScore(distM: number): number {
  if (distM > 9998) return 5
  if (distM < 20) return 30
  if (distM < 50) return 55
  if (distM < 200) return 100 - Math.abs(distM - 100) / 2
  if (distM < 500) return Math.max(0, 80 - distM / 10)
  return Math.max(0, 25 - distM / 60)
}

function calcWindScore(elevVar: number): number {
  if (elevVar > 40) return 90
  if (elevVar > 20) return 75
  if (elevVar > 8) return 55
  return 30
}

function calcPrivacyScore(distToAnyPath: number): number {
  if (distToAnyPath > 2000) return 100
  if (distToAnyPath > 800) return 90
  if (distToAnyPath > 400) return 75
  if (distToAnyPath > 150) return 50
  if (distToAnyPath > 60) return 25
  return 5
}

function calcAccessScore(distToRoad: number, slope: number): number {
  let score: number
  if (distToRoad > 9998) score = 20
  else if (distToRoad < 30) score = 5
  else if (distToRoad < 100) score = 40
  else if (distToRoad < 500) score = 85
  else if (distToRoad < 1000) score = 60
  else score = 30
  if (slope > 35) score -= 35
  else if (slope > 20) score -= 12
  if (distToRoad > 2000) score -= 10
  return Math.max(0, Math.min(100, score))
}

function weightedScore(
  m: { sunScore: number; waterScore: number; windScore: number; privacyScore: number; accessScore: number },
  weights: WeightConfig
): number {
  const total = weights.sun + weights.water + weights.wind + weights.privacy + weights.access
  return (m.sunScore * weights.sun + m.waterScore * weights.water +
    m.windScore * weights.wind + m.privacyScore * weights.privacy +
    m.accessScore * weights.access) / total
}

function calculateAspect(lat: number, lng: number, elev: number, neighbors: { lat: number; lng: number; el: number }[]): string {
  if (neighbors.length < 2) return 'Plano'
  const sorted = [...neighbors].sort((a, b) => {
    const da = (a.lat - lat) ** 2 + (a.lng - lng) ** 2
    const db = (b.lat - lat) ** 2 + (b.lng - lng) ** 2
    return da - db
  })
  const diff = elev - sorted[0].el
  if (Math.abs(diff) < 1) return 'Plano'
  const dLat = sorted[0].lat - lat
  const dLng = sorted[0].lng - lng
  const angle = Math.atan2(dLng, dLat) * 180 / Math.PI
  if (angle > -22.5 && angle <= 22.5) return diff > 0 ? 'Norte' : 'Sur'
  if (angle > 22.5 && angle <= 67.5) return diff > 0 ? 'Noreste' : 'Suroeste'
  if (angle > 67.5 && angle <= 112.5) return diff > 0 ? 'Este' : 'Oeste'
  if (angle > 112.5 && angle <= 157.5) return diff > 0 ? 'Sureste' : 'Noroeste'
  if (angle > 157.5 || angle <= -157.5) return diff > 0 ? 'Sur' : 'Norte'
  if (angle > -157.5 && angle <= -112.5) return diff > 0 ? 'Suroeste' : 'Noreste'
  if (angle > -112.5 && angle <= -67.5) return diff > 0 ? 'Oeste' : 'Este'
  return diff > 0 ? 'Noroeste' : 'Sureste'
}

function generateStrengths(
  m: { sunScore: number; waterScore: number; windScore: number; privacyScore: number; accessScore: number },
  waterDist: number
): { strengths: string[]; weaknesses: string[] } {
  const s: string[] = []
  const w: string[] = []
  if (m.sunScore >= 70) s.push('Buena exposición solar')
  else if (m.sunScore < 35) w.push('Sol escaso — demasiada sombra')
  if (waterDist === 9999) w.push('Sin agua cercana detectada')
  else if (m.waterScore >= 70) s.push(`Agua a ${waterDist}m — distancia ideal`)
  else if (m.waterScore < 30) w.push(`Agua a ${waterDist}m — demasiado lejos`)
  if (m.windScore >= 70) s.push('Bien protegido del viento')
  else if (m.windScore < 30) w.push('Zona expuesta al viento')
  if (m.privacyScore >= 70) s.push('Alta discreción — lejos de caminos')
  else if (m.privacyScore < 25) w.push('Poca discreción — visible o cercano')
  if (m.accessScore >= 70) s.push('Acceso equilibrado')
  else if (m.accessScore < 25) w.push('Acceso demasiado fácil o muy difícil')
  return { strengths: s, weaknesses: w }
}

export function useAnalysis() {
  const [results, setResults] = useState<AnalyzedSpot[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [waterGeoJson, setWaterGeoJson] = useState<{ lat: number; lng: number }[]>([])
  const abortRef = useRef(false)

  const analyze = useCallback(async (
    center: LatLng, radiusM: number, densityM: number, weights: WeightConfig
  ) => {
    abortRef.current = false
    setIsAnalyzing(true)
    setProgress(0)
    setResults([])
    setWaterGeoJson([])

    setProgress(1)

    let features: GeoFeatures = { waterNodes: [], pathNodes: [], roadNodes: [] }
    try {
      features = await fetchGeoFeatures(center, radiusM)
    } catch { /* continue without features */ }

    setWaterGeoJson(features.waterNodes)
    setProgress(5)

    const grid = generateGrid(center, radiusM, densityM)
    const BATCH = 100
    const analyzed: AnalyzedSpot[] = []

    for (let i = 0; i < grid.length && !abortRef.current; i += BATCH) {
      const batch = grid.slice(i, i + BATCH)
      const elevations = await fetchElevationBatch(batch).catch(() => batch.map(() => 0))

      for (let j = 0; j < batch.length && !abortRef.current; j++) {
        const pt = batch[j]
        const el = elevations[j] || 0

        const neighbors: { lat: number; lng: number; el: number }[] = []
        for (let k = 0; k < batch.length; k++) {
          if (k !== j) neighbors.push({ lat: batch[k].lat, lng: batch[k].lng, el: elevations[k] || 0 })
        }

        const aspect = calculateAspect(pt.lat, pt.lng, el, neighbors)
        const slope = neighbors.length > 0
          ? Math.min(85, Math.abs(el - neighbors[0].el) / (densityM / 111320) * 10)
          : 2

        const sunScore = calcSunScore(aspect, slope)

        const elevVar = neighbors.length > 0
          ? Math.sqrt(neighbors.reduce((s, n) => s + (n.el - el) ** 2, 0) / neighbors.length)
          : 0
        const windScore = calcWindScore(Math.min(50, elevVar))

        const waterDist = nearestDist(pt, features.waterNodes)
        const waterScore = calcWaterScore(waterDist)

        const allPathNodes = [...features.pathNodes, ...features.roadNodes]
        const pathDist = nearestDist(pt, features.pathNodes)
        const roadDist = nearestDist(pt, features.roadNodes)
        const privacyDist = nearestDist(pt, allPathNodes)
        const privacyScore = calcPrivacyScore(privacyDist)

        const accessScore = calcAccessScore(roadDist, slope)

        const metrics = { sunScore, waterScore, windScore, privacyScore, accessScore }
        const score = weightedScore(metrics, weights)
        const { strengths, weaknesses } = generateStrengths(metrics, waterDist === 9999 ? 9999 : waterDist)

        analyzed.push({
          id: `${pt.lat.toFixed(6)},${pt.lng.toFixed(6)}`,
          lat: pt.lat, lng: pt.lng,
          score: Math.round(score),
          metrics,
          elevation: Math.round(el),
          aspect,
          slope: Math.round(slope),
          distanceToWater: waterDist,
          distanceToPath: pathDist,
          distanceToRoad: roadDist,
          strengths, weaknesses,
        })
      }

      const pct = 5 + Math.round(((i + BATCH) / grid.length) * 90)
      setProgress(Math.min(pct, 95))
    }

    if (!abortRef.current) {
      analyzed.sort((a, b) => b.score - a.score)
      setResults(analyzed)
      setProgress(100)
    }
    setIsAnalyzing(false)
  }, [])

  const abort = useCallback(() => {
    abortRef.current = true
    setIsAnalyzing(false)
  }, [])

  return { results, isAnalyzing, progress, analyze, abort, waterGeoJson }
}
