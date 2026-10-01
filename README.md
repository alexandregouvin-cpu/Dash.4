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
- **Conta compartilhada** 👥: duas (ou mais) pessoas veem e registram os mesmos gastos, em tempo real.
  Veja [Conta compartilhada](#conta-compartilhada).
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

## Conta compartilhada

Em **Ajustes → Conta compartilhada**, cada pessoa entra com e-mail e senha. Uma delas cria a **casa**
e toca em **Enviar convite**; a outra abre o link, cria a conta e entra. A partir daí:

- os gastos de todos aparecem para todos, em segundos, mostrando **quem registrou** (👤);
- o orçamento mensal e o limite diário valem para a casa inteira, e os alertas de 80%/100% chegam para todos;
- com o app aberto ou em segundo plano, cada um é avisado quando o outro registra um gasto;
- sem internet, os gastos ficam no aparelho e sobem sozinhos quando a conexão volta;
- o **Resumo** mostra “Quem gastou quanto”;
- os gastos que já estavam no aparelho podem ser enviados para a casa ao entrar.

Os dados ficam no Firebase (Google), protegidos pelas regras de `firestore.rules`: só membros da casa leem
ou alteram os gastos, e só entra quem tem o código de convite. Avisos com o app **totalmente fechado** exigiriam
Cloud Functions (plano pago do Firebase) e não estão incluídos.

### Configurar o Firebase (uma vez, ~10 minutos, plano gratuito)

1. Em <https://console.firebase.google.com>, **Criar um projeto** (o Google Analytics pode ficar desativado).
2. **Authentication → Vamos começar → Método de login → E-mail/senha → Ativar → Salvar**.
3. **Firestore Database → Criar banco de dados**, local `southamerica-east1 (São Paulo)`, **modo de produção**.
4. Na aba **Regras** do Firestore, apague o conteúdo, cole o arquivo [`firestore.rules`](firestore.rules) e **Publicar**.
5. **Configurações do projeto (⚙️) → Geral → Seus apps → Web (`</>`)**, dê um apelido e **Registrar app**
   (não precisa do Firebase Hosting). Copie o objeto `firebaseConfig` mostrado.
6. Cole esse objeto em [`js/firebase-config.js`](js/firebase-config.js), no lugar de `null`, e publique.

Esses valores identificam o projeto e não são senhas: a proteção vem das regras do passo 4.
Enquanto `firebaseConfig` for `null`, o app funciona só no aparelho, como antes.

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
npm start            # servidor local em http://localhost:8080
npm test             # testes da lógica (node --test)
npm install          # ferramentas abaixo (Firebase SDK, emulador, esbuild)
npm run test:rules   # testa firestore.rules no emulador (precisa de Java)
npm run build:firebase  # regera js/vendor/firebase.js a partir de scripts/firebase-entry.js
```

| Arquivo | Conteúdo |
| --- | --- |
| `index.html`, `css/styles.css` | Telas e estilos (tema claro/escuro automático) |
| `js/app.js` | Interface e interações |
| `js/core.js` | Lógica pura: valores, datas, totais, orçamento, CSV (testada em `tests/`) |
| `js/storage.js` | Salvamento local (localStorage) |
| `js/notifications.js` | Permissão, lembrete diário e alertas |
| `js/places.js` | GPS do aparelho e busca de estabelecimentos no OpenStreetMap |
| `js/sync.js`, `js/firebase-config.js` | Conta compartilhada: login, casa, convite, sincronização |
| `js/vendor/firebase.js` | SDK do Firebase empacotado (gerado; carregado só se configurado) |
| `firestore.rules`, `tests/rules/` | Regras de segurança do banco e seus testes |
| `sw.js` | Service worker: offline, lembrete em segundo plano, clique na notificação |
| `manifest.webmanifest`, `icons/` | Instalação como app |

Os valores são guardados em centavos (inteiros) para evitar erros de arredondamento.
