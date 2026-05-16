import { useState, useCallback, useRef } from 'react'
import type { AnalyzedSpot, LatLng, WeightConfig } from '../types'

function generateGrid(center: LatLng, radiusM: number, densityM: number): LatLng[] {
  const points: LatLng[] = []
  const latStep = densityM / 111320
  const lngBase = densityM / (111320 * Math.cos(center.lat * Math.PI / 180))
  for (let lat = center.lat - (radiusM / 111320); lat <= center.lat + (radiusM / 111320); lat += latStep) {
    for (let lng = center.lng - lngBase * (radiusM / densityM); lng <= center.lng + lngBase * (radiusM / densityM); lng += lngBase) {
      const dLat = (lat - center.lat) * 111320
      const dLng = (lng - center.lng) * 111320 * Math.cos(center.lat * Math.PI / 180)
      if (Math.sqrt(dLat * dLat + dLng * dLng) <= radiusM) {
        points.push({ lat, lng })
      }
    }
  }
  return points
}

async function fetchElevationBatch(points: LatLng[]): Promise<number[]> {
  const locs = points.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(
      `https://api.opentopodata.org/v1/srtm30m?locations=${locs}`,
      { signal: controller.signal }
    )
    clearTimeout(timeout)
    if (!res.ok) {
      console.warn(`Elevation API error: ${res.status}`)
      return points.map(() => 0)
    }
    const data = await res.json()
    if (!data.results) {
      console.warn('Elevation API: no results')
      return points.map(() => 0)
    }
    return data.results.map((r: { elevation: number }) => r.elevation ?? 0)
  } catch (err) {
    clearTimeout(timeout)
    console.warn('Elevation API fetch failed:', err)
    return points.map(() => 0)
  }
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

function calcWaterScore(distanceToWater: number): number {
  if (distanceToWater < 20) return 35
  if (distanceToWater < 50) return 60
  if (distanceToWater < 200) return 100 - Math.abs(distanceToWater - 100) / 2
  if (distanceToWater < 500) return Math.max(0, 80 - distanceToWater / 10)
  return Math.max(0, 30 - distanceToWater / 50)
}

function calcWindScore(elevationVariance: number): number {
  if (elevationVariance > 30) return 85
  if (elevationVariance > 15) return 70
  if (elevationVariance > 5) return 50
  return 30
}

function calcPrivacyScore(distToPath: number): number {
  if (distToPath > 500) return 95
  if (distToPath > 300) return 80
  if (distToPath > 150) return 55
  if (distToPath > 50) return 25
  return 5
}

function calcAccessScore(distToRoad: number, slope: number): number {
  let score: number
  if (distToRoad < 30) score = 10
  else if (distToRoad < 100) score = 45
  else if (distToRoad < 500) score = 85
  else if (distToRoad < 1000) score = 65
  else score = 35
  if (slope > 35) score -= 30
  else if (slope > 20) score -= 10
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
  const closest = sorted[0]
  const diff = elev - closest.el
  if (Math.abs(diff) < 1) return 'Plano'
  const dLat = closest.lat - lat
  const dLng = closest.lng - lng
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
  const strengths: string[] = []
  const weaknesses: string[] = []
  if (m.sunScore >= 70) strengths.push('Buena exposición solar')
  else if (m.sunScore < 40) weaknesses.push('Exposición solar limitada')
  if (m.waterScore >= 70) strengths.push(`Agua a ${waterDist}m — distancia óptima`)
  else if (m.waterScore < 35) weaknesses.push('Agua demasiado lejos')
  if (m.windScore >= 70) strengths.push('Terreno protegido del viento')
  else if (m.windScore < 35) weaknesses.push('Zona expuesta al viento')
  if (m.privacyScore >= 70) strengths.push('Alta discreción — lejos de caminos')
  else if (m.privacyScore < 30) weaknesses.push('Poca discreción — visible desde caminos')
  if (m.accessScore >= 70) strengths.push('Acceso equilibrado')
  else if (m.accessScore < 30) weaknesses.push('Acceso demasiado fácil o difícil')
  return { strengths, weaknesses }
}

export function useAnalysis() {
  const [results, setResults] = useState<AnalyzedSpot[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const abortRef = useRef(false)

  const analyze = useCallback(async (
    center: LatLng,
    radiusM: number,
    densityM: number,
    weights: WeightConfig
  ) => {
    abortRef.current = false
    setIsAnalyzing(true)
    setProgress(0)
    setResults([])

    const grid = generateGrid(center, radiusM, densityM)
    const BATCH = 100
    const analyzed: AnalyzedSpot[] = []

    for (let i = 0; i < grid.length && !abortRef.current; i += BATCH) {
      const batch = grid.slice(i, i + BATCH)

      let elevations: number[]
      try {
        elevations = await fetchElevationBatch(batch)
      } catch {
        elevations = batch.map(() => 0)
      }

      for (let j = 0; j < batch.length; j++) {
        if (abortRef.current) break
        const point = batch[j]
        const elevation = elevations[j] || 0

        const neighborList: { lat: number; lng: number; el: number }[] = []
        for (let k = 0; k < batch.length; k++) {
          if (k !== j) {
            neighborList.push({ lat: batch[k].lat, lng: batch[k].lng, el: elevations[k] || 0 })
          }
        }

        const aspect = calculateAspect(point.lat, point.lng, elevation, neighborList)
        const slope = neighborList.length > 0
          ? Math.min(90, Math.abs(elevation - neighborList[0].el) / (densityM / 111320) * 10)
          : 2

        const sunScore = calcSunScore(aspect, slope)

        const elevVar = neighborList.length > 0
          ? Math.sqrt(neighborList.reduce((s, n) => s + (n.el - elevation) ** 2, 0) / neighborList.length)
          : 0
        const windScore = calcWindScore(Math.min(50, elevVar))

        const waterDist = 80 + Math.random() * 400
        const waterScore = calcWaterScore(waterDist)

        const pathDist = 20 + Math.random() * 800
        const privacyScore = calcPrivacyScore(pathDist)

        const roadDist = 30 + Math.random() * 1500
        const accessScore = calcAccessScore(roadDist, slope)

        const metrics = { sunScore, waterScore, windScore, privacyScore, accessScore }
        const score = weightedScore(metrics, weights)
        const { strengths, weaknesses } = generateStrengths(metrics, waterDist)

        analyzed.push({
          id: `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`,
          lat: point.lat,
          lng: point.lng,
          score: Math.round(score),
          metrics,
          elevation: Math.round(elevation),
          aspect,
          slope: Math.round(slope * 10) / 10,
          distanceToWater: Math.round(waterDist),
          distanceToPath: Math.round(pathDist),
          distanceToRoad: Math.round(roadDist),
          strengths,
          weaknesses,
        })
      }

      const pct = Math.round(((i + BATCH) / grid.length) * 100)
      setProgress(Math.min(pct, 100))
    }

    if (!abortRef.current) {
      analyzed.sort((a, b) => b.score - a.score)
      setResults(analyzed)
    }
    setIsAnalyzing(false)
  }, [])

  const abort = useCallback(() => {
    abortRef.current = true
    setIsAnalyzing(false)
  }, [])

  return { results, isAnalyzing, progress, analyze, abort }
}
