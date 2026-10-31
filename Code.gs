/**
 * CONTROLE DE LOTES - Servidor (Google Apps Script)
 * Versao 1.0.0
 *
 * Como instalar (resumo): abrir a planilha Google > Extensoes > Apps Script >
 * colar este arquivo inteiro > rodar setup() > Implantar como App da Web
 * (executar como: eu / acesso: qualquer pessoa) > copiar a URL para o index.html.
 * Quando este arquivo mudar: colar inteiro, rodar setup() e publicar "Nova versao".
 */

var VERSAO = '1.0.0';
var PASTA_NOME = 'Controle de Lotes - Fotos';
var TOKEN_DIAS = 30;

var PERFIS = ['administrador', 'almoxarife', 'compras', 'consulta'];
var TODOS = PERFIS;
var ESCRITA_OBRA = ['administrador', 'almoxarife'];

var TABELAS = {
  Materiais:   ['id', 'nome', 'categoria', 'unidade', 'ativo'],
  Lotes:       ['id', 'materialId', 'numeroLote', 'fornecedor', 'notaFiscal', 'dataFabricacao', 'validade', 'dataEntrada', 'qtd', 'local', 'obs', 'status', 'por', 'criadoEm'],
  Liberacoes:  ['id', 'loteId', 'qtd', 'destino', 'dataLiberacao', 'dataAbertura', 'obs', 'por', 'criadoEm'],
  Ocorrencias: ['id', 'loteId', 'descricao', 'data', 'status', 'por', 'criadoEm', 'resolucao'],
  Fotos:       ['id', 'refTipo', 'refId', 'tipo', 'arquivo', 'por', 'criadoEm'],
  Destinos:    ['id', 'nome', 'tipo', 'ativo'],
  Usuarios:    ['id', 'nome', 'perfil', 'ativo'],
  Historico:   ['id', 'quando', 'quem', 'acao', 'detalhe']
};

var NUMERICAS = { qtd: true };

/* Tabela de acoes: quem pode e se e somente leitura */
var ACOES = {
  usuariosLogin:     { publica: true, ro: true },
  login:             { publica: true, ro: true },
  carregar:          { perfis: TODOS, ro: true },
  obterFoto:         { perfis: TODOS, ro: true },
  historico:         { perfis: ['administrador'], ro: true },
  salvarLote:        { perfis: ESCRITA_OBRA },
  salvarLiberacao:   { perfis: ESCRITA_OBRA },
  salvarFoto:        { perfis: ESCRITA_OBRA },
  salvarOcorrencia:  { perfis: ['administrador', 'almoxarife', 'compras'] },
  resolverOcorrencia:{ perfis: ['administrador', 'compras'] },
  salvarCadastro:    { perfis: ['administrador'] },
  salvarUsuario:     { perfis: ['administrador'] },
  lote:              { perfis: TODOS }   // agrupa passos; cada passo e conferido
};

var _cache = {};

/* ========================= SETUP ========================= */

function setup() {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());

  Object.keys(TABELAS).forEach(function (nome) {
    var sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
    var cab = TABELAS[nome];
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#d9d9d9');
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), cab.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  });
  var padrao = ss.getSheetByName('Planilha1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);

  if (!props.getProperty('PASTA_ID')) {
    var pasta = DriveApp.createFolder(PASTA_NOME);
    props.setProperty('PASTA_ID', pasta.getId());
  }

  // Materiais e destinos iniciais (so se vazios)
  if (lerTabela('Materiais').length === 0) {
    [['Argamassa de fachada', 'Argamassa', 'saco'], ['Argamassa colante', 'Argamassa', 'saco'],
     ['Impermeabilizante', 'Impermeabilizacao', 'balde'], ['Rejunte', 'Acabamento', 'saco']]
      .forEach(function (m) { inserir('Materiais', { id: novoId(), nome: m[0], categoria: m[1], unidade: m[2], ativo: 'sim' }); });
  }
  if (lerTabela('Destinos').length === 0) {
    ['Fachada', 'Torre - areas comuns', 'Apartamentos', 'Deposito']
      .forEach(function (n) { inserir('Destinos', { id: novoId(), nome: n, tipo: 'frente', ativo: 'sim' }); });
  }
  // Administrador inicial (trocar a senha no app)
  if (lerTabela('Usuarios').length === 0) {
    inserir('Usuarios', { id: 'u-admin', nome: 'Barbara', perfil: 'administrador', ativo: 'sim' });
    definirSenha('u-admin', '1234');
  }
  Logger.log('Setup concluido. Administrador inicial: Barbara, senha 1234 (troque no app).');
}

/* Rodar no editor para trocar uma senha: definirSenha('u-admin', '987654') */
function definirSenha(uid, pin) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('PIN_' + uid, hashPin(uid, pin));
}

/* ========================= ENTRADA ========================= */

function doGet() {
  return saida({ ok: true, app: 'controle-lotes', versao: VERSAO });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return saida({ ok: false, erro: 'JSON invalido' }); }
  var r = executar(req.acao, req.dados || {}, req.token);
  return saida(r);
}

function saida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function executar(acao, dados, token) {
  var def = ACOES[acao];
  if (!def) return { ok: false, erro: 'Acao desconhecida' };
  _cache = {};

  var usuario = null;
  if (!def.publica) {
    usuario = usuarioDoToken(token);
    if (!usuario) return { ok: false, erro: 'sessao', sessao: true };
    if (def.perfis && def.perfis.indexOf(usuario.perfil) < 0) return { ok: false, erro: 'Sem permissao' };
  }

  var lock = null;
  if (!def.ro) {
    lock = LockService.getScriptLock();
    try { lock.waitLock(30000); } catch (err) { return { ok: false, erro: 'Servidor ocupado, tente de novo', repetir: true }; }
  }
  try {
    return HANDLERS[acao](dados, usuario);
  } catch (err) {
    return { ok: false, erro: String(err && err.message || err) };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/* ========================= ACOES ========================= */

var HANDLERS = {

  usuariosLogin: function () {
    return { ok: true, usuarios: lerTabela('Usuarios').filter(function (x) { return x.ativo === 'sim'; })
      .map(function (x) { return { id: x.id, nome: x.nome }; }) };
  },

  login: function (d) {
    var uid = String(d.usuarioId || '');
    var cache = CacheService.getScriptCache();
    var chave = 'falhas_' + uid;
    var falhas = Number(cache.get(chave) || 0);
    if (falhas >= 5) return { ok: false, erro: 'Muitas tentativas. Aguarde 10 minutos.' };
    var u = lerTabela('Usuarios').filter(function (x) { return x.id === uid && x.ativo === 'sim'; })[0];
    var props = PropertiesService.getScriptProperties();
    var hash = props.getProperty('PIN_' + uid);
    if (!u || !hash || hash !== hashPin(uid, String(d.pin || ''))) {
      cache.put(chave, String(falhas + 1), 600);
      return { ok: false, erro: 'Senha incorreta' };
    }
    cache.remove(chave);
    limparTokens(props);
    var token = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('T_' + token, JSON.stringify({ u: uid, e: Date.now() + TOKEN_DIAS * 86400000 }));
    return { ok: true, token: token, usuario: { id: u.id, nome: u.nome, perfil: u.perfil } };
  },

  carregar: function (d, usuario) {
    var out = { ok: true, versao: VERSAO, usuario: usuario };
    ['Materiais', 'Lotes', 'Liberacoes', 'Ocorrencias', 'Fotos', 'Destinos'].forEach(function (t) { out[t] = lerTabela(t); });
    out.Usuarios = usuario.perfil === 'administrador' ? lerTabela('Usuarios') : [];
    return out;
  },

  obterFoto: function (d) {
    var f = lerTabela('Fotos').filter(function (x) { return x.id === d.id; })[0];
    if (!f) return { ok: false, erro: 'Foto nao encontrada' };
    var arq = DriveApp.getFileById(f.arquivo);
    var b = arq.getBlob();
    return { ok: true, id: f.id, dataUrl: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
  },

  historico: function () {
    var h = lerTabela('Historico');
    return { ok: true, itens: h.slice(-500).reverse() };
  },

  salvarLote: function (d, u) {
    exigir(d, ['id', 'materialId', 'numeroLote', 'dataEntrada', 'qtd']);
    var obj = {
      id: d.id, materialId: d.materialId, numeroLote: String(d.numeroLote).trim(),
      fornecedor: d.fornecedor || '', notaFiscal: d.notaFiscal || '',
      dataFabricacao: d.dataFabricacao || '', validade: d.validade || '',
      dataEntrada: d.dataEntrada, qtd: Number(d.qtd), local: d.local || '',
      obs: d.obs || '', status: d.status || 'ativo', por: u.nome, criadoEm: agora()
    };
    var novo = upsert('Lotes', obj);
    historico(u, novo ? 'Recebimento' : 'Edicao de lote', obj.numeroLote + ' (' + obj.qtd + ')');
    return { ok: true, id: d.id };
  },

  salvarLiberacao: function (d, u) {
    exigir(d, ['id', 'loteId', 'qtd', 'destino', 'dataLiberacao']);
    var obj = {
      id: d.id, loteId: d.loteId, qtd: Number(d.qtd), destino: d.destino,
      dataLiberacao: d.dataLiberacao, dataAbertura: d.dataAbertura || '',
      obs: d.obs || '', por: u.nome, criadoEm: agora()
    };
    var novo = upsert('Liberacoes', obj);
    historico(u, novo ? 'Liberacao' : 'Edicao de liberacao', d.loteId + ' -> ' + obj.destino + ' (' + obj.qtd + ')');
    return { ok: true, id: d.id };
  },

  salvarFoto: function (d, u) {
    exigir(d, ['id', 'refTipo', 'refId', 'tipo', 'base64']);
    var existe = lerTabela('Fotos').some(function (f) { return f.id === d.id; });
    if (existe) return { ok: true, id: d.id, repetida: true };
    var pasta = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PASTA_ID'));
    var bytes = Utilities.base64Decode(String(d.base64).replace(/^data:image\/\w+;base64,/, ''));
    var blob = Utilities.newBlob(bytes, 'image/jpeg', d.refTipo + '-' + d.refId + '-' + d.tipo + '-' + d.id + '.jpg');
    var arq = pasta.createFile(blob);
    inserir('Fotos', { id: d.id, refTipo: d.refTipo, refId: d.refId, tipo: d.tipo, arquivo: arq.getId(), por: u.nome, criadoEm: agora() });
    return { ok: true, id: d.id };
  },

  salvarOcorrencia: function (d, u) {
    exigir(d, ['id', 'loteId', 'descricao']);
    var obj = { id: d.id, loteId: d.loteId, descricao: d.descricao, data: d.data || hoje(), status: 'aberta', por: u.nome, criadoEm: agora(), resolucao: '' };
    var novo = upsert('Ocorrencias', obj, ['descricao']);
    historico(u, 'Ocorrencia', d.loteId + ': ' + d.descricao);
    return { ok: true, id: d.id };
  },

  resolverOcorrencia: function (d, u) {
    exigir(d, ['id']);
    var ok = atualizar('Ocorrencias', d.id, { status: 'resolvida', resolucao: d.resolucao || '' });
    if (!ok) return { ok: false, erro: 'Ocorrencia nao encontrada' };
    historico(u, 'Ocorrencia resolvida', d.id);
    return { ok: true, id: d.id };
  },

  salvarCadastro: function (d, u) {
    var tabela = { materiais: 'Materiais', destinos: 'Destinos' }[d.tabela];
    if (!tabela) return { ok: false, erro: 'Cadastro invalido' };
    exigir(d, ['id', 'nome']);
    var obj = tabela === 'Materiais'
      ? { id: d.id, nome: d.nome, categoria: d.categoria || '', unidade: d.unidade || 'un', ativo: d.ativo || 'sim' }
      : { id: d.id, nome: d.nome, tipo: d.tipo || 'frente', ativo: d.ativo || 'sim' };
    upsert(tabela, obj, Object.keys(obj));
    historico(u, 'Cadastro ' + d.tabela, d.nome);
    return { ok: true, id: d.id };
  },

  salvarUsuario: function (d, u) {
    exigir(d, ['id', 'nome', 'perfil']);
    if (PERFIS.indexOf(d.perfil) < 0) return { ok: false, erro: 'Perfil invalido' };
    if (d.pin && !/^\d{4,8}$/.test(String(d.pin))) return { ok: false, erro: 'Senha: 4 a 8 numeros' };
    var obj = { id: d.id, nome: d.nome, perfil: d.perfil, ativo: d.ativo || 'sim' };
    upsert('Usuarios', obj, Object.keys(obj));
    if (d.pin) definirSenha(d.id, String(d.pin));
    historico(u, 'Usuario', d.nome + ' (' + d.perfil + ')');
    return { ok: true, id: d.id };
  },

  /* Agrupa varios passos em uma chamada: dados.passos = [{acao, dados}] */
  lote: function (d, usuario) {
    var passos = d.passos || [];
    var resultados = passos.map(function (p) {
      var def = ACOES[p.acao];
      if (!def || p.acao === 'lote' || def.publica) return { ok: false, erro: 'Passo invalido' };
      if (def.perfis && def.perfis.indexOf(usuario.perfil) < 0) return { ok: false, erro: 'Sem permissao' };
      try { return HANDLERS[p.acao](p.dados || {}, usuario); }
      catch (err) { return { ok: false, erro: String(err && err.message || err) }; }
    });
    return { ok: true, resultados: resultados };
  }
};

/* ========================= PLANILHA ========================= */

function planilha() {
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
}

function lerTabela(nome) {
  if (_cache[nome]) return _cache[nome];
  var sh = planilha().getSheetByName(nome);
  var cab = TABELAS[nome];
  var n = sh.getLastRow() - 1;
  var out = [];
  if (n > 0) {
    var vals = sh.getRange(2, 1, n, cab.length).getValues();
    vals.forEach(function (linha) {
      if (linha[0] === '' || linha[0] === null) return;
      var o = {};
      cab.forEach(function (c, i) {
        var v = linha[i];
        if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        o[c] = NUMERICAS[c] ? Number(v) : String(v === null ? '' : v);
      });
      out.push(o);
    });
  }
  _cache[nome] = out;
  return out;
}

function inserir(nome, obj) {
  var cab = TABELAS[nome];
  var sh = planilha().getSheetByName(nome);
  var linha = cab.map(function (c) { return obj[c] === undefined ? '' : obj[c]; });
  sh.getRange(sh.getLastRow() + 1, 1, 1, cab.length).setValues([linha]);
  delete _cache[nome];
}

/* Insere se o id nao existe; se existe, atualiza so os campos de "campos" (ou todos, menos criadoEm). Retorna true se foi novo. */
function upsert(nome, obj, campos) {
  var existe = lerTabela(nome).some(function (x) { return x.id === obj.id; });
  if (!existe) { inserir(nome, obj); return true; }
  var parcial = {};
  var lista = campos || Object.keys(obj).filter(function (k) { return k !== 'criadoEm' && k !== 'por' && k !== 'id'; });
  lista.forEach(function (k) { if (k !== 'id') parcial[k] = obj[k]; });
  atualizar(nome, obj.id, parcial);
  return false;
}

function atualizar(nome, id, campos) {
  var cab = TABELAS[nome];
  var sh = planilha().getSheetByName(nome);
  var n = sh.getLastRow() - 1;
  if (n < 1) return false;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      Object.keys(campos).forEach(function (k) {
        var col = cab.indexOf(k);
        if (col >= 0) sh.getRange(i + 2, col + 1).setValue(campos[k]);
      });
      delete _cache[nome];
      return true;
    }
  }
  return false;
}

function historico(u, acao, detalhe) {
  inserir('Historico', { id: novoId(), quando: agora(), quem: u.nome, acao: acao, detalhe: detalhe });
}

/* ========================= UTIL ========================= */

function exigir(d, campos) {
  campos.forEach(function (c) {
    if (d[c] === undefined || d[c] === null || d[c] === '') throw new Error('Campo obrigatorio: ' + c);
  });
}

function novoId() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function agora() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss"); }
function hoje() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd'); }

function hashPin(uid, pin) {
  var salt = PropertiesService.getScriptProperties().getProperty('SALT');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + uid + '|' + pin);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function usuarioDoToken(token) {
  if (!token) return null;
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('T_' + token);
  if (!raw) return null;
  var t = JSON.parse(raw);
  if (t.e < Date.now()) { props.deleteProperty('T_' + token); return null; }
  var u = lerTabela('Usuarios').filter(function (x) { return x.id === t.u && x.ativo === 'sim'; })[0];
  return u ? { id: u.id, nome: u.nome, perfil: u.perfil } : null;
}

function limparTokens(props) {
  var todas = props.getProperties();
  var agoraMs = Date.now();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf('T_') !== 0) return;
    try { if (JSON.parse(todas[k]).e < agoraMs) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}
