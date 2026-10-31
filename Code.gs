/**
 * CONTROLE DE LOTES - Servidor (Google Apps Script)
 * Versao 2.0.0 - registro de entrega de material (foto do lote)
 *
 * Quando este arquivo mudar: colar INTEIRO no Apps Script, rodar setup() e
 * publicar "Nova versao" da implantacao (Implantar > Gerenciar implantacoes > Editar > Nova versao).
 */

var VERSAO = '2.0.0';
var PASTA_NOME = 'Controle de Lotes - Fotos';
var TOKEN_DIAS = 30;
var SENHA_INICIAL = '1234';

var PERFIS = ['administrador', 'almoxarife', 'compras'];
var TODOS = PERFIS;
var ENTREGA = ['administrador', 'almoxarife'];

var TABELAS = {
  Materiais: ['id', 'nome', 'categoria', 'unidade', 'ativo'],
  Entregas:  ['id', 'materialId', 'local', 'retiradoPor', 'data', 'obs', 'por', 'criadoEm'],
  Fotos:     ['id', 'refTipo', 'refId', 'tipo', 'arquivo', 'por', 'criadoEm'],
  Usuarios:  ['id', 'nome', 'perfil', 'ativo'],
  Historico: ['id', 'quando', 'quem', 'acao', 'detalhe']
};

var USUARIOS_INICIAIS = [
  { id: 'u-admin',   nome: 'Barbara',    perfil: 'administrador' },
  { id: 'u-almox',   nome: 'Almoxarife', perfil: 'almoxarife' },
  { id: 'u-compras', nome: 'Compras',    perfil: 'compras' }
];

/* Tabela de acoes: quem pode e se e somente leitura */
var ACOES = {
  usuariosLogin:  { publica: true, ro: true },
  login:          { publica: true, ro: true },
  carregar:       { perfis: TODOS, ro: true },
  obterFoto:      { perfis: TODOS, ro: true },
  historico:      { perfis: ['administrador'], ro: true },
  salvarEntrega:  { perfis: ENTREGA },
  salvarFoto:     { perfis: ENTREGA },
  salvarCadastro: { perfis: ['administrador', 'compras'] },
  salvarUsuario:  { perfis: ['administrador'] },
  batch:          { perfis: TODOS }   // agrupa passos; cada passo e conferido
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
    props.setProperty('PASTA_ID', DriveApp.createFolder(PASTA_NOME).getId());
  }

  if (lerTabela('Materiais').length === 0) {
    ['Argamassa de fachada', 'Argamassa colante', 'Impermeabilizante', 'Rejunte']
      .forEach(function (n) { inserir('Materiais', { id: novoId(), nome: n, categoria: '', unidade: '', ativo: 'sim' }); });
  }

  // Usuarios iniciais (so cria os que faltam; nao mexe em senha de quem ja existe)
  var existentes = lerTabela('Usuarios').map(function (u) { return u.id; });
  USUARIOS_INICIAIS.forEach(function (u) {
    if (existentes.indexOf(u.id) >= 0) return;
    inserir('Usuarios', { id: u.id, nome: u.nome, perfil: u.perfil, ativo: 'sim' });
    definirSenha(u.id, SENHA_INICIAL);
  });
  Logger.log('Setup concluido. Usuarios: Barbara (administrador), Almoxarife, Compras. Senha inicial: ' + SENHA_INICIAL);
}

/* Rodar no editor para trocar uma senha: definirSenha('u-admin', '987654') */
function definirSenha(uid, pin) {
  PropertiesService.getScriptProperties().setProperty('PIN_' + uid, hashPin(uid, pin));
}

/* ========================= ENTRADA ========================= */

function doGet() {
  return saida({ ok: true, app: 'controle-de-lotes', versao: VERSAO });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return saida({ ok: false, erro: 'JSON invalido' }); }
  return saida(executar(req.acao, req.dados || {}, req.token));
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
    ['Materiais', 'Entregas', 'Fotos'].forEach(function (t) { out[t] = lerTabela(t); });
    out.Usuarios = usuario.perfil === 'administrador' ? lerTabela('Usuarios') : [];
    return out;
  },

  obterFoto: function (d) {
    var f = lerTabela('Fotos').filter(function (x) { return x.id === d.id; })[0];
    if (!f) return { ok: false, erro: 'Foto nao encontrada' };
    var b = DriveApp.getFileById(f.arquivo).getBlob();
    return { ok: true, id: f.id, dataUrl: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
  },

  historico: function () {
    return { ok: true, itens: lerTabela('Historico').slice(-500).reverse() };
  },

  salvarEntrega: function (d, u) {
    exigir(d, ['id', 'materialId', 'local', 'retiradoPor', 'data']);
    if (!lerTabela('Materiais').some(function (m) { return m.id === d.materialId; })) throw new Error('Material nao encontrado');
    var obj = {
      id: d.id, materialId: d.materialId, local: String(d.local).trim(), retiradoPor: String(d.retiradoPor).trim(),
      data: d.data, obs: d.obs || '', por: u.nome, criadoEm: agora()
    };
    var novo = upsert('Entregas', obj, ['materialId', 'local', 'retiradoPor', 'data', 'obs']);
    historico(u, novo ? 'Entrega' : 'Edicao de entrega', obj.local + ' / ' + obj.retiradoPor);
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

  salvarCadastro: function (d, u) {
    exigir(d, ['id', 'nome']);
    var obj = { id: d.id, nome: String(d.nome).trim(), categoria: '', unidade: '', ativo: d.ativo || 'sim' };
    upsert('Materiais', obj, ['nome', 'ativo']);
    historico(u, 'Material', obj.nome + ' (' + obj.ativo + ')');
    return { ok: true, id: d.id };
  },

  salvarUsuario: function (d, u) {
    exigir(d, ['id', 'nome', 'perfil']);
    if (PERFIS.indexOf(d.perfil) < 0) return { ok: false, erro: 'Perfil invalido' };
    if (d.pin && !/^\d{4,8}$/.test(String(d.pin))) return { ok: false, erro: 'Senha: 4 a 8 numeros' };
    var obj = { id: d.id, nome: d.nome, perfil: d.perfil, ativo: d.ativo || 'sim' };
    upsert('Usuarios', obj, ['nome', 'perfil', 'ativo']);
    if (d.pin) definirSenha(d.id, String(d.pin));
    historico(u, 'Usuario', d.nome + ' (' + d.perfil + ')');
    return { ok: true, id: d.id };
  },

  /* Agrupa varios passos em uma chamada: dados.passos = [{acao, dados}] */
  batch: function (d, usuario) {
    var resultados = (d.passos || []).map(function (p) {
      var def = ACOES[p.acao];
      if (!def || p.acao === 'batch' || def.publica) return { ok: false, erro: 'Passo invalido' };
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
    sh.getRange(2, 1, n, cab.length).getValues().forEach(function (linha) {
      if (linha[0] === '' || linha[0] === null) return;
      var o = {};
      cab.forEach(function (c, i) {
        var v = linha[i];
        if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        o[c] = String(v === null ? '' : v);
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

/* Insere se o id nao existe; se existe, atualiza so os campos de "campos". Retorna true se foi novo. */
function upsert(nome, obj, campos) {
  var existe = lerTabela(nome).some(function (x) { return x.id === obj.id; });
  if (!existe) { inserir(nome, obj); return true; }
  var parcial = {};
  campos.forEach(function (k) { parcial[k] = obj[k]; });
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
    if (d[c] === undefined || d[c] === null || String(d[c]).trim() === '') throw new Error('Campo obrigatorio: ' + c);
  });
}

function novoId() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function agora() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss"); }

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
