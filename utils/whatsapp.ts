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
 * Telefone brasileiro formatado para leitura e discagem, já com o nono dígito
 * do celular antigo: "4196221372" vira "(41) 99622-1372" e "1535551234" vira
 * "(15) 3555-1234".
 *
 * Só formata o que for inequívoco: 10 ou 11 dígitos (com ou sem 55 na frente)
 * e DDD válido (11 a 99, sem zero). Qualquer outra coisa (0800, ramal, dois
 * números no mesmo campo, texto) volta `null`, e quem chama mostra o original.
 */
export function formatarTelefoneBr(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const bruto = String(phone).trim();
    let d = phoneDigitsOnly(bruto);
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
        d = d.slice(2);
    } else if (bruto.startsWith('+')) {
        // "+55 4007-2221" (número de capital, sem DDD) e DDI estrangeiro: não mexe.
        return null;
    }
    if (d.length !== 10 && d.length !== 11) return null;
    if (!/^[1-9][1-9]/.test(d)) return null;
    // Assinante começando com 0 ou 1 não é telefone (ex.: "4700000001").
    if (!/^[2-9]/.test(d.slice(2))) return null;
    d = noveDigitos(d);
    const ddd = d.slice(0, 2);
    const assinante = d.slice(2);
    if (assinante.length === 9) {
        // Celular de 9 dígitos sempre começa com 9.
        if (!assinante.startsWith('9')) return null;
        return `(${ddd}) ${assinante.slice(0, 5)}-${assinante.slice(5)}`;
    }
    return `(${ddd}) ${assinante.slice(0, 4)}-${assinante.slice(4)}`;
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
