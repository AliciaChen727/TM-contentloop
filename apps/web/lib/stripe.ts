import Stripe from 'stripe'

// Singleton to avoid re-instantiation on every hot reload
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
})

export default stripe
