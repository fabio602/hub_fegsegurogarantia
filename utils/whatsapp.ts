/** Extrai apenas dígitos do telefone. */
export function phoneDigitsOnly(phone: string): string {
    return (phone || '').replace(/\D/g, '');
}

/**
 * URL https://wa.me/... para abrir conversa no WhatsApp.
 * Heurística Brasil: 10 ou 11 dígitos sem DDI → prefixo 55.
 * Já com 55 e ≥12 dígitos → mantém. Remove prefixo 00.
 * Outros: 10–15 dígitos com DDI já incluído → wa.me/<dígitos>.
 */
export function whatsappUrlFromPhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    let d = phoneDigitsOnly(phone);
    if (d.length < 10) return null;
    while (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('55') && d.length >= 12) return `https://wa.me/${d}`;
    if (d.length === 10 || d.length === 11) return `https://wa.me/55${d}`;
    if (d.length >= 10 && d.length <= 15) return `https://wa.me/${d}`;
    return null;
}
