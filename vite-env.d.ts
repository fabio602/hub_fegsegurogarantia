/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_EMPRESAQUI_TOKEN?: string;
    readonly VITE_PROXY_PNCP_URL?: string;
    readonly VITE_PROXY_EQ_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
