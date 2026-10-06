"""
Coletor de faturas de frete.

Busca os PDFs de fatura no Outlook (ou numa pasta local), lê cada um com a
API do Claude, confere vencimento e valor com a linha digitável do boleto e
grava dados/faturas.js para o painel.

Uso:
    python coletor.py                      # lê a pasta do Outlook definida no config.json
    python coletor.py --pasta C:\\faturas    # lê os PDFs de uma pasta local
    python coletor.py --reprocessar        # ignora o registro e lê tudo de novo

Requisitos: Python 3.10+, pip install -r requirements.txt e a variável de
ambiente ANTHROPIC_API_KEY com a chave da API.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ_PAINEL = AQUI.parent  # pasta onde está o index.html

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

CONFIG_PADRAO = {
    "outlook_conta": "",
    "outlook_pasta": "Caixa de Entrada/Faturas Transportadoras",
    "dias_retroativos": 45,
    "remetentes_permitidos": [],
    "cnpj_raiz_empresa": "49.345.358",
    "pasta_pdfs": "../pdfs",
    "arquivo_saida": "../dados/faturas.js",
    "arquivo_registro": "registro.json",
    "modelo": "claude-opus-5-5",
    "esforco": "low",
    "apelidos": {},
}


def carregar_config() -> dict:
    cfg = dict(CONFIG_PADRAO)
    arquivo = AQUI / "config.json"
    if arquivo.exists():
        cfg.update(json.loads(arquivo.read_text(encoding="utf-8")))
    return cfg


def caminho(cfg: dict, chave: str) -> Path:
    return (AQUI / cfg[chave]).resolve()


def log(msg: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Boleto: a linha digitável traz o vencimento e o valor embutidos
# ---------------------------------------------------------------------------

LINHA_DIGITAVEL = re.compile(
    r"(\d{5})\.?(\d{5})\s+(\d{5})\.?(\d{6})\s+(\d{5})\.?(\d{6})\s+(\d)\s+(\d{14})"
)
# Desde 22/02/2025 o fator de vencimento recomeçou em 1000 (Febraban).
BASE_FATOR = dt.date(2025, 2, 22)


def ler_boletos(texto: str) -> list[dict]:
    """Devolve vencimento e valor de cada linha digitável encontrada no texto."""
    boletos = {}
    for m in LINHA_DIGITAVEL.finditer(texto):
        campo = m.group(8)
        fator, centavos = int(campo[:4]), int(campo[4:])
        if fator < 1000 or centavos == 0:
            continue
        venc = BASE_FATOR + dt.timedelta(days=fator - 1000)
        linha = " ".join(
            [m.group(1) + "." + m.group(2), m.group(3) + "." + m.group(4), m.group(5) + "." + m.group(6), m.group(7), campo]
        )
        boletos[linha] = {"linha": linha, "vencimento": venc.isoformat(), "valor": round(centavos / 100, 2)}
    return list(boletos.values())


def extrair_texto(pdf: Path) -> str:
    import pdfplumber

    with pdfplumber.open(pdf) as doc:
        return "\n".join((p.extract_text() or "") for p in doc.pages)


# ---------------------------------------------------------------------------
# Leitura com a API do Claude
# ---------------------------------------------------------------------------

def _anulavel(tipo: str) -> dict:
    return {"anyOf": [{"type": tipo}, {"type": "null"}]}


ESQUEMA = {
    "type": "object",
    "properties": {
        "eh_fatura": {"type": "boolean"},
        "transportadora": {"type": "string"},
        "nome_curto": {"type": "string"},
        "cnpj_transportadora": _anulavel("string"),
        "numero_fatura": {"type": "string"},
        "data_emissao": _anulavel("string"),
        "data_vencimento": _anulavel("string"),
        "valor_total": _anulavel("number"),
        "qtd_ctes": _anulavel("integer"),
        "cnpj_pagador": _anulavel("string"),
        "tipo_cobranca": {"type": "string", "enum": ["frete", "reentrega_devolucao", "outro"]},
        "observacao": _anulavel("string"),
    },
    "required": [
        "eh_fatura", "transportadora", "nome_curto", "cnpj_transportadora", "numero_fatura", "data_emissao",
        "data_vencimento", "valor_total", "qtd_ctes", "cnpj_pagador", "tipo_cobranca", "observacao",
    ],
    "additionalProperties": False,
}

INSTRUCOES = """Você recebe um PDF enviado por uma transportadora para a Apis Flora (pagador).
Extraia os dados da FATURA de frete (documento de cobrança que agrupa CT-es), não de um CT-e isolado.

- eh_fatura: false se o PDF não for uma fatura ou cobrança de frete (por exemplo, só um DACTE, comprovante ou nota fiscal).
- transportadora: razão social de quem cobra (beneficiário), sem abreviar além do que está escrito.
- nome_curto: nome pelo qual a transportadora é conhecida, curto e com maiúsculas e minúsculas normais (ex.: "Braspress", "Rodonaves", "Expresso São Miguel", "Ativa").
- cnpj_transportadora e cnpj_pagador: no formato 00.000.000/0000-00.
- numero_fatura: exatamente como impresso, incluindo dígito ou sufixo (ex.: "1604658-2", "14274795-26").
- datas no formato AAAA-MM-DD. data_emissao é a emissão da fatura, não dos CT-es.
- valor_total: valor a pagar da fatura (valor do documento/valor líquido), em reais, número com ponto decimal.
- qtd_ctes: quantidade de conhecimentos (CT-e, AWB, minutas) cobrados. Use o total informado no documento quando houver.
- tipo_cobranca: "reentrega_devolucao" quando a fatura for de reentrega ou devolução; "frete" para frete normal.
- Use null quando um campo não aparecer no documento. Não invente valores.
- observacao: algo fora do comum que mereça conferência, ou null."""


def ler_com_claude(pdf: Path, cfg: dict, cliente) -> dict:
    import anthropic

    dados_pdf = base64.standard_b64encode(pdf.read_bytes()).decode("ascii")
    try:
        resposta = cliente.beta.messages.create(
            model=cfg["modelo"],
            max_tokens=16000,
            # Se o modelo recusar por engano, a API repete a leitura num modelo alternativo.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": cfg["esforco"], "format": {"type": "json_schema", "schema": ESQUEMA}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": dados_pdf}},
                    {"type": "text", "text": INSTRUCOES},
                ],
            }],
        )
    except anthropic.AuthenticationError:
        raise SystemExit("Chave da API inválida. Confira a variável ANTHROPIC_API_KEY.")
    except anthropic.RateLimitError as e:
        raise RuntimeError(f"limite de uso da API atingido, tente mais tarde ({e.message})")
    except anthropic.BadRequestError as e:
        raise RuntimeError(f"a API recusou o arquivo: {e.message}")
    except anthropic.APIStatusError as e:
        raise RuntimeError(f"erro da API ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise RuntimeError("sem conexão com a API")

    if resposta.stop_reason == "refusal":
        raise RuntimeError("a leitura foi recusada pela API")
    if resposta.stop_reason == "max_tokens":
        raise RuntimeError("a resposta da API foi cortada")
    texto = next((b.text for b in resposta.content if b.type == "text"), "")
    return json.loads(texto)


# ---------------------------------------------------------------------------
# Conferência e montagem do registro
# ---------------------------------------------------------------------------

def so_digitos(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def reais(v: float) -> str:
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def valida_data(s: str | None) -> str | None:
    try:
        return dt.date.fromisoformat(s).isoformat() if s else None
    except ValueError:
        return None


def conferir(lido: dict, boletos: list[dict], cfg: dict) -> tuple[str, list[str]]:
    """Compara o que foi lido com o boleto e regras simples. Devolve (confiança, pendências)."""
    pend = []
    venc, valor = lido.get("data_vencimento"), lido.get("valor_total")
    if not venc:
        pend.append("Vencimento não encontrado no PDF")
    if not valor:
        pend.append("Valor não encontrado no PDF")
    if not lido.get("numero_fatura"):
        pend.append("Número da fatura não encontrado")

    raiz = so_digitos(cfg.get("cnpj_raiz_empresa"))
    pagador = so_digitos(lido.get("cnpj_pagador"))
    if raiz and pagador and not pagador.startswith(raiz):
        pend.append("Pagador não é um CNPJ da empresa")

    if lido.get("data_emissao") and venc and venc < lido["data_emissao"]:
        pend.append("Vencimento anterior à emissão")

    confere_boleto = None
    if boletos:
        bate = [b for b in boletos if b["vencimento"] == venc and valor is not None and abs(b["valor"] - valor) < 0.01]
        confere_boleto = bool(bate)
        if not bate:
            b = boletos[0]
            pend.append(f"Boleto indica vencimento {dt.date.fromisoformat(b['vencimento']):%d/%m/%Y} e valor {reais(b['valor'])}")

    if pend:
        confianca = "baixa"
    elif confere_boleto:
        confianca = "alta"
    else:
        confianca = "media"  # sem boleto para conferir
    return confianca, pend


def montar_fatura(lido: dict, origem: dict, boletos: list[dict], cfg: dict) -> dict:
    confianca, pend = conferir(lido, boletos, cfg)
    if lido.get("observacao"):
        pend.append(lido["observacao"])
    razao = (lido.get("transportadora") or "").strip()
    return {
        "id": origem["hash"][:16],
        "transportadora": (lido.get("nome_curto") or razao).strip(),
        "razao_social": razao,
        "cnpj": lido.get("cnpj_transportadora"),
        "numero": (lido.get("numero_fatura") or "").strip(),
        "emissao": valida_data(lido.get("data_emissao")),
        "vencimento": valida_data(lido.get("data_vencimento")),
        "valor": lido.get("valor_total") or 0,
        "qtd_ctes": lido.get("qtd_ctes"),
        "cnpj_pagador": lido.get("cnpj_pagador"),
        "tipo": lido.get("tipo_cobranca"),
        "remetente": origem.get("remetente"),
        "recebido_em": origem.get("recebido_em"),
        "arquivo": origem.get("arquivo"),
        "linha_digitavel": boletos[0]["linha"] if boletos else None,
        "confianca": confianca,
        "pendencias": [p for p in pend if p],
        "pago": False,
    }


def raiz_cnpj(cnpj: str | None) -> str:
    return so_digitos(cnpj)[:8]


def padronizar_nomes(faturas: list[dict], cfg: dict) -> None:
    """Mesma empresa (raiz do CNPJ) sempre com o mesmo nome no painel.
    Usa o apelido do config.json quando houver; senão, o nome curto mais frequente."""
    apelidos = {raiz_cnpj(k): v for k, v in cfg.get("apelidos", {}).items()}
    contagem: dict[str, dict[str, int]] = {}
    for f in faturas:
        r = raiz_cnpj(f.get("cnpj"))
        if r:
            contagem.setdefault(r, {}).setdefault(f["transportadora"], 0)
            contagem[r][f["transportadora"]] += 1
    for f in faturas:
        r = raiz_cnpj(f.get("cnpj"))
        if r in apelidos:
            f["transportadora"] = apelidos[r]
        elif r in contagem:
            f["transportadora"] = max(contagem[r].items(), key=lambda kv: kv[1])[0]


def juntar_copias(faturas: list[dict]) -> list[dict]:
    """A mesma fatura recebida mais de uma vez vira um registro só, com aviso."""
    grupos: dict[tuple, list[dict]] = {}
    for f in faturas:
        chave = (so_digitos(f.get("cnpj")) or f["transportadora"].upper(), f["numero"].upper(), round(f["valor"], 2))
        grupos.setdefault(chave, []).append(f)
    saida = []
    for lista in grupos.values():
        lista.sort(key=lambda f: f.get("recebido_em") or "")
        f = dict(lista[0])
        if len(lista) > 1:
            f["copias"] = len(lista)
            f["pendencias"] = f["pendencias"] + [f"Recebida {len(lista)} vezes"]
        saida.append(f)
    return saida


# ---------------------------------------------------------------------------
# Fontes de PDF
# ---------------------------------------------------------------------------

def hash_arquivo(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def guardar_pdf(origem: Path, cfg: dict, data: dt.date, h: str) -> str:
    """Copia o PDF para pdfs/AAAA-MM/ e devolve o caminho relativo ao painel."""
    destino_dir = caminho(cfg, "pasta_pdfs") / f"{data:%Y-%m}"
    destino_dir.mkdir(parents=True, exist_ok=True)
    nome = re.sub(r"[^\w.\-]+", "_", origem.name)
    destino = destino_dir / f"{h[:8]}_{nome}"
    if not destino.exists():
        shutil.copy2(origem, destino)
    try:
        return destino.relative_to(RAIZ_PAINEL).as_posix()
    except ValueError:
        return destino.as_uri()


def pdfs_da_pasta(pasta: Path, cfg: dict) -> list[dict]:
    itens = []
    for p in sorted(pasta.glob("*.pdf")) + sorted(pasta.glob("*.PDF")):
        h = hash_arquivo(p)
        data = dt.date.fromtimestamp(p.stat().st_mtime)
        itens.append({"hash": h, "arquivo": guardar_pdf(p, cfg, data, h), "caminho": p,
                      "remetente": None, "recebido_em": data.isoformat(), "nome": p.name})
    return itens


def pdfs_do_outlook(cfg: dict, registro: dict) -> list[dict]:
    try:
        import win32com.client  # pywin32, só no Windows com o Outlook instalado
    except ImportError:
        raise SystemExit("Leitura do Outlook só funciona no Windows com o pywin32 instalado. Use --pasta para testar.")

    ns = win32com.client.Dispatch("Outlook.Application").GetNamespace("MAPI")
    pasta = ns.Folders[cfg["outlook_conta"]] if cfg["outlook_conta"] else ns.GetDefaultFolder(6).Parent
    for nome in [n for n in cfg["outlook_pasta"].split("/") if n]:
        filhas = {f.Name.lower(): f for f in pasta.Folders}
        if nome.lower() not in filhas:
            raise SystemExit(f'Pasta "{nome}" não encontrada no Outlook. Pastas disponíveis: {", ".join(f.Name for f in pasta.Folders)}')
        pasta = filhas[nome.lower()]

    limite = dt.datetime.now() - dt.timedelta(days=cfg["dias_retroativos"])
    permitidos = {r.lower() for r in cfg["remetentes_permitidos"]}
    temp = AQUI / "_temp"
    temp.mkdir(exist_ok=True)
    itens = pasta.Items
    itens.Sort("[ReceivedTime]", True)
    saida = []
    for msg in itens:
        try:
            recebido = dt.datetime(msg.ReceivedTime.year, msg.ReceivedTime.month, msg.ReceivedTime.day,
                                   msg.ReceivedTime.hour, msg.ReceivedTime.minute)
        except AttributeError:
            continue  # não é um e-mail (convite, aviso de leitura...)
        if recebido < limite:
            break
        remetente = _endereco_remetente(msg)
        if permitidos and not any(remetente.lower().endswith(r) for r in permitidos):
            continue
        for anexo in msg.Attachments:
            if not str(anexo.FileName).lower().endswith(".pdf"):
                continue
            chave_anexo = f"{msg.EntryID}|{anexo.FileName}"
            if chave_anexo in registro["anexos"]:
                continue
            tmp = temp / re.sub(r"[^\w.\-]+", "_", anexo.FileName)
            anexo.SaveAsFile(str(tmp))
            h = hash_arquivo(tmp)
            saida.append({"hash": h, "arquivo": guardar_pdf(tmp, cfg, recebido.date(), h), "caminho": tmp,
                          "remetente": remetente, "recebido_em": recebido.date().isoformat(),
                          "nome": anexo.FileName, "chave_anexo": chave_anexo})
    return saida


def _endereco_remetente(msg) -> str:
    try:
        if msg.SenderEmailType == "EX":
            return msg.Sender.GetExchangeUser().PrimarySmtpAddress or ""
    except Exception:
        pass
    return msg.SenderEmailAddress or ""


# ---------------------------------------------------------------------------
# Saída para o painel
# ---------------------------------------------------------------------------

def gravar_painel(faturas: list[dict], cfg: dict) -> Path:
    saida = caminho(cfg, "arquivo_saida")
    saida.parent.mkdir(parents=True, exist_ok=True)
    dados = {"gerado_em": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "fonte": "outlook", "faturas": faturas}
    saida.write_text(
        "// Gerado pelo coletor em " + dados["gerado_em"] + ". Não edite à mão.\n"
        "window.FATURAS_DADOS = " + json.dumps(dados, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    return saida


def main() -> None:
    ap = argparse.ArgumentParser(description="Lê faturas de frete em PDF e atualiza o painel.")
    ap.add_argument("--pasta", help="ler os PDFs desta pasta em vez do Outlook")
    ap.add_argument("--reprocessar", action="store_true", help="ler de novo PDFs que já foram lidos")
    ap.add_argument("--leituras-prontas", help=argparse.SUPPRESS)  # testes: JSON {nome_arquivo: leitura}
    args = ap.parse_args()

    cfg = carregar_config()
    arq_registro = AQUI / cfg["arquivo_registro"]
    registro = {"leituras": {}, "anexos": []}
    if arq_registro.exists() and not args.reprocessar:
        registro = json.loads(arq_registro.read_text(encoding="utf-8"))

    novos = pdfs_da_pasta(Path(args.pasta), cfg) if args.pasta else pdfs_do_outlook(cfg, registro)
    log(f"{len(novos)} PDF(s) encontrados")

    prontas = json.loads(Path(args.leituras_prontas).read_text(encoding="utf-8")) if args.leituras_prontas else None
    cliente = None
    erros = 0
    for item in novos:
        if item["hash"] in registro["leituras"]:
            log(f"  já lido: {item['nome']}")
        else:
            try:
                texto = extrair_texto(item["caminho"])
                boletos = ler_boletos(texto)
                if prontas is not None:
                    lido = prontas[item["nome"]]
                else:
                    if cliente is None:
                        import anthropic
                        cliente = anthropic.Anthropic()
                    lido = ler_com_claude(item["caminho"], cfg, cliente)
                registro["leituras"][item["hash"]] = {"lido": lido, "boletos": boletos, "origem": {k: item[k] for k in ("arquivo", "remetente", "recebido_em", "nome")}}
                log(f"  lido: {item['nome']} -> {lido.get('transportadora')} {lido.get('numero_fatura')}")
            except RuntimeError as e:
                erros += 1
                log(f"  ERRO em {item['nome']}: {e}")
                continue
        if item.get("chave_anexo") and item["chave_anexo"] not in registro["anexos"]:
            registro["anexos"].append(item["chave_anexo"])

    faturas = []
    ignorados = 0
    for h, r in registro["leituras"].items():
        if not r["lido"].get("eh_fatura", True):
            ignorados += 1
            continue
        faturas.append(montar_fatura(r["lido"], dict(r["origem"], hash=h), r["boletos"], cfg))
    padronizar_nomes(faturas, cfg)
    faturas = juntar_copias(faturas)
    faturas.sort(key=lambda f: (f["vencimento"] or "9999", f["transportadora"]))

    arq_registro.write_text(json.dumps(registro, ensure_ascii=False, indent=1), encoding="utf-8")
    saida = gravar_painel(faturas, cfg)
    shutil.rmtree(AQUI / "_temp", ignore_errors=True)
    conferir_n = sum(1 for f in faturas if f["pendencias"])
    log(f"{len(faturas)} fatura(s) no painel, {conferir_n} para conferir, {ignorados} PDF(s) que não eram fatura, {erros} erro(s)")
    log(f"Painel atualizado: {saida}")
    if erros:
        sys.exit(1)


if __name__ == "__main__":
    main()
