'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { IMOBILIARIAS, CORRETORES, CORRETOR_IMOB } from '../../lib/imobiliarias';

const LS = 'ip_operador_prefs';
const TZ = 'America/Sao_Paulo';

// Data/hora ATUAL de Brasilia no formato do campo (YYYY-MM-DDTHH:MM),
// independente do fuso configurado no computador do operador.
function agoraBR() {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  return f.format(new Date()).replace(' ', 'T').slice(0, 16);
}

// Converte o que o operador digitou (horario de Brasilia) para o
// instante correto a ser gravado no banco (com fuso explicito).
function paraISO(local) {
  if (!local) return null;
  const [d, h] = String(local).split('T');
  if (!d || !h) return null;
  const [Y, M, D] = d.split('-').map(Number);
  const [hh, mm] = h.split(':').map(Number);
  // descobre o deslocamento de Brasilia naquela data (-03:00)
  const teste = new Date(Date.UTC(Y, M - 1, D, hh, mm));
  const emBR = new Date(teste.toLocaleString('en-US', { timeZone: TZ }));
  const emUTC = new Date(teste.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offMin = Math.round((emUTC - emBR) / 60000);
  const sinal = offMin >= 0 ? '-' : '+';
  const abs = Math.abs(offMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${d}T${h}:00${sinal}${oh}:${om}`;
}

// Mostra um instante do banco no horario de Brasilia (para o campo do form)
function paraCampo(iso) {
  if (!iso) return '';
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  return f.format(new Date(iso)).replace(' ', 'T').slice(0, 16);
}

function prefs() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }

// "2 Qtos. Double Suite" -> "2Q DS"  |  "3 Qtos." -> "3Q"
function tipoCurto(t) {
  let s = (t || '').trim();
  if (!s || /^apartamento$/i.test(s)) return '';
  s = s.replace(/(\d+)\s*Qtos?\.?/i, '$1Q').replace(/(\d+)\s*Quartos?/i, '$1Q');
  s = s.replace(/Double\s*Su[ií]te/i, 'DS');
  return s.replace(/\s+/g, ' ').trim();
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

const VAZIO = {
  cliente: '', idProposta: '', imobiliaria: '', corretor: '',
  gerencia: '', hora_reserva: '', justificativa: ''
};

export default function Painel() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [units, setUnits] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [com, setCom] = useState({});
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
    const seen = new Set(); const uniq = [];
    (st || []).forEach(s => { if (!seen.has(s.nome)) { seen.add(s.nome); uniq.push(s); } });
    setStatuses(uniq);
    // dados comerciais ja registrados (para reabrir a reserva preenchida)
    const dc = await fetchAll('dado_comercial', 'unidade_id');
    const m = {}; (dc || []).forEach(d => { m[d.unidade_id] = d; });
    setCom(m);
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
    units.forEach(u => {
      if (!m.has(u.emp_slug)) m.set(u.emp_slug, { slug: u.emp_slug, nome: u.empreendimento, ordem: u.emp_ordem, n: 0, livres: 0 });
      const o = m.get(u.emp_slug); o.n++; if (u.status === 'Disponível') o.livres++;
    });
    return [...m.values()].sort((a, b) => a.ordem - b.ordem);
  }, [units]);

  useEffect(() => {
    if (!emp && empreendimentos.length) {
      const astra = empreendimentos.filter(e => e.slug === 'astra')[0];
      setEmp(astra ? astra.slug : empreendimentos[0].slug);
    }
  }, [empreendimentos, emp]);

  const doEmp = useMemo(() => units.filter(u => u.emp_slug === emp), [units, emp]);

  const blocos = useMemo(() => {
    const m = new Map();
    doEmp.forEach(u => {
      if (!m.has(u.bloco)) m.set(u.bloco, { nome: u.bloco, num: u.bloco_num, destaque: u.bloco_destaque, n: 0, livres: 0 });
      const o = m.get(u.bloco); o.n++; if (u.status === 'Disponível') o.livres++;
    });
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

  // Abre a unidade JA PREENCHIDA com o que estiver gravado.
  // Se nunca houve reserva, usa as preferencias do operador.
  function abrir(u) {
    const d = com[u.id] || {};
    const p = prefs();
    const temReserva = !!(d.cliente || d.corretor || d.imobiliaria || d.id_proposta);
    setMsg(null);
    setEditing(u);
    setForm({
      novo_status: u.status,
      cliente: d.cliente || '',
      idProposta: d.id_proposta || '',
      imobiliaria: d.imobiliaria || (temReserva ? '' : (p.imobiliaria || '')),
      corretor: d.corretor || (temReserva ? '' : (p.corretor || '')),
      gerencia: d.gerencia || (temReserva ? '' : (p.gerencia || '')),
      hora_reserva: d.hora_reserva ? paraCampo(d.hora_reserva) : agoraBR(),
      justificativa: '',
      versao: u.versao
    });
  }

  // Ao escolher um corretor conhecido, preenche a imobiliaria dele.
  // Se o operador ja tiver digitado outra imobiliaria, respeita o que esta la.
  function escolherCorretor(nome) {
    setForm(f => {
      const imob = CORRETOR_IMOB[nome];
      const antiga = CORRETOR_IMOB[f.corretor];
      const podeTrocar = !f.imobiliaria || f.imobiliaria === antiga;
      return Object.assign({}, f, {
        corretor: nome,
        imobiliaria: (imob && podeTrocar) ? imob : f.imobiliaria
      });
    });
  }

  function limpar() {
    setForm(f => Object.assign({}, f, VAZIO, { hora_reserva: agoraBR() }));
    setMsg({ t: 'ok', m: 'Campos limpos. Preencha os novos dados e salve.' });
  }

  async function salvar() {
    if (!editing || salvando) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc('reservar_unidade', {
      p_chave: editing.chave,
      p_novo_status: form.novo_status,
      p_versao_esperada: form.versao,
      p_comercial: {
        cliente: form.cliente, idProposta: form.idProposta,
        imobiliaria: form.imobiliaria, corretor: form.corretor,
        gerencia: form.gerencia, hora_reserva: paraISO(form.hora_reserva)
      },
      p_confirma: true,
      p_justificativa: form.justificativa,
      p_origem: 'Painel Web'
    });
    setSalvando(false);
    if (error) { setMsg({ t: 'err', m: error.message }); return; }
    if (data && data.ok) {
      localStorage.setItem(LS, JSON.stringify({ corretor: form.corretor, imobiliaria: form.imobiliaria, gerencia: form.gerencia }));
      setMsg({ t: 'ok', m: `${editing.bloco} ${editing.unidade_num} → ${data.status}` });
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
  const dEdit = editing ? (com[editing.id] || {}) : {};
  const temReserva = !!(dEdit.cliente || dEdit.corretor || dEdit.imobiliaria || dEdit.id_proposta);

  return (
    <div className="wrap">
      <Nav email={session.user.email} onSair={() => supabase.auth.signOut()} atual="/painel" />
      {msg && <div className={'msg ' + (msg.t === 'ok' ? 'ok' : 'err')}>{msg.m}</div>}

      <div className="chips">
        {empreendimentos.map(e => (
          <button key={e.slug} className={'chip' + (emp === e.slug ? ' on' : '')}
            onClick={() => { setEmp(e.slug); setBloco('TODOS'); }}>
            {(e.nome || '').replace('Ilha Pura - ', '')} <i>{e.livres} livres</i>
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
                      title={`${u.bloco} · ${u.tipologia || ''} · ${u.status} · ${u.m2}m²`} onClick={() => abrir(u)}>
                      <b>{u.unidade_num}</b>
                      <span>{tipoCurto(u.tipologia)}</span>
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
          <thead><tr><th>Bloco</th><th>Un.</th><th>Andar</th><th>Tipologia</th><th>m²</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {filtrados.slice(0, 800).map(u => {
              const c = cor(u.status);
              return (
                <tr key={u.chave}>
                  <td>{u.bloco}</td><td>{u.unidade_num}</td><td>{u.andar}</td>
                  <td>{u.tipologia || '—'}</td><td>{u.m2}</td>
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
            <div className="muted">
              {editing.empreendimento} · {editing.andar}º andar · {editing.tipologia || ''} · {editing.m2}m² · atual: {editing.status}
            </div>
            {temReserva && <div className="msg ok" style={{ marginTop: 8 }}>
              Reserva já registrada — os campos abaixo estão preenchidos com os dados atuais.
            </div>}
            {msg && <div className={'msg ' + (msg.t === 'ok' ? 'ok' : 'err')}>{msg.m}</div>}

            <div className="quick">
              {['Reservada', 'Em Negociação', 'Pix Validado', 'Vendido', 'Disponível'].map(s => (
                <button key={s} className={'chip' + (form.novo_status === s ? ' on' : '')}
                  style={{ borderColor: cor(s).cor_fundo }}
                  onClick={() => setForm(Object.assign({}, form, { novo_status: s }))}>{s}</button>
              ))}
            </div>

            <div className="form">
              <label>Status
                <select value={form.novo_status} onChange={e => setForm(Object.assign({}, form, { novo_status: e.target.value }))}>
                  {statuses.map(s => <option key={s.nome}>{s.nome}</option>)}
                </select>
              </label>
              <label>Cliente<input autoFocus value={form.cliente} onChange={e => setForm(Object.assign({}, form, { cliente: e.target.value }))} /></label>
              <label>ID da reserva / proposta<input value={form.idProposta} placeholder="Ex.: PRP-1001"
                onChange={e => setForm(Object.assign({}, form, { idProposta: e.target.value }))} /></label>
              <label>Corretor
                <input list="lista-corr" placeholder="Digite para buscar ou escreva"
                  value={form.corretor} onChange={e => escolherCorretor(e.target.value)} />
                <datalist id="lista-corr">
                  {CORRETORES.map(n => <option key={n} value={n} />)}
                </datalist>
              </label>
              <label className="full">Imobiliária
                <input list="lista-imob" placeholder="Digite para buscar ou escreva uma nova"
                  value={form.imobiliaria} onChange={e => setForm(Object.assign({}, form, { imobiliaria: e.target.value }))} />
                <datalist id="lista-imob">
                  {IMOBILIARIAS.map(n => <option key={n} value={n} />)}
                </datalist>
              </label>
              <label>Gerente<input value={form.gerencia} onChange={e => setForm(Object.assign({}, form, { gerencia: e.target.value }))} /></label>
              <label>Hora da reserva (Brasília)<input type="datetime-local" value={form.hora_reserva}
                onChange={e => setForm(Object.assign({}, form, { hora_reserva: e.target.value }))} /></label>
              <label className="full">Justificativa (opcional)<input value={form.justificativa}
                onChange={e => setForm(Object.assign({}, form, { justificativa: e.target.value }))} /></label>
            </div>

            <div className="bar" style={{ justifyContent: 'flex-end' }}>
              <button className="sm" style={{ background: '#5a3030' }} onClick={limpar}>Limpar dados</button>
              <button className="sm" style={{ background: '#20262e' }} onClick={() => setEditing(null)}>Fechar</button>
              <button onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
