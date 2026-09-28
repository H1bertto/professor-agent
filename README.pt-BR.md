# Professor Agent

Um professor de estudos local e open source que fica na sua área de trabalho. Ele aparece como um avatar 2D ou 3D por cima dos seus apps, e você conversa com ele por voz para aprender um idioma ou qualquer outro assunto.

[Read in English](README.md)

> **Status:** início do desenvolvimento. Ainda não tem nada para instalar. Acompanhe pelo [roadmap](docs/roadmap.md).

## Por que mais um avatar com IA?

A maioria dos projetos open source de avatar com IA é de companhia. O Professor Agent foi feito para ensinar. Ele sabe o seu nível, corrige sem travar a conversa, escreve numa lousa quando só a voz não basta e lembra o que você estudou da última vez.

## O que está planejado

- **Avatar sobreposto.** Um personagem VRM (3D) ou estilo PNGTuber (2D) por cima de qualquer app. O clique passa por tudo, menos pelo avatar.
- **Conversa por voz** em português e inglês, e dá para interromper a qualquer momento.
- **Prática de idiomas.** Conversas de imersão, correções em cartões ao lado e respostas no seu nível (CEFR A1 a C2).
- **Modo tutor para qualquer assunto**, com uma lousa para anotações, fórmulas e código.
- **Memória de progresso** guardada no seu computador: sessões, vocabulário novo e erros que se repetem.
- **Use o seu provedor de IA.** OpenAI, Anthropic, Google Gemini, OpenRouter, Groq e outras APIs compatíveis com OpenAI. Suporte a LLM local vem depois.
- **Voz local.** O reconhecimento e a síntese de fala rodam no seu computador.

## Como funciona

Dois processos rodam na sua máquina:

| Parte | Stack | Papel |
|---|---|---|
| [`apps/desktop`](apps/desktop) | Electron, React, TypeScript | Janela sobreposta, avatar, microfone, configurações |
| [`core`](core) | Python, FastAPI, Pipecat | Pipeline de voz: detecção de fala, fala para texto, LLM, texto para fala |

Eles conversam por WebSocket em `localhost`. Os motivos dessas escolhas estão no [ADR 0001](docs/adr/0001-architecture-and-stack.md).

## Privacidade

Seu áudio e suas transcrições ficam no seu computador. O único dado que sai dele é o que vai para o provedor de IA que você configurou, com a sua própria chave.

## Desenvolvimento

As instruções estão no [README em inglês](README.md#development) e no [CONTRIBUTING.md](CONTRIBUTING.md). Issues e discussões em português são bem-vindas.

## Licença

[MIT](LICENSE)
