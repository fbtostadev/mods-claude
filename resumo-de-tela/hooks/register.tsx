import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Resumo } from '../types'

const resumo = atom({ plugin: 'resumo-de-tela', key: 'resumo' } as const, null)
const resumindo = atom({ plugin: 'resumo-de-tela', key: 'resumindo' } as const, false)

const FERRAMENTAS_QUE_EDITAM = new Set(['Edit', 'Write', 'NotebookEdit'])

const PEDIDO =
  'Sem usar ferramentas e sem pensar muito: em uma única linha de até 120 caracteres, em português, ' +
  'começando por um verbo no passado, diga o que mudou na tela do app no seu último turno. ' +
  'Se nada mudou na tela, diga o que mudou no código. Responda só com a linha.'

export const register: Register = on => {
  // Arquivos editados pelo turno principal em andamento.
  let editados = new Set<string>()

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) editados = new Set()
    return next(e)
  })

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined && FERRAMENTAS_QUE_EDITAM.has(String(e.tool))) {
      const caminho = e as { file_path?: string; notebook_path?: string }
      editados.add(caminho.file_path ?? caminho.notebook_path ?? '?')
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const fim = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || editados.size === 0) return fim

    const arquivos = editados.size
    editados = new Set()
    await update($, resumindo, () => true)
    // Fora do turno, para não atrasar o prompt seguinte.
    $.clock.after(0, async () => {
      const r = await $.model.fork({ prompt: PEDIDO, effort: 'low' })
      if (r.isAnswered) {
        const texto = r.text.trim().split('\n')[0] ?? ''
        await update($, resumo, (): Resumo => ({ texto, arquivos }))
      }
      await update($, resumindo, () => false)
    })
    return fim
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const atual = await read($, resumo)
    const ocupado = await read($, resumindo)
    if (atual === null && !ocupado) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    if (ocupado) return <Text dimColor>Tela: resumindo o turno…</Text>
    if (atual === null) return next(e)

    return (
      <Box gap={1}>
        <Text>
          <Text color="ansi:cyan">Tela:</Text> {atual.texto}{' '}
          <Text dimColor>({atual.arquivos} arquivo{atual.arquivos === 1 ? '' : 's'})</Text>
        </Text>
        <Button
          key="copiar"
          label="Copiar"
          onPress={async () => {
            await $.ui.copy({ text: atual.texto, surface: e.surface })
          }}
        />
        <Button key="fechar" label="×" role="dismiss" onPress={() => update($, resumo, () => null)} />
      </Box>
    )
  })
}
