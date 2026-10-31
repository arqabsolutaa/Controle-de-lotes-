# Controle de Lotes — Documentação do sistema

**Versão 2.0.0 — 31/10/2026**

Sistema web para registrar a **entrega de material** na obra (argamassa de fachada, impermeabilizante etc.): material, para onde vai ser usado, quem retirou, data e **foto do lote**. Serve para rastrear de qual lote veio o material usado em cada local e gerar relatório em PDF (ex.: impermeabilizante usado no 8º andar). Mesma arquitetura do sistema de FVS do Essence Residence.

## Arquitetura
- **Site:** `index.html` único (HTML, CSS e JS puros), GitHub Pages. PWA (`manifest.json`, ícones, `sw.js`). Fonte Lavish nos títulos (`fontes/lavish.otf`), logo e fundo (`logo.png`, `fundo.jpg`).
- **Servidor:** `Code.gs` (Google Apps Script, Web App). O site chama por POST com texto JSON `{acao, dados, token}`.
- **Banco:** planilha Google, uma aba por tabela. Fotos no Google Drive (pasta "Controle de Lotes - Fotos"); a planilha guarda só o id do arquivo.
- **Segurança:** tabela de ações no servidor com perfis permitidos; `LockService` em toda gravação; ids gerados no aparelho (reenviar não duplica); senhas só como hash nas propriedades do script; 5 tentativas erradas bloqueiam o usuário por 10 minutos.
- **Offline:** o que o usuário salva entra numa fila no aparelho (IndexedDB) e é enviado quando houver sinal, até 6 passos por chamada (ação `batch`). O contador no topo mostra itens aguardando.
- **Fotos:** comprimidas no aparelho (lado maior 1400 px, JPEG 80%).
- **PDF:** gerado no navegador com jsPDF (cabeçalho com logo, fotos, rodapé com página X de Y).

## Perfis (senha inicial 1234, trocar depois)
| Usuário | Perfil | Abas |
|---|---|---|
| Barbara | administrador | Entregar, Entregas, Relatório, Cadastros (materiais e usuários), Histórico |
| Almoxarife | almoxarife | Entregar, Entregas, Relatório |
| Compras | compras | Entregas, Relatório, Cadastros (materiais) |

## Telas
- **Entregar:** material (lista), para onde vai ser usado (texto livre, com sugestões dos locais já usados), quem retirou, data (hoje) e **foto do lote obrigatória** (câmera ou galeria).
- **Entregas:** lista com filtro por material e busca por local ou pessoa. No detalhe: fotos, PDF da entrega e, para o administrador, Editar.
- **Relatório:** filtros de material, local, período e com/sem fotos; mostra quantas entregas foram encontradas; gera PDF agrupado por local. O filtro de local entende "8 andar" = "8º andar" e **não** confunde com "18º andar". Nome do arquivo: `ENTREGAS - material - local - dd-mm-aa.pdf`.
- **Cadastros:** materiais (ativar/inativar) e, para o administrador, usuários e senhas.
- **Histórico:** quem fez o quê e quando (administrador).

## Tabelas (abas da planilha)
Materiais, Entregas, Fotos, Usuarios (sem senha), Historico.
As abas Lotes, Liberacoes, Ocorrencias e Destinos da versão 1 não são mais usadas e podem ser apagadas.

## Instalação / atualização
1. Planilha Google > Extensões > Apps Script > colar **o `Code.gs` inteiro** > rodar `setup()` (cria abas, pasta no Drive, materiais iniciais e os usuários que faltarem).
2. Implantar > Gerenciar implantações > Editar (lápis) > Versão: **Nova versão** > Implantar. A URL continua a mesma.
3. `API_URL` no começo do script do `index.html` guarda a URL do App da Web.
4. GitHub Pages: Settings > Pages > branch `main`, pasta `/ (root)`.

**Quando o `Code.gs` mudar:** colar o arquivo inteiro, rodar `setup()` e publicar Nova versão.
**Quando o site mudar:** aumentar a versão em `sw.js` (`VERSAO`) para os aparelhos baixarem a nova.

## Regras de interface combinadas
Paleta cinza com logo e foto do Essence no login (cartão de vidro); pouquíssimo texto; janelas só fecham pelo X; botões grandes para tablet e celular; fotos pela câmera ou galeria; abas no topo.

## Testes (31/10/2026)
Servidor simulado + navegador automatizado, 14 de 14 verificações: login e abas por perfil, exigência de material e de foto, entrega com foto, fila offline (4 itens) enviada ao voltar a internet, agrupamento de passos, filtro "8 andar" sem pegar "18º andar", PDF gerado com nome correto, edição pelo administrador.

## Histórico de versões
- **2.0.0 (31/10/2026):** sistema refeito só para entrega de material (sem recebimento/notas/saldo); perfis administrador, almoxarife e compras; relatório por local.
- **1.0.4:** fonte Lavish nos títulos. **1.0.3:** logo. **1.0.2:** novo login. **1.0.1:** URL do servidor. **1.0.0:** primeira versão (recebimento e liberação por lote).
