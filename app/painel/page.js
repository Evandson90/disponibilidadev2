'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const LS = 'ip_operador_prefs';
function agoraLocal() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function prefs() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }

export default function Painel() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [units, setUnits] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [emp, setEmp] = useState(null);
  const [bloco, setBloco] = useState('TODOS');
  const [busca, setBusca] = useState('');
  const [soLivres, setSoLivres] = useState(false);
  const [modo, setModo] = useState('grade');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Busca paginada: a API do Supabase devolve no maximo 1000 linhas por chamada
  async function fetchAll(view, order) {
    const PAGE = 1000; let from = 0; let out = [];
    while (true) {
      const { data, error } = await supabase.from(view).select('*').order(order)
        .range(from, from + PAGE - 1);
      if (error) break;
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
      if (from > 20000) break;
    }
    return out;
  }

  async function load() {
    const data = await fetchAll('vw_operador', 'chave');
    setUnits(data || []);
    const { data: st } = await supabase.from('status').select('*').order('ordem');
    const uniq = []; const seen = new Set();
    (st || []).forEach(s => { if (!seen.has(s.nome)) { seen.add(s.nome); uniq.push(s); } });
    setStatuses(uniq);
  }
  useEffect(() => {
    if (!session) return;
    load();
    const ch = supabase.channel('rt-painel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unidade' }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session]);

  const empreendimentos = useMemo(() => {
    const m = new Map();
    units.forEach(u => { if (!m.has(u.emp_slug)) m.set(u.emp_slug, { slug: u.emp_slug, nome: u.empreendimento, ordem: u.emp_ordem, n: 0, livres: 0 }); const o = m.get(u.emp_slug); o.n++; if (u.status === 'Disponível') o.livres++; });
    return [...m.values()].sort((a, b) => a.ordem - b.ordem);
  }, [units]);

  useEffect(() => { if (!emp && empreendimentos.length) setEmp(empreendimentos.find(e => e.slug === 'astra')?.slug || empreendimentos[0].slug); }, [empreendimentos, emp]);

  const doEmp = useMemo(() => units.filter(u => u.emp_slug === emp), [units, emp]);
  const blocos = useMemo(() => {
    const m = new Map();
    doEmp.forEach(u => { if (!m.has(u.bloco)) m.set(u.bloco, { nome: u.bloco, num: u.bloco_num, destaque: u.bloco_destaque, n: 0, livres: 0 }); const o = m.get(u.bloco); o.n++; if (u.status === 'Disponível') o.livres++; });
    return [...m.values()].sort((a, b) => (b.destaque - a.destaque) || (a.num - b.num));
  }, [doEmp]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return doEmp.filter(u =>
      (bloco === 'TODOS' || u.bloco === bloco) &&
      (!soLivres || u.status === 'Disponível') &&
      (!q || String(u.unidade_num).includes(q) || (u.bloco || '').toLowerCase().includes(q) || (u.chave || '').toLowerCase().includes(q))
    );
  }, [doEmp, bloco, busca, soLivres]);

  const smap = useMemo(() => { const m = {}; statuses.forEach(s => m[s.nome] = s); return m; }, [statuses]);
  const cor = s => smap[s] || { cor_fundo: '#888', cor_texto: '#fff' };

  async function login(e) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) setMsg({ t: 'err', m: 'Falha no login: ' + error.message });
  }

  function abrir(u, statusSugerido) {
    const p = prefs();
    setMsg(null);
    setEditing(u);
    setForm({
      novo_status: statusSugerido || u.status,
      cliente: '', imobiliaria: p.imobiliaria || '', corretor: p.corretor || '', gerencia: p.gerencia || '',
      hora_reserva: agoraLocal(), justificativa: '', confirma: false, versao: u.versao
    });
  }

  async function salvar() {
    if (!editing || salvando) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc('reservar_unidade', {
      p_chave: editing.chave,
      p_novo_status: form.novo_status,
      p_versao_esperada: form.versao,
      p_comercial: { cliente: form.cliente, imobiliaria: form.imobiliaria, corretor: form.corretor, gerencia: form.gerencia, hora_reserva: form.hora_reserva },
      p_confirma: form.confirma,
      p_justificativa: form.justificativa,
      p_origem: 'Painel Web'
    });
    setSalvando(false);
    if (error) { setMsg({ t: 'err', m: error.message }); return; }
    if (data && data.ok) {
      localStorage.setItem(LS, JSON.stringify({ corretor: form.corretor, imobiliaria: form.imobiliaria, gerencia: form.gerencia }));
      setMsg({ t: 'ok', m: `${editing.chave} → ${data.status}` });
      setEditing(null);
      load();
    } else setMsg({ t: 'err', m: (data && data.msg) || 'Operação rejeitada' });
  }

  if (!session) {
    return (
      <div className="home">
        <h1>Painel do operador</h1>
        {msg && <div className={'msg ' + (msg.t === 'ok' ? 'ok' : 'err')}>{msg.m}</div>}
        <form onSubmit={login} className="card">
          <div className="form">
            <label>E-mail<input value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label>Senha<input type="password" value={senha} onChange={e => setSenha(e.target.value)} /></label>
          </div>
          <button type="submit">Entrar</button>
        </form>
      </div>
    );
  }

  const andares = [...new Set(filtrados.map(u => u.andar))].sort((a, b) => b - a);

  return (
    <div className="wrap">
      <div className="topbar">
        <b>Painel do operador</b>
        <span className="muted">· {session.user.email}</span>
        <button className="sm" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
      {msg && <div className={'msg ' + (msg.t === 'ok' ? 'ok' : 'err')}>{msg.m}</div>}

      <div className="chips">
        {empreendimentos.map(e => (
          <button key={e.slug} className={'chip' + (emp === e.slug ? ' on' : '')}
            onClick={() => { setEmp(e.slug); setBloco('TODOS'); }}>
            {e.nome.replace('Ilha Pura - ', '')} <i>{e.livres} livres</i>
          </button>
        ))}
      </div>

      <div className="chips">
        <button className={'chip' + (bloco === 'TODOS' ? ' on' : '')} onClick={() => setBloco('TODOS')}>Todos os blocos</button>
        {blocos.map(b => (
          <button key={b.nome} className={'chip' + (bloco === b.nome ? ' on' : '') + (b.destaque ? ' hot' : '')}
            onClick={() => setBloco(b.nome)}>
            {b.destaque ? '★ ' : ''}{b.nome} <i>{b.livres}/{b.n}</i>
          </button>
        ))}
      </div>

      <div className="bar">
        <input className="search" placeholder="Buscar unidade, bloco…" value={busca} onChange={e => setBusca(e.target.value)} />
        <label className="tg"><input type="checkbox" checked={soLivres} onChange={e => setSoLivres(e.target.checked)} /> Só disponíveis</label>
        <button className="sm" onClick={() => setModo(modo === 'grade' ? 'tabela' : 'grade')}>{modo === 'grade' ? 'Ver tabela' : 'Ver grade'}</button>
        <span className="muted">{filtrados.length} unidades</span>
      </div>

      {modo === 'grade' ? (
        <div className="gridop">
          {andares.map(a => (
            <div className="floor" key={a}>
              <div className="fl">{a}º</div>
              <div className="cells">
                {filtrados.filter(u => u.andar === a).sort((x, y) => x.unidade_num - y.unidade_num).map(u => {
                  const c = cor(u.status);
                  return (
                    <button key={u.chave} className="cellop" style={{ background: c.cor_fundo, color: c.cor_texto }}
                      title={`${u.bloco} · ${u.status} · ${u.m2}m²`} onClick={() => abrir(u)}>
                      <b>{u.unidade_num}</b>
                      <span>{u.m2}m²</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table>
          <thead><tr><th>Bloco</th><th>Un.</th><th>Andar</th><th>m²</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {filtrados.slice(0, 800).map(u => {
              const c = cor(u.status);
              return (
                <tr key={u.chave}>
                  <td>{u.bloco}</td><td>{u.unidade_num}</td><td>{u.andar}</td><td>{u.m2}</td>
                  <td><span className="badge" style={{ background: c.cor_fundo, color: c.cor_texto }}>{u.status}</span></td>
                  <td><button className="sm" onClick={() => abrir(u)}>Alterar</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="modal" onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="box">
            <h3>{editing.bloco} · Unidade {editing.unidade_num}</h3>
            <div className="muted">{editing.empreendimento} · {editing.andar}º andar · {editing.m2}m² · atual: {editing.status}</div>
            {msg && <div className={'msg ' + (msg.t === 'ok' ? 'ok' : 'err')}>{msg.m}</div>}

            <div className="quick">
              {['Reservada', 'Em Negociação', 'Pix Validado', 'Vendido', 'Disponível'].map(s => (
                <button key={s} className={'chip' + (form.novo_status === s ? ' on' : '')}
                  style={{ borderColor: cor(s).cor_fundo }}
                  onClick={() => setForm({ ...form, novo_status: s })}>{s}</button>
              ))}
            </div>

            <div className="form">
              <label>Status
                <select value={form.novo_status} onChange={e => setForm({ ...form, novo_status: e.target.value })}>
                  {statuses.map(s => <option key={s.nome}>{s.nome}</option>)}
                </select>
              </label>
              <label>Cliente<input autoFocus value={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.value })} /></label>
              <label>Corretor<input value={form.corretor} onChange={e => setForm({ ...form, corretor: e.target.value })} /></label>
              <label>Imobiliária<input value={form.imobiliaria} onChange={e => setForm({ ...form, imobiliaria: e.target.value })} /></label>
              <label>Gerente<input value={form.gerencia} onChange={e => setForm({ ...form, gerencia: e.target.value })} /></label>
              <label>Hora da reserva<input type="datetime-local" value={form.hora_reserva} onChange={e => setForm({ ...form, hora_reserva: e.target.value })} /></label>
              <label>Justificativa<input value={form.justificativa} onChange={e => setForm({ ...form, justificativa: e.target.value })} /></label>
              <label className="tg"><input type="checkbox" checked={form.confirma} onChange={e => setForm({ ...form, confirma: e.target.checked })} /> Confirmar ação crítica</label>
            </div>
            <button onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>{' '}
            <button className="sm" onClick={() => setEditing(null)}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}
