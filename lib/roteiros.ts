// Roteiros de abordagem do Kanban (spec em docs/kanban/ROTEIROS-CARD.md).
// Funções puras: grupo do lead, preenchimento dos campos, telefone e links.
// Os textos ficam na tabela prospect_roteiros (migração 116).

export type GrupoRoteiro = 'energia' | 'imobiliarias' | 'consultores';
export type CanalRoteiro = 'whatsapp' | 'email' | 'ligacao';

export interface Roteiro {
    grupo: GrupoRoteiro;
    canal: CanalRoteiro;
    etapa: number;
    variacao: 'A' | 'B';
    assunto: string | null;
    corpo: string;
}

interface LeadParaRoteiro {
    id: string;
    name?: string | null;
    company?: string | null;
    decisor?: string | null;
    city?: string | null;
    source?: string | null;
}

const GRUPO_POR_SOURCE: Record<string, GrupoRoteiro> = {
    garimpo_energia: 'energia',
    garimpo_imobiliarias: 'imobiliarias',
    garimpo_consultores: 'consultores',
};

/** Grupo do lead pelo `source`. Qualquer outro source fica sem roteiro. */
export const grupoDoLead = (source?: string | null): GrupoRoteiro | null =>
    (source && GRUPO_POR_SOURCE[source]) || null;

/** Variação da 1ª mensagem, fixa por lead: último caractere do id 0-7 → A, 8-f → B. */
export const variacaoDoLead = (id: string): 'A' | 'B' => {
    const n = parseInt(id.slice(-1), 16);
    return Number.isNaN(n) || n < 8 ? 'A' : 'B';
};

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

const capitalizar = (palavra: string): string => {
    const min = palavra.toLocaleLowerCase('pt-BR');
    return min.charAt(0).toLocaleUpperCase('pt-BR') + min.slice(1);
};

/** Texto todo em maiúsculas vira iniciais maiúsculas; texto que já tem minúscula fica como está. */
const ajustarMaiusculas = (texto: string): string => {
    if (/[a-zà-ÿ]/.test(texto)) return texto;
    return texto
        .split(/\s+/)
        .filter(Boolean)
        .map((p, i) => (i > 0 && PARTICULAS.has(p.toLocaleLowerCase('pt-BR')) ? p.toLocaleLowerCase('pt-BR') : capitalizar(p)))
        .join(' ');
};

const igual = (a?: string | null, b?: string | null): boolean =>
    !!a && !!b && a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

/**
 * {nome}: primeira palavra do decisor, só com a inicial maiúscula.
 * Em energia o `name` é o próprio decisor, então só comparamos com `name`
 * quando ele repete a empresa (caso de imobiliárias e consultores).
 */
export const nomeDoLead = (lead: LeadParaRoteiro): string => {
    const d = (lead.decisor || '').trim();
    const nameEhEmpresa = igual(lead.name, lead.company);
    if (!d || igual(d, lead.company) || (nameEhEmpresa && igual(d, lead.name))) return '';
    return capitalizar(d.split(/\s+/)[0]);
};

// Sufixos societários removidos do fim do nome, repetindo até não sobrar.
const SUFIXO = /(^|[\s,\-–])(LTDA\.?|Ltda\.?|ltda\.?|EIRELI|Eireli|EPP|Epp|ME|S\.A\.?|S\/A|SA)$/;
const PONTUACAO_FINAL = /[\s.,;:\-–/]+$/;

/** {empresa}: company sem sufixo societário e com maiúsculas ajustadas. */
export const empresaDoLead = (lead: LeadParaRoteiro): string => {
    let s = (lead.company || lead.name || '').trim();
    for (;;) {
        const limpo = s.replace(PONTUACAO_FINAL, '').replace(SUFIXO, '$1').replace(PONTUACAO_FINAL, '');
        if (limpo === s || !limpo) break;
        s = limpo;
    }
    return ajustarMaiusculas(s);
};

/** {cidade}: city com maiúsculas ajustadas; vazia vira "sua cidade". */
export const cidadeDoLead = (lead: LeadParaRoteiro): string => {
    const c = (lead.city || '').trim();
    return c ? ajustarMaiusculas(c) : 'sua cidade';
};

export interface CamposRoteiro {
    nome: string;
    empresa: string;
    cidade: string;
    remetente: string;
}

export const camposDoLead = (lead: LeadParaRoteiro, remetente: string): CamposRoteiro => ({
    nome: nomeDoLead(lead),
    empresa: empresaDoLead(lead),
    cidade: cidadeDoLead(lead),
    remetente: remetente.trim(),
});

/** Troca os campos do texto. Sem nome, ", {nome}" some inteiro antes da troca. */
export const preencherRoteiro = (texto: string, c: CamposRoteiro): string => {
    let t = texto;
    if (!c.nome) t = t.split(', {nome}').join('');
    return t
        .split('{nome_ou_responsavel}').join(c.nome || 'a pessoa que cuida dos contratos de energia')
        .split('{nome}').join(c.nome)
        .split('{empresa}').join(c.empresa)
        .split('{cidade}').join(c.cidade)
        .split('{remetente}').join(c.remetente);
};

export type TipoTelefone = 'celular' | 'fixo' | 'erro';

/** Só dígitos, sem o 55 do país e sem o 0 de operadora. */
export const normalizarTelefone = (bruto?: string | null): string => {
    let d = (bruto || '').replace(/\D/g, '');
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.startsWith('0')) d = d.slice(1);
    return d;
};

export const tipoTelefone = (normalizado: string): TipoTelefone => {
    if (normalizado.length === 11 && normalizado[2] === '9') return 'celular';
    if (normalizado.length === 10 && '2345'.includes(normalizado[2])) return 'fixo';
    return 'erro';
};

/** (DD) XXXX-XXXX para fixo e (DD) XXXXX-XXXX para celular; número com erro volta como veio. */
export const formatarTelefone = (bruto?: string | null): string => {
    const n = normalizarTelefone(bruto);
    const tipo = tipoTelefone(n);
    if (tipo === 'erro') return (bruto || '').trim();
    const corte = tipo === 'celular' ? 7 : 6;
    return `(${n.slice(0, 2)}) ${n.slice(2, corte)}-${n.slice(corte)}`;
};

export const linkWhatsApp = (normalizado: string, texto: string): string =>
    `https://wa.me/55${normalizado}?text=${encodeURIComponent(texto)}`;

/** mailto com quebra de linha como %0D%0A. */
export const linkEmail = (para: string, assunto: string, corpo: string): string => {
    const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, '\r\n'));
    return `mailto:${para.trim()}?subject=${enc(assunto)}&body=${enc(corpo)}`;
};

/** Escolhe o roteiro do grupo/canal/etapa; na falta da variação B, usa a A. */
export const escolherRoteiro = (
    roteiros: Roteiro[],
    grupo: GrupoRoteiro,
    canal: CanalRoteiro,
    etapa: number,
    variacao: 'A' | 'B' = 'A',
): Roteiro | null => {
    const doCanal = roteiros.filter(r => r.grupo === grupo && r.canal === canal && r.etapa === etapa);
    return doCanal.find(r => r.variacao === variacao) || doCanal.find(r => r.variacao === 'A') || null;
};
