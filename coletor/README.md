# Coletor de faturas

Busca os PDFs de fatura no Outlook, lê cada um e atualiza o painel
(`dados/faturas.js`). Roda no computador que tem o Outlook instalado, sem
custo e sem enviar as faturas para nenhum serviço externo.

## Como funciona

1. Abre a pasta do Outlook definida no `config.json` e pega os anexos em PDF dos
   últimos dias (45 por padrão).
2. Copia cada PDF para `pdfs/AAAA-MM/`, para o link "Abrir" do painel funcionar.
3. Reconhece o modelo da fatura e tira transportadora, número, emissão,
   vencimento, valor, quantidade de CT-es, CNPJ do pagador e se é frete ou
   reentrega/devolução (`leitores.py`, um leitor por modelo).
4. Confere o resultado com a **linha digitável do boleto**, que traz o
   vencimento e o valor embutidos. Se não bater, a fatura vai para "Conferir"
   no painel com o valor do boleto ao lado.
5. A mesma fatura recebida mais de uma vez vira um registro só, com o aviso
   "Recebida N vezes".
6. O que já foi baixado do Outlook fica anotado em `registro.json`, para não
   baixar o mesmo anexo de novo.

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
   | `outlook_pasta` | Caminho da pasta com as faturas, ex.: `Caixa de Entrada/Faturas Transportadoras` |
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
execute `executar_coletor.bat`. O histórico de cada execução fica em
`coletor.log`. O Outlook precisa estar instalado e com a conta configurada
nesse computador.

## Dados sensíveis

`config.json`, `registro.json`, a pasta `pdfs/` e `dados/faturas.js` contêm
dados das faturas e estão no `.gitignore`. Não os envie ao GitHub, porque o
repositório é público.

## Leitura pela API do Claude (opcional)

Se um dia as transportadoras mudarem muito de modelo, dá para trocar a leitura
local pela API do Claude, que entende qualquer layout: ponha `"leitura": "claude"`
no `config.json`, rode `pip install anthropic` e grave a chave com
`setx ANTHROPIC_API_KEY "sua-chave"`. Esse modo tem custo por fatura lida.

