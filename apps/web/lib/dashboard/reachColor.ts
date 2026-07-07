// Tiered colour for reach numbers in the content tables. Higher reach = warmer/
// more prominent colour so top posts pop at a glance. ≤500 stays default (black).
// >500 綠、>1000 藍、>5000 紫、>10000 紅。
export function reachColor(n: number): string | undefined {
  if (n > 10000) return '#DC2626'  // red
  if (n > 5000) return '#7C3AED'   // purple
  if (n > 1000) return '#2563EB'   // blue
  if (n > 500) return '#16A34A'    // green
  return undefined                 // ≤500 → default text colour (black)
}
