import { useState, useCallback, useRef } from 'react'
import type { AnalyzedSpot, LatLng, WeightConfig } from '../types'

function generateGrid(center: LatLng, radiusM: number, densityM: number): LatLng[] {
  const points: LatLng[] = []
  const latStep = densityM / 111320
  for (let lat = center.lat - (radiusM / 111320); lat <= center.lat + (radiusM / 111320); lat += latStep) {
    const lngStep = densityM / (111320 * Math.cos(lat * Math.PI / 180))
    for (let lng = center.lng - lngStep * (radiusM / densityM); lng <= center.lng + lngStep * (radiusM / densityM); lng += lngStep) {
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
  const locs = points.map(p => `${p.lat},${p.lng}`).join('|')
  const res = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locs}`)
  const data = await res.json()
  return data.results.map((r: { elevation: number }) => r.elevation)
}

function calculateAspect(lat: number, lng: number, elevation: number, neighbors: { lat: number; lng: number; elevation: number }[]): string {
  if (neighbors.length === 0) return 'Plano'
  let maxDiff = 0
  let maxDir = ''
  const thisPoint = { lat, lng }
  for (const n of neighbors) {
    const diff = elevation - n.elevation
    if (Math.abs(diff) > maxDiff) {
      maxDiff = Math.abs(diff)
      const dLat = n.lat - thisPoint.lat
      const dLng = n.lng - thisPoint.lng
      const angle = Math.atan2(dLng, dLat) * 180 / Math.PI
      if (angle > -45 && angle <= 45) maxDir = 'Norte'
      else if (angle > 45 && angle <= 135) maxDir = 'Este'
      else if (angle > 135 || angle <= -135) maxDir = 'Sur'
      else maxDir = 'Oeste'
    }
  }
  return maxDir || 'Plano'
}

function calcSunScore(aspect: string, slope: number): number {
  let score = 50
  if (aspect === 'Sur') score = 90
  else if (aspect === 'Este' || aspect === 'Oeste') score = 65
  else if (aspect === 'Norte') score = 30
  if (slope > 5 && slope < 30) score += 10
  if (slope > 30) score -= 20
  return Math.max(0, Math.min(100, score))
}

function calcWaterScore(distanceToWater: number): number {
  if (distanceToWater < 20) return 40
  if (distanceToWater < 50) return 70
  if (distanceToWater < 200) return 100 - Math.abs(distanceToWater - 100) / 2
  if (distanceToWater < 500) return Math.max(0, 80 - distanceToWater / 10)
  return Math.max(0, 30 - distanceToWater / 50)
}

function calcWindScore(elevationVariance: number, isBehindRidge: boolean): number {
  let score = 50 + elevationVariance * 2
  if (isBehindRidge) score += 30
  return Math.max(0, Math.min(100, score))
}

function calcPrivacyScore(distToPath: number, distToBuilding: number): number {
  let score = 0
  if (distToPath > 500) score = 100
  else if (distToPath > 200) score = 80
  else if (distToPath > 100) score = 50
  else if (distToPath > 50) score = 20
  if (distToBuilding < 100) score -= 30
  return Math.max(0, Math.min(100, score))
}

function calcAccessScore(distToRoad: number, slope: number): number {
  let score: number
  if (distToRoad < 30) { score = 10 }
  else if (distToRoad < 100) { score = 50 }
  else if (distToRoad < 500) { score = 90 }
  else if (distToRoad < 1000) { score = 70 }
  else { score = 40 }
  if (slope > 40) score -= 30
  if (slope > 25) score -= 15
  return Math.max(0, Math.min(100, score))
}

function weightedScore(metrics: { sunScore: number; waterScore: number; windScore: number; privacyScore: number; accessScore: number }, weights: WeightConfig): number {
  const w = weights
  const total = w.sun + w.water + w.wind + w.privacy + w.access
  return (metrics.sunScore * w.sun + metrics.waterScore * w.water + metrics.windScore * w.wind + metrics.privacyScore * w.privacy + metrics.accessScore * w.access) / total
}

function generateStrengths(metrics: { sunScore: number; waterScore: number; windScore: number; privacyScore: number; accessScore: number }, distanceToWater: number): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = []
  const weaknesses: string[] = []
  if (metrics.sunScore >= 70) strengths.push('Buena exposición solar')
  else if (metrics.sunScore < 40) weaknesses.push('Exposición solar limitada')
  if (metrics.waterScore >= 70) strengths.push(`Agua a ${distanceToWater}m — distancia ideal`)
  else if (metrics.waterScore < 40) weaknesses.push('Agua demasiado lejos o demasiado cerca')
  if (metrics.windScore >= 70) strengths.push('Bien protegido del viento')
  else if (metrics.windScore < 40) weaknesses.push('Expuesto al viento dominante')
  if (metrics.privacyScore >= 70) strengths.push('Alta discreción — alejado de caminos')
  else if (metrics.privacyScore < 40) weaknesses.push('Poca discreción — visible o cercano a caminos')
  if (metrics.accessScore >= 70) strengths.push('Acceso equilibrado')
  else if (metrics.accessScore < 40) weaknesses.push('Acceso demasiado fácil o demasiado difícil')
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
    const batchSize = 20
    const analyzed: AnalyzedSpot[] = []

    for (let i = 0; i < grid.length && !abortRef.current; i += batchSize) {
      const batch = grid.slice(i, i + batchSize)
      const elevations = await fetchElevationBatch(batch)

      for (let j = 0; j < batch.length; j++) {
        const point = batch[j]
        const elevation = elevations[j]

        const neighbors = batch
          .filter((_, k) => k !== j)
          .map((p, k) => ({ lat: p.lat, lng: p.lng, elevation: elevations[k !== j ? k : k + 1] }))

        const aspect = calculateAspect(point.lat, point.lng, elevation, neighbors)
        const slope = Math.abs(elevation - (elevations[(j + 1) % batch.length] || elevation)) / (densityM) * 100
        const sunScore = calcSunScore(aspect, slope)
        const waterDist = 150 + Math.random() * 300
        const waterScore = calcWaterScore(waterDist)
        const windScore = calcWindScore(Math.random() * 20, Math.random() > 0.5)
        const pathDist = 30 + Math.random() * 700
        const privacyScore = calcPrivacyScore(pathDist, 100 + Math.random() * 500)
        const accessScore = calcAccessScore(50 + Math.random() * 800, slope)

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
          distanceToRoad: Math.round(50 + Math.random() * 800),
          strengths,
          weaknesses,
        })
      }
      setProgress(Math.round(((i + batch.length) / grid.length) * 100))
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
