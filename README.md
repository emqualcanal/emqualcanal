# Lives de futebol no YouTube — site com atualização automática

Um site que mostra as transmissões de futebol **ao vivo e agendadas** nos canais que você escolher.
Ele usa a mesma lógica da extensão do Chrome (mesmos filtros, busca reforçada e acompanhamento das lives agendadas), mas roda sozinho no GitHub, sem precisar do seu computador ligado.

**Como funciona:** a cada ~15 minutos o GitHub executa `scripts/update.mjs`, que consulta a API do YouTube, gera `data/lives.json` e publica o site no GitHub Pages. Tudo gratuito (repositório público).

## Instalação (uns 10 minutos)

1. **Crie uma conta** em github.com (se ainda não tiver) e um **repositório público** novo, por exemplo `lives-futebol`.
2. **Envie os arquivos.** No repositório: *Add file → Upload files*, arraste o conteúdo desta pasta (`config.json`, `package.json`, `README.md`, pastas `scripts` e `docs`) e confirme com *Commit changes*.
3. **Crie o workflow** (a pasta `.github` é oculta e costuma não subir pelo upload): *Add file → Create new file*, digite o nome `.github/workflows/update.yml` (as barras criam as pastas), cole o conteúdo do arquivo `workflow-update.yml` e confirme com *Commit*.
4. **Guarde a chave da API como segredo:** *Settings → Secrets and variables → Actions → New repository secret*. Nome: `YOUTUBE_API_KEY`. Valor: sua chave da YouTube Data API v3. A chave nunca aparece no site nem no código.
5. **Ative o GitHub Pages:** *Settings → Pages → Build and deployment → Source: GitHub Actions*.
6. **Rode pela primeira vez:** aba *Actions → Atualizar lives → Run workflow*. Em 1–2 minutos o site abre em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`. Depois disso ele se atualiza sozinho.

> Se o repositório se chamar `SEU-USUARIO.github.io`, troque no `update.yml` a linha `SITE_URL` por `https://${{ github.repository_owner }}.github.io`.

## Personalizar (`config.json`)

| Campo | O que faz |
|---|---|
| `channels` | Canais monitorados (`@handle` como aparece **no YouTube**, ou o ID que começa com `UC`). |
| `deepSearchChannels` / `deepPriorityEveryMin` | Canais que agendam muitas lives e a frequência da busca reforçada neles (100 unidades por busca). Os canais daqui também têm a lista de uploads lida mais a fundo. |
| `uploadsPages` / `uploadsPagesPriority` | Quantas páginas de 50 vídeos recentes são lidas por canal (1 unidade por página): `uploadsPages` para os canais comuns (padrão 2) e `uploadsPagesPriority` para os de `deepSearchChannels` (padrão 4). Canais que postam muito (CazéTV, ge tv…) empurram a live agendada para longe do topo da lista; páginas a mais resolvem isso por quase nada. |
| `deepBudgetPerDay` | Cota diária (em unidades) para a busca reforçada em rodízio nos demais canais. 100 unidades = 1 busca. `0` desliga. |
| `requireMatchup` | Só aceita títulos com “Time x Time”, “vs” ou placar. |
| `excludeKeywords` | Palavras que descartam a live (basquete, sub-19, pré/pós-jogo, reação, resenha, sem imagem, videogame…). |
| `keywords`, `requireKeyword` | Usados só quando `requireMatchup` está desligado. |
| `staleUpcomingHours` | Descarta lives agendadas que não começaram até X horas depois do horário. |

Depois de editar o arquivo no GitHub, rode o workflow de novo (ou espere a próxima execução).

## Usar as configurações da extensão no site

A extensão e o site **não compartilham configurações**: o que você muda nas opções da extensão fica só no seu navegador, e o site lê apenas o `config.json` deste repositório. Para levar as mudanças (canais, busca reforçada, filtros) para o site:

1. Nas opções da extensão (versão 1.5.0 ou mais nova), clique em **Copiar config para o GitHub**.
2. No GitHub, abra o arquivo `config.json` do repositório, clique no lápis (Edit this file), apague tudo, cole e clique em **Commit changes**.
3. Na próxima execução (ou em *Actions → Atualizar lives → Run workflow*) o site já usa a nova configuração.

Cuidado com a cota: cada canal em `deepSearchChannels` gasta 100 unidades por busca. A cada 120 minutos são 1.200 unidades por dia por canal; a cada 60 minutos, 2.400. O log de cada execução mostra a estimativa diária e avisa quando passa de 10.000.

## Campeonatos, ordenação e filtros

O site permite **ordenar por Campeonatos ou por Horário** e tem um painel com as abas **Campeonatos** (agrupados por região, com contagem e “Mostrar mais”) e **Canais**. Marque ou desmarque itens, ou use “Todos”.

O YouTube não informa o campeonato; ele é deduzido do **título** da transmissão em `scripts/leagues.mjs`. Se um campeonato aparecer como “Outros campeonatos”, ele está listado em `data/debug.json`, no campo `semCampeonato`. Para ensinar um campeonato novo, acrescente uma linha na lista `RULES` desse arquivo, por exemplo:

```js
[/copa sao paulo|copinha/, "Copa São Paulo", "Brasil", "br"],
```

(o texto é comparado sem acentos e em minúsculas; o último valor é o código da bandeira, ou omita para não ter bandeira.)

## Cota da API (10.000 unidades por dia, por projeto do Google Cloud)

Uma execução normal gasta ~40 unidades (lê as páginas de uploads de cada canal; vídeos comuns já conferidos não são consultados de novo) e roda 96 vezes por dia. O log de cada execução mostra a **estimativa diária** para a sua configuração. Com o `config.json` deste projeto ela fica em torno de **8.700 unidades por dia**: ~4.500 das leituras, ~3.200 da busca reforçada nos 4 canais prioritários (a cada 180 min) e 1.000 do rodízio nos outros canais.
A primeira execução (e a opção “busca completa” do botão Run workflow) faz a busca reforçada em todos os canais, cerca de 1.800 unidades.

**Se você usar a mesma chave da extensão, a cota é dividida entre as duas.** Nesse caso reduza o uso da extensão (por exemplo, orçamento da busca reforçada = 0 nas opções) ou use uma chave de outro projeto para o site.

## Diagnóstico

- `https://SEU-USUARIO.github.io/REPOSITORIO/data/debug.json` mostra, por canal, quantos vídeos foram lidos e quantas lives foram achadas, os erros (por exemplo, `@` de canal não encontrado), a cota usada, as transmissões sem campeonato identificado (`semCampeonato`), como cada live foi encontrada (`descobertas`: pela lista de uploads, só pela busca reforçada ou só pelo acompanhamento) e quais lives **só a busca reforçada achou** (`soPelaBusca`, a lista de canais que mais precisam de prioridade) e **todas as lives descartadas com o motivo**.
- Cada execução também registra a cota usada no log da aba *Actions*.
- Se uma execução falha (cota esgotada, erro da API), o site continua mostrando a última versão publicada.

## Limites e cuidados

- O agendamento do GitHub é “melhor esforço”: execuções podem atrasar alguns minutos.
- **Em repositórios públicos, o GitHub desativa as execuções agendadas após 60 dias sem atividade no repositório.** Ele avisa por e-mail; é só reativar na aba *Actions*, ou fazer qualquer edição no repositório.
- Só aparecem lives **públicas**. Rascunhos, transmissões privadas e lives ainda não criadas não existem para a API.
- O filtro é feito pelo título; pode haver lives de fora que deveriam entrar e o contrário.
- Se o GitHub avisar que as versões das ações (`checkout`, `setup-node`, `deploy-pages`…) estão antigas, atualize os números de versão no `update.yml`.
- Sem vínculo com o YouTube nem com os canais monitorados.
