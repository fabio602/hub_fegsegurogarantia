import React from 'react';
import { whatsappUrlFromPhone } from '../utils/whatsapp';

type Props = {
    phone: string | null | undefined;
    /** Texto formatado a mostrar (ex.: máscara). Por defeito usa `phone`. */
    display?: React.ReactNode;
    className?: string;
};

/**
 * Telefone clicável que abre nova conversa no WhatsApp (wa.me), quando o número for válido.
 */
const WhatsAppPhoneLink: React.FC<Props> = ({ phone, display, className = '' }) => {
    const raw = phone != null ? String(phone).trim() : '';
    if (!raw || raw === 'nan') {
        return display != null ? <span className={className}>{display}</span> : null;
    }
    const url = whatsappUrlFromPhone(raw);
    const shown = display !== undefined && display !== null ? display : raw;
    if (!url) {
        return <span className={className}>{shown}</span>;
    }
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir WhatsApp"
            className={`font-medium text-navy hover:text-gold underline decoration-gold/40 hover:decoration-gold underline-offset-2 break-all ${className}`}
        >
            {shown}
        </a>
    );
};

export default WhatsAppPhoneLink;
