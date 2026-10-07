"""
Leitura local das faturas, sem IA e sem custo.

Cada transportadora usa um modelo de PDF. Aqui há um leitor por modelo,
reconhecido por trechos fixos do texto. Quando o modelo não é conhecido, o
leitor genérico tira do boleto o vencimento e o valor, do texto o CNPJ, e a
fatura vai para "Conferir" no painel.

Todos os leitores devolvem o mesmo dicionário (ver CAMPOS).
"""

from __future__ import annotations

import re

# Aumente quando um leitor mudar: o coletor relê só os PDFs lidos com versão anterior.
VERSAO_LEITORES = "3"

CAMPOS = (
    "eh_fatura", "transportadora", "nome_curto", "cnpj_transportadora", "numero_fatura",
    "data_emissao", "data_vencimento", "valor_total", "qtd_ctes", "cnpj_pagador",
    "tipo_cobranca", "observacao", "modelo",
)

CNPJ = r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}"
DATA = r"\d{2}/\d{2}/\d{4}"
VALOR = r"\d{1,3}(?:\.\d{3})*,\d{2}"

MESES = {m: i for i, m in enumerate(
    ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
     "agosto", "setembro", "outubro", "novembro", "dezembro"], start=1)}

# Nome curto das transportadoras já conhecidas (raiz do CNPJ). O config.json
# pode sobrescrever ou acrescentar com "apelidos".
NOMES_CONHECIDOS = {
    "00193687": "Troca Transportes",
    "00428307": "Expresso São Miguel",
    "48740351": "Braspress",
    "01125797": "Ativa Logística",
    "02360122": "Mosca Logística",
    "11423942": "TTJB Transportes",
    "12053556": "Aviões Transportes",
    "34922709": "Movimente Express",
    "44914992": "Rodonaves",
}


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def data_iso(s: str | None) -> str | None:
    if not s:
        return None
    d, m, a = s.split("/")
    return f"{a}-{m}-{d}"


def numero(s: str | None) -> float | None:
    return float(s.replace(".", "").replace(",", ".")) if s else None


def achar(padrao: str, texto: str, grupo: int = 1, flags: int = re.M) -> str | None:
    m = re.search(padrao, texto, flags)
    return m.group(grupo).strip() if m else None


def raiz(cnpj: str | None) -> str:
    return re.sub(r"\D", "", cnpj or "")[:8]


def cnpjs(texto: str) -> list[str]:
    vistos = []
    for c in re.findall(CNPJ, texto):
        if c not in vistos:
            vistos.append(c)
    return vistos


def nome_curto(razao: str | None, cnpj: str | None) -> str:
    if raiz(cnpj) in NOMES_CONHECIDOS:
        return NOMES_CONHECIDOS[raiz(cnpj)]
    if not razao:
        return cnpj or "Transportadora não identificada"
    palavras = [p for p in re.split(r"\s+", razao) if p.upper() not in {"LTDA", "S/A", "SA", "S.A.", "EIRELI", "ME", "EPP"}]
    return " ".join(palavras[:3]).title()


def vazio() -> dict:
    return {c: None for c in CAMPOS} | {"eh_fatura": True, "tipo_cobranca": "frete"}


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------

def ler_ssw(t: str) -> dict:
    """Faturas geradas pelo sistema SSW (Ativa, Mosca, TTJB, Aviões e outras)."""
    r = vazio()
    r["transportadora"] = achar(r"^Recibo do Pagador\n(.+?) Pág:", t)
    r["cnpj_transportadora"] = achar(rf"CNPJ/CPF: ({CNPJ}) - IE", t)
    r["numero_fatura"] = achar(r"FATURA Nº:\s*(\S+)", t)
    r["data_emissao"] = data_iso(achar(rf"FATURA Nº:\s*\S+ Emissão: ({DATA})", t))
    linha = re.search(rf"Vencimento Nº do Documento Espécie Valor do Documento\n({DATA}) \S+ ({VALOR})", t)
    if linha:
        r["data_vencimento"] = data_iso(linha.group(1))
        r["valor_total"] = numero(linha.group(2))
    total = achar(rf"^VALOR TOTAL ({VALOR})", t)
    if total:
        r["valor_total"] = numero(total)
    qtds = re.findall(r"^Quantidade de documentos: (\d+)", t, re.M)
    r["qtd_ctes"] = sum(int(q) for q in qtds) if qtds else None
    r["cnpj_pagador"] = achar(rf"Pagador CNPJ: ({CNPJ})", t)
    blocos = re.findall(r"^(FRETE|REENTREGA / DEVOLUÇÃO) (?:CIF|FOB)", t, re.M)
    if blocos and all(b.startswith("REENTREGA") for b in blocos):
        r["tipo_cobranca"] = "reentrega_devolucao"
    return r


def ler_troca(t: str) -> dict:
    """Modelo com cabeçalho 'FATURA N°/FILIAL/UNIDADE' (Troca Transportes)."""
    r = vazio()
    r["transportadora"] = achar(r"\A(.+?) ISO:", t, flags=0) or achar(r"^Beneficiário: (.+?) CPF/CNPJ", t)
    r["cnpj_transportadora"] = achar(rf"CPF/CNPJ: ({CNPJ})", t)
    m = re.search(rf"- ({CNPJ}) (\d+)/\d+/\d+ \S+ ({DATA}) ({DATA})", t)
    if m:
        r["cnpj_pagador"], r["numero_fatura"] = m.group(1), m.group(2)
        r["data_emissao"], r["data_vencimento"] = data_iso(m.group(3)), data_iso(m.group(4))
    m = re.search(rf"Quant\.documentos Valor Total Valor Desconto Valor Documento\n(\d+) {VALOR} {VALOR} ({VALOR})", t)
    if m:
        r["qtd_ctes"], r["valor_total"] = int(m.group(1)), numero(m.group(2))
    return r


def ler_sao_miguel(t: str) -> dict:
    """Modelo 'Esta é a sua fatura de ...' (Expresso São Miguel)."""
    r = vazio()
    m = re.search(rf"^Beneficiário Vencimento\n(.+?) \| CNPJ: ({CNPJ})", t, re.M)
    if m:
        r["transportadora"], r["cnpj_transportadora"] = m.group(1), m.group(2)
    r["valor_total"] = numero(achar(rf"no valor de R\$ ({VALOR})", t))
    r["data_vencimento"] = data_iso(achar(rf"^VENCIMENTO VALOR\n({DATA})", t))
    m = re.search(rf"^Data do Documento Nº do Documento.*\n({DATA}) (\d+)", t, re.M)
    if m:
        r["data_emissao"], r["numero_fatura"] = data_iso(m.group(1)), m.group(2)
    r["cnpj_pagador"] = achar(rf"^Pagador\n.* ({CNPJ})", t)
    if "CTe n°" in t:
        lista = t.split("CTe n°", 1)[1]
        r["qtd_ctes"] = len(re.findall(rf"\b\d+ R\$ {VALOR}", lista))
    return r


def ler_braspress(t: str) -> dict:
    """Modelo Braspress (AWB, 'Nº da Fatura')."""
    r = vazio()
    r["numero_fatura"] = achar(r"Nº da Fatura: (\d+)", t)
    m = re.search(r"Emissão: (\d{1,2}) de (\w+) de (\d{4})", t)
    if m and m.group(2).lower() in MESES:
        r["data_emissao"] = f"{m.group(3)}-{MESES[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    r["cnpj_transportadora"] = achar(rf"^CNPJ ({CNPJ}) Insc", t)
    m = re.search(rf"^Beneficiário Final Vencimento.*\n(.+?) ({DATA})", t, re.M)
    if m:
        r["transportadora"], r["data_vencimento"] = m.group(1), data_iso(m.group(2))
    totais = achar(r"^TOTAL BRUTO.*\n(.+)$", t)
    if totais:
        partes = totais.split()
        r["valor_total"] = numero(partes[-1])
        if partes[-3].isdigit():
            r["qtd_ctes"] = int(partes[-3])
    r["cnpj_pagador"] = achar(rf"Cliente: .*?CNPJ: ({CNPJ})", t)
    return r


def ler_rodonaves(t: str) -> dict:
    """Modelo 'Devem a ... a importância referente aos conhecimentos' (Rodonaves)."""
    r = vazio()
    m = re.search(rf"Emitida em Fatura\n({DATA}) às \S+ (\S+)", t)
    if m:
        r["data_emissao"], r["numero_fatura"] = data_iso(m.group(1)), m.group(2)
    r["cnpj_transportadora"] = achar(rf"CNPJ/CPF: ({CNPJ})", t)
    r["transportadora"] = achar(rf"{CNPJ} - ([^/\n]+?) /", t) or achar(r"\n(.+?LTDA)", t)
    m = re.search(rf"Valor líquido Data de vencimento\nR\$ {VALOR} R\$ {VALOR} R\$ {VALOR} R\$ ({VALOR}) ({DATA})", t)
    if m:
        r["valor_total"], r["data_vencimento"] = numero(m.group(1)), data_iso(m.group(2))
    qtd = achar(r"QTD total fretes.*\n(\d+) R\$", t)
    r["qtd_ctes"] = int(qtd) if qtd else None
    return r


def ler_movimente(t: str) -> dict:
    """Modelo 'Minuta CTE/NFSE' com 'Dados do sacado' (Movimente Express)."""
    r = vazio()
    r["transportadora"] = t.strip().splitlines()[0].strip()
    r["cnpj_transportadora"] = achar(rf"^CNPJ:({CNPJ})", t)
    # O número da fatura fica logo abaixo do nome, no topo (é o que vai no assunto do
    # e-mail). O número da tabela "Número Vencimento Parcela" é o do boleto.
    r["numero_fatura"] = achar(r"\A.+\n(\d+)\n", t, flags=0)
    m = re.search(rf"^Número Vencimento Parcela Valor.*\n(\d+) ({DATA}) \S+ ({VALOR})", t, re.M)
    if m:
        r["numero_fatura"] = r["numero_fatura"] or m.group(1)
        r["data_vencimento"], r["valor_total"] = data_iso(m.group(2)), numero(m.group(3))
    r["data_emissao"] = data_iso(achar(rf"Desconto Emissão\n.*?({DATA})", t))
    qtd = achar(r"Qtd\. Remessas (\d+)", t)
    r["qtd_ctes"] = int(qtd) if qtd else None
    if re.search(r"^Obs: DEVOLU", t, re.M):
        r["tipo_cobranca"] = "reentrega_devolucao"
    return r


MODELOS = [
    ("ssw", lambda t: "ssw.inf.br" in t and "FATURA Nº:" in t, ler_ssw),
    ("troca", lambda t: "FATURA N°/FILIAL/UNIDADE" in t, ler_troca),
    ("sao_miguel", lambda t: "Esta é a sua fatura de" in t, ler_sao_miguel),
    ("braspress", lambda t: "Nº da Fatura:" in t and "AWB" in t, ler_braspress),
    ("rodonaves", lambda t: "importância referente aos conhecimentos" in t, ler_rodonaves),
    ("movimente", lambda t: "Minuta CTE/NFSE" in t and "Dados do sacado" in t, ler_movimente),
]


def ler_generico(t: str, boletos: list[dict], raiz_empresa: str) -> dict:
    """Modelo desconhecido: aproveita boleto, CNPJs e padrões comuns."""
    r = vazio()
    lista = cnpjs(t)
    r["cnpj_transportadora"] = next((c for c in lista if raiz(c) != raiz_empresa), None)
    r["cnpj_pagador"] = next((c for c in lista if raiz(c) == raiz_empresa), None)
    r["numero_fatura"] = achar(r"FATURA\s*N[º°o]?\.?\s*:?\s*([\w-]+\d)", t, flags=re.I)
    r["data_emissao"] = data_iso(achar(rf"Emiss[ãa]o:?\s*({DATA})", t, flags=re.I))
    if boletos:
        r["data_vencimento"], r["valor_total"] = boletos[0]["vencimento"], boletos[0]["valor"]
    r["observacao"] = "Modelo de fatura não reconhecido: confira os dados"
    # Só conta como fatura de frete se tiver boleto, a empresa como pagadora e
    # vocabulário de transporte. Nota fiscal, DACTE avulso, manual etc. ficam de fora.
    de_frete = re.search(r"\bCT-?e\b|conhecimento|frete|transport", t, re.I)
    r["eh_fatura"] = bool(boletos and r["cnpj_pagador"] and de_frete)
    return r


def ler_local(texto: str, boletos: list[dict], raiz_empresa: str = "49345358") -> dict:
    t = texto.replace("\r", "")
    for nome, reconhece, leitor in MODELOS:
        if reconhece(t):
            r = leitor(t)
            r["modelo"] = nome
            break
    else:
        r = ler_generico(t, boletos, raiz_empresa)
        r["modelo"] = "generico"
    if not r["cnpj_pagador"]:
        r["cnpj_pagador"] = next((c for c in cnpjs(t) if raiz(c) == raiz_empresa), None)
    if not r["cnpj_transportadora"]:
        r["cnpj_transportadora"] = next((c for c in cnpjs(t) if raiz(c) != raiz_empresa), None)
    r["transportadora"] = (r["transportadora"] or "").strip() or None
    r["nome_curto"] = nome_curto(r["transportadora"], r["cnpj_transportadora"])
    if not r["transportadora"]:
        r["transportadora"] = r["nome_curto"]
    return r
