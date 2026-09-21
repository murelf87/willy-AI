import React from 'react';
import './Header.css';

interface Props {
  title: string;
}

function Header({ title }: Props) {
  return (
    <header className="Header">
      <h1>{title}</h1>
    </header>
  );
}

export default Header;
