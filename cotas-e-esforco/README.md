# cotas-e-esforco

Mod do Claude Code: um painel com as cotas de 5h e 7d de todas as contas Claude logadas e uma matriz para trocar **modelo e esforço com um clique**. Fica ao lado da conversa e abre sozinho ao iniciar a sessão.

## Instalar

```
/plugin install cotas-e-esforco --marketplace fbtostadev/mods-claude
```

Ponteiro (hover e clique) só existe no renderer fullscreen: use `/tui fullscreen` . No renderer clássico o painel só responde ao teclado.

## Comportamento

### `/cotas`

| Comando | O que faz |
|---|---|
| `/cotas` | Abre o painel e atualiza as cotas. Não escreve nada na conversa. |
| `/cotas atualizar` | Igual a `/cotas`. |
| `/cotas fechar` | Fecha o painel. |
| `/cotas <outra coisa>` | Escreve `Uso: /cotas [atualizar|fechar]`. |

O painel pede 56 colunas ao abrir; o tamanho que a pessoa arrastar vale mais.

### Modelo e esforço: uma matriz, um clique

Linhas, de cima para baixo: Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5 (o Fable fica acima do Opus), cada modelo separado do seguinte por uma linha em branco. Colunas: `low`, `medium`, `high` (`xhigh` e `max` ficam de fora).

- Clicar numa célula roda `/model <id>` e depois `/effort <nível>`, como se digitados. Sem seletor, sem ctrl+x.
- Se o modelo clicado já é o atual, não roda `/model`. O `/effort` roda sempre depois de um `/model` (o modelo novo pode reaplicar o esforço padrão dele, definido em `modelSettings` nos settings) e, no mesmo modelo, só quando o esforço muda. Célula já em vigor: nada roda.
- A célula em vigor aparece em destaque (`primary`). O modelo vem do último pedido ao modelo (`turn.step`) e, antes dele, de `$.session.model()`; o esforço vem do `turn.step`, do `/effort` digitado à mão ou do `effortLevel` dos settings.
- Passar o ponteiro sobre uma célula acende a linha inteira (nome do modelo e as três células).
- Com a sessão ocupada, os comandos entram na fila e o painel mostra `→ Opus 5.5 · high no próximo turno livre` até rodarem.
- Não há atalhos de teclado: o clique já dá o foco ao painel.
- Atenção: o `/model` do Claude Code também salva o modelo escolhido como padrão das próximas sessões. Um clique na matriz, portanto, muda o seu padrão.

### Cotas

Contas lidas: `~/.claude` e, se existirem, as contas do Maestri em `~/.maestri-local/accounts/*`. A consulta roda `claude -p` com um pedido `get_usage`, que não gasta prompt.

Uma moldura por conta (azul na conta desta sessão, cinza nas outras), com duas barras por janela: uso em cima (azul, vermelho onde passa do tempo) e tempo embaixo (cinza, verde na folga). Sem legenda, sem texto de ritmo.

- Um traço branco (`│`) cruza as duas barras na coluna do tempo decorrido, a "linha de agora". Na barra de uso, o que está à esquerda dele é o uso dentro do ritmo (azul) e o que passa dele é o excesso (vermelho); assim, com o uso muito à frente, o vermelho tem ponto de referência em vez de virar um bloco único. Na barra de tempo, o traço fecha o preenchimento.
- O número do uso fica à direita do traço quando o tempo decorrido é tão curto que o traço cairia sobre ele.

- Ao atualizar, as contas já conhecidas continuam na tela e cada uma mostra `lendo…` até chegar; uma conta lenta não segura as outras.
- Conta com erro mostra o motivo e o botão **tentar de novo**, que consulta só aquela conta.
- Um só botão, `↻ lido às HH:MM`, consulta todas as contas (`↻ Consultando…` enquanto lê).
- A cada 5 minutos o painel atualiza sozinho; a cada minuto redesenha os prazos.

## Desenvolver

- Validar e testar: `claude plugin validate .` e `claude plugin test .`
- Ver a mudança sem publicar: `claude --plugin-dir <esta pasta>`, que recarrega ao editar.
- Publicar: suba `version` no `.claude-plugin/plugin.json` e faça push. Quem já instalou recebe com `claude plugin marketplace update mods-claude` e `claude plugin update cotas-e-esforco@mods-claude`.
