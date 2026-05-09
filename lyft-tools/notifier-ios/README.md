# Lyft Advisor — iOS

App nativo iOS que **lê o card da Lyft Driver na tela** via ReplayKit + Vision OCR e te avisa **PEGA** ou **RECUSA** por notificação automática, sem você ter que tocar em nada.

## Como funciona (visão geral)

1. Você abre o app uma vez antes do turno
2. Aperta o botão **Iniciar Transmissão de Tela** → escolhe "Lyft Advisor" → "Iniciar"
3. Barrinha vermelha aparece em cima da tela (significa que tá lendo a tela)
4. Volta pro Lyft Driver, dirige normal
5. Quando aparecer card de corrida na tela:
   - Em ~0,5–1s aparece notificação: **✅ PEGA** ou **❌ RECUSA $24/hr baixo**
   - Você decide olhando só a notificação

---

## Setup no Mac (1ª vez — ~30 min depois do Xcode baixado)

### Pré-requisitos

- macOS 13 (Ventura) ou superior
- **Xcode 15+** instalado (App Store, ~15GB, demora 1–2h baixando)
- iPhone com **iOS 16+**, conectado por cabo
- Apple ID (qualquer um, **não precisa pagar $99**)

### Passo 1 — Instalar Homebrew + XcodeGen

Abre o **Terminal** no Mac e cola:

```bash
# Instala Homebrew se não tem
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Instala XcodeGen
brew install xcodegen
```

### Passo 2 — Clonar o repo

```bash
cd ~
git clone -b claude/remote-control-27Ti2 https://github.com/carlostroy/meshsig.git
cd meshsig/lyft-tools/notifier-ios
```

### Passo 3 — Gerar o projeto Xcode

```bash
xcodegen generate
open LyftAdvisor.xcodeproj
```

Xcode abre. Aí passa pra interface.

### Passo 4 — Configurar Apple ID grátis

No Xcode:

1. Menu **Xcode → Settings → Accounts**
2. **+** → "Add Apple ID" → faz login com seu Apple ID
3. Fecha Settings
4. Painel esquerdo: clica em **LyftAdvisor** (azul, no topo)
5. Painel central: aba **Signing & Capabilities** → target **LyftAdvisor**:
   - **Team**: escolhe seu nome (Personal Team)
   - **Bundle Identifier**: muda pra algo único, ex: `com.SEUNOME.lyftadvisor.app` (Apple não deixa duplicar entre desenvolvedores)
6. Repete pra target **BroadcastExtension** — Bundle ID: `com.SEUNOME.lyftadvisor.broadcast`

⚠️ **Importante**: o `PRODUCT_BUNDLE_IDENTIFIER` da extensão **precisa começar igual** ao do app. Se app for `com.SEUNOME.lyftadvisor.app`, extensão tem que ser `com.SEUNOME.lyftadvisor.app.broadcast` ou similar com o mesmo prefixo.

### Passo 5 — App Group

Ainda em **Signing & Capabilities** do target **LyftAdvisor**:

1. Procura **App Groups** na lista. Se não tiver, clica em **+ Capability** → escolhe **App Groups**
2. Marca o checkbox de `group.com.lyftadvisor.shared` (ou cria se não existir)
3. Repete pra target **BroadcastExtension**, marcando o **mesmo** group

Se Xcode reclamar de "container ID", clica em **Try Again** ou recria o group com nome único (ex: `group.com.SEUNOME.lyftadvisor`) — **e atualiza o `appGroup` em `Shared/SharedDefaults.swift` pra bater**.

### Passo 6 — Compilar e instalar no iPhone

1. Conecta o iPhone no Mac com cabo
2. iPhone vai pedir pra **confiar no computador** → Confiar
3. No Xcode, em cima à esquerda, escolhe seu iPhone como destino
4. Aperta **Cmd + R** (ou botão ▶️ Play)
5. Primeira vez: vai dar erro "Untrusted Developer" no iPhone
6. No iPhone: **Ajustes → Geral → VPN e Gerenciamento de Dispositivos → seu Apple ID → Confiar**
7. Volta no Xcode e roda de novo

App instala no iPhone.

### Passo 7 — Permissões no iPhone

Ao abrir o app pela primeira vez:

1. Permite **Notificações** quando pedir
2. **Ajustes → Notificações → Lyft Advisor** → ativar:
   - ✅ Permitir Notificações
   - ✅ Banners (Persistente é melhor)
   - ✅ Som
   - ✅ **Notificações Sensíveis ao Tempo** (importante — passa por Foco/Não Perturbe)

---

## Uso diário

### Começar turno

1. Abre o **Lyft Advisor**
2. Toca em **Iniciar Transmissão de Tela** (botão azul/vermelho do iOS)
3. Escolhe **Lyft Advisor** na lista de apps
4. Toca em **Iniciar Transmissão**
5. Espera notificação "📡 Lyft Advisor ativo"
6. Volta pro Lyft Driver normalmente

### Durante o turno

Card de corrida aparece → notificação automática em ~1 segundo:

- **✅ PEGA — $32/hr · pickup 5min/2.1mi · trip 25min/15mi**
- **❌ RECUSA — $18/hr muito baixo, pickup 44% do tempo**
- **⚠️ TALVEZ — pickup 32% (alvo 30%)**

### Parar transmissão

- Toca na barrinha vermelha em cima da tela → "Parar"
- Ou abre Centro de Controle → Gravação de Tela → Parar
- Ou fecha o app

---

## Limitação de free Apple ID — re-assinar a cada 7 dias

App expira em 7 dias. Pra renovar:

**Opção A — Manual (5 min/semana)**: conecta iPhone no Mac, abre Xcode, **Cmd+R**. Pronto.

**Opção B — AltStore (automático)**:

1. Baixa AltStore Server: https://altstore.io/ → instala no Mac
2. Abre AltStore Server, conecta com seu Apple ID
3. Conecta iPhone na mesma WiFi do Mac
4. AltStore renova automaticamente em background

---

## Troubleshooting

### "Notification permission denied"

**Ajustes → Notificações → Lyft Advisor** → ativar tudo, especialmente **Sensíveis ao Tempo**.

### Notificação não aparece quando o card da Lyft aparece

- Verifica se a barrinha vermelha de gravação tá visível (significa transmissão ativa)
- Abre o app, vê "Última decisão" — se tá vazia, OCR não tá rodando
- Pode ser que o crop esteja errado pra teu modelo de iPhone — testa com print fixo (vide "Calibração")

### "App Groups error" no Xcode

Cria um App Group com **nome único** (ex: `group.com.SEUNOME.lyftadvisor`) nos dois targets, e atualiza `Shared/SharedDefaults.swift` linha 4: `static let appGroup = "group.com.SEUNOME.lyftadvisor"`.

### Calibração do OCR (se não tá lendo direito)

Em `BroadcastExtension/SampleHandler.swift`, função `runOCR`, ajusta o `cropRect` — atualmente lê os 55% inferiores da tela (onde fica o card da Lyft). Se teu Lyft Driver tá em layout diferente, ajusta os números.

### A barrinha vermelha some sozinha

iOS pode matar Broadcast Extensions com mais de 50 MB de memória. O app mantém uso baixo, mas se acontecer recorrente, abre uma issue.

---

## Arquivos principais

```
notifier-ios/
├── project.yml                    XcodeGen config
├── LyftAdvisor/                   App principal (settings UI)
│   ├── LyftAdvisorApp.swift
│   ├── ContentView.swift
│   ├── Info.plist
│   └── LyftAdvisor.entitlements
├── BroadcastExtension/            Extensão que lê a tela
│   ├── SampleHandler.swift        ← ReplayKit + Vision OCR + Notification
│   ├── Info.plist
│   └── BroadcastExtension.entitlements
└── Shared/                        Código compartilhado
    ├── RideCard.swift             Modelo de dados
    ├── CardParser.swift           Regex pra extrair pay/min/mi
    ├── Rules.swift                Lógica de PEGA/TALVEZ/RECUSA
    └── SharedDefaults.swift       UserDefaults via App Group
```

## Riscos & disclaimers

- **Não viola TOS da Lyft** — você só tá lendo sua própria tela, não acessa API/servidor da Lyft
- **Account da Lyft NÃO entra em risco** — Lyft não tem como detectar isso
- **API oficial da Apple** — ReplayKit Broadcast Extension é a mesma usada por Twitch, Streamlabs, etc.
- **Free Apple ID re-sign de 7 dias** — limitação da Apple, não tem volta sem $99/ano
