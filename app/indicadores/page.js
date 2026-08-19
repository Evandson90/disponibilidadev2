'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const TZ = 'America/Sao_Paulo';

// Grupo 1 — EM ANDAMENTO (negociação + reserva)
const G_NEG_RES = ['Em Negociação', 'Reservada', 'Reservada c/ Recibão', 'Em validação', 'Em Simulação'];
// Grupo 2 — FECHADO (vendido + pix validado)
const G_VEN_PIX = ['Vendido', 'Pix Validado'];

// ---- EQUIPES ---------------------------------------------------------
const EQ_PLANTAO = ['sawala', 'somma rio', 'ptm consultoria', 'lopes rj'];
const EQ_IPVENDAS = ['ip vendas'];
function semAcento(x) {
  return String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(iso));
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

  // status final de cada unidade DENTRO do período (por dia de Brasília)
  const movs = useMemo(() => {
    const m = {}, t = {};
    aud.filter(a => a.campo === 'status' && a.ts)
      .filter(a => { const d = diaBR(a.ts); return d >= wk[0] && d <= wk[1]; })
      .forEach(a => {
        const ts = String(a.ts);
        if (!t[a.chave] || ts > t[a.chave]) { t[a.chave] = ts; m[a.chave] = a.status_novo; }
      });
    return m;
  }, [aud, wk]);

  const chaves = Object.keys(movs);
  const g1 = s => G_NEG_RES.indexOf(s) >= 0;   // negociação + reserva
  const g2 = s => G_VEN_PIX.indexOf(s) >= 0;   // vendido + pix validado
  const conta = s => g1(s) || g2(s);

  const totPer = useMemo(() => {
    let a = 0, f = 0;
    chaves.forEach(k => { const s = movs[k]; if (g2(s)) f++; else if (g1(s)) a++; });
    return { and: a, fec: f, total: a + f };
  }, [movs]);

  const pct = (v, t) => t ? Math.round(v / t * 100) : 0;

  // ---- LANÇAMENTO (torre em destaque) ----
  const gaia = useMemo(() => un.filter(u => u.bloco_destaque), [un]);
  const nomeGaia = gaia.length
    ? (gaia[0].empreendimento || '').replace('Ilha Pura - ', '') + ' · Torre ' + gaia[0].bloco
    : 'Lançamento';
  const gaiaMov = chaves.filter(k => uMap[k] && uMap[k].bloco_destaque);
  const gAnd = gaiaMov.filter(k => g1(movs[k])).length;
  const gFec = gaiaMov.filter(k => g2(movs[k])).length;
  const gTot = gAnd + gFec;

  // ---- POR EQUIPE ----
  const porEquipe = useMemo(() => {
    const m = {};
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k]; if (!conta(s)) return;
      const d = com[u.id] || {};
      const eq = equipeDe(d.imobiliaria);
      if (!m[eq]) m[eq] = { and: 0, fec: 0, tot: 0 };
      m[eq].tot++;
      if (g2(s)) m[eq].fec++; else m[eq].and++;
    });
    return Object.keys(m).sort((a, b) => (ORDEM_EQ[a] || 9) - (ORDEM_EQ[b] || 9)).map(k => [k, m[k]]);
  }, [movs, uMap, com]);

  // ---- POR EMPREENDIMENTO ----
  const porEmp = useMemo(() => {
    const m = {};
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k]; if (!conta(s)) return;
      const nome = (u.empreendimento || '').replace('Ilha Pura - ', '');
      const lab = u.bloco_destaque ? nome + ' · Torre ' + u.bloco + ' ★' : nome;
      if (!m[lab]) m[lab] = { and: 0, fec: 0, tot: 0, dest: !!u.bloco_destaque };
      m[lab].tot++;
      if (g2(s)) m[lab].fec++; else m[lab].and++;
    });
    return Object.keys(m).sort((a, b) => (m[b].dest - m[a].dest) || (m[b].tot - m[a].tot)).map(k => [k, m[k]]);
  }, [movs, uMap, com]);

  // ---- RANKING POR IMOBILIÁRIA (com equipe e %) ----
  const rk = useMemo(() => {
    const m = {};
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k]; if (!conta(s)) return;
      const d = com[u.id] || {};
      const i = (d.imobiliaria || '').trim() || '(sem imobiliária)';
      if (!m[i]) m[i] = { and: 0, fec: 0, tot: 0, eq: equipeDe(d.imobiliaria) };
      m[i].tot++;
      if (g2(s)) m[i].fec++; else m[i].and++;
    });
    return m;
  }, [movs, uMap, com]);
  const ordIm = Object.keys(rk).sort((a, b) => rk[b].tot - rk[a].tot);

  function csv(nome, linhas) {
    const b = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function baixarRanking() {
    if (!ordIm.length) { alert('Sem movimentação no período.'); return; }
    const l = ['Posicao;Imobiliaria;Equipe;Em negociacao+Reserva;% and;Vendido+Pix;% fec;Total;% do total'];
    ordIm.forEach((i, n) => l.push([n + 1, i, rk[i].eq, rk[i].and, pct(rk[i].and, rk[i].tot) + '%',
      rk[i].fec, pct(rk[i].fec, rk[i].tot) + '%', rk[i].tot, pct(rk[i].tot, totPer.total) + '%'].join(';')));
    csv('Ranking_' + wk[0] + '_a_' + wk[1] + '.csv', l);
  }
  function baixarEquipes() {
    if (!porEquipe.length) { alert('Sem movimentação no período.'); return; }
    const l = ['Equipe;Em negociacao+Reserva;% and;Vendido+Pix;% fec;Total;% do total'];
    porEquipe.forEach(([e, v]) => l.push([e, v.and, pct(v.and, v.tot) + '%', v.fec,
      pct(v.fec, v.tot) + '%', v.tot, pct(v.tot, totPer.total) + '%'].join(';')));
    csv('Equipes_' + wk[0] + '_a_' + wk[1] + '.csv', l);
  }
  function baixarVendas() {
    const l = ['Empreendimento;Bloco;Unidade;Andar;Tipologia;m2;Status no periodo;Grupo;Equipe;Cliente;ID Reserva;Corretor;Imobiliaria;Gerente;Hora da reserva (Brasilia)'];
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k]; if (!conta(s)) return;
      const d = com[u.id] || {};
      l.push([u.empreendimento, u.bloco, u.unidade_num, u.andar, u.tipologia || '', u.m2, s,
        g2(s) ? 'Vendido/Pix' : 'Negociacao/Reserva', equipeDe(d.imobiliaria),
        d.cliente || '', d.id_proposta || '', d.corretor || '', d.imobiliaria || '', d.gerencia || '',
        d.hora_reserva ? fmtBR(d.hora_reserva, true) : ''].join(';'));
    });
    if (l.length === 1) { alert('Nenhuma movimentação no período.'); return; }
    csv('Vendas_Reservas_' + wk[0] + '_a_' + wk[1] + '.csv', l);
  }

  if (!ses) return <div className="home"><h1>Indicadores</h1>
    <div className="muted">Entre pelo <a href="/painel">painel do operador</a>.</div></div>;

  const kpi = (n, l, d) => <div className={'kpi' + (d ? ' dest' : '')} key={l}>
    <div className="n">{n}</div><div className="l">{l}</div></div>;

  // barra dupla: parte azul = negociação/reserva, parte vermelha = vendido/pix
  const barra = (lab, v, extra) => (
    <div className="b-row" key={lab}>
      <div className="lab">{lab}</div>
      <div className="track">
        <div className="fillb" style={{ width: pct(v.and, totPer.total) + '%', background: '#f9a825', float: 'left' }} />
        <div className="fillb" style={{ width: pct(v.fec, totPer.total) + '%', background: '#b71c1c', float: 'left' }} />
      </div>
      <div style={{ width: 96, textAlign: 'right' }}>{v.tot} ({pct(v.tot, totPer.total)}%)</div>
      {extra}
    </div>
  );

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
        </div>
        <div className="hint">
          <b style={{ color: '#f9a825' }}>Em negociação + Reserva</b> = {G_NEG_RES.join(', ')}.
          &nbsp;<b style={{ color: '#e05656' }}>Vendido + Pix</b> = {G_VEN_PIX.join(', ')}.
        </div>
        {!chaves.length && aud.length > 0 &&
          <div className="hint" style={{ color: '#e0a000' }}>⚠ Nenhuma movimentação neste período — há {aud.length} alteração(ões) fora dele.</div>}
      </div>

      {/* ---------- LANÇAMENTO ---------- */}
      <div className="card" style={{ borderColor: '#f9a825' }}>
        <h4>🚀 LANÇAMENTO — {nomeGaia}</h4>
        <div className="kpis">
          {kpi(gTot, 'Total negociado', true)}
          {kpi(gAnd + ' · ' + pct(gAnd, gTot) + '%', 'Em negociação + Reserva', true)}
          {kpi(gFec + ' · ' + pct(gFec, gTot) + '%', 'Vendido + Pix Validado', true)}
          {kpi(gaia.filter(u => u.status === 'Disponível').length, 'Disponíveis agora', true)}
          {kpi(pct(gTot, gaia.length) + '%', 'Da torre (' + gaia.length + ' un.)', true)}
        </div>
      </div>

      {/* ---------- TOTAL DO PERÍODO ---------- */}
      <div className="card">
        <h4>Movimentação no período — todos os empreendimentos</h4>
        <div className="kpis">
          {kpi(totPer.total, 'Total no período')}
          {kpi(totPer.and + ' · ' + pct(totPer.and, totPer.total) + '%', 'Em negociação + Reserva')}
          {kpi(totPer.fec + ' · ' + pct(totPer.fec, totPer.total) + '%', 'Vendido + Pix Validado')}
        </div>
      </div>

      {/* ---------- POR EQUIPE ---------- */}
      <div className="card">
        <h4>👥 Desempenho por equipe</h4>
        {!porEquipe.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          <table>
            <thead><tr><th>Equipe</th><th>Negoc. + Reserva</th><th>%</th><th>Vendido + Pix</th><th>%</th><th>Total</th><th>% do total</th></tr></thead>
            <tbody>
              {porEquipe.map(([e, v]) => (
                <tr key={e}>
                  <td><span className="badge" style={{ background: COR_EQ[e] || '#555', color: '#fff' }}>{e}</span></td>
                  <td>{v.and}</td><td>{pct(v.and, v.tot)}%</td>
                  <td>{v.fec}</td><td>{pct(v.fec, v.tot)}%</td>
                  <td><b>{v.tot}</b></td><td><b>{pct(v.tot, totPer.total)}%</b></td>
                </tr>))}
              <tr style={{ background: '#20262e' }}>
                <td><b>TOTAL</b></td><td><b>{totPer.and}</b></td><td><b>{pct(totPer.and, totPer.total)}%</b></td>
                <td><b>{totPer.fec}</b></td><td><b>{pct(totPer.fec, totPer.total)}%</b></td>
                <td><b>{totPer.total}</b></td><td><b>100%</b></td>
              </tr>
            </tbody>
          </table>
          <div className="hint" style={{ marginTop: 8 }}>
            Plantonistas: Sawala, Somma Rio, PTM Consultoria e Lopes RJ · IP Vendas: IP Vendas · Parceria: demais imobiliárias.
          </div>
          <div style={{ marginTop: 10 }}><button className="sm" onClick={baixarEquipes}>⬇ Baixar equipes (Excel/CSV)</button></div>
        </>}
      </div>

      {/* ---------- POR EMPREENDIMENTO ---------- */}
      <div className="card">
        <h4>Por empreendimento</h4>
        {!porEmp.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          <table>
            <thead><tr><th>Empreendimento</th><th>Negoc. + Reserva</th><th>%</th><th>Vendido + Pix</th><th>%</th><th>Total</th></tr></thead>
            <tbody>
              {porEmp.map(([l, v]) => (
                <tr key={l} style={v.dest ? { background: '#1a1710' } : null}>
                  <td><b>{l}</b></td>
                  <td>{v.and}</td><td>{pct(v.and, v.tot)}%</td>
                  <td>{v.fec}</td><td>{pct(v.fec, v.tot)}%</td>
                  <td><b>{v.tot}</b></td>
                </tr>))}
              <tr style={{ background: '#20262e' }}>
                <td><b>TOTAL</b></td><td><b>{totPer.and}</b></td><td><b>{pct(totPer.and, totPer.total)}%</b></td>
                <td><b>{totPer.fec}</b></td><td><b>{pct(totPer.fec, totPer.total)}%</b></td>
                <td><b>{totPer.total}</b></td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}>
            <button className="sm" onClick={baixarVendas}>⬇ Baixar vendas e reservas do período (Excel/CSV)</button>
          </div>
        </>}
      </div>

      {/* ---------- RANKING POR IMOBILIÁRIA ---------- */}
      <div className="card">
        <h4>🏆 Ranking por imobiliária <span className="hint">({dBR(wk[0])} a {dBR(wk[1])})</span></h4>
        {!ordIm.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          <table>
            <thead><tr><th>#</th><th>Imobiliária</th><th>Equipe</th><th>Negoc. + Reserva</th><th>%</th><th>Vendido + Pix</th><th>%</th><th>Total</th><th>% do total</th></tr></thead>
            <tbody>{ordIm.slice(0, 30).map((i, n) => (
              <tr key={i}>
                <td>{n === 0 ? '🥇' : n === 1 ? '🥈' : n === 2 ? '🥉' : n + 1}</td>
                <td><b>{i}</b></td>
                <td><span className="badge" style={{ background: COR_EQ[rk[i].eq] || '#555', color: '#fff' }}>{rk[i].eq}</span></td>
                <td>{rk[i].and}</td><td>{pct(rk[i].and, rk[i].tot)}%</td>
                <td>{rk[i].fec}</td><td>{pct(rk[i].fec, rk[i].tot)}%</td>
                <td><b>{rk[i].tot}</b></td><td>{pct(rk[i].tot, totPer.total)}%</td>
              </tr>))}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}><button className="sm" onClick={baixarRanking}>⬇ Baixar ranking (Excel/CSV)</button></div>
        </>}
      </div>

      <div className="card">
        <h4>Últimas alterações <span className="hint">(horário de Brasília)</span></h4>
        {aud.slice(0, 12).map((a, i) => <div className="b-row" key={i}>
          <span className="tag">{fmtBR(a.ts, true)}</span>&nbsp;{a.chave} · {a.status_anterior} → <b>{a.status_novo}</b>
          <span className="muted">&nbsp;({a.usuario_nome})</span></div>)}
        {!aud.length && <div className="muted">Sem alterações ainda.</div>}
      </div>
    </div>
  );
}
