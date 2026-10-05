<#
.SYNOPSIS
  Gera dados\entregas_dados.js para o painel de entregas da TV.

.DESCRIPTION
  O painel (painel_tv.html) fica numa pasta do SharePoint/OneDrive sincronizada
  no computador da TV. Ele lê dados\entregas_dados.js ao abrir e a cada 5 minutos.
  Este script gera esse arquivo de um destes dois jeitos:

  1) Relatório exportado (padrão): pega o .xlsx mais recente da pasta de
     relatórios (o mesmo arquivo que hoje é carregado à mão) e, se houver,
     a planilha de entrega efetiva.

  2) Consulta direta ao banco do SAP Business One (opcional): roda as consultas
     de pedido e recebimento (arquivos .sql) e grava as linhas, sem precisar
     exportar nada. Use -ConexaoSql e os arquivos .sql.

  Só regrava o arquivo de dados quando algo mudou. Compatível com o Windows
  PowerShell 5.1 que já vem no Windows.

.EXAMPLE
  # Relatório exportado, com a estrutura de pastas padrão (veja o LEIA-ME)
  powershell -NoProfile -ExecutionPolicy Bypass -File atualizar_dados_tv.ps1

.EXAMPLE
  # Consulta direta ao SQL Server do Business One
  powershell -NoProfile -ExecutionPolicy Bypass -File atualizar_dados_tv.ps1 `
    -Banco SqlServer -ConexaoSql "Server=SRV-SAP;Database=SBO_APIS;Integrated Security=True" `
    -ConsultaPedido consulta_pedido.sql -ConsultaRecebimento consulta_recebimento.sql
#>
[CmdletBinding()]
param(
  # Pasta do painel (onde fica painel_tv.html). Padrão: a pasta acima de "automacao".
  [string]$PastaPainel = "",
  # Onde o relatório .xlsx é salvo. Padrão: <PastaPainel>\relatorios
  [string]$PastaRelatorios = "",
  # Nome do relatório principal (curingas permitidos)
  [string]$PadraoRelatorio = "*compras*.xlsx",
  # Nome da planilha de entrega efetiva (opcional)
  [string]$PadraoEfetiva = "*efetiva*.xlsx",

  # --- Modo consulta direta ao SAP (opcional) ---
  [ValidateSet("", "SqlServer", "Hana")]
  [string]$Banco = "",
  # SqlServer: string de conexão do .NET. Hana: string ODBC (ex.: "DSN=HANA_SAP;UID=...;PWD=...")
  [string]$ConexaoSql = "",
  [string]$ConsultaPedido = "",
  [string]$ConsultaRecebimento = "",
  [string]$ConsultaEfetiva = "",

  # Regrava mesmo sem mudança
  [switch]$Forcar
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)

# Pasta deste script. Em alguns Windows PowerShell 5.1 o $PSScriptRoot vem vazio: usa o caminho do
# próprio script e, em último caso, a pasta atual (de onde o comando foi rodado).
$pastaScript = $PSScriptRoot
if (-not $pastaScript -and $MyInvocation.MyCommand.Path) { $pastaScript = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $pastaScript) { $pastaScript = (Get-Location).ProviderPath }
if (-not $PastaPainel) { $PastaPainel = Split-Path -Parent $pastaScript }
$PastaPainel = (Resolve-Path -LiteralPath $PastaPainel).ProviderPath

if (-not $PastaRelatorios) { $PastaRelatorios = Join-Path $PastaPainel "relatorios" }
$pastaDados = Join-Path $PastaPainel "dados"
$arquivoDados = Join-Path $pastaDados "entregas_dados.js"
$arquivoVersao = Join-Path $pastaDados "versao.js"
$arquivoAssinatura = Join-Path $pastaDados ".assinatura"
$arquivoLog = Join-Path $pastaDados "atualizacao.log"
if (-not (Test-Path $pastaDados)) { New-Item -ItemType Directory -Path $pastaDados | Out-Null }

function Registrar([string]$msg) {
  $linha = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg
  Write-Host $linha
  $anteriores = @()
  if (Test-Path $arquivoLog) { $anteriores = @(Get-Content -Path $arquivoLog -Encoding UTF8 | Select-Object -Last 499) }
  [System.IO.File]::WriteAllLines($arquivoLog, [string[]]($anteriores + $linha), $utf8)
}

# Lê o arquivo mesmo que esteja aberto no Excel ou sincronizando
function Ler-Bytes([string]$caminho) {
  $fs = [System.IO.File]::Open($caminho, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $ms = New-Object System.IO.MemoryStream
    $fs.CopyTo($ms)
    return $ms.ToArray()
  } finally { $fs.Dispose() }
}

function Mais-Recente([string]$pasta, [string]$padrao, [string]$excluir) {
  if (-not (Test-Path $pasta)) { return $null }
  Get-ChildItem -Path $pasta -Filter $padrao -File |
    Where-Object { $_.Name -notlike '~$*' -and (-not $excluir -or $_.Name -notlike $excluir) } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
}

function Texto-Json([string]$s) {
  if ($null -eq $s) { return "null" }
  return (ConvertTo-Json -InputObject $s -Compress)
}

# DataTable -> lista de objetos com as colunas da consulta; datas viram "aaaa-MM-dd"
function Converter-Tabela($tabela) {
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($linha in $tabela.Rows) {
    $obj = [ordered]@{}
    foreach ($col in $tabela.Columns) {
      $v = $linha[$col.ColumnName]
      if ($v -is [System.DBNull]) { $v = "" }
      elseif ($v -is [datetime]) { $v = $v.ToString("yyyy-MM-dd") }
      elseif ($v -is [decimal]) { $v = [double]$v }
      $obj[$col.ColumnName] = $v
    }
    $lista.Add([pscustomobject]$obj)
  }
  return ,$lista.ToArray()
}

function Executar-Consulta([string]$arquivoSql) {
  $sql = [System.IO.File]::ReadAllText((Resolve-Path $arquivoSql).Path, $utf8)
  if ($Banco -eq "SqlServer") {
    $conn = New-Object System.Data.SqlClient.SqlConnection $ConexaoSql
    $cmd = New-Object System.Data.SqlClient.SqlCommand($sql, $conn)
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
  } else {
    $conn = New-Object System.Data.Odbc.OdbcConnection $ConexaoSql
    $cmd = New-Object System.Data.Odbc.OdbcCommand($sql, $conn)
    $adapter = New-Object System.Data.Odbc.OdbcDataAdapter $cmd
  }
  $cmd.CommandTimeout = 300
  $tabela = New-Object System.Data.DataTable
  try { [void]$adapter.Fill($tabela) } finally { $conn.Dispose() }
  return ,(Converter-Tabela $tabela)
}

function Gravar-Dados([string]$conteudoJs, [string]$assinatura, [string]$geradoEm) {
  # grava num temporário e troca de uma vez, para a TV nunca ler um arquivo pela metade
  $tmp = "$arquivoDados.tmp"
  [System.IO.File]::WriteAllText($tmp, $conteudoJs, $utf8)
  Move-Item -Path $tmp -Destination $arquivoDados -Force
  # versão por último: a TV só baixa os dados (que podem ter dezenas de MB) quando ela muda
  [System.IO.File]::WriteAllText($arquivoVersao, "window.ENTREGAS_VERSAO = $(Texto-Json $geradoEm);", $utf8)
  [System.IO.File]::WriteAllText($arquivoAssinatura, $assinatura, $utf8)
}

try {
  $agora = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

  if ($Banco) {
    # ---------- Modo consulta direta ----------
    if (-not $ConexaoSql -or -not $ConsultaPedido -or -not $ConsultaRecebimento) {
      throw "No modo consulta, informe -ConexaoSql, -ConsultaPedido e -ConsultaRecebimento."
    }
    $pedido = Executar-Consulta $ConsultaPedido
    $receb = Executar-Consulta $ConsultaRecebimento
    $efetiva = $null
    if ($ConsultaEfetiva) { $efetiva = Executar-Consulta $ConsultaEfetiva }

    $jsonPedido = ConvertTo-Json -InputObject $pedido -Depth 3 -Compress
    $jsonReceb = ConvertTo-Json -InputObject $receb -Depth 3 -Compress
    $jsonEfetiva = if ($efetiva) { ConvertTo-Json -InputObject $efetiva -Depth 3 -Compress } else { "null" }

    # assinatura = conteúdo das consultas: só regrava se os dados mudaram
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [System.BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($jsonPedido + $jsonReceb + $jsonEfetiva))).Replace("-", "")
    $assinatura = "sql:$hash"
    if (-not $Forcar -and (Test-Path $arquivoAssinatura) -and ([System.IO.File]::ReadAllText($arquivoAssinatura, $utf8) -eq $assinatura)) {
      Registrar "Sem mudanças na consulta ($($pedido.Count) linhas de pedido)."
      exit 0
    }
    $js = "window.ENTREGAS_DADOS = {""versao"":1,""formato"":""linhas"",""geradoEm"":$(Texto-Json $agora),""arquivo"":""Consulta SAP"",""pedido"":$jsonPedido,""recebimento"":$jsonReceb,""efetivaLinhas"":$jsonEfetiva};"
    Gravar-Dados $js $assinatura $agora
    Registrar "Dados gravados pela consulta: $($pedido.Count) linhas de pedido, $($receb.Count) de recebimento."
    exit 0
  }

  # ---------- Modo relatório exportado ----------
  $rel = Mais-Recente $PastaRelatorios $PadraoRelatorio $PadraoEfetiva
  if (-not $rel) { throw "Nenhum relatório '$PadraoRelatorio' encontrado em '$PastaRelatorios'." }
  $efe = Mais-Recente $PastaRelatorios $PadraoEfetiva ""

  $assinatura = "xlsx:{0}|{1}|{2}" -f $rel.Name, $rel.LastWriteTimeUtc.Ticks, $rel.Length
  if ($efe) { $assinatura += "|{0}|{1}|{2}" -f $efe.Name, $efe.LastWriteTimeUtc.Ticks, $efe.Length }
  if (-not $Forcar -and (Test-Path $arquivoAssinatura) -and ([System.IO.File]::ReadAllText($arquivoAssinatura, $utf8) -eq $assinatura)) {
    Registrar "Sem mudanças ($($rel.Name))."
    exit 0
  }

  # espera o arquivo parar de crescer (SAP salvando ou OneDrive sincronizando)
  $tam = -1
  for ($i = 0; $i -lt 10 -and $tam -ne (Get-Item $rel.FullName).Length; $i++) {
    $tam = (Get-Item $rel.FullName).Length
    Start-Sleep -Seconds 3
  }

  $b64 = [System.Convert]::ToBase64String((Ler-Bytes $rel.FullName))
  $partEfetiva = "null"
  if ($efe) {
    $b64e = [System.Convert]::ToBase64String((Ler-Bytes $efe.FullName))
    $partEfetiva = "{""arquivo"":$(Texto-Json $efe.Name),""conteudo"":""$b64e""}"
  }
  $js = "window.ENTREGAS_DADOS = {""versao"":1,""formato"":""xlsx-base64"",""geradoEm"":$(Texto-Json $agora),""arquivo"":$(Texto-Json $rel.Name),""conteudo"":""$b64"",""efetiva"":$partEfetiva};"
  Gravar-Dados $js $assinatura $agora
  $msgEfe = if ($efe) { " + $($efe.Name)" } else { "" }
  Registrar "Dados gravados: $($rel.Name)$msgEfe."
  exit 0
}
catch {
  Registrar "ERRO: $($_.Exception.Message)"
  exit 1
}
