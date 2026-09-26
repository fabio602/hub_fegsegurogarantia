/** Extrai apenas dígitos do telefone. */
export function phoneDigitsOnly(phone: string): string {
    return (phone || '').replace(/\D/g, '');
}

/**
 * Insere o nono dígito em celular brasileiro no formato antigo.
 *
 * Cadastro da Receita (e por consequência BrasilAPI, CNPJa e cnpj.ws) guarda
 * muito telefone em 8 dígitos, de antes da mudança de 2013. O WhatsApp exige
 * o nono, então sem isso o link abre "número não existe".
 *
 * Recebe DDD + assinante já sem DDI. Só mexe quando o assinante tem 8 dígitos
 * E começa com 6, 7, 8 ou 9 — faixa de celular. Fixo (2 a 5) fica intacto,
 * porque fixo nunca teve nono dígito.
 */
function noveDigitos(dddMaisNumero: string): string {
    if (dddMaisNumero.length !== 10) return dddMaisNumero;
    const ddd = dddMaisNumero.slice(0, 2);
    const assinante = dddMaisNumero.slice(2);
    return /^[6-9]/.test(assinante) ? `${ddd}9${assinante}` : dddMaisNumero;
}

/**
 * URL https://wa.me/... para abrir conversa no WhatsApp.
 * Heurística Brasil: 10 ou 11 dígitos sem DDI → nono dígito quando for
 * celular antigo, depois prefixo 55.
 * Já com 55 → mesma correção aplicada ao trecho depois do DDI.
 * Remove prefixo 00. Outros: 10–15 dígitos com DDI já incluído.
 */
export function whatsappUrlFromPhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    let d = phoneDigitsOnly(phone);
    if (d.length < 10) return null;
    while (d.startsWith('00')) d = d.slice(2);
    // 55 + DDD + 8 dígitos = 12: pode ser celular antigo, cabe corrigir.
    if (d.startsWith('55') && d.length === 12) return `https://wa.me/55${noveDigitos(d.slice(2))}`;
    if (d.startsWith('55') && d.length >= 12) return `https://wa.me/${d}`;
    if (d.length === 10 || d.length === 11) return `https://wa.me/55${noveDigitos(d)}`;
    if (d.length >= 10 && d.length <= 15) return `https://wa.me/${d}`;
    return null;
}
