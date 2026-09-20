/**
 * Leitura de listas de empresas coladas ou vindas de CSV.
 *
 * O formato é tolerante de propósito: quem monta essa lista está no Excel,
 * não escrevendo JSON. A regra é uma só: o campo que tiver arroba é o e-mail,
 * e os outros entram na ordem contato, empresa, cidade. Assim funciona tanto
 * "João; Metalúrgica X; joao@x.com.br; Boituva" quanto uma linha sem cidade,
 * separada por vírgula ou por tabulação.
 */

export interface LinhaLida {
  nome_contato: string;
  nome_empresa: string;
  email: string;
  cidade: string | null;
}

export interface ResultadoLeitura {
  validas: LinhaLida[];
  ignoradas: { linha: string; motivo: string }[];
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function lerLista(texto: string): ResultadoLeitura {
  const validas: LinhaLida[] = [];
  const ignoradas: { linha: string; motivo: string }[] = [];
  const vistos = new Set<string>();

  const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (const linha of linhas) {
    const campos = linha.split(/[;\t]|,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map(c => c.trim().replace(/^"|"$/g, ''))
      .filter(c => c !== '');

    if (campos.length < 2) {
      ignoradas.push({ linha, motivo: 'poucos campos' });
      continue;
    }

    const iEmail = campos.findIndex(c => c.includes('@'));
    if (iEmail < 0) {
      ignoradas.push({ linha, motivo: 'sem e-mail' });
      continue;
    }

    const email = campos[iEmail].toLowerCase();
    if (!EMAIL_OK.test(email)) {
      ignoradas.push({ linha, motivo: 'e-mail inválido' });
      continue;
    }

    /* Cabeçalho de planilha cai aqui: a linha tem "email" escrito, não um
       endereço. Já foi barrado acima, mas vale a rede de segurança. */
    const resto = campos.filter((_, i) => i !== iEmail);
    const nome_contato = resto[0] ?? '';
    const nome_empresa = resto[1] ?? '';
    const cidade = resto[2] ?? null;

    if (!nome_empresa) {
      ignoradas.push({ linha, motivo: 'sem empresa' });
      continue;
    }

    if (vistos.has(email)) {
      ignoradas.push({ linha, motivo: 'repetido na própria lista' });
      continue;
    }
    vistos.add(email);

    validas.push({
      nome_contato: nome_contato || nome_empresa,
      nome_empresa,
      email,
      cidade: cidade || null,
    });
  }

  return { validas, ignoradas };
}

export const EXEMPLO_LISTA =
  'João Silva; Metalúrgica Boituva; joao@metalurgica.com.br; Boituva\n' +
  'Ana Souza; Transportes Porto Feliz; ana@transportes.com.br; Porto Feliz';
