# Painel de entregas na TV: atualização automática

A TV abre o painel direto de uma pasta do SharePoint/OneDrive. Um script gera o
arquivo de dados ao lado do painel, e o painel se recarrega sozinho a cada
5 minutos. Ninguém precisa carregar arquivo na TV.

```
SAP Business One ──► relatorios\*.xlsx ──► atualizar_dados_tv.ps1 ──► dados\entregas_dados.js ──► painel_tv.html (TV)
                     (ou consulta direta ao banco)   (agendado)        (pasta sincronizada)         (recarrega a cada 5 min)
```

## 1. Montar a pasta no SharePoint

Crie uma pasta numa biblioteca do SharePoint (ex.: `Logística/Painel Entregas`) com esta estrutura:

```
Painel Entregas\
  painel_tv.html            ← cópia do gerador_dashboard.html (renomeada)
  relatorios\               ← onde o relatório do SAP é salvo
  dados\                    ← criada pelo script (entregas_dados.js e o log)
  automacao\
    atualizar_dados_tv.ps1
    agendar_atualizacao.ps1
    abrir_painel_tv.bat
```

Sincronize a pasta pelo OneDrive (botão **Sincronizar** na biblioteca) **no
computador da TV** e **no computador que vai rodar o script** (pode ser o mesmo).

## 2. Primeiro teste, à mão

1. Salve o relatório do SAP em `relatorios\` com o nome de sempre
   (ex.: `Relatório_de_compras.xlsx`). A planilha de entrega efetiva, se houver,
   vai na mesma pasta com "efetiva" no nome (ex.: `entrega_efetiva.xlsx`).
2. Clique com o botão direito em `automacao\atualizar_dados_tv.ps1` → **Executar com o PowerShell**.
3. Abra `painel_tv.html`: o painel já aparece com os dados, sem escolher arquivo.

Se o relatório tiver outro nome, rode com `-PadraoRelatorio "*meu_nome*.xlsx"`.

## 3. Agendar

No computador que roda o script, abra o PowerShell na pasta `automacao` e rode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File agendar_atualizacao.ps1
```

Isso cria a tarefa **"Painel Entregas - atualizar dados"**, que roda a cada 15
minutos, de segunda a sábado, das 6h às 20h. O script só regrava os dados quando
o relatório mudou. O histórico fica em `dados\atualizacao.log`.

## 4. Deixar a TV ligada no painel

No computador da TV, dê dois cliques em `automacao\abrir_painel_tv.bat`: o Edge
abre em tela cheia, já no Modo TV. Para abrir sozinho ao ligar o computador,
coloque um atalho do `.bat` na pasta `shell:startup` (Win+R → `shell:startup`).
Para sair da tela cheia: **Alt+F4**.

Se o Edge já estiver aberto, feche-o antes de rodar o `.bat`, senão ele abre uma
aba comum em vez da tela cheia.

O computador da TV precisa de internet: o painel baixa a biblioteca de leitura
de Excel e as fontes da web.

## 5. Tirar a exportação manual do SAP (consulta direta ao banco)

O Query Manager do Business One não exporta sozinho num horário. Para não
depender de alguém exportar o relatório, o script pode rodar as mesmas consultas
direto no banco do Business One:

1. No SAP, abra cada consulta no Query Manager e copie o texto SQL para
   `automacao\consulta_pedido.sql` e `automacao\consulta_recebimento.sql`.
   As colunas precisam ter os mesmos nomes de hoje (use `AS` se precisar):
   - pedido: `nro_pedido, emissao, cod_fornec, nome_fornec, cidade_fornec, uf_fornec, cnpj_fornec, item, descricao, qtd, um, faturar_dia, tipo_frete, obs, data_entrega, cnpj_emp`
   - recebimento: `doc_entry, grupo_item`
2. Peça à TI um usuário **só de leitura** no banco e a forma de conexão:
   - SQL Server: `-Banco SqlServer -ConexaoSql "Server=SERVIDOR;Database=BANCO_SAP;Integrated Security=True"`
   - SAP HANA: instale o driver ODBC do HANA e use `-Banco Hana -ConexaoSql "DSN=NOME_DSN;UID=usuario;PWD=senha"`
3. Teste à mão e depois agende passando os mesmos parâmetros em `-ArgumentosExtras`
   (exemplo no topo do `agendar_atualizacao.ps1`).

Não grave senha em arquivo dentro da pasta do SharePoint: prefira
`Integrated Security=True` (login do Windows) ou um DSN configurado no próprio computador.
