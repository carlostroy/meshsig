# Ricardo Almeida — Landing Page (Corretor de Imóveis)

Página de vendas de alto padrão para corretor de imóveis. Visual contemporâneo
(2026), paleta sóbria, tipografia elegante e efeitos suaves de rolagem.

> ⚠️ **Demonstração.** Nome, números, depoimentos e imóveis são **dados fictícios**.
> As fotos vêm do Unsplash (placeholders) — devem ser trocadas pelas fotos reais
> do corretor antes de publicar.

## Como abrir

É um site estático (HTML + CSS + JS puro, sem build):

```bash
# basta abrir o arquivo no navegador
open corretor-landing/index.html

# ou servir localmente
cd corretor-landing && python3 -m http.server 8080
# acesse http://localhost:8080
```

## Estrutura

| Arquivo       | Função                                        |
|---------------|-----------------------------------------------|
| `index.html`  | Conteúdo e seções da página                   |
| `styles.css`  | Design, paleta, tipografia e responsividade   |
| `script.js`   | Loader, nav, reveals, contadores, parallax    |

## Seções

1. **Hero** — chamada principal com foto do corretor
2. **Sobre** — quem é, trajetória, CRECI
3. **Resultados** — números animados (anos, negócios, volume)
4. **Portfólio** — imóveis em destaque (cards)
5. **Atuação** — serviços / como trabalha
6. **Clientes** — depoimentos
7. **Contato** — formulário (mock) + rodapé

## Personalização rápida

- **Cores:** variáveis no topo de `styles.css` (`:root`)
- **Fontes:** Cormorant Garamond (títulos) + Inter (texto)
- **Textos/preços:** direto no `index.html`
- **Fotos:** substituir as URLs do Unsplash pelas imagens reais
- **Contato:** trocar telefone/e-mail no rodapé e plugar o `form` num backend ou WhatsApp

## Acessibilidade

- Respeita `prefers-reduced-motion`
- Navegação por teclado e labels flutuantes nos campos
