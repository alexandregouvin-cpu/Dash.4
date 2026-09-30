/*
 * Dados de EXEMPLO para o dashboard de faturas.
 * As transportadoras e os valores são fictícios. As datas são geradas em
 * relação ao dia de hoje para que o exemplo sempre mostre vencimentos
 * próximos, vencidos e futuros.
 *
 * O coletor real grava dados/faturas.js com window.FATURAS_DADOS no mesmo
 * formato (veja o README), e o dashboard passa a usar esse arquivo.
 */
(function () {
  var seed = 20260930;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }
  function iso(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + dia;
  }
  function somaDias(d, n) {
    var r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() + n);
    return r;
  }

  var hoje = new Date();
  hoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  // ciclo = dias entre faturas; prazo = dias entre emissão e vencimento
  var transportadoras = [
    { nome: "Rodonorte Transportes", cnpj: "11.482.905/0001-37", email: "faturamento@rodonorte.exemplo", ciclo: 7, prazo: 21, base: 18500, ctes: 42, serie: "RN" },
    { nome: "TransVale Cargas", cnpj: "23.719.604/0001-52", email: "cobranca@transvale.exemplo", ciclo: 15, prazo: 30, base: 41200, ctes: 96, serie: "TV" },
    { nome: "Expresso Serra Azul", cnpj: "08.365.217/0001-04", email: "financeiro@serraazul.exemplo", ciclo: 10, prazo: 15, base: 12800, ctes: 31, serie: "ESA" },
    { nome: "LogSul Rodoviário", cnpj: "31.904.558/0001-81", email: "faturas@logsul.exemplo", ciclo: 14, prazo: 28, base: 26900, ctes: 58, serie: "LS" },
    { nome: "Carga Certa Logística", cnpj: "19.227.140/0001-66", email: "contas@cargacerta.exemplo", ciclo: 30, prazo: 30, base: 63500, ctes: 140, serie: "CC" },
    { nome: "Rápido Cerrado", cnpj: "27.558.391/0001-09", email: "adm@rapidocerrado.exemplo", ciclo: 7, prazo: 10, base: 7400, ctes: 19, serie: "RC" }
  ];

  var faturas = [];
  var n = 0;
  transportadoras.forEach(function (t, ti) {
    var numero = 4180 + ti * 1375;
    // emissões dos últimos 80 dias até ontem
    for (var off = -80 + Math.floor(rnd() * t.ciclo); off < 0; off += t.ciclo) {
      var emissao = somaDias(hoje, off);
      var vencimento = somaDias(emissao, t.prazo);
      var valor = Math.round(t.base * (0.72 + rnd() * 0.56) * 100) / 100;
      var ctes = Math.max(3, Math.round(t.ctes * (0.7 + rnd() * 0.6)));
      numero += 1 + Math.floor(rnd() * 3);
      var diasAteVenc = Math.round((vencimento - hoje) / 86400000);
      // o que venceu há mais de alguns dias já foi pago, salvo exceções
      var pago = diasAteVenc < -4 && rnd() > 0.12;
      n += 1;
      faturas.push({
        id: "ex-" + n,
        transportadora: t.nome,
        cnpj: t.cnpj,
        numero: t.serie + "-" + numero,
        emissao: iso(emissao),
        vencimento: iso(vencimento),
        valor: valor,
        qtd_ctes: ctes,
        remetente: t.email,
        recebido_em: iso(somaDias(emissao, rnd() > 0.7 ? 2 : 1)),
        arquivo: null,
        confianca: "alta",
        pendencias: [],
        pago: pago
      });
    }
  });

  // Casos para a lista de revisão
  var aberta = faturas.filter(function (f) { return !f.pago; });
  var dup = aberta[3];
  faturas.push(Object.assign({}, dup, { id: "ex-dup", recebido_em: iso(somaDias(new Date(dup.recebido_em + "T00:00"), 3)) }));

  var baixa = aberta[9];
  baixa.confianca = "baixa";
  baixa.pendencias = ["Quantidade de CT-es não encontrada no PDF"];
  baixa.qtd_ctes = null;

  var curta = aberta[14];
  curta.vencimento = iso(somaDias(new Date(curta.emissao + "T00:00"), 3));

  window.FATURAS_EXEMPLO = {
    gerado_em: new Date().toISOString(),
    fonte: "exemplo",
    faturas: faturas
  };
})();
