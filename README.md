# Faturas de Frete

Painel para acompanhar as faturas que as transportadoras enviam por e-mail:
valores em aberto, calendário de vencimentos, lembretes e pontos de conferência.
A governança oficial continua no TMS; este painel dá a visão ampla e antecipa
vencimentos.

## Como abrir

Abra `index.html` no navegador (duplo clique). Não precisa de servidor.

O visual segue a identidade Apis Flora usada no Mapa de Transportadoras
(verde profundo, menta, amarelo, Poppins + Inter, logo em `assets/`).

- Se existir `dados/faturas.js`, o painel mostra as faturas reais.
- Se não existir, mostra os **dados de exemplo** de `dados/faturas.exemplo.js`
  (transportadoras fictícias, datas geradas em relação a hoje).

## O que o painel mostra

| Bloco | Conteúdo |
|---|---|
| Indicadores | Em aberto, vencidas, vencem em até 7 dias, emitidas no mês |
| Lembretes | Vencidas, vencem hoje e próximos 7 dias; botão **Copiar resumo** gera um texto para e-mail ou Teams |
| Calendário | Valor a vencer por dia; clique num dia para filtrar a tabela |
| Cronograma | Valor em aberto por semana de vencimento (8 semanas) + vencidas |
| Por transportadora | Em aberto e vencido por transportadora; clique para filtrar |
| Para conferir | Duplicidade (mesmo CNPJ + número), leitura com baixa confiança, campos faltando, prazo menor que 5 dias, vencimento antes da emissão |
| Tabela | Todas as faturas, ordenável, com link para o PDF e marcação de "paga" |

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

## Próximas etapas

1. **Coletor Outlook (Python)**: ler uma pasta do Outlook, baixar os PDFs de
   remetentes conhecidos e evitar reprocessar e-mails já lidos.
2. **Extração com IA**: enviar cada PDF e receber os campos acima em JSON,
   com validação (datas coerentes, valor > 0) e nível de confiança.
3. **Agendamento e lembrete diário**: rodar todo dia pela manhã e enviar o
   resumo de vencimentos por e-mail.
4. **Cruzamento com o TMS** (opcional): marcar faturas pagas e apontar faturas
   que chegaram por e-mail mas não constam no TMS.
