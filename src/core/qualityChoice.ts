/** Reexporta as funções de qualidade usadas pela tela inicial (módulo sem dependência do three.js). */
export { detectQuality, loadQualityChoice, saveQualityChoice, resolveQuality as resolveQualityChoice } from './settings';
export type { QualityChoice } from './settings';
