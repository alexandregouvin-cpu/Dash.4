# Controle de Gastos 💸

App de celular para anotar **todos os pagamentos do dia**: combustível, alimentação, mercado,
transporte, imprevistos e o que mais aparecer. Mostra quanto você gastou hoje e no mês, para onde
vai o dinheiro, e manda **notificações** para lembrar de registrar e avisar quando o orçamento aperta.

É um **PWA** (Progressive Web App): abre no navegador e é instalado na tela inicial como um app comum,
sem passar por loja. Funciona offline e os dados ficam só no seu aparelho.

## Funcionalidades

- **Registro rápido**: toque na categoria, digite o valor (teclado numérico, estilo caixa registradora:
  `8550` → R$ 85,50) e salve. Descrição, data e forma de pagamento (Pix, débito, crédito, dinheiro) são opcionais.
- **Categorias**: Alimentação, Mercado, Combustível, Transporte, Saúde, Casa e contas, Lazer, Imprevistos, Outros.
- **Local do gasto** 📍: toque no alfinete para ver os estabelecimentos ao seu redor e escolher onde está.
  Veja detalhes em [Localização](#localização).
- **Hoje**: total do dia, do mês, média diária e barra de progresso do orçamento.
- **Histórico**: gastos agrupados por dia, navegação por mês e filtro por categoria. Toque num item para editar ou excluir (com “Desfazer”).
- **Resumo**: total, média por dia, projeção para o fim do mês, gráfico por categoria, dos últimos 7 dias e “Onde mais gasto”.
- **Notificações**:
  - lembrete diário no horário que você escolher, só se você ainda não registrou nada no dia;
  - alerta ao atingir 80% e 100% do orçamento mensal e ao passar do limite diário.
- **Dados**: exportar planilha CSV (abre no Excel/Google Planilhas), backup e restauração em JSON.

## Localização

No formulário de gasto, o botão **📍** usa o GPS do celular e mostra:

1. **Já usados aqui**: lugares onde você já registrou gastos num raio de ~150 m. Vêm do seu histórico,
   sem internet, com a categoria e a descrição que você costuma usar ali.
2. **Por perto**: estabelecimentos do [OpenStreetMap](https://www.openstreetmap.org) (API Overpass, grátis e sem cadastro).

Ao escolher um lugar, o app **sugere a categoria** pelo tipo de estabelecimento (posto → Combustível,
supermercado → Mercado, restaurante/padaria → Alimentação, farmácia → Saúde…). Se você já escolheu a categoria, ela é mantida.
Também dá para digitar o nome do local à mão; se a posição foi obtida, ela é salva junto.

Em **Ajustes → Localização** você pode ligar a sugestão automática ao abrir um novo gasto. Ela usa só o histórico.

Privacidade: sua posição só é enviada ao serviço de mapas quando você toca em 📍. A cobertura do OpenStreetMap
é boa em cidades grandes, mas pode faltar estabelecimento em lugares menores. Nesse caso, digite o nome.
Depois disso, o lugar passa a aparecer pelo histórico.

## Como instalar no celular

1. Publique o app (veja abaixo) e abra o link no celular.
2. **Android (Chrome)**: menu ⋮ → **Instalar app** / “Adicionar à tela inicial”.
3. **iPhone (Safari, iOS 16.4+)**: botão Compartilhar → **Adicionar à Tela de Início**.
   No iPhone as notificações só funcionam com o app instalado dessa forma.
4. Abra o app, vá em **Ajustes** e ative o lembrete diário / alertas de orçamento (o celular vai pedir permissão).

### Sobre os lembretes com o app fechado

- Com o app aberto ou em segundo plano, o lembrete dispara no horário exato.
- Ao abrir o app depois do horário, se não houver gasto no dia, o lembrete aparece.
- No **Android com o app instalado**, o lembrete também chega com o app fechado, via *Periodic Background Sync*.
  O próprio Android decide o momento (em geral uma vez por dia, perto do uso habitual), então pode não ser no minuto exato.
- No iPhone, lembretes com o app totalmente fechado exigiriam um servidor de push (Web Push).
  O service worker já trata eventos `push`, então dá para adicionar isso depois.

## Publicar (GitHub Pages)

O workflow `.github/workflows/pages.yml` roda os testes e publica o app a cada push na `main`.
Para ativar: no GitHub, **Settings → Pages → Build and deployment → Source: GitHub Actions**.
O endereço fica `https://<usuario>.github.io/<repositorio>/`.

## Desenvolvimento

Sem dependências nem etapa de build: HTML, CSS e JavaScript (módulos ES).

```bash
npm start   # servidor local em http://localhost:8080
npm test    # testes da lógica (node --test)
```

| Arquivo | Conteúdo |
| --- | --- |
| `index.html`, `css/styles.css` | Telas e estilos (tema claro/escuro automático) |
| `js/app.js` | Interface e interações |
| `js/core.js` | Lógica pura: valores, datas, totais, orçamento, CSV (testada em `tests/`) |
| `js/storage.js` | Salvamento local (localStorage) |
| `js/notifications.js` | Permissão, lembrete diário e alertas |
| `js/places.js` | GPS do aparelho e busca de estabelecimentos no OpenStreetMap |
| `sw.js` | Service worker: offline, lembrete em segundo plano, clique na notificação |
| `manifest.webmanifest`, `icons/` | Instalação como app |

Os valores são guardados em centavos (inteiros) para evitar erros de arredondamento.
