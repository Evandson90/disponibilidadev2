'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const TZ = 'America/Sao_Paulo';
const RES_ST = ['Reservada', 'Reservada c/ Recibão', 'Pix Validado', 'Em validação'];

// ---- Datas sempre no horario de Brasilia -------------------------------
function fmtBR(iso, comData) {
  if (!iso) return '';
  const o = comData
    ? { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { timeZone: TZ, hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat('pt-BR', o).format(new Date(iso));
}
// "AAAA-MM-DD" do instante, no fuso de Brasilia
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unidade' }, () => carregar())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [ses]);

  const uMap = useMemo(() => { const m = {}; un.forEach(u => { m[u.chave] = u; }); return m; }, [un]);

  // status final de cada unidade DENTRO do periodo (comparando por dia de Brasilia)
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
  const ehVenda = s => s === 'Vendido';
  const ehReserva = s => RES_ST.indexOf(s) >= 0;
  const ehNegoc = s => s === 'Em Negociação';

  // TOTAIS: somam APENAS os status que contam (reserva, venda, negociacao)
  const totPer = useMemo(() => {
    let res = 0, ven = 0, neg = 0;
    chaves.forEach(k => {
      const s = movs[k];
      if (ehVenda(s)) ven++; else if (ehReserva(s)) res++; else if (ehNegoc(s)) neg++;
    });
    return { res, ven, neg, total: res + ven + neg };
  }, [movs]);

  // ---- LANCAMENTO: torre em destaque (Gaia) ----
  const gaia = useMemo(() => un.filter(u => u.bloco_destaque), [un]);
  const nomeGaia = gaia.length
    ? (gaia[0].empreendimento || '').replace('Ilha Pura - ', '') + ' · Torre ' + gaia[0].bloco
    : 'Lançamento';
  const gaiaMov = chaves.filter(k => uMap[k] && uMap[k].bloco_destaque);
  const gRes = gaiaMov.filter(k => ehReserva(movs[k])).length;
  const gVen = gaiaMov.filter(k => ehVenda(movs[k])).length;
  const gNeg = gaiaMov.filter(k => ehNegoc(movs[k])).length;
  const gTot = gRes + gVen + gNeg;

  // ---- PERIODO por empreendimento ----
  const porEmp = useMemo(() => {
    const m = {};
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k];
      if (!ehVenda(s) && !ehReserva(s) && !ehNegoc(s)) return;   // so os status que contam
      const nome = (u.empreendimento || '').replace('Ilha Pura - ', '');
      const lab = u.bloco_destaque ? nome + ' · Torre ' + u.bloco + ' ★' : nome;
      if (!m[lab]) m[lab] = { res: 0, ven: 0, neg: 0, tot: 0, dest: !!u.bloco_destaque };
      m[lab].tot++;
      if (ehVenda(s)) m[lab].ven++; else if (ehReserva(s)) m[lab].res++; else m[lab].neg++;
    });
    return Object.keys(m).sort((a, b) => (b === a ? 0 : (m[b].dest - m[a].dest)) || m[b].tot - m[a].tot)
      .map(k => [k, m[k]]);
  }, [movs, uMap]);

  // ---- Ranking por imobiliaria ----
  const rk = useMemo(() => {
    const m = {};
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k];
      if (!ehVenda(s) && !ehReserva(s) && !ehNegoc(s)) return;
      const d = com[u.id] || {};
      const i = (d.imobiliaria || '').trim() || '(sem imobiliária)';
      if (!m[i]) m[i] = { res: 0, ven: 0, neg: 0, tot: 0 };
      m[i].tot++;
      if (ehVenda(s)) m[i].ven++; else if (ehReserva(s)) m[i].res++; else m[i].neg++;
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
    const l = ['Empreendimento;Bloco;Unidade;Andar;Tipologia;m2;Status no periodo;Cliente;ID Reserva;Corretor;Imobiliaria;Gerente;Hora da reserva (Brasilia)'];
    chaves.forEach(k => {
      const u = uMap[k]; if (!u) return;
      const s = movs[k]; if (!ehVenda(s) && !ehReserva(s) && !ehNegoc(s)) return;
      const d = com[u.id] || {};
      l.push([u.empreendimento, u.bloco, u.unidade_num, u.andar, u.tipologia || '', u.m2, s,
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
  const bar = (l, v, t, c) => <div className="b-row" key={l}><div className="lab">{l}</div>
    <div className="track"><div className="fillb" style={{ width: (t ? Math.round(v / t * 100) : 0) + '%', background: c || '#2d6cdf' }} /></div>
    <div style={{ width: 70, textAlign: 'right' }}>{v}</div></div>;

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
        <div className="hint">Contabiliza apenas reservas, vendas e negociações entre {dBR(wk[0])} e {dBR(wk[1])}.</div>
        {!chaves.length && aud.length > 0 &&
          <div className="hint" style={{ color: '#e0a000' }}>⚠ Nenhuma movimentação neste período — há {aud.length} alteração(ões) fora dele.</div>}
      </div>

      {/* ---------- FOCO: LANÇAMENTO ---------- */}
      <div className="card" style={{ borderColor: '#f9a825' }}>
        <h4>🚀 LANÇAMENTO — {nomeGaia}</h4>
        <div className="kpis">
          {kpi(gTot, 'Total negociado no período', true)}
          {kpi(gRes, 'Reservadas', true)}
          {kpi(gVen, 'Vendidas', true)}
          {kpi(gNeg, 'Em negociação', true)}
          {kpi(gaia.filter(u => u.status === 'Disponível').length, 'Disponíveis agora', true)}
          {kpi(gaia.length ? Math.round(gTot / gaia.length * 100) + '%' : '0%', 'Da torre (' + gaia.length + ' un.)', true)}
        </div>
      </div>

      {/* ---------- PERÍODO: TODOS OS EMPREENDIMENTOS ---------- */}
      <div className="card">
        <h4>Movimentação no período — todos os empreendimentos Ilha Pura</h4>
        <div className="kpis">
          {kpi(totPer.total, 'Total (reservas + vendas + negociação)')}
          {kpi(totPer.res, 'Reservadas')}
          {kpi(totPer.ven, 'Vendidas')}
          {kpi(totPer.neg, 'Em negociação')}
        </div>
        {!porEmp.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          <table>
            <thead><tr><th>Empreendimento</th><th>Reservas</th><th>Vendas</th><th>Negoc.</th><th>Total</th></tr></thead>
            <tbody>
              {porEmp.map(([l, v]) => (
                <tr key={l} style={v.dest ? { background: '#1a1710' } : null}>
                  <td><b>{l}</b></td><td>{v.res}</td><td>{v.ven}</td><td>{v.neg}</td><td><b>{v.tot}</b></td>
                </tr>))}
              <tr style={{ background: '#20262e' }}>
                <td><b>TOTAL</b></td><td><b>{totPer.res}</b></td><td><b>{totPer.ven}</b></td>
                <td><b>{totPer.neg}</b></td><td><b>{totPer.total}</b></td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}>
            <button className="sm" onClick={baixarVendas}>⬇ Baixar vendas e reservas do período (Excel/CSV)</button>
          </div>
        </>}
      </div>

      <div className="card">
        <h4>🏆 Ranking por imobiliária <span className="hint">({dBR(wk[0])} a {dBR(wk[1])})</span></h4>
        {!ordIm.length ? <div className="hint">Nenhuma movimentação no período.</div> : <>
          <table>
            <thead><tr><th>#</th><th>Imobiliária</th><th>Reservas</th><th>Vendas</th><th>Negoc.</th><th>Total</th></tr></thead>
            <tbody>{ordIm.slice(0, 25).map((i, n) => (
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
        <h4>Últimas alterações <span className="hint">(horário de Brasília)</span></h4>
        {aud.slice(0, 12).map((a, i) => <div className="b-row" key={i}>
          <span className="tag">{fmtBR(a.ts, true)}</span>&nbsp;{a.chave} · {a.status_anterior} → <b>{a.status_novo}</b>
          <span className="muted">&nbsp;({a.usuario_nome})</span></div>)}
        {!aud.length && <div className="muted">Sem alterações ainda.</div>}
      </div>
    </div>
  );
}
