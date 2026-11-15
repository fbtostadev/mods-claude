# mods-claude

Mods do [Claude Code](https://claude.com/claude-code), em um marketplace de plugins. Cada mod se instala sozinho: escolha só os que quiser.

| Mod | O que faz |
|---|---|
| [`cotas-e-esforco`](./cotas-e-esforco) | Painel ao lado da conversa com as cotas de 5h e 7d das suas contas Claude e uma matriz para trocar **modelo e esforço com um clique**. Abre com `/cotas`. |
| `resumo-de-tela` | Ao fim de cada turno que editou arquivos, mostra acima do prompt uma linha com o que mudou. Cada resumo é uma chamada curta ao modelo (esforço `low`), que conta na sua cota. |

## Instalar

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install cotas-e-esforco --marketplace fbtostadev/mods-claude
/plugin install resumo-de-tela --marketplace fbtostadev/mods-claude
```

Responda `y` para adicionar o marketplace e confirme o escopo de usuário com Enter. O mod já fica ativo na sessão.

Pelo shell:

```
claude plugin install cotas-e-esforco --marketplace fbtostadev/mods-claude
```

No app desktop: clique em **+** ao lado da caixa do prompt, **Plugins**, **Add marketplace** com `fbtostadev/mods-claude` e depois **Add plugin**.

## Atualizar e remover

```
claude plugin marketplace update mods-fabricio
claude plugin update cotas-e-esforco@mods-fabricio
claude plugin uninstall cotas-e-esforco@mods-fabricio
```

Depois de atualizar, reinicie as sessões abertas (ou rode `/reload-plugins`).

## Requisitos

- Claude Code 2.1.325 ou mais novo.
- Para usar o mouse (hover e clique) no painel de cotas: o renderer fullscreen, `/tui fullscreen`. No renderer clássico o painel responde só ao teclado.

## Licença

MIT. Veja [LICENSE](./LICENSE).
