'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

// Tipologia abreviada para caber na TV:
//   "2 Qtos."               -> "2Q"
//   "2 Qtos. Double Suíte"  -> "2Q DS"
//   "Apartamento" (generico) -> nao exibe
function tipo(u) {
  let t = (u.tipologia || '').trim();
  if (!t || /^apartamento$/i.test(t)) return null;
  t = t.replace(/(\d+)\s*Qtos?\.?/i, '$1Q');
  t = t.replace(/(\d+)\s*Quartos?/i, '$1Q');
  t = t.replace(/Double\s*Su[ií]te/i, 'DS');
  return t.replace(/\s+/g, ' ').trim();
}

export default function Espelho() {
  const [cells, setCells] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [ts, setTs] = useState('');
  const [online, setOnline] = useState(true);
  const [full, setFull] = useState(false);

  async function load() {
    const PAGE = 1000; let from = 0; let out = []; let erro = false;
    while (true) {
      const { data, error } = await supabase.from('vw_espelho').select('*')
        .order('chave').range(from, from + PAGE - 1);
      if (error) { erro = true; break; }
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
      if (from > 20000) break;
    }
    if (!erro) { setCells(out); setTs(new Date().toLocaleTimeString('pt-BR')); setOnline(true); }
    else { setOnline(false); }
  }
  async function loadStatus() {
    const { data } = await supabase.from('status').select('*').order('ordem');
    setStatuses(data || []);
  }

  useEffect(() => {
    loadStatus(); load();
    const ch = supabase
      .channel('rt-espelho')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unidade' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'status' }, () => loadStatus())
      .subscribe();
    const fs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fs);
    return () => { supabase.removeChannel(ch); document.removeEventListener('fullscreenchange', fs); };
  }, []);

  function telaCheia() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  // Status unicos por nome (a tabela repete o status para cada empreendimento)
  const smap = useMemo(() => {
    const m = {};
    statuses.forEach(s => { if (!m[s.nome]) m[s.nome] = s; });
    return m;
  }, [statuses]);

  const blocos = useMemo(() => {
    const m = new Map();
    cells.forEach(c => {
      if (!m.has(c.bloco_num)) m.set(c.bloco_num, {
        num: c.bloco_num, nome: c.bloco,
        ordem: c.bloco_ordem == null ? c.bloco_num : c.bloco_ordem,
        destaque: !!c.bloco_destaque
      });
    });
    return [...m.values()].sort((a, b) => (b.destaque - a.destaque) || (a.ordem - b.ordem) || (a.num - b.num));
  }, [cells]);

  // Maior numero de unidades por andar entre TODAS as torres
  // -> todas as celulas ficam do mesmo tamanho, inclusive as do Gaia
  const maxPorAndar = useMemo(() => {
    const g = {}; let mx = 1;
    cells.forEach(c => { const k = c.bloco_num + '|' + c.andar; g[k] = (g[k] || 0) + 1; });
    Object.keys(g).forEach(k => { if (g[k] > mx) mx = g[k]; });
    return mx;
  }, [cells]);

  // Legenda: so os status presentes na tela, sem repetir
  const legenda = useMemo(() => {
    const usados = {};
    cells.forEach(c => { usados[c.status] = true; });
    return Object.keys(smap).filter(n => usados[n] && smap[n].visivel_tv !== false)
      .map(n => smap[n])
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  }, [cells, smap]);

  const temDS = useMemo(() => cells.some(c => /Double\s*Su[ií]te/i.test(c.tipologia || '')), [cells]);

  const money = v => v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  function torre(b) {
    const bu = cells.filter(c => c.bloco_num === b.num);
    const andares = [...new Set(bu.map(c => c.andar))].filter(x => x != null).sort((x, y) => y - x);
    return (
      <div className={'tvtower' + (b.destaque ? ' destaque' : '')} key={b.num}>
        <h3>{b.destaque && <em className="tagl">LANÇAMENTO</em>}Torre {b.nome}</h3>
        <div className="tvfloors">
          {andares.map(f => {
            const row = bu.filter(c => c.andar === f).sort((a, c) => a.unidade_num - c.unidade_num);
            return (
              <div className="tvfloor" key={f}>
                <div className="tvfl">{f}</div>
                <div className="tvcells" style={{ gridTemplateColumns: 'repeat(' + maxPorAndar + ',1fr)' }}>
                  {row.map(u => {
                    const s = smap[u.status] || {};
                    const tp = tipo(u);
                    return (
                      <div className="tvcell" key={u.chave}
                        style={{ background: s.cor_fundo || '#888', color: s.cor_texto || '#fff' }}>
                        <b>{u.unidade_num}</b>
                        {tp && <span className="tvtip">{tp}</span>}
                        <span>{u.m2}m²</span>
                        {u.valor != null && u.valor > 1 && <span>{money(u.valor)}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="tv">
      <div className="tv-head">
        <span className="dot" style={{ background: online ? '#2e7d32' : '#c0392b' }} />
        <b>{(cells[0] && cells[0].empreendimento) || 'Espelho de Disponibilidade'}</b>
        <span className="tv-sub">{cells.length} unidades · {ts}</span>
        <span className="sp" />
        <button className="tvbtn" onClick={telaCheia}>{full ? '✕ Sair da tela cheia' : '⛶ Tela cheia'}</button>
      </div>

      {!online && <div className="tv-off">⚠ SEM CONEXÃO — exibindo o último estado conhecido. Reconectando…</div>}

      <div className="tv-main">{blocos.map(torre)}</div>

      <div className="tv-legend">
        {legenda.map(s => (
          <span key={s.nome}><i style={{ background: s.cor_fundo }} />{s.nome}</span>
        ))}
        {temDS && <span className="tv-ds">DS = Double Suíte</span>}
      </div>
    </div>
  );
}
