import type { Register } from 'claude-code'

// Same limits and same rule as statusline/statusline.sh (CC_BARS_CONTEXT_YELLOW / _RED):
//   pct <  YELLOW -> green
//   pct <  RED    -> yellow
//   pct >= RED    -> red + "compact" warning
// Keep these two numbers in sync with the terminal status line defaults (30 / 40).
const YELLOW = 30
const RED = 40
const WIDTH = 10

const COLORS = { green: '#3fb950', yellow: '#d29922', red: '#f85149' } as const

const band = (pct: number) =>
  pct >= RED ? COLORS.red : pct >= YELLOW ? COLORS.yellow : COLORS.green

// Half-block bar, as in the terminal status line.
const bar = (pct: number) => {
  const half = Math.round((Math.min(100, Math.max(0, pct)) / 100) * WIDTH * 2)
  const full = Math.floor(half / 2)
  const h = half % 2
  return '█'.repeat(full) + (h ? '▌' : '') + '░'.repeat(WIDTH - full - h)
}

export const register: Register = on => {
  let warned = false

  // Toast once when the context crosses the red limit; re-arm after compaction.
  on('session.measure', async ($, e, next) => {
    const pct = (await $.session.usage()).context.percent
    if (pct !== undefined && pct >= RED && !warned) {
      warned = true
      $.ui.toast(`Context at ${Math.round(pct)}% — run /compact`)
    } else if (pct === undefined || pct < RED) {
      warned = false
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const pct = (await $.session.usage()).context.percent
    if (pct === undefined) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const color = band(pct)
    const cwd = await $.session.cwd()
    const folder = cwd.split('/').filter(Boolean).pop() ?? cwd

    return (
      <Box>
        <Text>📁 </Text>
        <Text bold>{folder}</Text>
        <Text> · context </Text>
        <Text color={color}>{bar(pct)}</Text>
        <Text color={color}> {Math.round(pct)}%</Text>
        {pct >= RED ? (
          <Text color={COLORS.red} bold> · ⚠ compact </Text>
        ) : null}
        {pct >= RED && !e.props.isWorking ? (
          <Button
            key="compact"
            label="Compactar"
            onPress={() => {
              $.ui.toast('Compactando…')
              return $.prompt.fill({ text: '/compact' })
            }}
          />
        ) : null}
      </Box>
    )
  })
}