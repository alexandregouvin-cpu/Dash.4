# Coletor de faturas

Lê os PDFs de fatura e os avisos de e-mail, extrai os dados e atualiza o painel
(`dados/faturas.js`). Roda no computador, sem custo e sem enviar as faturas
para nenhum serviço externo.

## Montagem em uso

```
e-mail chega numa pasta do Outlook
  → fluxo do Power Automate grava o corpo (.html) e os PDFs na pasta
    FaturasEntrada do OneDrive
  → o OneDrive sincroniza a pasta no PC
  → o Agendador de Tarefas roda executar_coletor.bat (7h e 13h)
  → o painel (index.html) mostra as faturas
```

### Fluxos do Power Automate

Um fluxo por pasta do Outlook (um fluxo só aceita uma pasta). Todos iguais,
muda só o campo **Pasta** do gatilho:

1. Gatilho **Quando um novo email é recebido (V3)** (Office 365 Outlook):
   Pasta = a pasta da regra, Incluir Anexos = Sim, Somente com Anexos = Não.
2. **Criar arquivo** (OneDrive for Business), caminho `/FaturasEntrada`:
   - Nome: `concat('email_', formatDateTime(triggerOutputs()?['body/receivedDateTime'],'yyyyMMdd_HHmmss'), '_', guid(), '.html')`
   - Conteúdo: `concat('Assunto: ', triggerOutputs()?['body/subject'], decodeUriComponent('%0A'), 'De: ', triggerOutputs()?['body/from'], decodeUriComponent('%0A'), 'Recebido: ', triggerOutputs()?['body/receivedDateTime'], decodeUriComponent('%0A'), '---', decodeUriComponent('%0A'), triggerOutputs()?['body/body'])`
3. **Aplicar a cada** sobre os anexos do gatilho, com uma **Condição**
   `endsWith(toLower(item()?['name']), '.pdf')` é igual a `true`. No ramo
   Verdadeiro:
   - **Obter Anexo (V2)**: Id da mensagem = `triggerOutputs()?['body/id']`,
     Id do anexo = `item()?['id']`.
   - **Criar arquivo** em `/FaturasEntrada`:
     - Nome: `concat(formatDateTime(triggerOutputs()?['body/receivedDateTime'],'yyyyMMdd_HHmmss'), '_', item()?['name'])`
     - Conteúdo: `base64ToBinary(body('Obter_Anexo_(V2)')?['contentBytes'])`

Para uma pasta nova: abra um dos fluxos → **Salvar como** → **Editar** →
troque a Pasta e confira Incluir Anexos = Sim e Somente com Anexos = Não
(a cópia perde esses dois) → **Salvar** → **Ligar**.

A pasta FaturasEntrada fica no OneDrive pessoal de quem criou os fluxos e
precisa estar marcada para sincronizar nesse PC. No `config.json`:
`"pasta_entrada": "%USERPROFILE%\\OneDrive - Apis Flora Indl. e Coml. Ltda\\FaturasEntrada"`.

Rode o coletor em um computador só. Dois PCs gravando o mesmo
`registro.json` geram cópias em conflito no OneDrive.

## Como funciona

1. Lê a `pasta_entrada` (PDFs e avisos .html gravados pelos fluxos). Sem
   `pasta_entrada`, abre as pastas do Outlook clássico definidas no
   `config.json` e pega os anexos em PDF dos últimos dias (45 por padrão).
2. Descarta o que não é fatura de frete (nota fiscal, DACTE avulso, manual,
   comunicado...) pelo conteúdo do PDF, não pela pasta. Para contar como fatura
   de modelo desconhecido, o PDF precisa ter boleto, a empresa como pagadora e
   termos de transporte (CT-e, frete, conhecimento).
   Também lê os **avisos por e-mail sem PDF** ("Sua fatura Nº ... está
   disponível" do sistema SSW e "Sua fatura chegou" da Expresso São Miguel):
   número, valor, vencimento e o link "AQUI". Se o PDF da mesma fatura também
   chegar, fica o PDF; lembretes repetidos viram um registro só. No painel,
   essas faturas aparecem com o link "Página" e a nota "só aviso por e-mail".
3. Copia cada fatura para `pdfs/AAAA-MM/`, para o link "Abrir" do painel funcionar.
4. Reconhece o modelo da fatura e tira transportadora, número, emissão,
   vencimento, valor, quantidade de CT-es, CNPJ do pagador e se é frete ou
   reentrega/devolução (`leitores.py`, um leitor por modelo).
5. Confere o resultado com a **linha digitável do boleto**, que traz o
   vencimento e o valor embutidos. Se não bater, a fatura vai para "Conferir"
   no painel com o valor do boleto ao lado.
6. A mesma fatura recebida mais de uma vez (primeiro envio e lembretes de
   vencimento, com ou sem PDF) vira um registro só, pela transportadora e pelo
   número da fatura. No livro aparece "recebida N vezes", sem ir para
   "Conferir". Só vai para "Conferir" se o mesmo número chegar com valores
   diferentes; nesse caso fica o envio mais recente.
7. O que já foi lido fica anotado em `registro.json`, para não
   ler o mesmo PDF de novo.

## Modelos de fatura reconhecidos

| Modelo | Transportadoras |
|---|---|
| Sistema SSW | Ativa, Mosca, TTJB, Aviões (e outras que usem o SSW) |
| Troca | Troca Transportes |
| São Miguel | Expresso São Miguel |
| Braspress | Braspress |
| Rodonaves | Rodonaves |
| Movimente | Movimente Express |

Testado com 21 faturas reais: todos os campos lidos corretamente.

**Transportadora nova com outro modelo:** a fatura entra no painel com
vencimento, valor e CNPJ tirados do boleto e vai para "Conferir" com o aviso
"Modelo de fatura não reconhecido". Envie um PDF desse modelo para criar o
leitor. Depois disso, ao rodar o coletor de novo, as faturas antigas desse
modelo são relidas e se corrigem sozinhas.

Nível de confiança mostrado no painel:

| Confiança | Quando |
|---|---|
| alta | vencimento e valor batem com o boleto |
| média | o PDF não tem boleto para conferir |
| baixa | faltou algum campo ou algo não bateu (aparece em "Conferir") |

## Instalação (uma vez)

1. Instale o Python 3.10 ou mais novo em <https://www.python.org/downloads/>
   (marque "Add Python to PATH").
2. Abra o Prompt de Comando nesta pasta e rode:

   ```
   py -m pip install -r requirements.txt
   ```

   Se o Windows disser que `py` não é reconhecido, use `python -m pip ...`.

3. Copie `config.exemplo.json` para `config.json` e ajuste:

   | Campo | O que é |
   |---|---|
   | `outlook_pastas` | Pastas a ler, pelo nome (achadas em qualquer nível da caixa), ex.: `["Faturas transportadoras", "Ativa"]`. Use `["*"]` para a caixa inteira |
   | `outlook_conta` | Deixe vazio para a sua caixa; preencha com o nome da caixa compartilhada se for o caso |
   | `dias_retroativos` | Quantos dias para trás buscar |
   | `remetentes_permitidos` | Opcional: só ler e-mails desses domínios, ex.: `["@braspress.com.br"]` |
   | `apelidos` | Opcional: nome que aparece no painel por CNPJ, ex.: `{"01.125.797": "Ativa"}` |

4. No Outlook, crie uma regra que mova os e-mails de fatura para a pasta
   escolhida (por remetente ou por palavras do assunto).

## Uso

```
py coletor.py                    # lê o Outlook
py coletor.py --pasta C:\faturas  # lê PDFs de uma pasta, útil para testar
py coletor.py --reprocessar      # lê tudo de novo, ignorando o registro
```

Depois, abra o `index.html` do painel. Ele passa a mostrar as faturas reais no
lugar dos dados de exemplo.

## Atualização automática

No Agendador de Tarefas do Windows, crie uma tarefa diária (ex.: 7h e 13h) que
execute `executar_coletor.bat` ("Iniciar em" pode ficar vazio). Deixe
"Executar somente quando o usuário estiver conectado", porque o OneDrive só
sincroniza com o usuário logado, e marque em Configurações "Executar a tarefa o
mais cedo possível após perder uma inicialização agendada". O histórico de cada
execução fica em `coletor.log`.

Se o Windows avisar que o `.bat` veio da internet, desmarque "Sempre perguntar
antes de abrir este arquivo" e execute uma vez.

## Dados sensíveis

`config.json`, `registro.json`, a pasta `pdfs/` e `dados/faturas.js` contêm
dados das faturas e estão no `.gitignore`. Não os envie ao GitHub, porque o
repositório é público.

## Leitura pela API do Claude (opcional)

Se um dia as transportadoras mudarem muito de modelo, dá para trocar a leitura
local pela API do Claude, que entende qualquer layout: ponha `"leitura": "claude"`
no `config.json`, rode `pip install anthropic` e grave a chave com
`setx ANTHROPIC_API_KEY "sua-chave"`. Esse modo tem custo por fatura lida.

