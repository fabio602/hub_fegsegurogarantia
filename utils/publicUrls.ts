/** Caminho do formulário público Residencial/Locatícia (sem login). */
export const PUBLIC_RESIDENTIAL_FORM_PATH = '/formulario-residencial';

function viteBasePathPrefix(): string {
    const base = import.meta.env.BASE_URL || '/';
    return base.replace(/\/$/, '') || '';
}

/** Caminho absoluto no site (respeita `base` do Vite se houver subpasta). */
export function getPublicResidentialFormPath(): string {
    const p = viteBasePathPrefix();
    return p ? `${p}${PUBLIC_RESIDENTIAL_FORM_PATH}` : PUBLIC_RESIDENTIAL_FORM_PATH;
}

/** URL completa no domínio atual (ex.: https://hub.fegsegurogarantia.com/formulario-residencial). */
export function getPublicResidentialFormUrl(): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${getPublicResidentialFormPath()}`;
}
