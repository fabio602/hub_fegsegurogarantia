/**
 * Busca rua, bairro e cidade/UF pelo CEP em bases públicas e gratuitas
 * (BrasilAPI e, se ela falhar, ViaCEP). Devolve o endereço já em uma linha,
 * "Rua X, Bairro, Cidade/UF", ou null quando o CEP não existe ou nenhuma
 * base respondeu. Nunca lança erro: a busca é só uma ajuda ao preenchimento.
 */
export async function buscarEnderecoPorCep(cep: string): Promise<string | null> {
    const d = (cep || '').replace(/\D/g, '');
    if (d.length !== 8) return null;
    const juntar = (rua?: string, bairro?: string, cidade?: string, uf?: string) => {
        const local = [cidade, uf].filter(Boolean).join('/');
        const linha = [rua, bairro, local].map(p => (p || '').trim()).filter(Boolean).join(', ');
        return linha || null;
    };
    try {
        const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${d}`);
        if (r.ok) {
            const j = await r.json();
            const linha = juntar(j.street, j.neighborhood, j.city, j.state);
            if (linha) return linha;
        }
    } catch { /* tenta a próxima base */ }
    try {
        const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
        if (r.ok) {
            const j = await r.json();
            if (!j.erro) return juntar(j.logradouro, j.bairro, j.localidade, j.uf);
        }
    } catch { /* sem endereço */ }
    return null;
}
