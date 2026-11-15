export type Resumo = { texto: string; arquivos: number }

declare module 'claude-code' {
  interface PluginState {
    'resumo-de-tela': { resumo: Resumo | null; resumindo: boolean }
  }
}
