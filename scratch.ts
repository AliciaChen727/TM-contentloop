import { readFileSync } from 'fs'

const file = readFileSync('apps/web/app/api/ads/sync/route.ts', 'utf-8')
console.log(file.split('\n').slice(90, 95).join('\n'))
