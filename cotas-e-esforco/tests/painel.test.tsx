import { expect, test } from 'claude-code/testing'

import type { Conta } from '../types'


const PAINEL = {
  plugin: 'cotas-e-esforco',
  component: 'Pane',
  requestId: 'cotas',
  props: {
    title: 'Cotas e esforço',
    isFocused: false,
    bodyColumns: 52,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const T = Date.UTC(2026, 10, 13, 2, 0)
const H = 3600_000

const exemplo: Conta[] = [
  {
    rotulo: '~/.claude',
    plano: 'max',
    ativa: true,
    janelas: [
      { rotulo: '5h', uso: 71, fimMs: T + 2 * H, duracaoMs: 5 * H, grupos: 5 },
      { rotulo: '7d', uso: 11, fimMs: T + 130 * H, duracaoMs: 168 * H, grupos: 7 },
    ],
  },
  {
    rotulo: 'Maestri BD125777',
    plano: 'pro',
    ativa: false,
    janelas: [
      { rotulo: '5h', uso: 3, fimMs: T + 20 * 60_000, duracaoMs: 5 * H, grupos: 5 },
      { rotulo: '7d', uso: 40, fimMs: T + 82 * H, duracaoMs: 168 * H, grupos: 7 },
    ],
  },
]

// O estado que o mod leria numa sessão (as contas já consultadas, o relógio e o que o teste semear),
// guardado em memória: o que o mod escreve é o que ele lê depois.
function usaEstado(on: (evento: any, hook: any) => void, contas: Conta[] = exemplo, extra: Record<string, unknown> = {}) {
  const guardado = new Map<string, { value: unknown; version: number }>([
    ['contas', { value: { shape: 'contas-2', value: contas }, version: 1 }],
    ['agora', { value: T, version: 1 }],
    ...Object.entries(extra).map(([chave, value]) => [chave, { value, version: 1 }] as const),
  ])
  on('state.get', (_: unknown, e: { key: string }) => ({ value: guardado.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown; ifVersion?: number }) => {
    const atual = guardado.get(e.key)
    if (e.ifVersion !== undefined && (atual?.version ?? 0) !== e.ifVersion) return { value: { isSet: false, version: atual?.version ?? 0 } }
    const version = (atual?.version ?? 0) + 1
    guardado.set(e.key, { value: e.value, version })
    return { value: { isSet: true, version } }
  })
}

// O que a atualização em segundo plano pede ao sistema: nenhuma conta além da padrão, e a consulta sem resposta.
function semContasExtras(on: (evento: any, hook: any) => void) {
  on('env.get', () => ({ value: '' }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1 } }))
}

test('o painel mostra o prazo em linguagem de gente, sem ritmo, legenda nem pontos', async ($, on) => {
  usaEstado(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PAINEL, surface })
    // 5h: restam 2h de 5h (40%): "faltam"; 7d: 5d10h e 3d10h: dias.
    expect(await ui.find({ type: 'Text', text: /^faltam 2h00$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^daqui a 5 dias$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^daqui a 3 dias$/ })).toBeDefined()
    // 20 min de 5h (6,7%): quase no fim.
    expect(await ui.find({ type: 'Text', text: /^já faltam 20 min$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /mais folga/ }))?.text).toBe('◆ mais folga')
    for (const proibido of [/·/, /ritmo/, /tempo \d/, /uso à frente/, /empatados/, /uso \d+%/]) {
      expect(await ui.find({ type: 'Text', text: proibido })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('a conta ativa leva a moldura em azul; a outra, em cinza', async ($, on) => {
  usaEstado(on)
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  const ativa = await ui.find({ type: 'Box', key: '~/.claude' })
  const outra = await ui.find({ type: 'Box', key: 'Maestri BD125777' })
  expect(ativa?.props.borderStyle).toBe('round')
  expect(ativa?.props.borderColor).toBe('#87afff')
  expect(outra?.props.borderColor).toBe('#4e4e4e')
  await ui.unmount()
})

test('o número fica dentro da barra de uso e as duas barras têm a mesma largura', async ($, on) => {
  usaEstado(on)
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  const comprimento = (children: unknown[]): number =>
    children.reduce<number>((n, c) => n + (typeof c === 'string' ? c.length : comprimento((c as { children?: unknown[] }).children ?? [])), 0)
  const barras = (await ui.findAll({ type: 'Text' })).filter(t => t.children.length > 0 && typeof t.children[0] !== 'string')
  // Por janela: [uso, tempo]. As quatro primeiras são as da conta ativa (5h e 7d).
  const [uso5, tempo5, uso7, tempo7] = barras.filter(b => b.children.every(c => typeof c !== 'string') && comprimento(b.children) === 48)
  if (!uso5 || !tempo5 || !uso7 || !tempo7) throw new Error('faltam barras no painel')
  expect(uso5.text).toContain('71%')
  expect(uso7.text).toContain('11%')
  expect(comprimento(uso5.children)).toBe(comprimento(tempo5.children))
  expect(comprimento(uso7.children)).toBe(comprimento(tempo7.children))
  expect(comprimento(uso5.children)).toBe(comprimento(uso7.children))
  await ui.unmount()
})

test('a linha de agora cruza as duas barras na mesma coluna, e o número sai de baixo dela', async ($, on) => {
  usaEstado(on)
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  const barras = (await ui.findAll({ type: 'Text' })).filter(t => t.children.length > 0 && typeof t.children[0] !== 'string')
  const [uso5, tempo5, uso7, tempo7] = barras.filter(b => b.text.length === 48)
  if (!uso5 || !tempo5 || !uso7 || !tempo7) throw new Error('faltam barras no painel')
  // 5h: 3h de 5h passadas (60%) em 48 colunas: coluna 28. 7d: 22,6%: coluna 10.
  expect(uso5.text.indexOf('│')).toBe(28)
  expect(tempo5.text.indexOf('│')).toBe(28)
  expect(uso7.text.indexOf('│')).toBe(10)
  expect(tempo7.text.indexOf('│')).toBe(10)
  // Só um traço por barra, e o número do uso continua inteiro.
  expect(uso5.text.split('│').length).toBe(2)
  expect(uso5.text).toContain('71%')
  expect(uso7.text).toContain('11%')
  await ui.unmount()
})

test('com pouquíssimo tempo decorrido, o número passa para a direita do traço', async ($, on) => {
  // 5h: começou há 6 min (2%): o traço cai na coluna 0 e o número vai para depois dele.
  const [ativa] = exemplo as [Conta]
  const recem: Conta = { ...ativa, janelas: [{ rotulo: '5h', uso: 71, fimMs: T + 294 * 60_000, duracaoMs: 5 * H, grupos: 5 }] }
  usaEstado(on, [recem])
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  const barras = (await ui.findAll({ type: 'Text' })).filter(t => t.children.length > 0 && typeof t.children[0] !== 'string')
  const uso = barras.find(b => b.text.length === 48)
  expect(uso?.text.indexOf('│')).toBe(0)
  expect(uso?.text).toContain('71%')
  await ui.unmount()
})

test('sem contas lidas, o painel diz isso', async $ => {
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Nenhuma conta/ }))?.text).toBe('Nenhuma conta lida.')
  await ui.unmount()
})

const ABERTURA = { value: { isPlaced: true } } as const

// Um /cotas digitado no prompt de um terminal fullscreen.
const DIGITADO = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

test('a matriz tem uma linha por modelo, com low, medium e high em cada uma (o hover não aparece no harness)', async ($, on) => {
  usaEstado(on)
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  for (const modelo of ['opus', 'sonnet', 'haiku', 'fable']) {
    for (const nivel of ['low', 'medium', 'high']) {
      expect(await ui.find({ type: 'Button', key: `${modelo}-${nivel}` })).toBeDefined()
    }
  }
  expect(await ui.find({ type: 'Button', key: 'opus-xhigh' })).toBeUndefined()
  await ui.unmount()
})

test('os modelos vêm do mais ao menos capaz: Fable acima do Opus', async ($, on) => {
  usaEstado(on)
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  const chaves = (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.endsWith('-low'))
  expect(chaves).toEqual(['fable-low', 'opus-low', 'sonnet-low', 'haiku-low'])
  await ui.unmount()
})

test('um clique na célula roda /model e depois /effort', async ($, on) => {
  const rodados: string[] = []
  on('command.run', (_, e) => {
    rodados.push(`/${e.command} ${e.args}`)
    return {}
  })
  usaEstado(on, exemplo, { modelo: 'claude-sonnet-5-5', esforco: 'medium' })

  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  await ui.press({ key: 'opus-high' })
  expect(rodados).toEqual(['/model claude-opus-5-5', '/effort high'])
  await ui.unmount()
})

test('o que já está em vigor não é pedido de novo', async ($, on) => {
  const rodados: string[] = []
  on('command.run', (_, e) => {
    rodados.push(`/${e.command} ${e.args}`)
    return {}
  })
  usaEstado(on, exemplo, { modelo: 'claude-sonnet-5-5', esforco: 'medium' })

  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  // Mesmo modelo, outro esforço: só /effort.
  await ui.press({ key: 'sonnet-high' })
  expect(rodados).toEqual(['/effort high'])
  // Já em vigor: nada.
  rodados.length = 0
  await ui.press({ key: 'sonnet-high' })
  expect(rodados).toEqual([])
  // Outro modelo, mesmo esforço: /model e /effort de novo (o modelo novo pode reaplicar o padrão dele).
  await ui.press({ key: 'haiku-high' })
  expect(rodados).toEqual(['/model claude-haiku-5-5', '/effort high'])
  await ui.unmount()
})

test('a célula do modelo e do esforço em vigor é a primária', async ($, on) => {
  usaEstado(on, exemplo, { modelo: 'claude-opus-5-5', esforco: 'high' })
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'opus-high' }))?.props?.variant).toBe('primary')
  expect((await ui.find({ type: 'Button', key: 'opus-low' }))?.props?.variant).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'sonnet-high' }))?.props?.variant).toBeUndefined()
  await ui.unmount()
})

test('/cotas abre o painel pedindo 56 colunas, sem escrever na conversa', async ($, on) => {
  const abertos: unknown[] = []
  on('ui.open', (_, e) => {
    abertos.push(e)
    return ABERTURA
  })
  usaEstado(on)
  semContasExtras(on)
  const r = await $.command.run({ command: 'cotas', args: '', ...DIGITADO })
  expect(r.text).toBeUndefined()
  // A atualização das contas segue em segundo plano: deixa terminar antes de o teste acabar.
  // O módulo de teste não declara os globais do Node; o setTimeout existe no runtime dos testes.
  const { setTimeout: esperar } = globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }
  await new Promise<void>(resolver => esperar(resolver, 50))
  expect(abertos.length).toBeGreaterThan(0)
  expect((abertos[abertos.length - 1] as { columns?: number }).columns).toBe(56)
})

test('/cotas fechar fecha o painel; um argumento desconhecido mostra o uso', async ($, on) => {
  const fechados: unknown[] = []
  on('ui.close', (_, e) => {
    fechados.push(e.id)
    return { value: undefined }
  })
  const fechar = await $.command.run({ command: 'cotas', args: 'fechar', ...DIGITADO })
  expect(fechados).toEqual(['cotas'])
  expect(fechar.text).toBeUndefined()

  const ruim = await $.command.run({ command: 'cotas', args: 'banana', ...DIGITADO })
  expect(ruim.text).toBe('Uso: /cotas [atualizar|fechar]')
  expect(fechados).toEqual(['cotas'])
})

test('a conta que está sendo lida diz lendo…, sem esconder o que já se sabia', async ($, on) => {
  const [ativa, outra] = exemplo as [Conta, Conta]
  usaEstado(on, [{ ...ativa, lendo: true }, outra])
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: /^lendo…$/ })).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /^faltam 2h00$/ })).toBeDefined()
  await ui.unmount()
})

test('a conta com erro mostra o motivo e um botão que tenta só ela', async ($, on) => {
  const [ativa, outra] = exemplo as [Conta, Conta]
  usaEstado(on, [ativa, { ...outra, janelas: [], erro: 'sem resposta (saída 1)' }])
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /sem resposta \(saída 1\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'tentar-Maestri BD125777' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'tentar-~/.claude' })).toBeUndefined()
  await ui.unmount()
})

test('um só botão atualiza as cotas e diz quando foi a última leitura', async ($, on) => {
  usaEstado(on, exemplo, { consultadoEm: Date.UTC(2026, 10, 13, 2, 0) })
  const ui = await $.ui.mount({ ...PAINEL, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'atualizar' }))?.text).toMatch(/^↻ lido às \d\d:\d\d$/)
  await ui.unmount()
})
