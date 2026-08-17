'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const RESERVA_ST = ['Reservada', 'Reservada c/ Recibão', 'Em Negociação', 'Pix Validado', 'Em validação', 'Em Simulação'];

function pad(n) { return (n < 10 ? '0' : '') + n; }
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fimDeSemanaPadrao() {
  const d = new Date(), dow = d.getDay(), sex = new Date(d);
  sex.setDate(d.getDate() - ((dow + 2) % 7));
  let dom = new Date(sex); dom.setDate(sex.getDate() + 2);
  if (d > dom) dom = d;
  return [iso(sex), iso(dom)];
}
function dBR(s) { const p = String(s).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : s; }

async function fetchAll(view, order) {
  const PAGE = 1000; let from = 0, out = [];
  while (true) {
    const { data, error } = await supabase.from(view).select('*').order(order).range(from, from + PAGE - 1);
    if (error) break;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE; if (from > 20000) break;
  }
  return out;
}

function Nav({ email, onSair, atual }) {
  const item = (href, label) => (
    <a key={href} href={href} className={'navb' + (atual === href ? ' on' : '')}>{label}</a>
  );
  return (
    <div className="navbar">
      <b className="navbrand">Disponibilidade — Ilha Pura</b>
      <nav className="navlinks">
        {item('/painel', 'Painel operador')}
        {item('/espelho', 'Espelho TV')}
        {item('/indicadores', 'Indicadores')}
      </nav>
      <span className="sp" />
      {email && <span className="muted">{email}</span>}
      {onSair && <button className="sm" onClick={onSair}>Sair</button>}
    </div>
  );
}

export default function Indicadores() {
  const [session, setSession] = useState(null);
  const [units, setUnits] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [com, setCom] = useState({});
  const [audit, setAudit] = useState([]);
  const [conf, setConf] = useState([]);
  const [wk, setWk] = useState(fimDeSemanaPadrao());
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function load() {
    setCarregando(true);
    const u = await fetchAll('vw_operador', 'chave');
    setUnits(u);
    const { data: st } = await supabase.from('status').select('*').order('ordem');
    const seen = new Set(), uniq = [];
    (st || []).forEach(s => { if (!seen.has(s.nome)) { seen.add(s.nome); uniq.push(s); } });
    setStatuses(uniq);
    const dc = await fetchAll('dado_comercial', 'unidade_id');
    const m = {}; dc.forEach(d => m[d.unidade_id] = d); setCom(m);
    const { data: a } = await supabase.from('audit_log').select('*').order('ts', { ascending: false }).limit(5000);
    setAudit(a || []);
    const { data: c } = await supabase.from('conflito').select('*').order('ts', { ascending: false }).limit(500);
    setConf(c || []);
    setCarregando(false);
  }
  useEffect(() => {
    if (!session) return;
    load();
    const ch = supabase.channel('rt-ind')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unidade' }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session]);

  const smap = useMemo(() => { const m = {}; statuses.forEach(s => m[s.nome] = s); return m; }, [statuses]);
  const cor = s => smap[s] || { cor_fundo: '#888', cor_texto: '#fff' };
  const uById = useMemo(() => { const m = {}; units.forEach(u => m[u.chave] = u); return m; }, [units]);

  // movimentação dentro da janela do lançamento
  const mov = useMemo(() => {
    const ini = wk[0] + 'T00:00:00', fim = wk[1] + 'T23:59:59';
    return audit.filter(a => a.campo === 'status' && a.ts && String(a.ts).slice(0, 19) >= ini && String(a.ts).slice(0, 19) <= fim);
  }, [audit, wk]);

  // para cada unidade vale SEMPRE a alteração mais recente do período
  const unMov = useMemo(() => {
    const m = {}, t = {};
    mov.forEach(a => {
      const ts = String(a.ts || '');
      if (!t[a.chave] || ts > t[a.chave]) { t[a.chave] = ts; m[a.chave] = a.status_novo; }
    });
    return m;
  }, [mov]);
  const chaves = Object.keys(unMov);

  const byS = useMemo(() => { const m = {}; chaves.forEach(k => m[unMov[k]] = (m[unMov[k]] || 0) + 1); return m; }, [unMov]);
  const reservadas = (byS['Reservada'] || 0) + (byS['Reservada c/ Recibão'] || 0);

  // ranking por imobiliária / corretor
  const rank = useMemo(() => {
    const im = {}, co = {};
    chaves.forEach(k => {
      const u = uById[k]; if (!u) return;
      const d = com[u.id] || {};
      const i = (d.imobiliaria || '').trim() || '(sem imobiliária)';
      const c = (d.corretor || '').trim() || '(sem corretor)';
      if (!im[i]) im[i] = { res: 0, ven: 0, neg: 0, tot: 0 };
      im[i].tot++; co[c] = (co[c] || 0) + 1;
      const st = unMov[k];
      if (st === 'Vendido') im[i].ven++;
      else if (st === 'Reservada' || st === 'Reservada c/ Recibão') im[i].res++;
      else if (st === 'Em Negociação') im[i].neg++;
    });
    return { im, co };
  }, [unMov, uById, com]);

  const ordIm = Object.keys(rank.im).sort((a, b) => rank.im[b].tot - rank.im[a].tot);
  const ordCo = Object.keys(rank.co).sort((a, b) => rank.co[b] - rank.co[a]);

  // unidades por empreendimento (Astra · Torre Gaia separada)
  const porEmp = useMemo(() => {
    const m = {}, o = {};
    units.forEach(u => {
      let lab, ord;
      if (u.bloco_destaque) { lab = u.empreendimento.replace('Ilha Pura - ', '') + ' · Torre ' + u.bloco + ' (Lançamento)'; ord = 0; }
      else { lab = u.empreendimento.replace('Ilha Pura - ', ''); ord = (u.emp_ordem || 0) + 1; }
      m[lab] = (m[lab] || 0) + 1; o[lab] = ord;
    });
    return Object.keys(m).sort((a, b) => o[a] - o[b]).map(k => [k, m[k]]);
  }, [units]);

  const porStatus = useMemo(() => {
    const m = {}; units.forEach(u => m[u.status] = (m[u.status] || 0) + 1);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [units]);

  function baixarExcel(nome, rows) {
    const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    let sd = '';
    rows.forEach((r, ri) => {
      sd += '<row r="' + (ri + 1) + '">';
      r.forEach((v, ci) => {
        let col = '', n = ci; do { col = String.fromCharCode(65 + (n % 26)) + col; n = Math.floor(n / 26) - 1; } while (n >= 0);
        const ref = col + (ri + 1);
        if (typeof v === 'number' && isFinite(v)) sd += '<c r="' + ref + '"><v>' + v + '</v></c>';
        else if (v != null && v !== '') sd += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      });
      sd += '</row>';
    });
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + sd + '</sheetData></worksheet>';
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', sheet]
    ];
    const T = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const enc = new TextEncoder();
    const n2 = v => [v & 255, (v >> 8) & 255], n4 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255];
    let parts = [], cent = [], off = 0;
    files.forEach(([name, data]) => {
      const d = enc.encode(data), nm = enc.encode(name), c = crc(d);
      const loc = [].concat([80, 75, 3, 4], n2(20), n2(0), n2(0), n2(0), n2(0), n4(c), n4(d.length), n4(d.length), n2(nm.length), n2(0));
      parts.push(new Uint8Array(loc), nm, d);
      cent.push({ nm, c, len: d.length, off }); off += loc.length + nm.length + d.length;
    });
    const cs = off; let cd = [];
    cent.forEach(e => {
      cd.push(new Uint8Array([].concat([80, 75, 1, 2], n2(20), n2(20), n2(0), n2(0), n2(0), n2(0), n4(e.c), n4(e.len), n4(e.len), n2(e.nm.length), n2(0), n2(0), n2(0), n2(0), n4(0), n4(e.off))), e.nm);
    });
    const clen = cd.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([].concat([80, 75, 5, 6], n2(0), n2(0), n2(files.length), n2(files.length), n4(clen), n4(cs), n2(0)));
    const all = parts.concat(cd, [end]), tot = all.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(tot); let p = 0; all.forEach(a => { out.set(a, p); p += a.length; });
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function exportarRanking() {
    if (!ordIm.length) { alert('Sem movimentação no período selecionado.'); return; }
    const rows = [['Posicao', 'Imobiliaria', 'Reservas', 'Vendas', 'Em negociacao', 'Total']];
    ordIm.forEach((im, i) => rows.push([i + 1, im, rank.im[im].res, rank.im[im].ven, rank.im[im].neg, rank.im[im].tot]));
    baixarExcel('Ranking_Imobiliarias_' + wk[0] + '_a_' + wk[1] + '.xlsx', rows);
  }
  function exportarReservas() {
    const res = units.filter(u => RESERVA_ST.indexOf(u.status) >= 0);
    if (!res.length) { alert('Nenhuma reserva registrada.'); return; }
    const rows = [['Empreendimento', 'Bloco/Torre', 'Unidade', 'Andar', 'm2', 'Status', 'Cliente', 'Corretor', 'Imobiliaria', 'Gerente', 'Hora da reserva', 'Operador', 'Atualizado em']];
    res.forEach(u => {
      const d = com[u.id] || {};
      rows.push([u.empreendimento, u.bloco, u.unidade_num, u.andar, u.m2, u.status,
        d.cliente || '', d.corretor || '', d.imobiliaria || '', d.gerencia || '',
        (d.hora_reserva || '').replace('T', ' ').slice(0, 19),
        u.atualizado_por || '', (u.atualizado_em || '').replace('T', ' ').slice(0, 19)]);
    });
    baixarExcel('Reservas_IlhaPura_' + wk[1] + '.xlsx', rows);
  }

  if (!session) return (
    <div className="home"><h1>Indicadores</h1>
      <div className="muted">Faça login no <a href="/painel">painel do operador</a> para acessar.</div>
    </div>
  );

  const kpi = (n, l, c) => <div className="kpi" key={l}><div className="n" style={{ color: c }}>{n}</div><div className="l">{l}</div></div>;
  const bar = (lab, v, tot, c) => {
    const pct = tot ? Math.round(v / tot * 100) : 0;
    return (<div className="b-row" key={lab}><div className="lab">{lab}</div>
      <div className="track"><div className="fillb" style={{ width: pct + '%', background: c || '#2d6cdf' }} /></div>
      <div style={{ width: 78, textAlign: 'right' }}>{v} ({pct}%)</div></div>);
  };

  return (
    <div className="wrap">
      <Nav email={session.user.email} onSair={() => supabase.auth.signOut()} atual="/indicadores" />
      {carregando && <div className="msg">Carregando indicadores…</div>}

      <div className="card">
        <h4>Período considerado — fim de semana do lançamento</h4>
        <div className="bar">
          <label className="tg">De <input type="date" value={wk[0]} onChange={e => setWk([e.target.value, wk[1]])} /></label>
          <label className="tg">Até <input type="date" value={wk[1]} onChange={e => setWk([wk[0], e.target.value])} /></label>
          <button className="sm" onClick={() => setWk(fimDeSemanaPadrao())}>Fim de semana atual</button>
          <button className="sm" onClick={() => setWk(['2000-01-01', '2099-12-31'])}>Considerar tudo</button>
        </div>
        <div className="hint">Os números de movimentação consideram <b>apenas</b> alterações entre {dBR(wk[0])} e {dBR(wk[1])}.</div>
        {!mov.length && audit.length > 0 &&
          <div className="hint" style={{ color: '#e0a000' }}>⚠ Nenhuma movimentação neste período — existem {audit.length} alteração(ões) fora dele.</div>}
      </div>

      <div className="kpis">
        {kpi(units.length, 'Total de unidades', '#e8eef4')}
        {kpi(chaves.length, 'Movimentadas no período', '#00a0d8')}
        {kpi(reservadas, 'Reservadas no período', '#d9a400')}
        {kpi(byS['Vendido'] || 0, 'Vendidas no período', '#e05656')}
        {kpi(byS['Em Negociação'] || 0, 'Em negociação', '#00a0d8')}
        {kpi(conf.length, 'Conflitos de concorrência', '#e07070')}
      </div>

      <div className="cols2">
        <div className="card">
          <h4>🏆 Ranking por imobiliária <span className="hint">({dBR(wk[0])} a {dBR(wk[1])})</span></h4>
          {!ordIm.length ? <div className="hint">Nenhuma movimentação no período.</div> : (<>
            <table><thead><tr><th>#</th><th>Imobiliária</th><th>Res.</th><th>Vendas</th><th>Negoc.</th><th>Total</th></tr></thead>
              <tbody>{ordIm.slice(0, 20).map((im, i) => (
                <tr key={im}><td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + 'º'}</td>
                  <td><b>{im}</b></td><td>{rank.im[im].res}</td><td>{rank.im[im].ven}</td>
                  <td>{rank.im[im].neg}</td><td><b>{rank.im[im].tot}</b></td></tr>))}
              </tbody></table>
            <div style={{ marginTop: 10 }}><button className="sm" onClick={exportarRanking}>⬇ Baixar ranking em Excel</button></div>
          </>)}
        </div>
        <div className="card">
          <h4>Ranking por corretor <span className="hint">(mesmo período)</span></h4>
          {!ordCo.length ? <div className="hint">Sem movimentação no período.</div>
            : ordCo.slice(0, 12).map(c => bar(c, rank.co[c], chaves.length))}
        </div>
      </div>

      <div className="card">
        <h4>Unidades por empreendimento — Ilha Pura <span className="hint">(estado atual)</span></h4>
        {porEmp.map(([lab, v]) => bar(lab, v, units.length, lab.indexOf('Lançamento') >= 0 ? '#f9a825' : '#2d6cdf'))}
      </div>

      <div className="cols2">
        <div className="card">
          <h4>Distribuição por status</h4>
          {porStatus.map(([s, v]) => bar(s, v, units.length, cor(s).cor_fundo))}
        </div>
        <div className="card">
          <h4>Reservas registradas</h4>
          <div className="hint">{units.filter(u => RESERVA_ST.indexOf(u.status) >= 0).length} unidade(s) em reserva/negociação.</div>
          <div style={{ margin: '10px 0' }}><button className="sm" onClick={exportarReservas}>⬇ Baixar relatório de reservas (Excel)</button></div>
          <h4 style={{ marginTop: 16 }}>Últimas alterações</h4>
          {audit.slice(0, 8).map((a, i) => (
            <div className="b-row" key={i}><span className="tag">{(a.ts || '').slice(11, 16)}</span>
              &nbsp;{a.chave} · {a.status_anterior} → <b>{a.status_novo}</b>
              <span className="hint">&nbsp;({a.usuario_nome})</span></div>))}
          {!audit.length && <div className="hint">Sem alterações ainda.</div>}
        </div>
      </div>

      {conf.length > 0 && (
        <div className="card">
          <h4>Operações com conflito / tentativa simultânea</h4>
          <table><thead><tr><th>Hora</th><th>Unidade</th><th>Operador</th><th>Esperada</th><th>Atual</th><th>Resolução</th></tr></thead>
            <tbody>{conf.slice(0, 50).map((c, i) => (
              <tr key={i}><td>{(c.ts || '').slice(11, 19)}</td><td>{c.chave}</td><td>{c.operador}</td>
                <td>{c.versao_esperada}</td><td>{c.versao_atual}</td><td>{c.resolucao}</td></tr>))}
            </tbody></table>
        </div>
      )}
    </div>
  );
}
