'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const TZ = 'America/Sao_Paulo';
const META_GAIA = 80;

// ---- GRUPOS DE STATUS -------------------------------------------------
// Os tres grupos principais sao ESTRITOS. Qualquer outro status
// (Reservada c/ Recibao, Em validacao, Em Simulacao, Bloqueada, Locada,
// Comodato, Disponivel) entra em "Outros" e aparece detalhado no grafico
// de rosca e no relatorio completo.
const G_VENDA = ['Vendido', 'Pix Validado'];
const G_NEGOC = ['Em Negociação'];
const G_RESERVA = ['Reservada'];

// ---- EQUIPES ---------------------------------------------------------
const EQ_PLANTAO = ['sawala', 'somma rio', 'ptm consultoria', 'patrimovel', 'lopes rj'];
const EQ_IPVENDAS = ['ip vendas'];

function semAcento(x) {
  return String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
// PTM CONSULTORIA IMOBILIARIA LTDA passa a se chamar PATRIMOVEL
function nomeImob(n) {
  const s = String(n || '').trim();
  if (!s) return '';
  if (semAcento(s).indexOf('ptm consultoria') >= 0) return 'PATRIMÓVEL';
  return s;
}
function equipeDe(imob) {
  const n = semAcento(imob);
  if (!n) return 'Parceria';
  if (EQ_IPVENDAS.some(k => n.indexOf(k) >= 0)) return 'IP Vendas';
  if (EQ_PLANTAO.some(k => n.indexOf(k) >= 0)) return 'Plantonistas';
  return 'Parceria';
}
const ORDEM_EQ = { 'Plantonistas': 1, 'IP Vendas': 2, 'Parceria': 3 };
const COR_EQ = { 'Plantonistas': '#2d6cdf', 'IP Vendas': '#00838f', 'Parceria': '#8d6e63' };

// ---- Datas sempre no horário de Brasília -----------------------------
function fmtBR(iso, comData) {
  if (!iso) return '';
  const o = comData
    ? { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { timeZone: TZ, hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat('pt-BR', o).format(new Date(iso));
}
function diaBR(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));
}
function horaBR(iso) {
  if (!iso) return 0;
  return parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false })
    .format(new Date(iso)), 10) || 0;
}
function hojeBR() { return diaBR(new Date().toISOString()); }
function semana() {
  const hoje = hojeBR();
  const d = new Date(hoje + 'T12:00:00Z');
  const dow = d.getUTCDay();
  const sex = new Date(d); sex.setUTCDate(d.getUTCDate() - ((dow + 2) % 7));
  let dom = new Date(sex); dom.setUTCDate(sex.getUTCDate() + 2);
  const iso = x => x.toISOString().slice(0, 10);
  let fim = iso(dom);
  if (hoje > fim) fim = hoje;
  return [iso(sex), fim];
}
const dBR = s => { const p = String(s).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : s; };

async function todos(view, ord) {
  let from = 0, out = [];
  while (true) {
    const { data, error } = await supabase.from(view).select('*').order(ord).range(from, from + 999);
    if (error) break;
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000; if (from > 20000) break;
  }
  return out;
}

// ===================== GRÁFICOS (SVG puro) ============================

// Acelerador / velocímetro
function Gauge({ valor, meta, titulo }) {
  const p = meta > 0 ? Math.min(valor / meta, 1) : 0;
  const pctReal = meta > 0 ? Math.round(valor / meta * 100) : 0;
  const R = 110, CX = 130, CY = 130, W = 26;
  const ang = Math.PI * (1 - p);
  const x = CX + R * Math.cos(ang), y = CY - R * Math.sin(ang);
  const arco = (fim, cor, larg) => {
    const a = Math.PI * (1 - fim);
    const xf = CX + R * Math.cos(a), yf = CY - R * Math.sin(a);
    return <path d={'M ' + (CX - R) + ' ' + CY + ' A ' + R + ' ' + R + ' 0 ' + (fim > 0.5 ? 1 : 0) + ' 1 ' + xf + ' ' + yf}
      fill="none" stroke={cor} strokeWidth={larg} strokeLinecap="round" />;
  };
  const cor = p >= 1 ? '#2e9e4f' : p >= 0.7 ? '#f9a825' : p >= 0.4 ? '#ef6c00' : '#c0392b';
  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 260 168" style={{ width: '100%', maxWidth: 320 }}>
        {arco(1, '#20262e', W)}
        {p > 0 && arco(p, cor, W)}
        <line x1={CX} y1={CY} x2={x} y2={y} stroke="#e8eef4" strokeWidth="3" />
        <circle cx={CX} cy={CY} r="7" fill="#e8eef4" />
        <text x={CX} y={CY - 34} textAnchor="middle" fill={cor} fontSize="42" fontWeight="800">{valor}</text>
        <text x={CX} y={CY - 12} textAnchor="middle" fill="#9aa6b2" fontSize="14">de {meta}</text>
        <text x={CX - R} y={CY + 22} textAnchor="middle" fill="#7c8794" fontSize="11">0</text>
        <text x={CX + R} y={CY + 22} textAnchor="middle" fill="#7c8794" fontSize="11">{meta}</text>
        <text x={CX} y={CY + 32} textAnchor="middle" fill={cor} fontSize="20" fontWeight="800">{pctReal}%</text>
      </svg>
      <div className="muted" style={{ marginTop: -4 }}>{titulo}</div>
    </div>
  );
}

// Rosca (donut)
function Donut({ dados, total }) {
  const R = 62, r = 40, CX = 80, CY = 80;
  let ini = -Math.PI / 2;
  const fatias = dados.filter(d => d.v > 0).map((d, i) => {
    const frac = total > 0 ? d.v / total : 0;
    const fim = ini + frac * Math.PI * 2;
    const gr = frac > 0.5 ? 1 : 0;
    const x1 = CX + R * Math.cos(ini), y1 = CY + R * Math.sin(ini);
    const x2 = CX + R * Math.cos(fim), y2 = CY + R * Math.sin(fim);
    const x3 = CX + r * Math.cos(fim), y3 = CY + r * Math.sin(fim);
    const x4 = CX + r * Math.cos(ini), y4 = CY + r * Math.sin(ini);
    const dd = 'M ' + x1 + ' ' + y1 + ' A ' + R + ' ' + R + ' 0 ' + gr + ' 1 ' + x2 + ' ' + y2 +
               ' L ' + x3 + ' ' + y3 + ' A ' + r + ' ' + r + ' 0 ' + gr + ' 0 ' + x4 + ' ' + y4 + ' Z';
    ini = fim;
    return <path key={i} d={dd} fill={d.c} />;
  });
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 160 160" style={{ width: 150, flex: '0 0 auto' }}>
        {total > 0 ? fatias : <circle cx={CX} cy={CY} r={(R + r) / 2} fill="none" stroke="#20262e" strokeWidth={R - r} />}
        <text x={CX} y={CY - 2} textAnchor="middle" fill="#e8eef4" fontSize="30" fontWeight="800">{total}</text>
        <text x={CX} y={CY + 18} textAnchor="middle" fill="#9aa6b2" fontSize="12">total</text>
      </svg>
      <div style={{ flex: 1, minWidth: 150 }}>
        {dados.filter(d => d.v > 0).map(d => (
          <div className="b-row" key={d.n}>
            <i style={{ width: 12, height: 12, borderRadius: 3, background: d.c, display: 'inline-block', flex: '0 0 auto' }} />
            <div style={{ flex: 1, fontSize: 12 }}>{d.n}</div>
            <b style={{ fontSize: 12 }}>{d.v}</b>
            <span className="muted">{total > 0 ? Math.round(d.v / total * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Barras horizontais empilhadas
function BarraEmp({ lab, neg, res, ven, max, extra }) {
  const tot = neg + res + ven;
  const w = v => (max > 0 ? v / max * 100 : 0) + '%';
  return (
    <div className="b-row">
      <div className="lab">{lab}</div>
      <div className="track" style={{ height: 16 }}>
        <div style={{ width: w(ven), background: '#c0392b', height: '100%', float: 'left' }} title={'Vendas: ' + ven} />
        <div style={{ width: w(res), background: '#1565c0', height: '100%', float: 'left' }} title={'Reservas: ' + res} />
        <div style={{ width: w(neg), background: '#f9a825', height: '100%', float: 'left' }} title={'Negociação: ' + neg} />
      </div>
      <div style={{ width: 54, textAlign: 'right', fontWeight: 700 }}>{tot}</div>
      {extra}
    </div>
  );
}

// Barras verticais por hora
function PorHora({ dados }) {
  const max = Math.max(1, ...dados.map(d => d.v));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 130, marginTop: 8 }}>
      {dados.map(d => (
        <div key={d.h} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div title={d.h + 'h — ' + d.v}
            style={{
              height: Math.round(d.v / max * 100) + '%', minHeight: d.v > 0 ? 3 : 0,
              background: d.v > 0 ? '#2d6cdf' : '#20262e', borderRadius: '3px 3px 0 0'
            }} />
          <div style={{ fontSize: 9, color: '#7c8794', marginTop: 3 }}>{d.h}</div>
        </div>
      ))}
    </div>
  );
}

function Nav({ email, onSair }) {
  const item = (h, t) => <a key={h} href={h} className={'navb' + (h === '/indicadores' ? ' on' : '')}>{t}</a>;
  return (
    <div className="navbar">
      <b className="navbrand">Disponibilidade — Ilha Pura</b>
      <nav className="navlinks">{item('/painel', 'Painel operador')}{item('/espelho', 'Espelho TV')}{item('/indicadores', 'Indicadores')}</nav>
      <span className="sp" />
      <span className="muted">{email}</span>
      <button className="sm" onClick={onSair}>Sair</button>
    </div>
  );
}

export default function Indicadores() {
  const [ses, setSes] = useState(null);
  const [un, setUn] = useState([]);
  const [com, setCom] = useState({});
  const [aud, setAud] = useState([]);
  const [wk, setWk] = useState(semana());
  const [meta, setMeta] = useState(META_GAIA);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSes(data.session));
    const { data: s } = supabase.auth.onAuthStateChange((_e, x) => setSes(x));
    return () => s.subscription.unsubscribe();
  }, []);

  async function carregar() {
    setUn(await todos('vw_operador', 'chave'));
    const dc = await todos('dado_comercial', 'unidade_id');
    const m = {}; dc.forEach(d => { m[d.unidade_id] = d; }); setCom(m);
    const { data: a } = await supabase.from('audit_log').select('*')
      .order('ts', { ascending: false }).limit(5000);
    setAud(a || []);
  }
  useEffect(() => {
    if (!ses) return;
    carregar();
    const ch = supabase.channel('rt-ind')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'unidade' }, () => carregar())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [ses]);

  const uMap = useMemo(() => { const m = {}; un.forEach(u => { m[u.chave] = u; }); return m; }, [un]);

  // Alterações de status dentro do período (por dia de Brasília)
  const altPeriodo = useMemo(() =>
    aud.filter(a => a.campo === 'status' && a.ts)
       .filter(a => { const d = diaBR(a.ts); return d >= wk[0] && d <= wk[1]; }),
  [aud, wk]);

  // Status final de cada unidade no período — TODOS os status, sem filtro
  const movs = useMemo(() => {
    const m = {}, t = {};
    altPeriodo.forEach(a => {
      const ts = String(a.ts);
      if (!t[a.chave] || ts > t[a.chave]) { t[a.chave] = ts; m[a.chave] = a.status_novo; }
    });
    return m;
  }, [altPeriodo]);

  const chaves = Object.keys(movs);
  const ehVenda = s => G_VENDA.indexOf(s) >= 0;
  const ehNegoc = s => G_NEGOC.indexOf(s) >= 0;
  const ehReserva = s => G_RESERVA.indexOf(s) >= 0;
  const pct = (v, t) => t > 0 ? Math.round(v / t * 100) : 0;

  const tot = useMemo(() => {
    let ven = 0, neg = 0, res = 0, out = 0;
    chaves.forEach(k => {
      const s = movs[k];
      if (ehVenda(s)) ven++; else if (ehReserva(s)) res++; else if (ehNegoc(s)) neg++; else out++;
    });
    return { ven, neg, res, out, mov: chaves.length };
  }, [movs]);

  // ---- LANÇAMENTO (torre em destaque) ----
  const gaia = useMemo(() => un.filter(u => u.bloco_destaque), [un]);
  const nomeGaia = gaia.length
    ? (gaia[0].empreendimento || '').replace('Ilha Pura - ', '') + ' · Torre ' + gaia[0].bloco
    : 'Lançamento';
  const gaiaMov = chaves.filter(k => uMap[k] && uMap[k].bloco_destaque);
  const gVen = gaiaMov.filter(k => ehVenda(movs[k])).length;
  const gRes = gaiaMov.filter(k => ehReserva(movs[k])).length;
  const gNeg = gaiaMov.filter(k => ehNegoc(movs[k])).length;

  // ---- distribuição de status (todos) ----
  const porStatus = useMemo(() => {
    const m = {};
    chaves.forEach(k => { const s = movs[k] || '(sem status)'; m[s] = (m[s] || 0) + 1; });
    return Object.keys(m).sort((a, b) => m[b] - m[a]).map(k => [k, m[k]]);
  }, [movs]);

  const CORS = {
    'Vendido': '#b71c1c', 'Pix Validado': '#e53935', 'Reservada': '#1565c0',
    'Reservada c/ Recibão': '#0d47a1', 'Em validação': '#6a1b9a', 'Em Negociação': '#f9a825',
    'Em Simulação': '#8d6e63', 'Disponível': '#2e7d32', 'Bloqueada': '#000000',
    'Locada': '#00838f', 'Comodato': '#455a64'
  };

  // ---- por equipe / empreendimento / imobiliária ----
  function agrupa(fnChave) {
    const m = {};
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k];
      const d = com[u.id] || {};
      const lab = fnChave(u, d); if (lab == null) return;
      if (!m[lab]) m[lab] = { ven: 0, neg: 0, res: 0, out: 0, tot: 0, eq: equipeDe(d.imobiliaria), dest: !!u.bloco_destaque };
      m[lab].tot++;
      if (ehVenda(s)) m[lab].ven++; else if (ehReserva(s)) m[lab].res++;
      else if (ehNegoc(s)) m[lab].neg++; else m[lab].out++;
    });
    return m;
  }

  const porEquipe = useMemo(() => {
    const m = agrupa((u, d) => equipeDe(d.imobiliaria));
    return Object.keys(m).sort((a, b) => (ORDEM_EQ[a] || 9) - (ORDEM_EQ[b] || 9)).map(k => [k, m[k]]);
  }, [movs, uMap, com]);

  const porEmp = useMemo(() => {
    const m = agrupa(u => {
      const n = (u.empreendimento || '').replace('Ilha Pura - ', '');
      return u.bloco_destaque ? n + ' · Torre ' + u.bloco + ' ★' : n;
    });
    return Object.keys(m).sort((a, b) => (m[b].dest - m[a].dest) || (m[b].tot - m[a].tot)).map(k => [k, m[k]]);
  }, [movs, uMap, com]);

  const rk = useMemo(() => agrupa((u, d) => nomeImob(d.imobiliaria) || '(sem imobiliária)'), [movs, uMap, com]);
  const ordIm = Object.keys(rk).sort((a, b) => (rk[b].ven - rk[a].ven) || (rk[b].tot - rk[a].tot));

  const porCorretor = useMemo(() => {
    const m = agrupa((u, d) => (d.corretor || '').trim() || null);
    return Object.keys(m).sort((a, b) => (m[b].ven - m[a].ven) || (m[b].tot - m[a].tot)).slice(0, 10).map(k => [k, m[k]]);
  }, [movs, uMap, com]);

  // ---- ritmo por hora (vendas) ----
  const porHora = useMemo(() => {
    const h = {}; for (let i = 8; i <= 21; i++) h[i] = 0;
    altPeriodo.filter(a => ehVenda(a.status_novo)).forEach(a => {
      const x = horaBR(a.ts); if (h[x] != null) h[x]++;
    });
    return Object.keys(h).map(k => ({ h: k, v: h[k] }));
  }, [altPeriodo]);

  // ---- por dia ----
  const porDia = useMemo(() => {
    const m = {};
    altPeriodo.forEach(a => {
      const d = diaBR(a.ts);
      if (!m[d]) m[d] = { ven: 0, tot: 0 };
      m[d].tot++;
      if (ehVenda(a.status_novo)) m[d].ven++;
    });
    return Object.keys(m).sort().map(k => [k, m[k]]);
  }, [altPeriodo]);

  const maxBarra = Math.max(1, ...porEmp.map(x => x[1].tot), ...porEquipe.map(x => x[1].tot));

  // ===================== EXPORTAÇÕES =====================
  function csv(nome, linhas) {
    const b = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
  }
  const esc = v => String(v == null ? '' : v).replace(/;/g, ',').replace(/[\r\n]+/g, ' ');

  // Relatório COMPLETO: todas as unidades movimentadas, TODOS os status
  function baixarCompleto() {
    if (!chaves.length) { alert('Nenhuma movimentação no período.'); return; }
    const l = ['Empreendimento;Bloco;Unidade;Andar;Tipologia;m2;Status;Grupo;Equipe;Cliente;ID Reserva;Corretor;Imobiliaria;Gerente;Hora da reserva;Alterado por;Alterado em'];
    chaves.sort((a, b) => a.localeCompare(b)).forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k];
      const d = com[u.id] || {};
      const grupo = ehVenda(s) ? 'Venda' : ehReserva(s) ? 'Reserva' : ehNegoc(s) ? 'Negociação' : 'Outro';
      l.push([u.empreendimento, u.bloco, u.unidade_num, u.andar, u.tipologia || '', u.m2, s, grupo,
        equipeDe(d.imobiliaria), d.cliente || '', d.id_proposta || '', d.corretor || '',
        nomeImob(d.imobiliaria), d.gerencia || '',
        d.hora_reserva ? fmtBR(d.hora_reserva, true) : '',
        u.atualizado_por || '', u.atualizado_em ? fmtBR(u.atualizado_em, true) : ''].map(esc).join(';'));
    });
    csv('Relatorio_Completo_' + wk[0] + '_a_' + wk[1] + '.csv', l);
  }

  // Relatório de TODAS as alterações (histórico)
  function baixarAlteracoes() {
    if (!altPeriodo.length) { alert('Nenhuma alteração no período.'); return; }
    const l = ['Data e hora;Unidade;Empreendimento;Bloco;Status anterior;Status novo;Operador;Perfil;Origem;Justificativa'];
    altPeriodo.slice().sort((a, b) => String(a.ts).localeCompare(String(b.ts))).forEach(a => {
      const u = uMap[a.chave] || {};
      l.push([fmtBR(a.ts, true), a.chave, u.empreendimento || '', u.bloco || '',
        a.status_anterior || '', a.status_novo || '', a.usuario_nome || '', a.perfil || '',
        a.origem || '', a.justificativa || ''].map(esc).join(';'));
    });
    csv('Alteracoes_' + wk[0] + '_a_' + wk[1] + '.csv', l);
  }

  function baixarRanking() {
    if (!ordIm.length) { alert('Sem movimentação no período.'); return; }
    const l = ['Posicao;Imobiliaria;Equipe;Vendas;% vendas;Reservas;Em negociacao;Outros;Total'];
    ordIm.forEach((i, n) => l.push([n + 1, i, rk[i].eq, rk[i].ven, pct(rk[i].ven, rk[i].tot) + '%',
      rk[i].res, rk[i].neg, rk[i].out, rk[i].tot].map(esc).join(';')));
    csv('Ranking_Imobiliarias_' + wk[0] + '_a_' + wk[1] + '.csv', l);
  }
  function baixarEquipes() {
    if (!porEquipe.length) { alert('Sem movimentação no período.'); return; }
    const l = ['Equipe;Vendas;% vendas;Reservas;Em negociacao;Outros;Total'];
    porEquipe.forEach(([e, v]) => l.push([e, v.ven, pct(v.ven, v.tot) + '%', v.res, v.neg, v.out, v.tot].map(esc).join(';')));
    csv('Equipes_' + wk[0] + '_a_' + wk[1] + '.csv', l);
  }

  if (!ses) return <div className="home"><h1>Indicadores</h1>
    <div className="muted">Entre pelo <a href="/painel">painel do operador</a>.</div></div>;

  const kpi = (n, l, c, d) => <div className={'kpi' + (d ? ' dest' : '')} key={l}>
    <div className="n" style={c ? { color: c } : null}>{n}</div><div className="l">{l}</div></div>;

  return (
    <div className="wrap">
      <Nav email={ses.user.email} onSair={() => supabase.auth.signOut()} />

      <div className="card">
        <h4>Período do lançamento <span className="hint">(horário de Brasília)</span></h4>
        <div className="bar">
          <label className="tg">De <input type="date" value={wk[0]} onChange={e => setWk([e.target.value, wk[1]])} /></label>
          <label className="tg">Até <input type="date" value={wk[1]} onChange={e => setWk([wk[0], e.target.value])} /></label>
          <button className="sm" onClick={() => setWk(semana())}>Fim de semana atual</button>
          <button className="sm" onClick={() => setWk(['2000-01-01', '2099-12-31'])}>Considerar tudo</button>
          <span className="sp" />
          <label className="tg">Meta de vendas <input type="number" min="1" style={{ width: 72 }}
            value={meta} onChange={e => setMeta(Math.max(1, parseInt(e.target.value, 10) || 1))} /></label>
        </div>
        <div className="hint">
          <b style={{ color: '#e53935' }}>Venda</b> = Vendido + Pix Validado ·
          <b style={{ color: '#4a9eff' }}> Reserva</b> = Reservada ·
          <b style={{ color: '#f9a825' }}> Negociação</b> = Em Negociação ·
          <b style={{ color: '#9aa6b2' }}> Outros</b> = demais status (c/ Recibão, Em validação,
          Em Simulação, Bloqueada, Locada, Comodato), detalhados na rosca e no relatório completo.
        </div>
        {!chaves.length && aud.length > 0 &&
          <div className="hint" style={{ color: '#e0a000' }}>⚠ Nenhuma movimentação neste período — há {aud.length} alteração(ões) fora dele.</div>}
      </div>

      {/* ---------- LANÇAMENTO: ACELERADOR ---------- */}
      <div className="card" style={{ borderColor: '#f9a825' }}>
        <h4>🚀 LANÇAMENTO — {nomeGaia} <span className="hint">meta de {meta} vendas no fim de semana</span></h4>
        <div className="cols2">
          <Gauge valor={gVen} meta={meta} titulo={'Vendas confirmadas (Vendido + Pix Validado)'} />
          <div>
            <div className="kpis" style={{ marginBottom: 8 }}>
              {kpi(gVen, 'Vendas', '#e53935', true)}
              {kpi(Math.max(0, meta - gVen), 'Faltam p/ a meta', '#f9a825', true)}
              {kpi(pct(gVen, gaia.length) + '%', 'Da torre (' + gaia.length + ' un.)', '#e8eef4', true)}
            </div>
            <div className="b-row"><div className="lab">Vendas</div>
              <div className="track"><div className="fillb" style={{ width: pct(gVen, gaia.length) + '%', background: '#b71c1c' }} /></div>
              <b style={{ width: 40, textAlign: 'right' }}>{gVen}</b></div>
            <div className="b-row"><div className="lab">Reservas</div>
              <div className="track"><div className="fillb" style={{ width: pct(gRes, gaia.length) + '%', background: '#1565c0' }} /></div>
              <b style={{ width: 40, textAlign: 'right' }}>{gRes}</b></div>
            <div className="b-row"><div className="lab">Em negociação</div>
              <div className="track"><div className="fillb" style={{ width: pct(gNeg, gaia.length) + '%', background: '#f9a825' }} /></div>
              <b style={{ width: 40, textAlign: 'right' }}>{gNeg}</b></div>
            <div className="b-row"><div className="lab">Disponíveis agora</div>
              <div className="track"><div className="fillb" style={{ width: pct(gaia.filter(u => u.status === 'Disponível').length, gaia.length) + '%', background: '#2e7d32' }} /></div>
              <b style={{ width: 40, textAlign: 'right' }}>{gaia.filter(u => u.status === 'Disponível').length}</b></div>
          </div>
        </div>
      </div>

      {/* ---------- VISÃO GERAL ---------- */}
      <div className="kpis">
        {kpi(tot.mov, 'Unidades movimentadas')}
        {kpi(tot.ven, 'Vendas (Vendido + Pix)', '#e53935')}
        {kpi(tot.res, 'Reservas', '#4a9eff')}
        {kpi(tot.neg, 'Em negociação', '#f9a825')}
        {kpi(tot.out, 'Outros status', '#9aa6b2')}
        {kpi(pct(tot.ven, tot.mov) + '%', '% vendido do movimentado', '#e53935')}
      </div>

      <div className="cols2">
        <div className="card">
          <h4>Distribuição por status <span className="hint">(no período)</span></h4>
          <Donut total={tot.mov} dados={porStatus.map(([s, v]) => ({ n: s, v: v, c: CORS[s] || '#607d8b' }))} />
        </div>
        <div className="card">
          <h4>Ritmo de vendas por hora</h4>
          {porHora.some(d => d.v > 0)
            ? <PorHora dados={porHora} />
            : <div className="hint">Nenhuma venda registrada no período.</div>}
          {porDia.length > 0 && <div style={{ marginTop: 10 }}>
            {porDia.map(([d, v]) => (
              <div className="b-row" key={d}>
                <div className="lab">{dBR(d)}</div>
                <div className="track"><div className="fillb" style={{ width: pct(v.ven, Math.max(1, ...porDia.map(x => x[1].ven))) + '%', background: '#c0392b' }} /></div>
                <b style={{ width: 78, textAlign: 'right' }}>{v.ven} vendas</b>
              </div>))}
          </div>}
        </div>
      </div>

      {/* ---------- EQUIPES ---------- */}
      <div className="card">
        <h4>👥 Desempenho por equipe</h4>
        {!porEquipe.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          {porEquipe.map(([e, v]) => (
            <BarraEmp key={e} lab={e} neg={v.neg} res={v.res} ven={v.ven} max={maxBarra}
              extra={<span className="badge" style={{ background: COR_EQ[e] || '#555', color: '#fff', marginLeft: 8 }}>{v.ven} vendas</span>} />
          ))}
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Equipe</th><th>Vendas</th><th>% vendas</th><th>Reservas</th><th>Negociação</th><th>Outros</th><th>Total</th></tr></thead>
            <tbody>
              {porEquipe.map(([e, v]) => (
                <tr key={e}>
                  <td><span className="badge" style={{ background: COR_EQ[e] || '#555', color: '#fff' }}>{e}</span></td>
                  <td><b>{v.ven}</b></td><td>{pct(v.ven, v.tot)}%</td>
                  <td>{v.res}</td><td>{v.neg}</td><td>{v.out}</td><td><b>{v.tot}</b></td>
                </tr>))}
              <tr style={{ background: '#20262e' }}>
                <td><b>TOTAL</b></td><td><b>{tot.ven}</b></td><td><b>{pct(tot.ven, tot.mov)}%</b></td>
                <td><b>{tot.res}</b></td><td><b>{tot.neg}</b></td><td><b>{tot.out}</b></td><td><b>{tot.mov}</b></td>
              </tr>
            </tbody>
          </table>
          <div className="hint" style={{ marginTop: 8 }}>
            Plantonistas: Sawala, Somma Rio, Patrimóvel e Lopes RJ · IP Vendas: IP Vendas · Parceria: demais imobiliárias.
          </div>
          <div style={{ marginTop: 10 }}><button className="sm" onClick={baixarEquipes}>⬇ Baixar equipes</button></div>
        </>}
      </div>

      {/* ---------- EMPREENDIMENTOS ---------- */}
      <div className="card">
        <h4>Por empreendimento</h4>
        {!porEmp.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          {porEmp.map(([l, v]) => <BarraEmp key={l} lab={l} neg={v.neg} res={v.res} ven={v.ven} max={maxBarra} />)}
          <div className="hint" style={{ marginTop: 8 }}>
            <i style={{ background: '#c0392b', width: 10, height: 10, display: 'inline-block', borderRadius: 2 }} /> Vendas
            &nbsp;<i style={{ background: '#1565c0', width: 10, height: 10, display: 'inline-block', borderRadius: 2 }} /> Reservas
            &nbsp;<i style={{ background: '#f9a825', width: 10, height: 10, display: 'inline-block', borderRadius: 2 }} /> Negociação
          </div>
        </>}
      </div>

      {/* ---------- RANKING IMOBILIÁRIAS ---------- */}
      <div className="card">
        <h4>🏆 Ranking por imobiliária <span className="hint">(ordenado por vendas)</span></h4>
        {!ordIm.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          <table>
            <thead><tr><th>#</th><th>Imobiliária</th><th>Equipe</th><th>Vendas</th><th>%</th><th>Reservas</th><th>Negoc.</th><th>Total</th></tr></thead>
            <tbody>{ordIm.slice(0, 30).map((i, n) => (
              <tr key={i}>
                <td>{n === 0 ? '🥇' : n === 1 ? '🥈' : n === 2 ? '🥉' : n + 1}</td>
                <td><b>{i}</b></td>
                <td><span className="badge" style={{ background: COR_EQ[rk[i].eq] || '#555', color: '#fff' }}>{rk[i].eq}</span></td>
                <td><b style={{ color: '#e53935' }}>{rk[i].ven}</b></td><td>{pct(rk[i].ven, rk[i].tot)}%</td>
                <td>{rk[i].res}</td><td>{rk[i].neg}</td><td><b>{rk[i].tot}</b></td>
              </tr>))}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}><button className="sm" onClick={baixarRanking}>⬇ Baixar ranking</button></div>
        </>}
      </div>

      {/* ---------- TOP CORRETORES ---------- */}
      <div className="card">
        <h4>🎯 Top 10 corretores</h4>
        {!porCorretor.length ? <div className="hint">Nenhuma movimentação no período.</div> :
          porCorretor.map(([c, v], i) => (
            <div className="b-row" key={c}>
              <div style={{ width: 26 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div>
              <div className="lab">{c}</div>
              <div className="track">
                <div className="fillb" style={{ width: pct(v.ven, Math.max(1, ...porCorretor.map(x => x[1].tot))) + '%', background: '#c0392b', float: 'left' }} />
                <div className="fillb" style={{ width: pct(v.res + v.neg, Math.max(1, ...porCorretor.map(x => x[1].tot))) + '%', background: '#1565c0', float: 'left' }} />
              </div>
              <b style={{ width: 66, textAlign: 'right' }}>{v.ven} vendas</b>
            </div>))}
      </div>

      {/* ---------- RELATÓRIOS ---------- */}
      <div className="card" style={{ borderColor: '#2d6cdf' }}>
        <h4>📥 Relatórios para baixar</h4>
        <div className="bar">
          <button onClick={baixarCompleto}>⬇ Relatório completo (todos os status)</button>
          <button className="sm" onClick={baixarAlteracoes}>⬇ Histórico de alterações</button>
          <button className="sm" onClick={baixarRanking}>⬇ Ranking</button>
          <button className="sm" onClick={baixarEquipes}>⬇ Equipes</button>
        </div>
        <div className="hint">
          O <b>relatório completo</b> traz TODAS as unidades movimentadas no período, com qualquer status
          (inclusive Bloqueada, Disponível e Locada). O <b>histórico de alterações</b> traz cada mudança
          registrada, com operador, hora e status anterior.
        </div>
      </div>

      {/* ---------- ÚLTIMAS ALTERAÇÕES ---------- */}
      <div className="card">
        <h4>Últimas alterações <span className="hint">(horário de Brasília)</span></h4>
        {aud.slice(0, 15).map((a, i) => {
          const c = CORS[a.status_novo] || '#607d8b';
          return (
            <div className="b-row" key={i}>
              <span className="tag">{fmtBR(a.ts, true)}</span>
              <div style={{ flex: 1 }}>{a.chave} · {a.status_anterior} → <b style={{ color: c }}>{a.status_novo}</b></div>
              <span className="muted">{a.usuario_nome}</span>
            </div>);
        })}
        {!aud.length && <div className="muted">Sem alterações ainda.</div>}
      </div>
    </div>
  );
}
