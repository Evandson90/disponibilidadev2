'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav({ email, onSair }) {
  const path = usePathname();
  const item = (href, label) => (
    <Link key={href} href={href} className={'navb' + (path === href ? ' on' : '')}>{label}</Link>
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
