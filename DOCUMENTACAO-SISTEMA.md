# Controle de Lotes — Documentação do sistema

**Versão 1.0.0 — 31/10/2026**

Sistema web para registrar o recebimento e a liberação de materiais por lote (argamassa de fachada, impermeabilizante etc.), com foto obrigatória da etiqueta e do lote liberado, e relatório em PDF. Mesma arquitetura do sistema de FVS do Essence Residence.

## Arquitetura
- **Site:** `index.html` único (HTML, CSS e JS puros), publicado no GitHub Pages. PWA (`manifest.json`, ícones, `sw.js`).
- **Servidor:** `Code.gs` (Google Apps Script, Web App). O site chama por POST com texto JSON `{acao, dados, token}`.
- **Banco:** planilha Google, uma aba por tabela. Fotos no Google Drive (pasta "Controle de Lotes - Fotos"); a planilha guarda só o id do arquivo.
- **Segurança:** tabela de ações no servidor com perfis permitidos; `LockService` em toda gravação; ids gerados no aparelho (repetir um envio não duplica); senhas só como hash nas propriedades do script.
- **Offline:** tudo que o usuário salva entra numa fila no aparelho (IndexedDB) e é enviado quando houver sinal (até 6 passos por chamada, ação `lote`). O contador no topo mostra itens aguardando.
- **Fotos:** comprimidas no aparelho (lado maior 1400 px, JPEG 80%).
- **PDF:** gerado no navegador com jsPDF (cabeçalho, logo, fotos, rodapé com página X de Y).

## Perfis
| Perfil | Pode |
|---|---|
| administrador | tudo, inclusive cadastros, usuários e histórico |
| almoxarife | receber, liberar, registrar ocorrência, relatórios |
| compras | ver tudo, registrar e resolver ocorrências, relatórios |
| consulta | ver tudo e gerar relatórios |

## Telas
Painel (alertas), Receber, Liberar, Lotes (lista e detalhe), Relatório, Cadastros e Histórico (só administrador).

- **Receber:** material, nº do lote, quantidade, fornecedor, NF, fabricação, validade, entrada, local. **Foto da etiqueta obrigatória.**
- **Liberar:** lote, quantidade, destino (+ detalhe do local), data, abertura do saco (opcional). **Foto do lote liberado obrigatória.** Avisa se já houve outro lote do mesmo material no mesmo local.
- **Lotes:** filtro por material e situação, busca por lote/NF. No detalhe: fotos, liberações, ocorrências, data de abertura, encerrar lote, PDF.
- **Relatório:** por lote ou por local, com filtros de material, lote, local e período, com ou sem fotos. Nome do arquivo: `LOTE - material - número - dd-mm-aa.pdf`.
- **Painel:** saldo por material, lotes sem foto de etiqueta, liberações sem foto, ocorrências abertas, lotes diferentes do mesmo material no mesmo local, validade vencida ou a vencer em 30 dias.

## Tabelas (abas da planilha)
Materiais, Lotes, Liberacoes, Ocorrencias, Fotos, Destinos, Usuarios (sem senha), Historico.
O saldo do lote é calculado (recebido − liberações); liberar acima do saldo é permitido com confirmação e fica sinalizado no painel.

## Instalação / atualização
1. Planilha Google nova > Extensões > Apps Script > colar **o `Code.gs` inteiro** > rodar `setup()` (cria abas, pasta no Drive, materiais e destinos iniciais e o usuário administrador).
2. Implantar > Nova implantação > App da Web > executar como "Eu" > acesso "Qualquer pessoa" > copiar a URL.
3. Colocar a URL em `API_URL` no começo do script do `index.html`.
4. GitHub: Settings > Pages > Deploy from a branch > `main` / `/ (root)`.
5. Opcional: `fundo.jpg` (foto da obra) e `logo.png` na raiz do repositório.
6. Primeiro acesso: usuário Barbara, senha 1234 — trocar em Cadastros > Usuários e criar o almoxarife e o compras.

**Quando o `Code.gs` mudar:** colar o arquivo inteiro, rodar `setup()` e publicar **Nova versão** da implantação.
**Quando o site mudar:** aumentar a versão em `sw.js` (`VERSAO`) para os aparelhos baixarem a nova.

## Regras de interface combinadas
Paleta cinza; pouquíssimo texto; janelas só fecham pelo X; botões grandes para tablet e celular; fotos pela câmera ou galeria; abas no topo.

## Testes (31/10/2026)
Servidor simulado + navegador automatizado: login, abas por perfil, foto obrigatória, recebimento, liberação offline na fila, envio ao voltar a internet, agrupamento de passos, detalhe do lote e PDF gerado — 11 de 11 verificações passaram.

## Histórico de versões
- **1.0.2 (31/10/2026):** novo visual da tela de entrada (cartão de vidro sobre foto do Essence).
- **1.0.1 (31/10/2026):** URL do servidor configurada no site.
- **1.0.0 (31/10/2026):** primeira versão.
