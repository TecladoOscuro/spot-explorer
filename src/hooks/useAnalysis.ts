import { useState, useCallback, useRef } from 'react'
import type { AnalyzedSpot, LatLng, WeightConfig } from '../types'

function generateGrid(center: LatLng, radiusM: number, densityM: number): LatLng[] {
  const points: LatLng[] = []
  const degPerM = 1 / 111320
  const latD = radiusM * degPerM
  const latStep = densityM * degPerM
  const cosLat = Math.cos((center.lat * Math.PI) / 180) || 1
  const lngD = latD / cosLat
  const lngStep = latStep / cosLat

  const lat0 = center.lat - latD
  const lng0 = center.lng - lngD

  for (let r = 0; r * latStep <= 2 * latD; r++) {
    const lat = lat0 + r * latStep
    for (let c = 0; c * lngStep <= 2 * lngD; c++) {
      const lng = lng0 + c * lngStep
      const dy = (lat - center.lat) * 111320
      const dx = (lng - center.lng) * 111320 * cosLat
      if (Math.sqrt(dx * dx + dy * dy) <= radiusM) {
        points.push({ lat, lng })
      }
    }
  }
  return points
}

async function fetchElevations(points: LatLng[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  let remaining = [...points]
  while (remaining.length > 0) {
    const batch = remaining.slice(0, 80)
    remaining = remaining.slice(80)
    const locs = batch.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|')
    try {
      const res = await fetch(
        `https://api.opentopodata.org/v1/srtm30m?locations=${locs}`,
        { signal: AbortSignal.timeout(8000) }
      )
      if (res.ok) {
        const data = await res.json()
        for (let i = 0; i < batch.length && i < (data.results || []).length; i++) {
          const el = data.results[i]?.elevation
          if (typeof el === 'number') {
            map.set(`${batch[i].lat.toFixed(6)},${batch[i].lng.toFixed(6)}`, el)
          }
        }
      }
    } catch { /* skip failed batch */ }
  }
  return map
}

interface GeoFeatures {
  waterNodes: { lat: number; lng: number }[]
  pathNodes: { lat: number; lng: number }[]
  roadNodes: { lat: number; lng: number }[]
}

function getBbox(center: LatLng, radiusM: number): string {
  const d = radiusM / 111320
  const cos = Math.cos((center.lat * Math.PI) / 180) || 1
  return `${(center.lng - d / cos).toFixed(5)},${(center.lat - d).toFixed(5)},${(center.lng + d / cos).toFixed(5)},${(center.lat + d).toFixed(5)}`
}

async function queryOverpass(osmQuery: string): Promise<{ lat: number; lng: number }[]> {
  const nodes: { lat: number; lng: number }[] = []
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: osmQuery,
      signal: AbortSignal.timeout(12000),
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
  } catch { /* offline or timeout */ }
  return nodes
}

async function fetchGeoFeatures(center: LatLng, radiusM: number): Promise<GeoFeatures> {
  const bbox = getBbox(center, radiusM * 1.5)
  const empty = { waterNodes: [] as { lat: number; lng: number }[], pathNodes: [] as { lat: number; lng: number }[], roadNodes: [] as { lat: number; lng: number }[] }

  const waterQ = `[out:json];(way["waterway"]( ${bbox});way["water"]( ${bbox});way["natural"~"water"]( ${bbox}););out geom;`
  const pathQ = `[out:json];(way["highway"~"path|track|footway|cycleway|bridleway|steps"]( ${bbox});way["highway"~"service|living_street|pedestrian"]( ${bbox}););out geom;`
  const roadQ = `[out:json];(way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified"]( ${bbox}););out geom;`

  try {
    const [water, paths, roads] = await Promise.all([
      queryOverpass(waterQ), queryOverpass(pathQ), queryOverpass(roadQ)
    ])
    return { waterNodes: water, pathNodes: paths, roadNodes: roads }
  } catch {
    return empty
  }
}

function elAt(elMap: Map<string, number>, p: LatLng): number {
  return elMap.get(`${p.lat.toFixed(6)},${p.lng.toFixed(6)}`) ?? 0
}

function fastNearestDist(
  pt: LatLng,
  nodes: { lat: number; lng: number }[],
  maxCheck: number = 800
): number {
  if (nodes.length === 0) return 9999
  const step = Math.max(1, Math.floor(nodes.length / maxCheck))
  let minD = Infinity
  for (let i = 0; i < nodes.length; i += step) {
    const n = nodes[i]
    const dLat = (n.lat - pt.lat) * 111320
    const dLng = (n.lng - pt.lng) * 111320 * Math.cos(pt.lat * Math.PI / 180)
    const d = Math.sqrt(dLat * dLat + dLng * dLng)
    if (d < minD) minD = d
  }
  return Math.round(minD)
}

function calcSun(aspect: string, slope: number): number {
  let s: number
  if (aspect.startsWith('Sur')) s = slope > 2 && slope < 30 ? 92 : 88
  else if (aspect.includes('Sur')) s = 78
  else if (aspect === 'Este' || aspect === 'Oeste') s = 65
  else if (aspect === 'Plano') s = 60
  else s = 30
  if (slope > 30 && slope < 40) s -= 15
  if (slope > 40) s -= 30
  return Math.max(0, Math.min(100, s))
}

function calcWater(d: number): number {
  if (d > 9000) return 0
  if (d < 15) return 20
  if (d < 40) return 45
  if (d < 120) return 70 + Math.round((120 - d) * 0.33)
  if (d < 300) return Math.max(0, 85 - Math.round((d - 120) * 0.2))
  if (d < 800) return Math.max(0, 40 - Math.round((d - 300) * 0.08))
  return 5
}

function calcWind(elevVar: number): number {
  if (elevVar > 35) return 88
  if (elevVar > 18) return 72
  if (elevVar > 7) return 50
  return 28
}

function calcPrivacy(d: number): number {
  if (d > 9000) return 100
  if (d > 1500) return 98
  if (d > 800) return 90
  if (d > 400) return 75
  if (d > 200) return 50
  if (d > 100) return 25
  if (d > 50) return 10
  if (d > 20) return 3
  return 0
}

function calcAccess(d: number, slope: number): number {
  let s: number
  if (d > 9000) s = 10
  else if (d < 20) s = 5
  else if (d < 60) s = 20
  else if (d < 200) s = 65
  else if (d < 600) s = 85
  else s = 50
  if (slope > 35) s -= 35
  else if (slope > 20) s -= 15
  return Math.max(0, Math.min(100, s))
}

function aspectStr(pt: LatLng, el: number, elMap: Map<string, number>, grid: LatLng[]): string {
  const neighbors = grid
    .filter(g => g.lat !== pt.lat || g.lng !== pt.lng)
    .slice(0, 8)
    .map(g => ({ p: g, el: elAt(elMap, g) }))
    .sort((a, b) => {
      const da = (a.p.lat - pt.lat) ** 2 + (a.p.lng - pt.lng) ** 2
      const db = (b.p.lat - pt.lat) ** 2 + (b.p.lng - pt.lng) ** 2
      return da - db
    })
  if (neighbors.length < 2) return 'Plano'
  const n = neighbors[0]
  if (Math.abs(el - n.el) < 1) return 'Plano'
  const da = n.p.lat - pt.lat
  const dl = n.p.lng - pt.lng
  const ang = Math.atan2(dl, da) * 180 / Math.PI
  const down = el > n.el
  if (ang > -22.5 && ang <= 22.5) return down ? 'Norte' : 'Sur'
  if (ang > 22.5 && ang <= 67.5) return down ? 'Noreste' : 'Suroeste'
  if (ang > 67.5 && ang <= 112.5) return down ? 'Este' : 'Oeste'
  if (ang > 112.5 && ang <= 157.5) return down ? 'Sureste' : 'Noroeste'
  if (ang > 157.5 || ang <= -157.5) return down ? 'Sur' : 'Norte'
  if (ang > -157.5 && ang <= -112.5) return down ? 'Suroeste' : 'Noreste'
  if (ang > -112.5 && ang <= -67.5) return down ? 'Oeste' : 'Este'
  return down ? 'Noroeste' : 'Sureste'
}

function slopeDeg(pt: LatLng, el: number, elMap: Map<string, number>, grid: LatLng[]): number {
  for (const g of grid) {
    if (g.lat === pt.lat && g.lng === pt.lng) continue
    const diff = Math.abs(el - elAt(elMap, g))
    if (diff > 0) {
      const d = Math.sqrt(
        ((g.lat - pt.lat) * 111320) ** 2 +
        ((g.lng - pt.lng) * 111320 * Math.cos(pt.lat * Math.PI / 180)) ** 2
      )
      if (d > 0) return Math.min(85, Math.round((diff / d) * 100))
    }
  }
  return 2
}

function strengthsWeaknesses(
  m: { sunScore: number; waterScore: number; windScore: number; privacyScore: number; accessScore: number },
  waterDist: number
) {
  const s: string[] = []
  const w: string[] = []
  if (m.privacyScore >= 80) s.push('Privacidad excelente')
  else if (m.privacyScore >= 55) s.push('Buena privacidad')
  else if (m.privacyScore < 10) w.push('Muy expuesto — cerca de caminos')
  else if (m.privacyScore < 30) w.push('Privacidad baja')
  if (m.sunScore >= 75) s.push('Sol óptimo')
  else if (m.sunScore < 35) w.push('Sol insuficiente')
  if (waterDist > 9000) w.push('Sin agua cercana')
  else if (m.waterScore >= 60) s.push(`Agua a ${waterDist}m`)
  else if (m.waterScore < 20) w.push(`Agua lejos (${waterDist}m)`)
  if (m.windScore >= 65) s.push('Protegido del viento')
  else if (m.windScore < 30) w.push('Expuesto al viento')
  if (m.accessScore >= 60) s.push('Buen acceso')
  else if (m.accessScore < 20) w.push('Acceso difícil o nulo')
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

    const grid = generateGrid(center, radiusM, densityM)
    setProgress(2)

    const [features, elMap] = await Promise.all([
      fetchGeoFeatures(center, radiusM),
      fetchElevations(grid),
    ])
    if (abortRef.current) { setIsAnalyzing(false); return }

    setWaterGeoJson(features.waterNodes)
    setProgress(20)

    const steps = grid.length
    const analyzed: AnalyzedSpot[] = []

    for (let i = 0; i < steps && !abortRef.current; i++) {
      const pt = grid[i]
      const el = elAt(elMap, pt)

      const asp = aspectStr(pt, el, elMap, grid)
      const slp = slopeDeg(pt, el, elMap, grid)

      const sunScore = calcSun(asp, slp)
      const waterDist = fastNearestDist(pt, features.waterNodes)
      const waterScore = calcWater(waterDist)
      const windScore = calcWind(Math.min(40, slp * 0.6 + (asp !== 'Plano' ? 8 : 0)))

      const pathDist = fastNearestDist(pt, features.pathNodes)
      const roadDist = fastNearestDist(pt, features.roadNodes)
      const privacyDist = Math.min(pathDist, roadDist)
      const privacyScore = calcPrivacy(privacyDist)
      const accessScore = calcAccess(roadDist, slp)

      const metrics = { sunScore, waterScore, windScore, privacyScore, accessScore }
      const totalW = weights.sun + weights.water + weights.wind + weights.privacy + weights.access
      const rawScore = (sunScore * weights.sun + waterScore * weights.water + windScore * weights.wind + privacyScore * weights.privacy + accessScore * weights.access) / totalW

      const { strengths, weaknesses } = strengthsWeaknesses(metrics, waterDist > 9000 ? 9999 : waterDist)

      analyzed.push({
        id: `${pt.lat.toFixed(6)},${pt.lng.toFixed(6)}`,
        lat: pt.lat, lng: pt.lng,
        score: Math.round(rawScore),
        metrics,
        elevation: Math.round(el),
        aspect: asp,
        slope: slp,
        distanceToWater: waterDist,
        distanceToPath: pathDist,
        distanceToRoad: roadDist,
        strengths, weaknesses,
      })
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
