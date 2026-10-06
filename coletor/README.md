# Coletor de faturas

Busca os PDFs de fatura no Outlook, lê cada um com a API do Claude e atualiza o
painel (`dados/faturas.js`). Roda no computador que tem o Outlook instalado.

## Como funciona

1. Abre a pasta do Outlook definida no `config.json` e pega os anexos em PDF dos
   últimos dias (45 por padrão).
2. Copia cada PDF para `pdfs/AAAA-MM/`, para o link "Abrir" do painel funcionar.
3. Envia o PDF para a API do Claude, que devolve transportadora, número, emissão,
   vencimento, valor, quantidade de CT-es, CNPJ do pagador e se é frete ou
   reentrega/devolução. Funciona com qualquer modelo de fatura.
4. Confere o resultado com a **linha digitável do boleto**, que traz o
   vencimento e o valor embutidos. Se não bater, a fatura vai para "Conferir"
   no painel com o valor do boleto ao lado.
5. A mesma fatura recebida mais de uma vez vira um registro só, com o aviso
   "Recebida N vezes".
6. Cada PDF é lido uma única vez. O resultado fica guardado em `registro.json`,
   então rodar de novo não gera custo com o que já foi lido.

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
   pip install -r requirements.txt
   ```

3. Crie a chave da API em <https://platform.claude.com> (API Keys) e grave na
   variável de ambiente do Windows:

   ```
   setx ANTHROPIC_API_KEY "sua-chave-aqui"
   ```

   Feche e abra o Prompt de Comando depois disso.
4. Copie `config.exemplo.json` para `config.json` e ajuste:

   | Campo | O que é |
   |---|---|
   | `outlook_pasta` | Caminho da pasta com as faturas, ex.: `Caixa de Entrada/Faturas Transportadoras` |
   | `outlook_conta` | Deixe vazio para a sua caixa; preencha com o nome da caixa compartilhada se for o caso |
   | `dias_retroativos` | Quantos dias para trás buscar |
   | `remetentes_permitidos` | Opcional: só ler e-mails desses domínios, ex.: `["@braspress.com.br"]` |
   | `apelidos` | Opcional: nome que aparece no painel por CNPJ, ex.: `{"01.125.797": "Ativa"}` |
   | `esforco` | Profundidade da leitura (`low` é suficiente para faturas) |

5. No Outlook, crie uma regra que mova os e-mails de fatura para a pasta
   escolhida (por remetente ou por palavras do assunto).

## Uso

```
python coletor.py                    # lê o Outlook
python coletor.py --pasta C:\faturas  # lê PDFs de uma pasta, útil para testar
python coletor.py --reprocessar      # lê tudo de novo, ignorando o registro
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
