/**
 * Aviso de "saiu versão nova" para os portais públicos.
 *
 * Mesma ideia do AvisoNovaVersao.tsx do hub, só que para as páginas estáticas
 * de public/ — que não passam pelo bundle e portanto não têm __BUILD_TIME__.
 *
 * Como cada página sabe a própria versão: o build carimba o timestamp na
 * <meta name="fg-build"> de cada HTML (ver o plugin fg-carimba-portais no
 * vite.config.ts). O HTML em execução nunca muda sozinho; o /version.json
 * avulso, sim, a cada deploy. Quando os dois deixam de bater, tem versão nova.
 *
 * Por que avisar e não recarregar sozinho: o parceiro pode estar no meio de um
 * cadastro. Recarregar sem pedir joga fora o que ele digitou.
 *
 * Uso: <script defer src="aviso-versao.js"></script> — sem dependências.
 */
(function () {
  'use strict';

  /** De quanto em quanto tempo perguntar ao servidor. */
  var INTERVALO_MS = 5 * 60 * 1000;

  var meta = document.querySelector('meta[name="fg-build"]');
  var atual = meta && meta.getAttribute('content');

  // Em dev o carimbo continua sendo o placeholder — nada a comparar.
  if (!atual || atual.indexOf('__') === 0) return;

  var mostrando = false;
  var dispensada = null;

  function estilo() {
    if (document.getElementById('fg-aviso-css')) return;
    var s = document.createElement('style');
    s.id = 'fg-aviso-css';
    s.textContent = [
      '.fg-aviso{position:fixed;bottom:24px;left:24px;z-index:9999;max-width:370px;',
      'display:flex;align-items:flex-start;gap:14px;padding:18px 20px;',
      'background:#1B263B;color:#fff;border-radius:20px;',
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'box-shadow:0 4px 12px rgba(20,32,58,.2),0 28px 60px -24px rgba(20,32,58,.6);',
      'animation:fg-sobe .5s cubic-bezier(.22,.61,.36,1) both}',
      '@keyframes fg-sobe{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}',
      '.fg-aviso-ico{width:38px;height:38px;border-radius:12px;flex:none;',
      'display:flex;align-items:center;justify-content:center;',
      'background:rgba(198,156,109,.16);color:#C69C6D}',
      '.fg-aviso-ico svg{width:19px;height:19px;fill:none;stroke:currentColor;',
      'stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
      '.fg-aviso-txt{flex:1;min-width:0}',
      '.fg-aviso-txt b{display:block;font-size:14px;font-weight:600;letter-spacing:-.2px}',
      '.fg-aviso-txt p{margin:6px 0 0;font-size:12.5px;line-height:1.55;color:#a9b3c4}',
      '.fg-aviso-btn{margin-top:13px;display:inline-flex;align-items:center;gap:7px;',
      'padding:9px 17px;border:none;border-radius:999px;cursor:pointer;',
      'background:#C69C6D;color:#1B263B;font:inherit;font-size:12.5px;font-weight:600;',
      'transition:transform .24s cubic-bezier(.22,.61,.36,1),background .24s}',
      '.fg-aviso-btn:hover{background:#d3ae83;transform:translateY(-1px)}',
      '.fg-aviso-btn:disabled{opacity:.55;transform:none;cursor:default}',
      '.fg-aviso-x{flex:none;background:none;border:none;cursor:pointer;padding:2px;',
      'color:#6d7891;line-height:0;transition:color .24s}',
      '.fg-aviso-x:hover{color:#fff}',
      '.fg-aviso-x svg{width:16px;height:16px;fill:none;stroke:currentColor;',
      'stroke-width:2;stroke-linecap:round}',
      '@media(max-width:560px){.fg-aviso{left:14px;right:14px;bottom:14px;max-width:none}}',
      '@media(prefers-reduced-motion:reduce){.fg-aviso{animation:none}',
      '.fg-aviso-btn{transition:none}}'
    ].join('');
    document.head.appendChild(s);
  }

  /** Limpa o cache do service worker antes de recarregar. Sem isso, quem
      estiver com um SW antigo recarrega para a mesma versão velha e o aviso
      volta em cinco minutos, num laço sem fim. */
  function atualizar(btn) {
    btn.disabled = true;
    btn.lastChild.textContent = ' Atualizando…';
    var limpar = ('caches' in window)
      ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })
      : Promise.resolve();
    limpar
      .then(function () { return navigator.serviceWorker && navigator.serviceWorker.getRegistration(); })
      .then(function (reg) { return reg && reg.update(); })
      .catch(function () { /* limpar cache é otimização; recarrega assim mesmo */ })
      .then(function () { location.reload(); });
  }

  function mostrar(versao) {
    if (mostrando || dispensada === versao) return;
    mostrando = true;
    estilo();

    var box = document.createElement('div');
    box.className = 'fg-aviso';
    box.setAttribute('role', 'status');
    box.innerHTML =
      '<div class="fg-aviso-ico"><svg viewBox="0 0 24 24">' +
        '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M18.5 3v3.4h-3.4"/>' +
      '</svg></div>' +
      '<div class="fg-aviso-txt">' +
        '<b>Melhoramos esta página</b>' +
        '<p>Atualize quando terminar o que está fazendo — nada do que você já enviou se perde.</p>' +
        '<button class="fg-aviso-btn">' +
          '<svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round">' +
            '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M18.5 3v3.4h-3.4"/>' +
          '</svg><span>Atualizar agora</span>' +
        '</button>' +
      '</div>' +
      '<button class="fg-aviso-x" title="Agora não" aria-label="Fechar aviso">' +
        '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button>';

    box.querySelector('.fg-aviso-btn').addEventListener('click', function () { atualizar(this); });
    // Dispensar esconde só esta versão: no próximo deploy o aviso volta.
    box.querySelector('.fg-aviso-x').addEventListener('click', function () {
      dispensada = versao;
      mostrando = false;
      box.remove();
    });

    document.body.appendChild(box);
  }

  function verificar() {
    if (mostrando) return;
    // `no-store` + query única: nem o navegador nem nenhum proxy no caminho
    // pode devolver uma cópia velha justo do arquivo que diz o que é novo.
    fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && typeof j.buildTime === 'string' && j.buildTime !== atual) mostrar(j.buildTime);
      })
      .catch(function () { /* sem rede, ou em dev: tenta no próximo intervalo */ });
  }

  verificar();
  setInterval(verificar, INTERVALO_MS);
  // Voltar para a aba é o momento mais provável de ter perdido um deploy.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') verificar();
  });
})();
