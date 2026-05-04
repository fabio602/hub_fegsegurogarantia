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
            className={`font-medium text-[#1B263B] hover:text-[#C69C6D] underline decoration-[#C69C6D]/40 hover:decoration-[#C69C6D] underline-offset-2 break-all ${className}`}
        >
            {shown}
        </a>
    );
};

export default WhatsAppPhoneLink;
