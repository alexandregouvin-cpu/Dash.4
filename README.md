# Faturas de Frete

Painel para acompanhar as faturas que as transportadoras enviam por e-mail:
valores em aberto, calendário de vencimentos, lembretes e pontos de conferência.
A governança oficial continua no TMS; este painel dá a visão ampla e antecipa
vencimentos.

## Como abrir

Abra `index.html` no navegador (duplo clique). Não precisa de servidor.

Painel de operação na identidade Apis Flora: coluna verde escura com relógio e
os números principais, conteúdo em fundo claro. Tem **Modo Individual** (filtros,
rolagem e livro completo) e **Modo TV** (tela única 1920×1080 que se ajusta à
TV, com a fila paginada a cada 10 segundos), como no Mapa de Transportadoras.

- Se existir `dados/faturas.js`, o painel mostra as faturas reais.
- Se não existir, mostra os **dados de exemplo** de `dados/faturas.exemplo.js`
  (transportadoras fictícias, datas geradas em relação a hoje).

## O que o painel mostra

| Bloco | Conteúdo |
|---|---|
| Coluna verde | Relógio, total em aberto, vencidas e o que vence em 7 dias |
| Próximos 14 dias | Valor e quantidade por dia de vencimento (em R$ mil), com as vencidas à esquerda; clique num dia para filtrar a fila |
| Fila de pagamentos | Faturas em aberto por data de vencimento, com a situação em destaque |
| Por transportadora | Em aberto e vencido por transportadora; clique para filtrar |
| Conferir | Faixa com duplicidades, leituras com baixa confiança, campos faltando e prazos curtos, alternando a cada 7 segundos |
| Livro de faturas | Só no Modo Individual: todas as faturas, ordenável, com link para o PDF e marcação de "paga"; botão **Copiar resumo** para e-mail ou Teams |

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
