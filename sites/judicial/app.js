// Ficha de Garantia Judicial: tela e envio.
//
// Nada aqui fala com o banco. O envio passa pela Edge Function ficha-judicial:
//   1) "preparar": o servidor confere a ficha e devolve uma URL de upload por documento;
//   2) os documentos sobem direto para a pasta privada;
//   3) "enviar": o servidor grava, devolve o protocolo e dispara os e-mails.
// Se a rede cair no passo 3, tentar de novo reaproveita o mesmo lote e o
// servidor devolve o mesmo protocolo, sem duplicar a ficha.
(function () {
  'use strict';

  var API = 'https://hfjvwibucplyhsvnwfor.supabase.co/functions/v1/ficha-judicial';
  var STORAGE = 'https://hfjvwibucplyhsvnwfor.supabase.co/storage/v1';
  var RASCUNHO = 'fg-ficha-judicial-v1';
  var CONTATO = 'Fabio@fegsegurogarantia.com.br ou WhatsApp (15) 99861-8659';

  // O que o cliente vê nas pílulas e o que o servidor espera.
  var PARA_SERVIDOR = {
    papel: { 'Advogado da causa': 'advogado', 'Da empresa': 'empresa' },
    caucao: { 'Nova garantia no processo': 'nova', 'Substituição de uma garantia já existente': 'substituicao', 'Garantia adicional': 'adicional' },
    exito: { 'Provável': 'provavel', 'Possível': 'possivel', 'Remota': 'remota' }
  };
  var CATEGORIA = { docSentenca: 'sentenca', docCalculo: 'calculo', docProcuracao: 'procuracao' };
  var CAMPO_DA_CATEGORIA = { sentenca: 'docSentenca', calculo: 'docCalculo', procuracao: 'docProcuracao' };
  // Preenchimento automático do navegador. Contato e empresa ficam em seções
  // separadas: escolher a sugestão do próprio e-mail não despeja o endereço
  // pessoal de quem preenche nos campos da empresa.
  var AUTO = {
    nome: 'section-contato name', email: 'section-contato email', tel: 'section-contato tel-national',
    razao: 'section-empresa organization', cep: 'section-empresa postal-code', endereco: 'section-empresa street-address',
    cidade: 'section-empresa address-level2', uf: 'section-empresa address-level1'
  };
  var EXTENSOES = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
  var MAX_BYTES = 20 * 1024 * 1024;
  var TOTAL = STEPS.length + 1; // etapas do formulário + conferência

  var st = {
    step: 0, v: {}, files: {}, tried: {}, aceite: false,
    enviando: false, andamento: '', erroEnvio: '', lote: null, anexos: null,
    recuperado: false, enviada: null
  };
  var refs = {};       // campo -> { wrap, input, nota, grupo }
  var caixaConta = null;
  var avisoEtapa = null;
  var notaAceiteEl = null;
  var conteudo = document.getElementById('conteudo');
  var nav = document.getElementById('etapas');

  // ── utilitários de DOM ─────────────────────────────────────────────────────
  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var val = attrs[k];
      if (val === null || val === undefined || val === false) return;
      if (k === 'class') n.className = val;
      else if (k === 'text') n.textContent = val;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), val);
      else n.setAttribute(k, val === true ? '' : val);
    });
    (filhos || []).forEach(function (f) { if (f) n.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return n;
  }
  function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dataBr(iso) { return iso ? iso.split('-').reverse().join('/') : ''; }
  function centavos(k) { return Number(dg(st.v[k])) || 0; }

  // ── rascunho (fica só neste aparelho; os arquivos não são guardados) ─────────
  function salvarRascunho() {
    try { localStorage.setItem(RASCUNHO, JSON.stringify({ v: st.v, step: Math.min(st.step, STEPS.length - 1), aceite: st.aceite })); } catch (e) { /* sem armazenamento: segue sem rascunho */ }
  }
  function lerRascunho() {
    try {
      var r = JSON.parse(localStorage.getItem(RASCUNHO) || 'null');
      if (r && r.v && typeof r.v === 'object' && Object.keys(r.v).some(function (k) { return r.v[k]; })) {
        st.v = r.v; st.aceite = !!r.aceite; st.recuperado = true;
      }
    } catch (e) { /* rascunho ilegível: começa em branco */ }
  }
  function apagarRascunho() { try { localStorage.removeItem(RASCUNHO); } catch (e) { /* nada a apagar */ } }

  // ── validação ──────────────────────────────────────────────────────────────
  function erroDoArquivo(arq) {
    var ext = (/\.([a-z0-9]+)$/i.exec(arq.name) || [])[1];
    if (!ext || EXTENSOES.indexOf(ext.toLowerCase()) < 0) return 'Use PDF, Word, JPG ou PNG.';
    if (arq.size <= 0) return 'O arquivo está vazio.';
    if (arq.size > MAX_BYTES) return 'O arquivo passa de 20 MB. Reduza ou divida o arquivo.';
    return '';
  }
  function erroDe(f) {
    if (f.kind === 'file') {
      var arq = st.files[f.key];
      if (!arq) return f.optional ? '' : 'Anexe este documento.';
      return erroDoArquivo(arq);
    }
    var v = st.v[f.key] || '';
    if (!v) return f.optional ? '' : (f.kind === 'pills' || f.kind === 'select' ? 'Escolha uma opção.' : 'Preencha este campo.');
    return f.check ? CHECK[f.check](v) : '';
  }
  function camposDaEtapa(i) {
    var lista = [];
    STEPS[i].groups.forEach(function (g) { g.fields.forEach(function (f) { lista.push(f); }); });
    return lista;
  }
  function errosDaEtapa(i) {
    var n = camposDaEtapa(i).filter(function (f) { return !!erroDe(f); }).length;
    if (i === STEPS.length - 1 && !st.aceite) n++;
    return n;
  }
  function etapaDoCampo(key) {
    for (var i = 0; i < STEPS.length; i++) if (camposDaEtapa(i).some(function (f) { return f.key === key; })) return i;
    return -1;
  }
  function notaCnj(v) {
    var d = dg(v);
    if (d.length !== 20 || !okCnj(v)) return null;
    var tr = Number(d.slice(14, 16));
    if (d[13] !== '5') return { texto: 'Número válido, mas não é da Justiça do Trabalho. Confira: esta ficha é para depósito recursal trabalhista.', tipo: 'alerta' };
    return { texto: 'Número válido. Justiça do Trabalho, ' + (tr === 0 ? 'TST' : 'TRT da ' + tr + 'ª Região') + '.', tipo: 'ok' };
  }
  /** Texto e tipo da linha de apoio embaixo do campo. */
  function notaDe(f) {
    var value = f.kind === 'file' ? '' : (st.v[f.key] || '');
    var err = erroDe(f);
    var completo = false;
    if (f.check === 'cnj') completo = dg(value).length === 20;
    else if (f.check === 'cnpj') completo = value.replace(/[^0-9A-Za-z]/g, '').length === 14;
    else if (f.check === 'doc') completo = dg(value).length === 11 || dg(value).length === 14;
    if (f.kind === 'file' && st.files[f.key]) completo = true;
    var mostra = !!err && (!!st.tried[st.step] || completo);
    if (mostra) return { texto: err, tipo: 'erro', erro: true };
    if (f.key === 'valorBase' && TETOS[st.v.recurso]) {
      var teto = TETOS[st.v.recurso];
      if (centavos('valorBase') > teto) return { texto: 'Acima do teto do depósito recursal para ' + st.v.recurso + ' (R$ ' + money(String(teto)) + '). Confira com o advogado se é este o valor.', tipo: 'alerta' };
      return { texto: 'Referência: teto do depósito recursal para ' + st.v.recurso + ', R$ ' + money(String(teto)) + ' (' + TETO_FONTE + ').', tipo: '' };
    }
    if (f.check === 'cnj') { var c = notaCnj(value); if (c) return c; }
    if (f.key === 'cnpj' && value && !err && consultado.cnpjAchado === value.replace(/[^0-9A-Za-z]/g, '')) {
      return { texto: 'CNPJ válido. Preenchemos a razão social e o endereço pelo cadastro do CNPJ. Confira e corrija se precisar.', tipo: 'ok' };
    }
    if (f.ok && value && !err) return { texto: f.ok, tipo: 'ok' };
    if (f.kind === 'file' && st.files[f.key]) return { texto: 'Anexado: ' + st.files[f.key].name, tipo: 'ok' };
    if (f.hint) return { texto: f.hint, tipo: '' };
    return { texto: '', tipo: '' };
  }

  // ── preenchimento automático (BrasilAPI e ViaCEP, gratuitos) ────────────────
  var consultado = { cnpj: '', cep: '', cnpjAchado: '' };
  function preencher(key, valor) {
    if (!valor) return;
    st.v[key] = valor;
    if (refs[key] && refs[key].input) refs[key].input.value = valor;
    atualizarCampo(key);
  }
  function preencherSeVazio(key, valor) { if (!st.v[key]) preencher(key, valor); }
  function buscar(url) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) { if (timer) clearTimeout(timer); return d; });
  }
  function autoCnpj() {
    var c = (st.v.cnpj || '').replace(/[^0-9A-Za-z]/g, '');
    if (c.length !== 14 || !okCnpj(c) || consultado.cnpj === c || !/^\d+$/.test(c)) return;
    consultado.cnpj = c;
    buscar('https://brasilapi.com.br/api/cnpj/v1/' + c).then(function (d) {
      // Só vale se o CNPJ na tela ainda for o que foi consultado.
      if (!d || !d.razao_social || (st.v.cnpj || '').replace(/[^0-9A-Za-z]/g, '') !== c) return;
      // O cadastro do CNPJ entra por cima do que estiver nos campos (inclusive do
      // preenchimento automático do navegador, que costuma pôr o endereço da pessoa).
      // Roda uma vez por CNPJ: o que o cliente corrigir depois fica como ele deixou.
      preencher('razao', d.razao_social);
      if (d.cep) { preencher('cep', MASK.cep(String(d.cep))); consultado.cep = dg(String(d.cep)); }
      var end = [[d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' '), d.numero, d.bairro].filter(Boolean).join(', ');
      preencher('endereco', end);
      preencher('cidade', d.municipio);
      if (UFS.indexOf(d.uf) >= 0) preencher('uf', d.uf);
      consultado.cnpjAchado = c;
      salvarRascunho(); atualizarTudo();
    });
  }
  function autoCep() {
    var c = dg(st.v.cep);
    if (c.length !== 8 || consultado.cep === c) return;
    consultado.cep = c;
    buscar('https://viacep.com.br/ws/' + c + '/json/').then(function (d) {
      if (!d || d.erro) return;
      preencherSeVazio('endereco', [d.logradouro, d.bairro].filter(Boolean).join(', '));
      preencherSeVazio('cidade', d.localidade);
      if (UFS.indexOf(d.uf) >= 0) preencherSeVazio('uf', d.uf);
      salvarRascunho(); atualizarTudo();
    });
  }

  // ── lateral ────────────────────────────────────────────────────────────────
  function desenharEtapas() {
    limpar(nav);
    var liberada = 0;
    while (liberada < STEPS.length && errosDaEtapa(liberada) === 0) liberada++;
    STEPS.map(function (s) { return s.label; }).concat(['Conferir e enviar']).forEach(function (rotulo, i) {
      var feita = !!st.enviada || (i < STEPS.length && i < st.step && errosDaEtapa(i) === 0);
      var atual = !st.enviada && i === st.step;
      nav.appendChild(el('button', {
        type: 'button', class: 'etapa' + (atual ? ' atual' : '') + (feita ? ' feita' : ''),
        disabled: !!st.enviada || st.enviando || i > liberada, 'aria-current': atual ? 'step' : null,
        onclick: function () { irPara(i); }
      }, [el('span', { class: 'bola', 'aria-hidden': 'true', text: feita ? '✓' : String(i + 1) }), el('span', { text: rotulo })]));
    });
  }

  // ── campos ─────────────────────────────────────────────────────────────────
  function mudou(f, valor) {
    st.v[f.key] = valor;
    if (st.lote) { st.lote = null; st.anexos = null; } // mudou algo depois de um envio que falhou: recomeça o envio do zero
    salvarRascunho();
    atualizarCampo(f.key);
    if (f.key === 'recurso' || f.key === 'valorBase') { atualizarCampo('valorBase'); atualizarConta(); }
    if (f.key === 'cnpj') autoCnpj();
    if (f.key === 'cep') autoCep();
    atualizarAviso();
    desenharEtapas();
  }
  function desenharCampo(f) {
    var id = 'f-' + f.key, kind = f.kind || 'input', r = { f: f };
    var rotulo = [f.label, f.optional ? el('span', { class: 'opcional', text: ' (opcional)' }) : null];
    var topo = el('div', { class: 'topo' }, [
      kind === 'pills' ? el('span', { class: 'rotulo', id: id + '-rotulo' }, rotulo) : el('label', { for: id }, rotulo)
    ]);
    var ajuda = null;
    if (HELP[f.key]) {
      ajuda = el('div', { class: 'ajuda', id: id + '-ajuda', role: 'note', hidden: true, text: HELP[f.key] });
      var botao = el('button', {
        type: 'button', class: 'botao-i', 'aria-expanded': 'false', 'aria-controls': id + '-ajuda',
        'aria-label': 'O que preencher em: ' + f.label, text: 'i',
        onclick: function () {
          var abrir = ajuda.hasAttribute('hidden');
          if (abrir) ajuda.removeAttribute('hidden'); else ajuda.setAttribute('hidden', '');
          botao.setAttribute('aria-expanded', abrir ? 'true' : 'false');
        }
      });
      topo.appendChild(botao);
    }
    var controle;
    if (kind === 'input') {
      controle = el('input', {
        id: id, class: 'entrada', type: f.type || 'text', placeholder: f.ph || null, inputmode: f.mode || null,
        autocomplete: AUTO[f.key] || 'off', max: f.type === 'date' ? hojeISO() : null, 'aria-describedby': id + '-nota'
      });
      controle.value = st.v[f.key] || '';
      controle.addEventListener('input', function () {
        if (f.mask) { var m = MASK[f.mask](controle.value); if (m !== controle.value) controle.value = m; }
        mudou(f, controle.value);
      });
      r.input = controle;
    } else if (kind === 'area') {
      controle = el('textarea', { id: id, class: 'entrada', placeholder: f.ph || null, maxlength: '4000', 'aria-describedby': id + '-nota' });
      controle.value = st.v[f.key] || '';
      controle.addEventListener('input', function () { mudou(f, controle.value); });
      r.input = controle;
    } else if (kind === 'select') {
      controle = el('select', { id: id, class: 'entrada', autocomplete: AUTO[f.key] || 'off', 'aria-describedby': id + '-nota' },
        [el('option', { value: '', text: 'Selecione' })].concat(f.options.map(function (o) { return el('option', { value: o, text: o }); })));
      controle.value = st.v[f.key] || '';
      controle.addEventListener('change', function () { mudou(f, controle.value); });
      r.input = controle;
    } else if (kind === 'pills') {
      controle = el('div', { class: 'pilulas', role: 'group', 'aria-labelledby': id + '-rotulo', id: id }, f.options.map(function (o) {
        return el('button', {
          type: 'button', class: 'pilula', 'aria-pressed': st.v[f.key] === o ? 'true' : 'false', text: o,
          onclick: function () {
            Array.prototype.forEach.call(controle.children, function (b) { b.setAttribute('aria-pressed', b.textContent === o ? 'true' : 'false'); });
            mudou(f, o);
          }
        });
      }));
      r.grupo = controle;
    } else { // file
      controle = el('input', { id: id, class: 'arquivo', type: 'file', accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png', 'aria-describedby': id + '-nota' });
      controle.addEventListener('change', function () {
        var arq = controle.files && controle.files[0];
        if (arq) st.files[f.key] = arq; else delete st.files[f.key];
        st.lote = null; st.anexos = null;
        atualizarCampo(f.key); atualizarAviso(); desenharEtapas();
      });
      r.input = controle;
    }
    r.nota = el('div', { class: 'nota', id: id + '-nota' });
    r.wrap = el('div', { class: 'campo', style: 'grid-column: span ' + f.span }, [topo, ajuda, controle, r.nota]);
    refs[f.key] = r;
    return r.wrap;
  }
  function atualizarCampo(key) {
    var r = refs[key];
    if (!r) return;
    var n = notaDe(r.f);
    // Arquivo já escolhido em outra visita à etapa: o navegador não deixa repor o campo, então a nota avisa.
    r.nota.textContent = n.texto;
    r.nota.className = 'nota' + (n.tipo ? ' ' + n.tipo : '');
    r.nota.hidden = !n.texto;
    var alvo = r.input || r.grupo;
    alvo.classList.toggle('com-erro', !!n.erro);
    if (r.input) { if (n.erro) r.input.setAttribute('aria-invalid', 'true'); else r.input.removeAttribute('aria-invalid'); }
  }
  function atualizarConta() {
    if (!caixaConta) return;
    var base = centavos('valorBase'), acrescimo = Math.round(base * 0.3);
    caixaConta.hidden = !(base > 0);
    caixaConta.querySelector('[data-c="base"]').textContent = 'R$ ' + money(String(base));
    caixaConta.querySelector('[data-c="mais"]').textContent = 'R$ ' + money(String(acrescimo));
    caixaConta.querySelector('[data-c="total"]').textContent = 'R$ ' + money(String(base + acrescimo));
  }
  function atualizarAviso() {
    if (!avisoEtapa) return;
    var n = st.step < STEPS.length ? errosDaEtapa(st.step) : 0;
    var mostra = !!st.tried[st.step] && n > 0;
    avisoEtapa.hidden = !mostra;
    avisoEtapa.textContent = n === 1 ? 'Falta 1 item nesta etapa. Veja o campo marcado.' : 'Faltam ' + n + ' itens nesta etapa. Veja os campos marcados.';
  }
  function atualizarTudo() {
    Object.keys(refs).forEach(atualizarCampo);
    atualizarConta(); atualizarAviso(); desenharEtapas();
  }

  // ── telas ──────────────────────────────────────────────────────────────────
  function cabecalho(contagem, titulo, texto) {
    return el('header', { class: 'cabecalho' }, [
      el('div', { class: 'contagem', text: contagem }),
      el('h2', { tabindex: '-1', id: 'titulo-etapa', text: titulo }),
      el('p', { text: texto })
    ]);
  }
  function por(n) { if (n) conteudo.appendChild(n); }
  function faixaErroEnvio() {
    return st.erroEnvio ? el('div', { class: 'faixa erro', role: 'alert', text: st.erroEnvio }) : null;
  }
  function desenharFormulario() {
    var i = st.step, etapa = STEPS[i];
    refs = {}; caixaConta = null; notaAceiteEl = null;
    limpar(conteudo);
    if (st.recuperado && i === 0) {
      conteudo.appendChild(el('div', { class: 'faixa' }, [
        el('span', { text: 'Recuperamos o que você já tinha preenchido neste aparelho. Os documentos precisam ser anexados de novo.' }),
        el('button', { type: 'button', class: 'botao-texto', text: 'Começar do zero', onclick: function () {
          apagarRascunho(); st.v = {}; st.files = {}; st.tried = {}; st.aceite = false; st.recuperado = false; st.step = 0; desenhar(true);
        } })
      ]));
    }
    por(faixaErroEnvio());
    conteudo.appendChild(cabecalho('Etapa ' + (i + 1) + ' de ' + TOTAL, etapa.title, etapa.lead));
    etapa.groups.forEach(function (g) {
      conteudo.appendChild(el('section', { class: 'cartao' }, [
        el('h3', { text: g.title }),
        el('div', { class: 'grade' }, g.fields.map(desenharCampo))
      ]));
    });
    if (i === STEPS.length - 1) {
      caixaConta = el('section', { class: 'conta', 'aria-live': 'polite', hidden: true }, [
        el('div', null, [el('span', { text: 'Valor informado' }), el('strong', { 'data-c': 'base' })]),
        el('div', null, [el('span', { text: 'Acréscimo de 30%' }), el('strong', { 'data-c': 'mais' })]),
        el('div', { class: 'total' }, [el('span', { text: 'Valor da garantia a cotar' }), el('strong', { 'data-c': 'total' })]),
        el('p', { text: 'O acréscimo de 30% é o pedido na ficha da seguradora. O valor final é confirmado na análise.' })
      ]);
      conteudo.appendChild(caixaConta);
      var caixa = el('input', { type: 'checkbox', id: 'aceite' });
      caixa.checked = st.aceite;
      var notaAceite = el('span', { class: 'nota erro', id: 'aceite-nota', hidden: true, text: ' Marque para continuar.' });
      caixa.addEventListener('change', function () {
        st.aceite = caixa.checked; salvarRascunho();
        notaAceite.hidden = st.aceite || !st.tried[st.step];
        atualizarAviso(); desenharEtapas();
      });
      notaAceite.hidden = st.aceite || !st.tried[i];
      conteudo.appendChild(el('label', { class: 'aceite', for: 'aceite' }, [caixa, el('span', null, [
        'Autorizo a F&G Seguro Garantia a usar os dados e documentos desta ficha para cotar e emitir a garantia com as seguradoras.', notaAceite
      ])]));
      notaAceiteEl = notaAceite;
    }
    avisoEtapa = el('span', { class: 'aviso', role: 'alert', hidden: true });
    conteudo.appendChild(el('div', { class: 'acoes' }, [
      i > 0 ? el('button', { type: 'button', class: 'botao secundario', text: 'Voltar', onclick: function () { irPara(i - 1); } }) : null,
      el('button', { type: 'button', class: 'botao', text: i === STEPS.length - 1 ? 'Conferir a ficha' : 'Continuar', onclick: avancar }),
      avisoEtapa
    ]));
    atualizarTudo();
  }
  function linhasDaRevisao() {
    var v = st.v, base = centavos('valorBase');
    var t = function (k) { return v[k] || 'Não informado'; };
    var arq = function (k) { return st.files[k] ? st.files[k].name : 'Não anexado'; };
    return [
      ['Contato', 0, [['Nome', t('nome') + ' (' + t('papel') + ')'], ['E-mail', t('email')], ['Celular', t('tel')]]],
      ['Empresa (reclamada)', 0, [['Razão social', t('razao')], ['CNPJ', t('cnpj')], ['Endereço', [v.endereco, v.cidade, v.uf, v.cep].filter(Boolean).join(', ')]]],
      ['Processo', 1, [['Número', t('numero')], ['Vara', t('juizo')], ['Valor da causa', 'R$ ' + t('valorCausa')], ['Distribuição', dataBr(v.dataDist)], ['Recurso', t('recurso')], ['Tipo de garantia', t('caucao')]]],
      ['Reclamante', 1, [['Nome', t('recNome')], ['CPF ou CNPJ', t('recDoc')], ['Endereço', t('recEnd')]]],
      ['Parecer do advogado', 2, [['Objeto', t('objeto')], ['Histórico', t('historico')], ['Linha de defesa', t('defesa')], ['Probabilidade de êxito', t('exito')], ['Advogado', t('advNome') + ', OAB ' + t('oabUf') + ' ' + t('oab')]]],
      ['Valor e documentos', 3, [['Valor informado', 'R$ ' + money(String(base))], ['Com acréscimo de 30%', 'R$ ' + money(String(base + Math.round(base * 0.3)))], ['Data base', dataBr(v.dataBase)], ['Índice', t('indice')], ['Objetivo', t('objetivo')], ['Segurado', v.segurado || 'A confirmar'], ['Sentença', arq('docSentenca')], ['Cálculo', arq('docCalculo')], ['Procuração', arq('docProcuracao')]]]
    ];
  }
  function desenharRevisao() {
    refs = {}; caixaConta = null; avisoEtapa = null; notaAceiteEl = null;
    limpar(conteudo);
    por(faixaErroEnvio());
    conteudo.appendChild(cabecalho('Etapa ' + TOTAL + ' de ' + TOTAL, 'Confira antes de enviar', 'É assim que a ficha chega para nós. Se algo estiver errado, volte à etapa e corrija.'));
    conteudo.appendChild(el('div', { class: 'revisao' }, linhasDaRevisao().map(function (g) {
      return el('section', { class: 'cartao' }, [
        el('div', { class: 'titulo' }, [
          el('h3', { text: g[0] }),
          el('button', { type: 'button', class: 'botao-texto', text: 'Corrigir', disabled: st.enviando, 'aria-label': 'Corrigir ' + g[0], onclick: function () { irPara(g[1]); } })
        ]),
        el('dl', null, g[2].map(function (w) { return el('div', null, [el('dt', { text: w[0] }), el('dd', { text: w[1] })]); }))
      ]);
    })));
    conteudo.appendChild(el('div', { class: 'acoes' }, [
      el('button', { type: 'button', class: 'botao secundario', text: 'Voltar', disabled: st.enviando, onclick: function () { irPara(STEPS.length - 1); } }),
      el('button', { type: 'button', class: 'botao', id: 'botao-enviar', text: st.enviando ? 'Enviando...' : 'Enviar ficha', disabled: st.enviando, onclick: enviarFicha }),
      el('span', { class: 'andamento', role: 'status', id: 'andamento', text: st.andamento })
    ]));
    desenharEtapas();
  }
  function desenharRecebida() {
    var e = st.enviada;
    refs = {}; caixaConta = null; avisoEtapa = null; notaAceiteEl = null;
    limpar(conteudo);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '56'); svg.setAttribute('height', '56'); svg.setAttribute('viewBox', '0 0 56 56'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true');
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', '28'); c.setAttribute('cy', '28'); c.setAttribute('r', '27'); c.setAttribute('fill', '#E7F5EE'); c.setAttribute('stroke', '#047857'); c.setAttribute('stroke-width', '2');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M17 29l8 8 15-17'); p.setAttribute('stroke', '#047857'); p.setAttribute('stroke-width', '3.5'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(c); svg.appendChild(p);
    var copia = e.emailEnviado
      ? el('p', null, ['Obrigado, ' + e.primeiroNome + '. Sua ficha já está com a nossa equipe e vamos tratar do seu pedido. Enviamos uma cópia do que você preencheu para ', el('strong', { text: e.email }), '.'])
      : el('p', null, ['Obrigado, ' + e.primeiroNome + '. Sua ficha já está com a nossa equipe e vamos tratar do seu pedido. Não conseguimos enviar a cópia para ', el('strong', { text: e.email }), ' agora. Anote o protocolo abaixo.']);
    conteudo.appendChild(el('section', { class: 'recebida' }, [
      svg,
      el('h2', { tabindex: '-1', id: 'titulo-etapa', text: 'Recebemos a sua ficha' }),
      copia,
      el('div', { class: 'dados' }, [
        el('div', { class: 'protocolo' }, [el('span', { text: 'Protocolo' }), el('strong', { text: e.protocolo })]),
        el('div', null, [el('span', { text: 'Processo' }), el('strong', { text: e.numero })]),
        el('div', null, [el('span', { text: 'Valor da garantia a cotar' }), el('strong', { text: 'R$ ' + e.valor })])
      ]),
      el('div', null, [
        el('h3', { text: 'O que acontece agora' }),
        el('ol', null, [
          el('li', { text: 'Conferimos os dados e os documentos que você enviou.' }),
          el('li', { text: 'Se faltar alguma informação, falamos com você pelo e-mail ou telefone informados.' }),
          el('li', { text: 'Damos atenção imediata ao seu pedido e retornamos o mais breve possível.' })
        ])
      ]),
      el('p', null, ['Precisa falar com a gente? Informe o protocolo: ', el('strong', { text: 'Fabio@fegsegurogarantia.com.br' }), ' ou WhatsApp ', el('strong', { text: '(15) 99861-8659' }), '.']),
      el('div', { class: 'acoes' }, [el('button', { type: 'button', class: 'botao secundario', text: 'Enviar outra ficha', onclick: function () {
        st.enviada = null; st.v = {}; st.files = {}; st.tried = {}; st.aceite = false; st.recuperado = false; st.step = 0; st.lote = null; st.anexos = null; desenhar(true);
      } })])
    ]));
    desenharEtapas();
  }
  function desenhar(focar) {
    if (st.enviada) desenharRecebida();
    else if (st.step >= STEPS.length) desenharRevisao();
    else desenharFormulario();
    if (focar) {
      var t = document.getElementById('titulo-etapa');
      if (t) { t.focus(); if (t.scrollIntoView) t.scrollIntoView({ block: 'start' }); }
    }
  }

  // ── navegação ──────────────────────────────────────────────────────────────
  function irPara(i) {
    if (st.enviando) return;
    if (i === 2 && !st.v.advNome && st.v.papel === 'Advogado da causa' && st.v.nome) st.v.advNome = st.v.nome;
    st.step = i; st.erroEnvio = '';
    salvarRascunho();
    desenhar(true);
  }
  function avancar() {
    if (errosDaEtapa(st.step) > 0) {
      st.tried[st.step] = true;
      atualizarTudo();
      if (notaAceiteEl) notaAceiteEl.hidden = st.aceite;
      var primeiro = camposDaEtapa(st.step).filter(function (f) { return !!erroDe(f); })[0];
      var alvo = primeiro && refs[primeiro.key] && (refs[primeiro.key].input || refs[primeiro.key].grupo.querySelector('button'));
      if (!alvo && !st.aceite) alvo = document.getElementById('aceite');
      if (alvo) alvo.focus();
      return;
    }
    irPara(st.step + 1);
  }

  // ── envio ──────────────────────────────────────────────────────────────────
  function corpoDaFicha() {
    var v = st.v;
    return {
      nome: v.nome, papel: PARA_SERVIDOR.papel[v.papel], email: v.email, tel: v.tel,
      cnpj: v.cnpj, razao: v.razao, cep: v.cep, endereco: v.endereco, cidade: v.cidade, uf: v.uf,
      numero: v.numero, juizo: v.juizo, valorCausa: centavos('valorCausa') / 100, dataDist: v.dataDist,
      recurso: v.recurso, caucao: PARA_SERVIDOR.caucao[v.caucao],
      recNome: v.recNome, recDoc: v.recDoc, recEnd: v.recEnd || '',
      objeto: v.objeto, historico: v.historico, defesa: v.defesa, exito: PARA_SERVIDOR.exito[v.exito],
      advNome: v.advNome, oab: v.oab, oabUf: v.oabUf,
      valorBase: centavos('valorBase') / 100, dataBase: v.dataBase, indice: v.indice,
      objetivo: v.objetivo, segurado: v.segurado || '', obs: v.obs || '',
      aceite: st.aceite === true,
      site: (document.getElementById('site') || {}).value || ''
    };
  }
  function chamar(corpo) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.__status = r.status; return d; }); });
  }
  function falha(msg, campo) { var e = new Error(msg); e.campo = campo || ''; e.doServidor = true; return e; }
  function andamento(texto) {
    st.andamento = texto;
    var n = document.getElementById('andamento');
    if (n) n.textContent = texto;
  }
  function enviarFicha() {
    if (st.enviando) return;
    for (var i = 0; i < STEPS.length; i++) if (errosDaEtapa(i) > 0) { st.tried[i] = true; irPara(i); return; }
    st.enviando = true; st.erroEnvio = '';
    desenharRevisao();
    var corpo = corpoDaFicha();
    var arquivos = Object.keys(CATEGORIA).filter(function (k) { return st.files[k]; });

    var subir = st.lote && st.anexos ? Promise.resolve() : (function () {
      andamento('Conferindo os dados...');
      var pedido = Object.assign({}, corpo, { acao: 'preparar', arquivos: arquivos.map(function (k) {
        return { categoria: CATEGORIA[k], nome: st.files[k].name, tamanho: st.files[k].size };
      }) });
      return chamar(pedido).then(function (d) {
        if (!d.success) throw falha(d.error || 'Não foi possível enviar agora.', d.campo);
        var feitos = [];
        return d.arquivos.reduce(function (fila, a, n) {
          return fila.then(function () {
            andamento('Enviando documento ' + (n + 1) + ' de ' + d.arquivos.length + '...');
            var arq = st.files[CAMPO_DA_CATEGORIA[a.categoria]];
            return fetch(STORAGE + '/object/upload/sign/' + d.bucket + '/' + a.path + '?token=' + encodeURIComponent(a.token), {
              method: 'PUT', headers: { 'Content-Type': a.tipo, 'x-upsert': 'false' }, body: arq
            }).then(function (r) {
              if (!r.ok) throw falha('Não conseguimos receber o arquivo "' + a.nome + '". Tente de novo.', a.categoria);
              feitos.push({ path: a.path, nome: a.nome });
            });
          });
        }, Promise.resolve()).then(function () { st.lote = d.lote; st.anexos = feitos; });
      });
    })();

    subir.then(function () {
      andamento('Registrando a ficha...');
      return chamar(Object.assign({}, corpo, { acao: 'enviar', lote: st.lote, anexos: st.anexos }));
    }).then(function (d) {
      if (!d.success) {
        if (d.__status >= 500) throw new Error('servidor');   // mantém o lote: tentar de novo não duplica
        st.lote = null; st.anexos = null;
        throw falha(d.error || 'Não foi possível enviar agora.', d.campo);
      }
      st.enviada = {
        protocolo: d.protocolo, email: d.email, emailEnviado: d.email_enviado !== false,
        numero: st.v.numero, valor: money(String(Math.round(d.valor_garantia * 100))),
        primeiroNome: (st.v.nome || '').trim().split(' ')[0]
      };
      st.enviando = false; st.andamento = '';
      apagarRascunho();
      desenhar(true);
    }).catch(function (e) {
      st.enviando = false; st.andamento = '';
      if (e && e.doServidor) {
        st.erroEnvio = e.message;
        var key = CAMPO_DA_CATEGORIA[e.campo] || e.campo;
        var etapa = key === 'aceite' ? STEPS.length - 1 : etapaDoCampo(key);
        if (etapa >= 0) { st.tried[etapa] = true; st.step = etapa; var msg = st.erroEnvio; desenhar(true); st.erroEnvio = msg; return; }
      } else {
        st.erroEnvio = 'Não conseguimos concluir o envio. Confira a sua internet e clique em "Enviar ficha" de novo. Se continuar, fale com a gente: ' + CONTATO + '.';
      }
      desenhar(true);
    });
  }

  // ── início ─────────────────────────────────────────────────────────────────
  // Campo isca: escondido de quem usa o formulário; robôs costumam preencher.
  document.body.appendChild(el('div', { class: 'isca', 'aria-hidden': 'true' }, [
    el('label', { for: 'site', text: 'Não preencha este campo' }),
    el('input', { type: 'text', id: 'site', name: 'site', tabindex: '-1', autocomplete: 'off' })
  ]));
  lerRascunho();
  desenhar(false);
})();
