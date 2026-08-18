'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const RES_ST = ['Reservada', 'Reservada c/ Recibão', 'Pix Validado', 'Em validação'];
const pad = n => (n < 10 ? '0' : '') + n;
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function semana() {
  const d = new Date(), s = new Date(d);
  s.setDate(d.getDate() - ((d.getDay() + 2) % 7));
  let f = new Date(s); f.setDate(s.getDate() + 2);
  if (d > f) f = d;
  return [iso(s), iso(f)];
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unidade' }, () => carregar())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [ses]);

  const uMap = useMemo(() => { const m = {}; un.forEach(u => { m[u.chave] = u; }); return m; }, [un]);

  // status final de cada unidade DENTRO do periodo (vale a alteracao mais recente)
  const movs = useMemo(() => {
    const i = wk[0] + 'T00:00:00', f = wk[1] + 'T23:59:59', m = {}, t = {};
    aud.filter(a => a.campo === 'status' && a.ts
      && String(a.ts).slice(0, 19) >= i && String(a.ts).slice(0, 19) <= f)
      .forEach(a => {
        const ts = String(a.ts);
        if (!t[a.chave] || ts > t[a.chave]) { t[a.chave] = ts; m[a.chave] = a.status_novo; }
      });
    return m;
  }, [aud, wk]);

  const chaves = Object.keys(movs);
  const ehVenda = s => s === 'Vendido';
  const ehReserva = s => RES_ST.indexOf(s) >= 0;

  // ---- LANÇAMENTO: apenas a torre em destaque (Gaia) ----
  const gaia = useMemo(() => un.filter(u => u.bloco_destaque), [un]);
  const nomeGaia = gaia.length
    ? (gaia[0].empreendimento || '').replace('Ilha Pura - ', '') + ' · Torre ' + gaia[0].bloco
    : 'Lançamento';
  const gaiaMov = chaves.filter(k => uMap[k] && uMap[k].bloco_destaque);

  // ---- PERÍODO: todos os empreendimentos ----
  const porEmpPeriodo = useMemo(() => {
    const m = {};
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const nome = (u.empreendimento || '').replace('Ilha Pura - ', '');
      const lab = u.bloco_destaque ? nome + ' · Torre ' + u.bloco + ' ★' : nome;
      if (!m[lab]) m[lab] = { res: 0, ven: 0, neg: 0, tot: 0, dest: !!u.bloco_destaque };
      m[lab].tot++;
      const s = movs[k];
      if (ehVenda(s)) m[lab].ven++;
      else if (ehReserva(s)) m[lab].res++;
      else if (s === 'Em Negociação') m[lab].neg++;
    });
    return Object.keys(m).sort((a, b) => (b.dest === true) - (a.dest === true) || m[b].tot - m[a].tot)
      .map(k => [k, m[k]]);
  }, [movs, uMap]);

  const totPer = useMemo(() => {
    let res = 0, ven = 0, neg = 0;
    chaves.forEach(k => {
      const s = movs[k];
      if (ehVenda(s)) ven++; else if (ehReserva(s)) res++; else if (s === 'Em Negociação') neg++;
    });
    return { res, ven, neg };
  }, [movs]);

  // ---- Ranking por imobiliária (todos os empreendimentos) ----
  const rk = useMemo(() => {
    const m = {};
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const d = com[u.id] || {};
      const i = (d.imobiliaria || '').trim() || '(sem imobiliária)';
      if (!m[i]) m[i] = { res: 0, ven: 0, neg: 0, tot: 0 };
      m[i].tot++;
      const s = movs[k];
      if (ehVenda(s)) m[i].ven++;
      else if (ehReserva(s)) m[i].res++;
      else if (s === 'Em Negociação') m[i].neg++;
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
    const l = ['Posicao;Imobiliaria;Reservas;Vendas;Em negociacao;Total'];
    ordIm.forEach((i, n) => l.push([n + 1, i, rk[i].res, rk[i].ven, rk[i].neg, rk[i].tot].join(';')));
    csv('Ranking_' + wk[0] + '_a_' + wk[1] + '.csv', l);
  }
  function baixarVendas() {
    const l = ['Empreendimento;Bloco;Unidade;Andar;m2;Status no periodo;Cliente;ID Reserva;Corretor;Imobiliaria;Gerente'];
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k]; if (!ehVenda(s) && !ehReserva(s)) return;
      const d = com[u.id] || {};
      l.push([u.empreendimento, u.bloco, u.unidade_num, u.andar, u.m2, s,
        d.cliente || '', d.id_proposta || '', d.corretor || '', d.imobiliaria || '', d.gerencia || ''].join(';'));
    });
    if (l.length === 1) { alert('Nenhuma venda ou reserva no período.'); return; }
    csv('Vendas_Reservas_' + wk[0] + '_a_' + wk[1] + '.csv', l);
  }

  const nav = (h, t) => <a key={h} href={h} className={'navb' + (h === '/indicadores' ? ' on' : '')}>{t}</a>;
  if (!ses) return <div className="home"><h1>Indicadores</h1>
    <div className="muted">Entre pelo <a href="/painel">painel do operador</a>.</div></div>;

  const kpi = (n, l, d) => <div className={'kpi' + (d ? ' dest' : '')} key={l}>
    <div className="n">{n}</div><div className="l">{l}</div></div>;
  const bar = (l, v, t, c) => <div className="b-row" key={l}><div className="lab">{l}</div>
    <div className="track"><div className="fillb" style={{ width: (t ? Math.round(v / t * 100) : 0) + '%', background: c || '#2d6cdf' }} /></div>
    <div style={{ width: 70, textAlign: 'right' }}>{v}</div></div>;

  return (
    <div className="wrap">
      <div className="navbar">
        <b className="navbrand">Disponibilidade — Ilha Pura</b>
        <nav className="navlinks">{nav('/painel', 'Painel operador')}{nav('/espelho', 'Espelho TV')}{nav('/indicadores', 'Indicadores')}</nav>
        <span className="sp" />
        <span className="muted">{ses.user.email}</span>
        <button className="sm" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>

      <div className="card">
        <h4>Período do lançamento</h4>
        <div className="bar">
          <label className="tg">De <input type="date" value={wk[0]} onChange={e => setWk([e.target.value, wk[1]])} /></label>
          <label className="tg">Até <input type="date" value={wk[1]} onChange={e => setWk([wk[0], e.target.value])} /></label>
          <button className="sm" onClick={() => setWk(semana())}>Fim de semana atual</button>
          <button className="sm" onClick={() => setWk(['2000-01-01', '2099-12-31'])}>Considerar tudo</button>
        </div>
        <div className="hint">Movimentação de {dBR(wk[0])} a {dBR(wk[1])}.</div>
        {!chaves.length && aud.length > 0 &&
          <div className="hint" style={{ color: '#e0a000' }}>⚠ Nenhuma movimentação neste período — há {aud.length} alteração(ões) fora dele.</div>}
      </div>

      {/* ---------- FOCO: LANÇAMENTO ---------- */}
      <div className="card" style={{ borderColor: '#f9a825' }}>
        <h4>🚀 LANÇAMENTO — {nomeGaia}</h4>
        <div className="kpis">
          {kpi(gaia.length, 'Unidades da torre', true)}
          {kpi(gaia.filter(u => u.status === 'Disponível').length, 'Disponíveis agora', true)}
          {kpi(gaiaMov.filter(k => ehReserva(movs[k])).length, 'Reservadas no período', true)}
          {kpi(gaiaMov.filter(k => ehVenda(movs[k])).length, 'Vendidas no período', true)}
          {kpi(gaiaMov.filter(k => movs[k] === 'Em Negociação').length, 'Em negociação', true)}
          {kpi(gaia.length ? Math.round(gaiaMov.filter(k => ehVenda(movs[k]) || ehReserva(movs[k])).length / gaia.length * 100) + '%' : '0%', 'Da torre negociada', true)}
        </div>
      </div>

      {/* ---------- PERÍODO: TODOS OS EMPREENDIMENTOS ---------- */}
      <div className="card">
        <h4>Movimentação no período — todos os empreendimentos Ilha Pura</h4>
        <div className="kpis">
          {kpi(un.length, 'Unidades na base')}
          {kpi(chaves.length, 'Movimentadas no período')}
          {kpi(totPer.res, 'Reservadas')}
          {kpi(totPer.ven, 'Vendidas')}
          {kpi(totPer.neg, 'Em negociação')}
        </div>
        {!porEmpPeriodo.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          <table>
            <thead><tr><th>Empreendimento</th><th>Reservas</th><th>Vendas</th><th>Negoc.</th><th>Total</th></tr></thead>
            <tbody>{porEmpPeriodo.map(([l, v]) => (
              <tr key={l} style={v.dest ? { background: '#1a1710' } : null}>
                <td><b>{l}</b></td><td>{v.res}</td><td>{v.ven}</td><td>{v.neg}</td><td><b>{v.tot}</b></td>
              </tr>))}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}>
            <button className="sm" onClick={baixarVendas}>⬇ Baixar vendas e reservas do período (Excel/CSV)</button>
          </div>
        </>}
      </div>

      <div className="card">
        <h4>🏆 Ranking por imobiliária <span className="hint">({dBR(wk[0])} a {dBR(wk[1])} · todos os empreendimentos)</span></h4>
        {!ordIm.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          <table>
            <thead><tr><th>#</th><th>Imobiliária</th><th>Reservas</th><th>Vendas</th><th>Negoc.</th><th>Total</th></tr></thead>
            <tbody>{ordIm.slice(0, 20).map((i, n) => (
              <tr key={i}>
                <td>{n === 0 ? '🥇' : n === 1 ? '🥈' : n === 2 ? '🥉' : n + 1}</td>
                <td><b>{i}</b></td><td>{rk[i].res}</td><td>{rk[i].ven}</td><td>{rk[i].neg}</td><td><b>{rk[i].tot}</b></td>
              </tr>))}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}><button className="sm" onClick={baixarRanking}>⬇ Baixar ranking (Excel/CSV)</button></div>
        </>}
      </div>

      <div className="card">
        <h4>Últimas alterações</h4>
        {aud.slice(0, 10).map((a, i) => <div className="b-row" key={i}>
          <span className="tag">{(a.ts || '').slice(11, 16)}</span>&nbsp;{a.chave} · {a.status_anterior} → <b>{a.status_novo}</b>
          <span className="muted">&nbsp;({a.usuario_nome})</span></div>)}
        {!aud.length && <div className="muted">Sem alterações ainda.</div>}
      </div>
    </div>
  );
}
