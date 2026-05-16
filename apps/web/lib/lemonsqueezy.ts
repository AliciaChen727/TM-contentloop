import { lemonSqueezySetup } from '@lemonsqueezy/lemonsqueezy.js'

lemonSqueezySetup({ apiKey: process.env.LEMONSQUEEZY_API_KEY! })

export const LS_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID!
export const LS_PRO_VARIANT_ID = process.env.LEMONSQUEEZY_PRO_VARIANT_ID!
export const LS_WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET!
