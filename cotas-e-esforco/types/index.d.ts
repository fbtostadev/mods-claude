export type Janela = {
  rotulo: string
  uso: number
  fimMs: number
  duracaoMs: number
  /** Quantas divisas a barra de tempo tem: 5 horas na janela de 5h, 7 dias na de 7d. */
  grupos: number
}

export type Nivel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Um clique da matriz que ainda espera a sessão ficar livre. */
export type Pedido = { familia: string; nivel: Nivel }

export type Conta = {
  rotulo: string
  /** A consulta desta conta está em andamento: a tela mostra `lendo…` e mantém o que já sabia. */
  lendo?: boolean
  plano: string
  /** A conta desta sessão (CLAUDE_CONFIG_DIR, ou ~/.claude sem ela): leva a moldura em destaque. */
  ativa: boolean
  janelas: Janela[]
  erro?: string
}

declare module 'claude-code' {
  interface PluginState {
    'cotas-e-esforco': {
      contas: Shaped<Conta[]>
      consultando: boolean
      consultadoEm: number
      agora: number
      /** O esforço em vigor, lido do último pedido ao modelo ou do /effort. */
      esforco: Nivel | null
      /** O modelo em vigor, como a sessão o chama (id completo ou apelido): casa com a linha pela família. */
      modelo: string | null
      /** O clique da matriz que ainda espera a sessão ficar livre. */
      pedido: Shaped<Pedido | null>
    }
  }
}
