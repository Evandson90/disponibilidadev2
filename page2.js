import Link from 'next/link';

export default function Home() {
  return (
    <div className="home">
      <h1>Disponibilidade de Lançamentos</h1>
      <div className="muted">Ilha Pura — plataforma de espelho de vendas em tempo real</div>
      <div className="btnrow">
        <Link className="btn" href="/espelho">Espelho (TV)</Link>
        <Link className="btn ghost" href="/painel">Painel do operador</Link>
      </div>
    </div>
  );
} 
