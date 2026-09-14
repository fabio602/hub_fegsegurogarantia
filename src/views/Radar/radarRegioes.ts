/**
 * Regiões prontas para o filtro do Radar: cada uma vira uma lista de chips
 * de município (editável depois). Os nomes ficam com acento para leitura;
 * a comparação com o banco usa `normalizarMunicipio` (a BrasilAPI grava os
 * municípios em maiúsculas e sem acento, ex.: SAO PAULO).
 */

export interface RadarRegiao {
  id: string;
  nome: string;
  uf: string;
  municipios: string[];
}

export const REGIOES: RadarRegiao[] = [
  {
    id: 'sorocaba',
    nome: 'Sorocaba e região',
    uf: 'SP',
    municipios: ['Sorocaba', 'Boituva', 'Itu', 'Salto', 'Tatuí', 'Porto Feliz', 'Votorantim', 'Iperó', 'Piedade', 'Cerquilho', 'Tietê', 'Capivari'],
  },
  {
    id: 'campinas',
    nome: 'Campinas e região',
    uf: 'SP',
    municipios: ['Campinas', 'Indaiatuba', 'Itupeva', 'Jundiaí', 'Valinhos', 'Vinhedo', 'Hortolândia', 'Sumaré', 'Americana', 'Paulínia', 'Louveira'],
  },
  {
    id: 'grande-sp-oeste',
    nome: 'Grande SP oeste',
    uf: 'SP',
    municipios: ['Barueri', 'Osasco', 'Jandira', 'Carapicuíba', 'Cotia', 'Itapevi', 'Santana de Parnaíba', 'Cajamar', 'Caieiras'],
  },
];

/** 'Santana de Parnaíba' -> 'SANTANA DE PARNAIBA', como está em radar_empresas.municipio. */
export const normalizarMunicipio = (nome: string): string =>
  nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Municípios da região já no formato do banco. */
export const municipiosDaRegiao = (r: RadarRegiao): string[] => r.municipios.map(normalizarMunicipio);

/** Id da região cujos municípios são exatamente os chips atuais, ou '' se for uma seleção própria. */
export const regiaoDosMunicipios = (uf: string, municipios: string[]): string => {
  const atual = [...municipios].map(normalizarMunicipio).sort().join('|');
  const r = REGIOES.find(x => x.uf === uf && municipiosDaRegiao(x).sort().join('|') === atual);
  return r?.id ?? '';
};
