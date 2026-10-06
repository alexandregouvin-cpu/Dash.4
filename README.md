# Faturas de Frete

Painel para acompanhar as faturas que as transportadoras enviam por e-mail:
valores em aberto, calendário de vencimentos, lembretes e pontos de conferência.
A governança oficial continua no TMS; este painel dá a visão ampla e antecipa
vencimentos.

## Como abrir

Abra `index.html` no navegador (duplo clique). Não precisa de servidor.

Conceito **Favo**: a logo Apis Flora vira o painel. O hexágono vermelho do centro
mostra as vencidas e os seis amarelos em volta são as transportadoras. O favo tem
sempre os 7 hexágonos da logo; com mais de 6 transportadoras ele ganha páginas
(o sexto hexágono vira "+N" e, na página seguinte, um hexágono "Principais" volta).
Tem **Modo Individual** (filtros e livro de faturas) e **Modo TV** (tela única
1920×1080, com o favo e os próximos pagamentos alternando sozinhos).

- Se existir `dados/faturas.js`, o painel mostra as faturas reais.
- Se não existir, mostra os **dados de exemplo** de `dados/faturas.exemplo.js`
  (transportadoras fictícias, datas geradas em relação a hoje).

## O que o painel mostra

| Bloco | Conteúdo |
|---|---|
| Favo | Vencidas no centro; transportadoras em volta com valor em aberto e vencido; clique para filtrar o painel |
| Números | Total em aberto, quanto vence em 7 dias, quantidade de faturas e de transportadoras |
| Próximos pagamentos | Vencidas e próximas faturas por data de vencimento |
| Conferir | Duplicidades, leituras com baixa confiança, campos faltando e prazos curtos, alternando a cada 7 segundos |
| Livro de faturas | Só no Modo Individual: todas as faturas, filtros, ordenação, link para o PDF e marcação de "paga"; botão **Copiar resumo** para e-mail ou Teams |

"Marcar como paga" fica salvo só no navegador de quem marcou. Quando o coletor
souber a situação de pagamento (por exemplo, cruzando com um relatório do TMS),
ele grava `"pago": true` e a fatura aparece como paga para todos.

## Formato dos dados (`dados/faturas.js`)

O coletor deve gerar este arquivo:

```js
window.FATURAS_DADOS = {
  "gerado_em": "2026-09-30T07:00:00-03:00",
  "fonte": "outlook",
  "faturas": [
    {
      "id": "AAMkAGI2...-1",              // único e estável (ex.: id do e-mail + nº do anexo)
      "transportadora": "Rodonorte Transportes",
      "cnpj": "11.482.905/0001-37",
      "numero": "RN-4188",
      "emissao": "2026-08-11",            // AAAA-MM-DD
      "vencimento": "2026-09-01",         // AAAA-MM-DD
      "valor": 15538.11,
      "qtd_ctes": 31,                     // null se não encontrado
      "remetente": "faturamento@rodonorte.com.br",
      "recebido_em": "2026-08-12",
      "arquivo": "pdfs/2026-08/rodonorte_RN-4188.pdf",  // caminho relativo ao index.html, ou null
      "confianca": "alta",                // alta | media | baixa (vinda da extração)
      "pendencias": [],                   // ex.: ["Quantidade de CT-es não encontrada no PDF"]
      "pago": false
    }
  ]
};
```

É um `.js` (e não `.json`) para funcionar abrindo o arquivo direto, sem servidor.

## Coletor do Outlook

A pasta `coletor/` tem o programa que lê os PDFs de fatura do Outlook com a API
do Claude, confere vencimento e valor com o boleto e grava `dados/faturas.js`.
Instalação e uso em [coletor/README.md](coletor/README.md).

Campos extras que o coletor grava além dos do exemplo acima: `razao_social`,
`cnpj_pagador` (unidade da empresa que paga), `tipo` (`frete` ou
`reentrega_devolucao`), `linha_digitavel` e `copias` (quando a mesma fatura
chegou mais de uma vez).

## Próximas etapas

1. Instalar o coletor no computador com o Outlook e agendar a execução diária.
2. Lembrete diário por e-mail com o resumo de vencimentos.
3. Cruzamento com o TMS (opcional): marcar faturas pagas e apontar faturas que
   chegaram por e-mail mas não constam no TMS.
