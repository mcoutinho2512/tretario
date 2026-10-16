/**
 * Nível de qualidade ativo, visível para construtores de materiais (sem acoplar ao Game.ts).
 * Definido pelo GameRenderer ao ser criado (antes de qualquer material ser compilado).
 */
import type { QualityLevel } from '../core/settings';

export const renderQuality: { level: QualityLevel } = { level: 'high' };
