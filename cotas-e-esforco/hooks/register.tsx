import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Conta, Janela, Nivel } from '../types'

const PAINEL = 'cotas'
const TITULO = 'Cotas e esforço'
const CINCO_MIN = 5 * 60 * 1000

const contas = atom({ plugin: 'cotas-e-esforco', key: 'contas' } as const, [], { shape: 'contas-2' })
const consultando = atom({ plugin: 'cotas-e-esforco', key: 'consultando' } as const, false)
const consultadoEm = atom({ plugin: 'cotas-e-esforco', key: 'consultadoEm' } as const, 0)
const agora = atom({ plugin: 'cotas-e-esforco', key: 'agora' } as const, 0)
const esforco = atom({ plugin: 'cotas-e-esforco', key: 'esforco' } as const, null)
const modelo = atom({ plugin: 'cotas-e-esforco', key: 'modelo' } as const, null)
const pedido = atom({ plugin: 'cotas-e-esforco', key: 'pedido' } as const, null, { shape: 'pedido-2' })

// O teto do Opus 5.5 é high (maxEffortLevel no ~/.claude/settings.json):
// xhigh e max ficam de fora.
const NIVEIS: Nivel[] = ['low', 'medium', 'high']

// As linhas da matriz, do mais ao menos capaz. A `familia` casa com o modelo em vigor, que a
// sessão chama ora pelo apelido (`sonnet`), ora pelo id (`claude-sonnet-5-5`).
const MODELOS = [
  { familia: 'fable', nome: 'Fable 5.2', id: 'claude-fable-5-2' },
  { familia: 'opus', nome: 'Opus 5.5', id: 'claude-opus-5-5' },
  { familia: 'sonnet', nome: 'Sonnet 5.5', id: 'claude-sonnet-5-5' },
  { familia: 'haiku', nome: 'Haiku 5.5', id: 'claude-haiku-5-5' },
]

const ehDaFamilia = (atual: string | null, familia: string) => atual?.toLowerCase().includes(familia) ?? false

const ehNivel = (x: unknown): x is Nivel =>
  x === 'low' || x === 'medium' || x === 'high' || x === 'xhigh' || x === 'max'

// O mesmo pedido que o Maestri faz para os anéis de uso: nenhum prompt, sem custo.
const PEDIDO =
  JSON.stringify({
    type: 'control_request',
    request_id: 'cotas',
    request: { subtype: 'get_usage', skip_behaviors: true },
  }) + '\n'

type Pasta = { rotulo: string; dir?: string; ativa: boolean }

async function pastasDasContas($: EngineInterface): Promise<Pasta[]> {
  const home = (await $.env.get('HOME')) ?? ''
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? ''
  // A conta desta sessão: a pasta de CLAUDE_CONFIG_DIR, ou ~/.claude sem ela.
  const padraoAtiva = !config || config === `${home}/.claude`
  const pastas: Pasta[] = [{ rotulo: '~/.claude', ativa: padraoAtiva }]
  const base = `${home}/.maestri-local/accounts`
  try {
    for (const conta of await $.fs.list(base)) {
      if (conta.kind !== 'dir') continue
      const dir = `${base}/${conta.name}`
      const dentro = await $.fs.list(dir)
      if (dentro.some(a => a.name === '.claude.json')) {
        pastas.push({ rotulo: `Maestri ${conta.name.slice(0, 8)}`, dir, ativa: config === dir })
      }
    }
  } catch {
    // Sem Maestri: fica só a conta padrão.
  }
  return pastas
}

type Limite = { utilization?: number; resets_at?: string } | null | undefined

function janela(rotulo: string, limite: Limite, duracaoMs: number, grupos: number): Janela[] {
  if (!limite || limite.utilization === undefined || !limite.resets_at) return []
  return [{ rotulo, uso: limite.utilization, fimMs: Date.parse(limite.resets_at), duracaoMs, grupos }]
}

async function consultar($: EngineInterface, pasta: Pasta): Promise<Conta> {
  const base = { rotulo: pasta.rotulo, ativa: pasta.ativa }
  const argv = [
    '/usr/bin/env', '-u', 'ANTHROPIC_API_KEY', '-u', 'CLAUDE_CODE_OAUTH_TOKEN', '-u', 'CLAUDE_CONFIG_DIR',
    ...(pasta.dir ? [`CLAUDE_CONFIG_DIR=${pasta.dir}`] : []),
    'claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--no-session-persistence',
  ]
  try {
    const r = await $.process.run(argv, { stdin: PEDIDO, timeoutMs: 45_000, cwd: '/tmp' })
    for (const linha of r.stdout.split('\n')) {
      if (!linha.includes('control_response')) continue
      const msg = JSON.parse(linha)
      const uso = msg?.response?.response
      if (!uso) continue
      const limites = uso.rate_limits ?? {}
      return {
        ...base,
        plano: String(uso.subscription_type ?? '?'),
        janelas: [
          ...janela('5h', limites.five_hour, 5 * 3600_000, 5),
          ...janela('7d', limites.seven_day, 7 * 86400_000, 7),
        ],
      }
    }
    return { ...base, plano: '?', janelas: [], erro: `sem resposta (saída ${r.exitCode})` }
  } catch (erro) {
    return { ...base, plano: '?', janelas: [], erro: String(erro).slice(0, 120) }
  }
}

/** Consulta uma conta e troca só o cartão dela; até chegar, o cartão mostra `lendo…`. */
async function lerConta($: EngineInterface, pasta: Pasta) {
  await update($, contas, lista => lista.map(c => (c.rotulo === pasta.rotulo ? { ...c, lendo: true } : c)))
  const lida = await consultar($, pasta)
  await update($, contas, lista => lista.map(c => (c.rotulo === pasta.rotulo ? lida : c)))
}

async function atualizar($: EngineInterface) {
  if (await read($, consultando)) return
  await update($, consultando, () => true)
  try {
    const pastas = await pastasDasContas($)
    // A lista das contas aparece já; o que se sabia de cada uma fica até a leitura nova chegar.
    await update($, contas, antes =>
      pastas.map(p => antes.find(c => c.rotulo === p.rotulo) ?? { rotulo: p.rotulo, plano: '?', ativa: p.ativa, janelas: [] }),
    )
    await Promise.all(pastas.map(p => lerConta($, p)))
    await update($, consultadoEm, () => Date.now())
  } finally {
    await update($, consultando, () => false)
  }
}

async function tentarDeNovo($: EngineInterface, rotulo: string) {
  const pasta = (await pastasDasContas($)).find(p => p.rotulo === rotulo)
  if (pasta) await lerConta($, pasta)
}

/** Um clique da matriz: troca o modelo e o esforço, como se digitados. */
async function aplicar($: EngineInterface, alvo: (typeof MODELOS)[number], nivel: Nivel) {
  const atual = await read($, modelo)
  const mesmoModelo = ehDaFamilia(atual, alvo.familia)
  if (mesmoModelo && (await read($, esforco)) === nivel) return
  await update($, pedido, () => ({ familia: alvo.familia, nivel }))
  try {
    // Na fila: cada comando roda quando a sessão estiver livre.
    if (!mesmoModelo) {
      await $.command.run({ command: 'model', args: alvo.id })
      await update($, modelo, () => alvo.id)
    }
    // Depois de trocar de modelo o esforço vai de novo: o modelo novo pode reaplicar o padrão dele.
    await $.command.run({ command: 'effort', args: nivel })
    await update($, esforco, () => nivel)
  } finally {
    await update($, pedido, () => null)
  }
}

const abrirPainel = ($: EngineInterface) => $.ui.open({ id: PAINEL, title: TITULO, columns: 56 })

// --- gramática das barras
//
// Duas barras separadas e tangentes (uma linha cada, sem espaço entre elas): a de USO em cima,
// contínua, e a de TEMPO embaixo, cortada por hora (5h) ou por dia (7d). As duas têm a mesma
// largura em colunas; o que conta o ritmo é a diferença de preenchimento: o trecho do uso que
// passou do tempo fica vermelho, o do tempo que passou do uso (folga) fica verde.

const COR = {
  uso: '#87afff',
  acima: '#ff5f5f',
  tempo: '#8a8a8a',
  folga: '#87d787',
  trilho: '#303030',
  tinta: '#1c1c1c', // texto sobre trecho preenchido
  claro: '#d0d0d0', // texto sobre trilho vazio
  moldura: '#4e4e4e',
  agora: '#ffffff', // a linha de agora
}

const OITAVOS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉']

type Pedaco = { texto: string; fg?: string; bg?: string; negrito?: boolean }

/** Junta células vizinhas de mesmo estilo num único pedaço. */
function junta(celulas: Pedaco[]): Pedaco[] {
  const saida: Pedaco[] = []
  for (const c of celulas) {
    const u = saida[saida.length - 1]
    if (u && u.fg === c.fg && u.bg === c.bg && u.negrito === c.negrito) u.texto += c.texto
    else saida.push({ ...c })
  }
  return saida
}

/** Colunas (0-based) das divisas entre grupos: a coluna i·W/g, arredondada, fica vazia na barra de tempo. */
function divisas(largura: number, grupos: number): Set<number> {
  const s = new Set<number>()
  for (let i = 1; i < grupos; i++) s.add(Math.min(largura - 1, Math.max(0, Math.round((i * largura) / grupos) - 1)))
  return s
}

function porcentagemDeTempo(j: Janela, t: number): number {
  return Math.min(100, Math.max(0, ((t - (j.fimMs - j.duracaoMs)) / j.duracaoMs) * 100))
}

/** A coluna da linha de agora: onde o tempo decorrido cai na barra (o traço `│` fica no meio da célula). */
function colunaAgora(j: Janela, largura: number, t: number): number {
  return Math.min(largura - 1, Math.floor((porcentagemDeTempo(j, t) / 100) * largura))
}

/** O traço de agora sobre uma célula, mantendo o fundo dela. */
const comAgora = (c: Pedaco): Pedaco => ({ texto: '│', fg: COR.agora, bg: c.bg ?? COR.trilho, negrito: true })

/** Quanto da célula `c` está coberta por um preenchimento que termina em `fim` colunas. */
const cobertura = (fim: number, c: number) => Math.min(1, Math.max(0, fim - c))

/** Fração de célula como bloco à esquerda (oitavos); null quando é vazia ou cheia. */
function parcial(frac: number): string | null {
  const k = Math.round(frac * 8)
  return k <= 0 || k >= 8 ? null : (OITAVOS[k - 1] ?? null)
}

function barraUso(j: Janela, largura: number, t: number): Pedaco[] {
  const cu = (Math.min(100, Math.max(0, j.uso)) / 100) * largura
  const ct = (porcentagemDeTempo(j, t) / 100) * largura
  const rotulo = ` ${Math.round(j.uso)}%`
  const agoraCol = colunaAgora(j, largura, t)
  // O número fica à esquerda; se o tempo decorrido é tão curto que o traço cairia sobre ele, vai para a direita do traço.
  const inicio = agoraCol < rotulo.length ? agoraCol + 1 : 0
  const celulas: Pedaco[] = []
  for (let c = 0; c < largura; c++) {
    const u = cobertura(cu, c)
    const cor = u > 0 && cu > ct && c + u / 2 > ct + 1e-9 ? COR.acima : COR.uso
    const sob = c >= inicio && c < inicio + rotulo.length ? rotulo[c - inicio] : undefined
    if (sob !== undefined) {
      // O número inverte com o que passa por trás: escuro sobre o preenchido, claro sobre o vazio.
      const cheio = c < Math.round(cu)
      celulas.push(cheio
        ? { texto: sob, fg: COR.tinta, bg: cor, negrito: true }
        : { texto: sob, fg: COR.claro, bg: COR.trilho, negrito: true })
    } else if (u >= 1 - 1 / 16) celulas.push({ texto: ' ', bg: cor })
    else if (parcial(u)) celulas.push({ texto: parcial(u)!, fg: cor, bg: COR.trilho })
    else celulas.push({ texto: ' ', bg: COR.trilho })
  }
  celulas[agoraCol] = comAgora(celulas[agoraCol]!)
  return junta(celulas)
}

function barraTempo(j: Janela, largura: number, t: number): Pedaco[] {
  const cu = (Math.min(100, Math.max(0, j.uso)) / 100) * largura
  const ct = (porcentagemDeTempo(j, t) / 100) * largura
  const corte = divisas(largura, j.grupos)
  const celulas: Pedaco[] = []
  for (let c = 0; c < largura; c++) {
    if (corte.has(c)) {
      celulas.push({ texto: ' ' })
      continue
    }
    const k = cobertura(ct, c)
    const cor = k > 0 && ct > cu && c + k / 2 > cu + 1e-9 ? COR.folga : COR.tempo
    if (k >= 1 - 1 / 16) celulas.push({ texto: ' ', bg: cor })
    else if (parcial(k)) celulas.push({ texto: parcial(k)!, fg: cor, bg: COR.trilho })
    else celulas.push({ texto: ' ', bg: COR.trilho })
  }
  const agoraCol = colunaAgora(j, largura, t)
  celulas[agoraCol] = comAgora(celulas[agoraCol]!)
  return junta(celulas)
}

// --- texto

function hora(ms: number, comDia: boolean) {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (!comDia) return `${hh}:${mm}`
  const dias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
  return `${dias[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${hh}h`
}

/** O que falta, em linguagem de gente: dias quando sobra muito, horas quando falta pouco. */
function prazo(restaMs: number, duracaoMs: number): string {
  const min = Math.max(0, Math.round(restaMs / 60_000))
  if (min >= 1440) {
    const dias = Math.floor(min / 1440)
    const horas = Math.floor((min % 1440) / 60)
    if (dias >= 2) return `daqui a ${dias} dias`
    return horas > 0 ? `daqui a 1 dia e ${horas}h` : 'daqui a 1 dia'
  }
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0 && m <= 1) return 'já falta 1 min'
  const tempo = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
  const proporcao = restaMs / duracaoMs
  if (proporcao > 0.5) return `ainda faltam ${tempo}`
  if (proporcao >= 0.1) return `faltam ${tempo}`
  return `já faltam ${tempo}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cotas', description: 'Abre o painel de cotas e esforço e atualiza as cotas' })
    const salvo = await $.settings.read({ key: 'effortLevel' })
    if (ehNivel(salvo)) await update($, esforco, a => a ?? salvo)
    const atual = await $.session.model()
    await update($, modelo, () => atual)
    await update($, agora, () => Date.now())
    $.clock.every(60_000, () => void update($, agora, () => Date.now()))
    $.clock.every(CINCO_MIN, () => void atualizar($))
    void atualizar($)
    void abrirPainel($)
    return next(e)
  })

  on('command.run', { command: 'cotas' }, async ($, e) => {
    const argumento = e.args.trim()
    if (argumento === 'fechar') {
      await $.ui.close({ id: PAINEL })
      return {}
    }
    if (argumento !== '' && argumento !== 'atualizar') return { text: 'Uso: /cotas [atualizar|fechar]' }
    await abrirPainel($)
    void atualizar($)
    return {}
  })

  // O modelo e o nível que o turno principal de fato usa.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const nivel = e.effort
      const id = e.model
      if (ehNivel(nivel)) await update($, esforco, () => nivel)
      await update($, modelo, () => id)
    }
    return yield* next(e)
  })

  // /model digitado à mão (o da matriz a própria matriz registra).
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const r = await next(e)
    const pedido = e.args.trim().split(/\s+/)[0]
    if (pedido) await update($, modelo, () => pedido)
    return r
  })

  // /effort digitado à mão (o do botão o próprio botão registra).
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const nivel = e.args.trim().split(/\s+/)[0]
    if (ehNivel(nivel)) await update($, esforco, () => nivel)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const lista = await read($, contas)
    const ocupado = await read($, consultando)
    const quando = await read($, consultadoEm)
    const t = (await read($, agora)) || Date.now()
    const nivelEmVigor = await read($, esforco)
    const modeloEmVigor = await read($, modelo)
    const esperando = await read($, pedido)

    // Moldura (2) e respiro (2) saem da largura do corpo; as barras ocupam o resto.
    const largura = Math.min(60, Math.max(24, (e.props.bodyColumns ?? 44) - 4))

    // Conta com mais folga: menor uso na semana.
    const comSemana = lista.filter(c => c.janelas.some(j => j.rotulo === '7d'))
    const folgada = comSemana.length > 1
      ? comSemana.reduce((a, b) =>
          (a.janelas.find(j => j.rotulo === '7d')?.uso ?? 100) <= (b.janelas.find(j => j.rotulo === '7d')?.uso ?? 100) ? a : b)
      : undefined

    const desenha = (pedacos: Pedaco[]) => (
      <Text>
        {pedacos.map((p, i) => (
          <Text key={String(i)} color={p.fg} backgroundColor={p.bg} weight={p.negrito ? 'bold' : undefined}>{p.texto}</Text>
        ))}
      </Text>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column" gap={1}>
          {MODELOS.map(m => {
            const doModelo = ehDaFamilia(modeloEmVigor, m.familia)
            // Passar o ponteiro numa célula acende a linha toda: o grupo é o modelo.
            const hover = { scope: `modelo-${m.familia}`, underline: true }
            return (
              <Box key={m.familia} gap={1}>
                <Text weight={doModelo ? 'bold' : undefined} hover={hover}>{m.nome.padEnd(10)}</Text>
                {NIVEIS.map(nivel => (
                  <Button
                    key={`${m.familia}-${nivel}`}
                    label={nivel}
                    variant={doModelo && nivel === nivelEmVigor ? 'primary' : undefined}
                    hover={hover}
                    onPress={() => aplicar($, m, nivel)}
                  />
                ))}
              </Box>
            )
          })}
          {esperando !== null && (
            <Text dimColor>→ {MODELOS.find(m => m.familia === esperando.familia)?.nome} · {esperando.nivel} no próximo turno livre</Text>
          )}
        </Box>
        <Button
          key="atualizar"
          plain
          label={ocupado ? '↻ Consultando…' : quando ? `↻ lido às ${hora(quando, false)}` : '↻ ainda não lido'}
          onPress={() => atualizar($)}
        />
        {lista.length === 0 && <Text dimColor>{ocupado ? 'Consultando as contas…' : 'Nenhuma conta lida.'}</Text>}
        {lista.map(conta => (
          <Box
            key={conta.rotulo}
            flexDirection="column"
            gap={1}
            borderStyle="round"
            borderColor={conta.ativa ? COR.uso : COR.moldura}
            paddingX={1}
          >
            <Box width={largura} justifyContent="space-between">
              <Text>
                <Text weight="bold">{conta.plano.toUpperCase()}</Text> <Text dimColor>{conta.rotulo}</Text>
              </Text>
              {conta.lendo ? <Text dimColor>lendo…</Text> : folgada === conta && <Text color="success">◆ mais folga</Text>}
            </Box>
            {conta.erro && !conta.lendo && (
              <Box gap={1}>
                <Text color="error">{conta.erro}</Text>
                <Button key={`tentar-${conta.rotulo}`} label="tentar de novo" onPress={() => tentarDeNovo($, conta.rotulo)} />
              </Box>
            )}
            {conta.janelas.map(j => {
              const comDia = j.rotulo === '7d'
              return (
                <Box key={j.rotulo} flexDirection="column" width={largura}>
                  <Box justifyContent="space-between">
                    <Text>
                      <Text weight="bold">{j.rotulo}</Text>{'  '}
                      <Text dimColor>{hora(j.fimMs - j.duracaoMs, comDia)} → {hora(j.fimMs, comDia)}</Text>
                    </Text>
                    <Text>{prazo(j.fimMs - t, j.duracaoMs)}</Text>
                  </Box>
                  {desenha(barraUso(j, largura, t))}
                  {desenha(barraTempo(j, largura, t))}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  })
}
